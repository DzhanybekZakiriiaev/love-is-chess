/**
 * Love is Chess — LAN Multiplayer Server
 * Run: node server.js
 * Listens on port 3001 (WebSocket + REST)
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const { randomBytes } = require('crypto');
const os = require('os');

/** Simple UUID v4 replacement using Node's built-in crypto — no ESM issues */
function uuidv4() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return [
    b.slice(0,4), b.slice(4,6), b.slice(6,8),
    b.slice(8,10), b.slice(10,16),
  ].map(x => x.toString('hex')).join('-');
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Allow CORS from React dev server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── In-memory state ───────────────────────────────────────────────────────────

/** sessionId → Session */
const sessions = new Map();

/** ws → ClientMeta */
const clients = new Map();

const PIECE_TYPES = ['K', 'Q', 'R', 'B', 'N', 'P'];

function makeSession(hostName, hostPlayerId) {
  return {
    id: uuidv4().slice(0, 6).toUpperCase(),
    hostName,
    hostPlayerId,
    /** [{ playerId, name, pieceType, isHost }] */
    players: [{ playerId: hostPlayerId, name: hostName, pieceType: null, isHost: true }],
    status: 'lobby', // 'lobby' | 'playing' | 'finished'
    /** Authoritative chess FEN, set once game starts */
    fen: null,
    createdAt: Date.now(),
  };
}

