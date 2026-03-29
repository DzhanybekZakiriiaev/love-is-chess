/**
 * Multiplayer WebSocket service.
 * Wraps the WebSocket connection and provides typed send/receive helpers.
 */

const DEFAULT_SERVER = 'ws://localhost:3001';
const HTTP_SERVER    = 'http://localhost:3001';

class MultiplayerService {
  constructor() {
    this.ws          = null;
    this.playerId    = null;
    this.serverUrl   = DEFAULT_SERVER;
    this.httpUrl     = HTTP_SERVER;
    this._listeners  = {};
    this._connected  = false;
    this._reconnectTimer = null;
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  connect(serverUrl) {
    if (serverUrl) {
      this.serverUrl = serverUrl.startsWith('ws') ? serverUrl : `ws://${serverUrl}`;
      // Derive HTTP URL from WS URL
      this.httpUrl = this.serverUrl.replace(/^ws(s?):\/\//, 'http$1://');
    }
    return new Promise((resolve, reject) => {
      try {
        if (this.ws) { this.ws.close(); this.ws = null; }
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          this._connected = true;
          clearTimeout(this._reconnectTimer);
        };

        this.ws.onmessage = (e) => {
          let msg;
          try { msg = JSON.parse(e.data); } catch { return; }

          if (msg.type === 'CONNECTED') {
            this.playerId = msg.playerId;
            resolve(msg.playerId);
          }

          this._emit(msg.type, msg);
        };

        this.ws.onerror = (err) => {
          this._connected = false;
          reject(new Error('Cannot connect to multiplayer server'));
        };

        this.ws.onclose = () => {
          this._connected = false;
          this._emit('DISCONNECTED', {});
        };

        // Timeout after 5 s
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect() {
    if (this.ws) { this.ws.close(); this.ws = null; }
    this._connected = false;
    this.playerId   = null;
  }

  get connected() { return this._connected && this.ws?.readyState === WebSocket.OPEN; }

  // ── Send helpers ────────────────────────────────────────────────────────────

  send(msg) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
  }

  createSession(name) { this.send({ type: 'CREATE_SESSION', name }); }
  joinSession(sessionId, name) { this.send({ type: 'JOIN_SESSION', sessionId, name }); }
  selectPieceType(pieceType) { this.send({ type: 'SELECT_PIECE_TYPE', pieceType }); }
  startGame() { this.send({ type: 'START_GAME' }); }
  leaveSession() { this.send({ type: 'LEAVE_SESSION' }); }

  sendMove(from, to, fen, promotion = 'q') {
    this.send({ type: 'GAME_MOVE', from, to, fen, promotion });
  }

  sendPieceStatesUpdate(pieceStates, fen, lastMove, isThinking, gameOver) {
    this.send({ type: 'PIECE_STATES_UPDATE', pieceStates, fen, lastMove, isThinking, gameOver });
  }

  sendChatToPiece(square, message) {
    this.send({ type: 'CHAT_TO_PIECE', square, message });
  }

  sendPlayerChat(message) {
    this.send({ type: 'PLAYER_CHAT', message });
  }

  sendWebRTCOffer(targetPieceType, sdp) {
    this.send({ type: 'WEBRTC_OFFER', targetPieceType, sdp });
  }

  sendWebRTCAnswer(sdp) {
    this.send({ type: 'WEBRTC_ANSWER', sdp });
  }

  sendWebRTCIce(targetPieceType, candidate) {
    this.send({ type: 'WEBRTC_ICE', targetPieceType, candidate });
  }

  sendCallEnd(targetPieceType) {
    this.send({ type: 'CALL_END', targetPieceType });
  }

  // ── REST helpers ─────────────────────────────────────────────────────────────

  async fetchSessions() {
    const res = await fetch(`${this.httpUrl}/api/sessions`);
    if (!res.ok) throw new Error('Failed to fetch sessions');
    return res.json();
  }

  async fetchServerInfo() {
    const res = await fetch(`${this.httpUrl}/api/server-info`);
    if (!res.ok) throw new Error('Failed to fetch server info');
    return res.json();
  }

  // ── Event emitter ────────────────────────────────────────────────────────────

  on(type, handler) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter(h => h !== handler);
  }

  _emit(type, data) {
    (this._listeners[type] || []).forEach(h => h(data));
    (this._listeners['*'] || []).forEach(h => h({ type, ...data }));
  }
}

/** Singleton service shared across the app */
export const mpService = new MultiplayerService();
export default mpService;