function serializeSession(s) {
  return {
    id:         s.id,
    hostName:   s.hostName,
    hostPlayerId: s.hostPlayerId,
    players:    s.players.map(p => ({ name: p.name, pieceType: p.pieceType, isHost: p.isHost })),
    status:     s.status,
    createdAt:  s.createdAt,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastToSession(sessionId, msg, excludePlayerId = null) {
  const session = sessions.get(sessionId);
  if (!session) return;
  for (const [ws, meta] of clients) {
    if (meta.sessionId !== sessionId) continue;
    if (excludePlayerId && meta.playerId === excludePlayerId) continue;
    send(ws, msg);
  }
}

function findWsByPlayerId(playerId) {
  for (const [ws, meta] of clients) {
    if (meta.playerId === playerId) return ws;
  }
  return null;
}

// ── REST endpoints ────────────────────────────────────────────────────────────

app.get('/api/sessions', (_req, res) => {
  const list = [];
  for (const s of sessions.values()) {
    if (s.status !== 'finished') list.push(serializeSession(s));
  }
  res.json(list);
});

app.get('/api/server-info', (_req, res) => {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  res.json({ ips, port: PORT });
});

// ── WebSocket handler ─────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  const playerId = uuidv4();
  clients.set(ws, { playerId, sessionId: null, name: '', pieceType: null });
  send(ws, { type: 'CONNECTED', playerId });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const meta    = clients.get(ws);
    if (!meta) return;

    switch (msg.type) {

      // ── CREATE SESSION ──────────────────────────────────────────────────────
      case 'CREATE_SESSION': {
        const name    = (msg.name || 'Host').slice(0, 24);
        const session = makeSession(name, meta.playerId);
        sessions.set(session.id, session);
        meta.sessionId = session.id;
        meta.name      = name;
        send(ws, { type: 'SESSION_CREATED', session: serializeSession(session) });
        break;
      }

      // ── JOIN SESSION ────────────────────────────────────────────────────────
      case 'JOIN_SESSION': {
        const session = sessions.get(msg.sessionId);
        if (!session) { send(ws, { type: 'ERROR', message: 'Session not found' }); return; }
        if (session.status !== 'lobby') { send(ws, { type: 'ERROR', message: 'Game already started' }); return; }
        if (session.players.find(p => p.playerId === meta.playerId)) {
          // Reconnection — just re-send session info
          send(ws, { type: 'SESSION_JOINED', session: serializeSession(session) });
          return;
        }
        const name   = (msg.name || 'Player').slice(0, 24);
        const player = { playerId: meta.playerId, name, pieceType: null, isHost: false };
        session.players.push(player);
        meta.sessionId = session.id;
        meta.name      = name;
        send(ws, { type: 'SESSION_JOINED', session: serializeSession(session) });
        broadcastToSession(session.id, {
          type: 'PLAYER_JOINED',
          player: { name, pieceType: null, isHost: false },
          session: serializeSession(session),
        }, meta.playerId);
        break;
      }

      // ── SELECT PIECE TYPE ───────────────────────────────────────────────────
      case 'SELECT_PIECE_TYPE': {
        const session = sessions.get(meta.sessionId);
        if (!session || session.status !== 'lobby') return;
        const pieceType = msg.pieceType;
        if (!PIECE_TYPES.includes(pieceType)) { send(ws, { type: 'ERROR', message: 'Invalid piece type' }); return; }

        // Check not already taken by someone else
        const taken = session.players.find(p => p.playerId !== meta.playerId && p.pieceType === pieceType);
        if (taken) { send(ws, { type: 'ERROR', message: `${pieceType} is already taken by ${taken.name}` }); return; }

        const player = session.players.find(p => p.playerId === meta.playerId);
        if (!player) return;
        player.pieceType = pieceType;
        meta.pieceType   = pieceType;

        broadcastToSession(session.id, {
          type:    'PIECE_TYPE_SELECTED',
          name:    meta.name,
          pieceType,
          session: serializeSession(session),
        });
        break;
      }

      // ── START GAME (host only) ──────────────────────────────────────────────
      case 'START_GAME': {
        const session = sessions.get(meta.sessionId);
        if (!session || meta.playerId !== session.hostPlayerId) return;
        if (session.status !== 'lobby') return;

        // At least one human player must have a piece type
        const hasPiece = session.players.some(p => p.pieceType !== null);
        if (!hasPiece) { send(ws, { type: 'ERROR', message: 'Select at least one piece type before starting' }); return; }

        session.status = 'playing';
        broadcastToSession(session.id, {
          type:    'GAME_STARTED',
          session: serializeSession(session),
        });
        break;
      }

      // ── GAME MOVE (from any player, relayed to others; host is authoritative) ──
      case 'GAME_MOVE': {
        const session = sessions.get(meta.sessionId);
        if (!session || session.status !== 'playing') return;
        // Relay to everyone else; include sender pieceType so peers know whose move it was
        broadcastToSession(session.id, {
          type:      'GAME_MOVE',
          from:      msg.from,
          to:        msg.to,
          promotion: msg.promotion || 'q',
          fen:       msg.fen,
          pieceType: meta.pieceType,
          playerName: meta.name,
        }, meta.playerId);
        break;
      }

      // ── PIECE STATES UPDATE (host broadcasts piece states to peers) ─────────
      case 'PIECE_STATES_UPDATE': {
        const session = sessions.get(meta.sessionId);
        if (!session || meta.playerId !== session.hostPlayerId) return;
        broadcastToSession(session.id, {
          type:        'PIECE_STATES_UPDATE',
          pieceStates: msg.pieceStates,
          fen:         msg.fen,
          lastMove:    msg.lastMove,
          isThinking:  msg.isThinking,
          gameOver:    msg.gameOver,
        }, meta.playerId);
        break;
      }

      // ── CHAT MESSAGE (King player only can send to pieces) ──────────────────
      case 'CHAT_TO_PIECE': {
        const session = sessions.get(meta.sessionId);
        if (!session) return;
        if (meta.pieceType !== 'K') {
          send(ws, { type: 'ERROR', message: 'Only the King commander can relay messages to pieces' });
          return;
        }
        broadcastToSession(session.id, {
          type:       'CHAT_TO_PIECE',
          from:       meta.name,
          square:     msg.square,
          message:    msg.message,
        }, meta.playerId);
        break;
      }

      // ── CHAT BETWEEN PLAYERS ────────────────────────────────────────────────
      case 'PLAYER_CHAT': {
        const session = sessions.get(meta.sessionId);
        if (!session) return;
        broadcastToSession(session.id, {
          type:    'PLAYER_CHAT',
          from:    meta.name,
          message: msg.message,
        }, meta.playerId);
        break;
      }

      // ── KING → PIECE-PLAYER TEXT CHAT ───────────────────────────────────────
      case 'KING_CHAT': {
        const session = sessions.get(meta.sessionId);
        if (!session || meta.pieceType !== 'K') return;
        const target = session.players.find(p => p.pieceType === msg.targetPieceType);
        if (!target) return;
        const tWs = findWsByPlayerId(target.playerId);
        if (tWs) send(tWs, { type: 'KING_CHAT', text: msg.text, fromName: meta.name });
        break;
      }

      // ── PIECE-PLAYER → KING REPLY ────────────────────────────────────────────
      case 'PIECE_PLAYER_REPLY': {
        const session = sessions.get(meta.sessionId);
        if (!session) return;
        const king = session.players.find(p => p.pieceType === 'K');
        if (!king) return;
        const kWs = findWsByPlayerId(king.playerId);
        if (kWs) send(kWs, {
          type:       'PIECE_PLAYER_REPLY',
          pieceType:  meta.pieceType,
          senderName: meta.name,
          text:       msg.text,
        });
        break;
      }

      // ── WEBRTC SIGNALING (King ↔ piece-type player) ─────────────────────────

      // King sends offer → relay to target piece type's player
      case 'WEBRTC_OFFER': {
        const session = sessions.get(meta.sessionId);
        if (!session || meta.pieceType !== 'K') return;
        const target = session.players.find(p => p.pieceType === msg.targetPieceType);
        if (!target) return; // Claude-controlled, no call
        const targetWs = findWsByPlayerId(target.playerId);
        if (!targetWs) return;
        send(targetWs, { type: 'WEBRTC_OFFER', sdp: msg.sdp, fromName: meta.name });
        break;
      }

      // Target player answers → relay back to King
      case 'WEBRTC_ANSWER': {
        const session = sessions.get(meta.sessionId);
        if (!session) return;
        const kingPlayer = session.players.find(p => p.pieceType === 'K');
        if (!kingPlayer) return;
        const kingWs = findWsByPlayerId(kingPlayer.playerId);
        if (!kingWs) return;
        send(kingWs, { type: 'WEBRTC_ANSWER', sdp: msg.sdp, fromPieceType: meta.pieceType });
        break;
      }

      // ICE candidate — King→target or target→King
      case 'WEBRTC_ICE': {
        const session = sessions.get(meta.sessionId);
        if (!session) return;
        if (meta.pieceType === 'K') {
          const target = session.players.find(p => p.pieceType === msg.targetPieceType);
          if (!target) return;
          const tWs = findWsByPlayerId(target.playerId);
          if (tWs) send(tWs, { type: 'WEBRTC_ICE', candidate: msg.candidate });
        } else {
          const kingPlayer = session.players.find(p => p.pieceType === 'K');
          if (!kingPlayer) return;
          const kWs = findWsByPlayerId(kingPlayer.playerId);
          if (kWs) send(kWs, { type: 'WEBRTC_ICE', candidate: msg.candidate });
        }
        break;
      }

      // Either side ends the call — notify the other
      case 'CALL_END': {
        const session = sessions.get(meta.sessionId);
        if (!session) return;
        if (meta.pieceType === 'K') {
          const target = session.players.find(p => p.pieceType === msg.targetPieceType);
          if (!target) return;
          const tWs = findWsByPlayerId(target.playerId);
          if (tWs) send(tWs, { type: 'CALL_END' });
        } else {
          const kingPlayer = session.players.find(p => p.pieceType === 'K');
          if (!kingPlayer) return;
          const kWs = findWsByPlayerId(kingPlayer.playerId);
          if (kWs) send(kWs, { type: 'CALL_END', fromPieceType: meta.pieceType });
        }
        break;
      }

      // ── LEAVE SESSION ───────────────────────────────────────────────────────
      case 'LEAVE_SESSION': {
        handleLeave(ws, meta);
        break;
      }
    }
  });

  ws.on('close', () => {
    const meta = clients.get(ws);
    if (meta) handleLeave(ws, meta);
    clients.delete(ws);
  });
});

function handleLeave(ws, meta) {
  if (!meta.sessionId) return;
  const session = sessions.get(meta.sessionId);
  if (!session) return;

  session.players = session.players.filter(p => p.playerId !== meta.playerId);
  broadcastToSession(session.id, {
    type:    'PLAYER_LEFT',
    name:    meta.name,
    session: serializeSession(session),
  });

  if (session.players.length === 0) {
    sessions.delete(session.id);
  } else if (session.hostPlayerId === meta.playerId && session.players.length > 0) {
    // Transfer host to next player
    session.hostPlayerId = session.players[0].playerId;
    session.players[0].isHost = true;
    broadcastToSession(session.id, {
      type:    'HOST_CHANGED',
      newHostName: session.players[0].name,
      session: serializeSession(session),
    });
  }

  meta.sessionId = null;
  meta.pieceType = null;
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║       Love is Chess — Multiplayer Server          ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Local:    ws://localhost:${PORT}                   ║`);
  ips.forEach(ip => {
    const padded = `ws://${ip}:${PORT}`.padEnd(42);
    console.log(`║  LAN:      ${padded} ║`);
  });
  console.log('║                                                   ║');
  console.log('║  Share your LAN IP with friends on the network   ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
});
