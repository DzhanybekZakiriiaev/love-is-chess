/**
 * useMultiplayerGame — wraps useChessGame with LAN multiplayer networking.
 *
 * Architecture:
 *  - HOST:     Runs full game logic (useChessGame).  Broadcasts state to peers.
 *              Validates & applies moves sent by peer players.
 *              Runs Claude for unassigned white piece types + all black pieces.
 *  - NON-HOST: Receives game state from host.  Can only move pieces of their type.
 *              Sends move requests to host.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Chess } from 'chess.js';
import {
  getPieceGreeting,
  getPieceResponse,
  getPieceMoveResponse,
  getPieceRefusalResponse,
} from '../services/claudeService';
import {
  buildPieceSystemPrompt,
  getTraitsForInstance,
  getNameForInstance,
  PIECE_META,
} from '../data/piecePersonalities';
import { speakText, stopSpeaking } from '../services/voiceService';
import mpService from '../services/multiplayerService';

// ── Helpers (duplicated from useChessGame to keep this hook self-contained) ──

function buildVisibleBoard(chess, square) {
  const piece = chess.get(square);
  if (!piece) return { friendly: [], enemy: [], threatened: false };
  const pieceMoves    = chess.moves({ square, verbose: true });
  const visibleSquares = new Set([square, ...pieceMoves.map(m => m.to)]);
  const friendly = [], enemy = [];
  visibleSquares.forEach(sq => {
    if (sq === square) return;
    const p = chess.get(sq);
    if (!p) return;
    const meta = PIECE_META[p.type.toUpperCase()];
    const label = meta?.name || p.type;
    if (p.color === piece.color) friendly.push(`${label} at ${sq}`);
    else                         enemy.push(`${label} at ${sq}`);
  });
  let threatened = false;
  try { threatened = chess.isAttacked(square, piece.color === 'w' ? 'b' : 'w'); } catch {}
  return { friendly, enemy, threatened };
}

function initPieceStates(chess) {
  const states = {};
  const files  = 'abcdefgh';
  const counts = {};
  chess.board().forEach((row, r) => {
    row.forEach((p, c) => {
      if (!p || p.color !== 'w') return;
      const sq   = files[c] + (8 - r);
      const type = p.type.toUpperCase();
      const idx  = counts[type] ?? 0;
      counts[type] = idx + 1;
      states[sq] = {
        trust: type === 'K' ? 100 : 40,
        love:  type === 'K' ? 100 : 50,
        instanceId: idx,
        name:  getNameForInstance(type, idx),
        traits: getTraitsForInstance(type, idx),
        messages: [],
      };
    });
  });
  return states;
}

function makeAiMove(chess, lastBlackPieceSquare) {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  const scored = moves.map(m => {
    let score = Math.random() * 14;
    if (m.captured) score += 100;
    if (m.promotion) score += 45;
    if (lastBlackPieceSquare && m.from === lastBlackPieceSquare) score -= 80;
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const tier = scored.filter(x => x.score >= best - 30).slice(0, 7);
  return tier[Math.floor(Math.random() * tier.length)].m;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} config
 * @param {boolean}  config.isHost       - Whether this client is the session host
 * @param {string}   config.myPieceType  - The piece type letter this player controls (or null if Claude)
 * @param {object}   config.session      - Session object from server
 * @param {string}   config.playerName   - This player's display name
 */
export function useMultiplayerGame({ isHost, myPieceType, session, playerName }) {
  const chessRef = useRef(new Chess());
  const chess    = chessRef.current;
  const msgId    = useRef(1);
  const nextId   = () => msgId.current++;

  const [board,         setBoard]         = useState(() => chess.board());
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [pieceStates,   setPieceStates]   = useState(() => initPieceStates(chess));
  const [lastMove,      setLastMove]      = useState(null);
  const [isThinking,    setIsThinking]    = useState(false);
  const [gameOver,      setGameOver]      = useState(false);
  const [eventLog,      setEventLog]      = useState([
    { id: 0, type: 'system', text: 'Multiplayer game started. Click your pieces to move them.' },
  ]);
  const [playerChatLog, setPlayerChatLog] = useState([]);

  const pieceStatesRef   = useRef(pieceStates);
  const selectedPieceRef = useRef(selectedPiece);
  const lastBlackRef     = useRef(null);

  pieceStatesRef.current   = pieceStates;
  selectedPieceRef.current = selectedPiece;

  // Human-assigned piece types from session (for all players)
  const assignedTypes = useMemo(() =>
    (session?.players || []).map(p => p.pieceType).filter(Boolean),
    [session]
  );

  // Types controlled by Claude (not assigned to any human)
  const claudeTypes = useMemo(() =>
    ['K','Q','R','B','N','P'].filter(t => !assignedTypes.includes(t)),
    [assignedTypes]
  );

  const refreshBoard = () => setBoard(chess.board().map(r => [...r]));

  // ── Piece state helpers ─────────────────────────────────────────────────

  function addMsgToPiece(square, msg) {
    setPieceStates(prev => {
      const s = prev[square];
      if (!s) return prev;
      return { ...prev, [square]: { ...s, messages: [...s.messages, { id: nextId(), ...msg }] } };
    });
  }

  function updateMsgInPiece(square, mid, newText) {
    setPieceStates(prev => {
      const s = prev[square];
      if (!s) return prev;
      return { ...prev, [square]: { ...s, messages: s.messages.map(m => m.id === mid ? { ...m, text: newText } : m) } };
    });
  }

  async function streamPieceMsg(square, type, fetchFn) {
    const id = nextId();
    addMsgToPiece(square, { id, type: 'piece', pieceType: type, text: '' });
    let finalText = '';
    try {
      finalText = await fetchFn((partial) => updateMsgInPiece(square, id, partial));
    } catch (e) {
      updateMsgInPiece(square, id, e.message === 'NO_API_KEY'
        ? 'Claude API key not set — open Settings.'
        : `Error: ${e.message}`);
      throw e;
    }
    speakText(finalText, type, {
      onlyIf: () => selectedPieceRef.current?.square === square && chess.get(square)?.color === 'w',
    });
    return finalText;
  }

  function adjustStats(square, td = 0, ld = 0) {
    setPieceStates(prev => {
      const s = prev[square];
      if (!s) return prev;
      return { ...prev, [square]: { ...s, trust: Math.max(0, Math.min(100, s.trust + td)), love: Math.max(0, Math.min(100, s.love + ld)) } };
    });
  }

  function relocatePiece(from, to, td = 0, ld = 0) {
    setPieceStates(prev => {
      if (!prev[from]) return prev;
      const s = prev[from];
      const next = { ...prev };
      next[to] = { ...s, trust: Math.max(0, Math.min(100, s.trust + td)), love: Math.max(0, Math.min(100, s.love + ld)) };
      delete next[from];
      return next;
    });
  }

  // ── Broadcast state (host only) ─────────────────────────────────────────

  // Broadcast after any state change (host only, debounced slightly)
  const broadcastTimer = useRef(null);

  function broadcastState(extraPieceStates, extraFen, extraLastMove, extraThinking, extraGameOver) {
    if (!isHost) return;
    clearTimeout(broadcastTimer.current);
    broadcastTimer.current = setTimeout(() => {
      const states = extraPieceStates ?? pieceStatesRef.current;
      // Strip messages to reduce bandwidth (peers don't get chat history)
      const stripped = {};
      Object.entries(states).forEach(([sq, s]) => {
        stripped[sq] = { trust: s.trust, love: s.love, name: s.name, traits: s.traits, instanceId: s.instanceId };
      });
      mpService.sendPieceStatesUpdate(
        stripped,
        extraFen ?? chess.fen(),
        extraLastMove ?? lastMove,
        extraThinking ?? false,
        extraGameOver ?? gameOver,
      );
    }, 80);
  }

  // ── Receive state (non-host) ────────────────────────────────────────────

  useEffect(() => {
    if (isHost) return; // host doesn't listen to state updates from itself

    const unsubs = [
      mpService.on('PIECE_STATES_UPDATE', (msg) => {
        // Apply FEN
        try { chess.load(msg.fen); } catch {}
        refreshBoard();
        setLastMove(msg.lastMove);
        setIsThinking(msg.isThinking);
        setGameOver(msg.gameOver);
        // Merge piece states (preserve our chat messages)
        setPieceStates(prev => {
          const next = {};
          Object.entries(msg.pieceStates || {}).forEach(([sq, s]) => {
            next[sq] = {
              ...s,
              messages: prev[sq]?.messages || [],
            };
          });
          return next;
        });
      }),

      mpService.on('GAME_MOVE', (msg) => {
        // Peer applied a move — apply it here too
        try {
          chess.move({ from: msg.from, to: msg.to, promotion: msg.promotion || 'q' });
          refreshBoard();
          setLastMove({ from: msg.from, to: msg.to });
        } catch {}
        setEventLog(prev => [...prev, {
          id: nextId(), type: 'system',
          text: `${msg.playerName || '?'} moved their piece.`,
        }]);
      }),

      mpService.on('CHAT_TO_PIECE', (msg) => {
        // Knight player sent a chat to a piece square — show in that piece's messages
        addMsgToPiece(msg.square, { type: 'player', text: `[${msg.from}]: ${msg.message}` });
      }),

      mpService.on('PLAYER_CHAT', (msg) => {
        setPlayerChatLog(prev => [...prev, { from: msg.from, text: msg.message }]);
      }),
    ];

    return () => unsubs.forEach(fn => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  // ── Receive peer moves (HOST validates and applies) ─────────────────────

  useEffect(() => {
    if (!isHost) return;

    const unsubs = [
      mpService.on('GAME_MOVE', (msg) => {
        if (gameOver || chess.turn() !== 'w') return;
        // Validate the move belongs to the sender's piece type
        const piece = chess.get(msg.from);
        if (!piece || piece.color !== 'w') return;
        if (piece.type.toUpperCase() !== msg.pieceType) return;

        const result = chess.move({ from: msg.from, to: msg.to, promotion: msg.promotion || 'q' });
        if (!result) return;

        const newLm = { from: msg.from, to: msg.to };
        setLastMove(newLm);
        relocatePiece(msg.from, msg.to, 5, 3);
        refreshBoard();
        setEventLog(prev => [...prev, {
          id: nextId(), type: 'system',
          text: `${msg.playerName || '?'} moved ${msg.from}→${msg.to}.`,
        }]);
        broadcastState(pieceStatesRef.current, chess.fen(), newLm, false, chess.isGameOver());
        checkGameState();
        if (!chess.isGameOver()) setTimeout(() => runAiTurn(), 800);
      }),

      mpService.on('CHAT_TO_PIECE', (msg) => {
        // Knight player sent a message to a piece
        addMsgToPiece(msg.square, { type: 'player', text: `[${msg.from}]: ${msg.message}` });
      }),

      mpService.on('PLAYER_CHAT', (msg) => {
        setPlayerChatLog(prev => [...prev, { from: msg.from, text: msg.message }]);
      }),
    ];

    return () => unsubs.forEach(fn => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, gameOver]);

  // ── Game state check ────────────────────────────────────────────────────

  function checkGameState() {
    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White';
      setEventLog(p => [...p, { id: nextId(), type: 'system', text: `CHECKMATE — ${winner} wins!` }]);
      setGameOver(true);
    } else if (chess.isDraw()) {
      setEventLog(p => [...p, { id: nextId(), type: 'system', text: 'DRAW!' }]);
      setGameOver(true);
    } else if (chess.inCheck() && chess.turn() === 'w') {
      setEventLog(p => [...p, { id: nextId(), type: 'system', text: 'Your King is in CHECK!' }]);
    }
  }

  // ── AI turn (HOST only) ─────────────────────────────────────────────────

  function runAiTurn() {
    if (!isHost) return;
    setIsThinking(true);
    const move = makeAiMove(chess, lastBlackRef.current);
    if (!move) { setIsThinking(false); broadcastState(undefined, undefined, undefined, false); return; }

    chess.move(move);
    lastBlackRef.current = move.to;
    const newLm = { from: move.from, to: move.to };
    setLastMove(newLm);
    refreshBoard();

    if (move.captured) {
      setPieceStates(prev => {
        const next = { ...prev };
        delete next[move.to];
        Object.keys(next).forEach(sq => {
          next[sq] = { ...next[sq], trust: Math.max(0, next[sq].trust - 5), love: Math.max(0, next[sq].love - 5) };
        });
        return next;
      });
    }

    checkGameState();
    setIsThinking(false);
    broadcastState(undefined, chess.fen(), newLm, false, chess.isGameOver());

    // Now it's white's turn — if Claude controls certain white piece types,
    // auto-move a Claude-controlled white piece if available
    if (!chess.isGameOver() && chess.turn() === 'w') {
      setTimeout(() => runClaudeWhiteTurn(), 600);
    }
  }

  /**
   * If it's white's turn and there are Claude-controlled white pieces,
   * attempt an AI move for one of them.
   */
  function runClaudeWhiteTurn() {
    if (!isHost || gameOver) return;
    if (chess.turn() !== 'w') return;

    // Check if any human player needs to move (has unblocked pieces)
    const humanTypes = assignedTypes;
    const allWhiteMoves = chess.moves({ verbose: true });

    // Are there any moves available for human-controlled piece types?
    const humanCanMove = allWhiteMoves.some(m => {
      const p = chess.get(m.from);
      return p && humanTypes.includes(p.type.toUpperCase());
    });

    if (humanCanMove) return; // humans have moves to make, don't auto-move

    // Only Claude-controlled white pieces remain moveable — auto-move
    const claudeMoves = allWhiteMoves.filter(m => {
      const p = chess.get(m.from);
      return p && claudeTypes.includes(p.type.toUpperCase());
    });
    if (!claudeMoves.length) return;

    // Pick a random claude move
    const pick = claudeMoves[Math.floor(Math.random() * claudeMoves.length)];
    chess.move(pick);
    const newLm = { from: pick.from, to: pick.to };
    setLastMove(newLm);
    refreshBoard();
    setEventLog(prev => [...prev, { id: nextId(), type: 'system', text: `🤖 Claude moves ${pick.from}→${pick.to}` }]);
    broadcastState(pieceStatesRef.current, chess.fen(), newLm, false, chess.isGameOver());
    checkGameState();
    if (!chess.isGameOver()) setTimeout(() => runAiTurn(), 800);
  }

  // ── Fog of war for this player's piece type ─────────────────────────────

  /**
   * Returns the set of squares visible to this player's piece type.
   * If no piece type, return null (see everything — spectator).
   */
  const visibleSquares = useMemo(() => {
    if (!myPieceType) return null;  // spectator sees all
    if (myPieceType === 'K') return null; // King is the commander — sees the whole board
    const visible = new Set();
    chess.board().forEach((row, r) => {
      row.forEach((p, c) => {
        if (!p || p.color !== 'w') return;
        if (p.type.toUpperCase() !== myPieceType) return;
        const files = 'abcdefgh';
        const sq    = files[c] + (8 - r);
        visible.add(sq);
        chess.moves({ square: sq, verbose: true }).forEach(m => visible.add(m.to));
      });
    });
    return visible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, myPieceType]);

  // ── Valid moves for selected piece ──────────────────────────────────────

  const validMoves = useMemo(() => {
    if (!selectedPiece) return [];
    // Only show move highlights for pieces this player can actually move
    if (!canControlPiece(selectedPiece.square)) return [];
    try { return chess.moves({ square: selectedPiece.square, verbose: true }).map(m => m.to); }
    catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPiece, board]);

  // ── Can this player move this piece? ────────────────────────────────────

  function canControlPiece(square) {
    const p = chess.get(square);
    if (!p || p.color !== 'w') return false;
    if (!myPieceType) return false; // spectator can't move
    return p.type.toUpperCase() === myPieceType;
  }

  // ── Execute move ────────────────────────────────────────────────────────

  async function executeMove(square, type, targetSquare) {
    if (gameOver) return;
    const ps = pieceStatesRef.current[square];
    if (!ps) return;

    if (isHost) {
      // Host: apply directly
      if (chess.turn() !== 'w') return;
      const sysPrompt  = buildPieceSystemPrompt(type, ps.name, ps.traits, ps.trust, ps.love);
      const legalMoves = chess.moves({ square, verbose: true });
      const canMove    = legalMoves.some(m => m.to === targetSquare);

      setIsThinking(true);
      if (!canMove) {
        try {
          const vis = buildVisibleBoard(chess, square);
          await streamPieceMsg(square, type, (onChunk) =>
            getPieceRefusalResponse(sysPrompt, ps.name, square, targetSquare, vis, 'illegal', onChunk)
          );
        } catch {}
        adjustStats(square, -3, 0);
        setIsThinking(false);
        return;
      }

      const moveResult = chess.move({ from: square, to: targetSquare, promotion: 'q' });
      if (!moveResult) { setIsThinking(false); return; }

      const newVisBoard = buildVisibleBoard(chess, targetSquare);
      try {
        await streamPieceMsg(square, type, (onChunk) =>
          getPieceMoveResponse(sysPrompt, ps.name, square, targetSquare, newVisBoard, onChunk)
        );
      } catch {}

      const newLm = { from: square, to: targetSquare };
      relocatePiece(square, targetSquare, 5, 3);
      setSelectedPiece({ square: targetSquare, type });
      setLastMove(newLm);
      refreshBoard();
      checkGameState();

      // Broadcast before running AI
      broadcastState(pieceStatesRef.current, chess.fen(), newLm, false, chess.isGameOver());
      // Also send the move itself so non-hosts can animate it
      mpService.sendMove(square, targetSquare, chess.fen());

      setIsThinking(false);
      if (!chess.isGameOver()) setTimeout(() => runAiTurn(), 800);

    } else {
      // Non-host: send move request to host
      if (chess.turn() !== 'w') return;
      const piece = chess.get(square);
      if (!piece || piece.type.toUpperCase() !== myPieceType) return;

      // Optimistic: add player message
      addMsgToPiece(square, { type: 'player', text: `Go to ${targetSquare}` });

      // Show local response if king (can chat)
      if (myPieceType === 'K') {
        const sysPrompt = buildPieceSystemPrompt(type, ps.name, ps.traits, ps.trust, ps.love);
        const vis       = buildVisibleBoard(chess, square);
        setIsThinking(true);
        try {
          await streamPieceMsg(square, type, (onChunk) =>
            getPieceMoveResponse(sysPrompt, ps.name, square, targetSquare, vis, onChunk)
          );
        } catch {}
        setIsThinking(false);
      }

      // Send to host
      mpService.sendMove(square, targetSquare, chess.fen());
    }
  }

  // ── Square click ────────────────────────────────────────────────────────

  const handleSquareClick = useCallback(async (square) => {
    if (gameOver) return;
    const piece = chess.get(square);
    const cur   = selectedPieceRef.current;

    // Clicking a valid target square → move command (only for pieces this player controls)
    if (cur && chess.turn() === 'w' && canControlPiece(cur.square)) {
      if ((!piece && validMoves.includes(square)) || (piece?.color === 'b')) {
        addMsgToPiece(cur.square, { type: 'player', text: `Go to ${square}` });
        executeMove(cur.square, cur.type, square);
        return;
      }
    }

    if (!piece) {
      stopSpeaking();
      setSelectedPiece(null);
      return;
    }
    if (piece.color !== 'w') return;

    const type = piece.type.toUpperCase();

    // King can select any white piece (for chat).
    // Other players can only select their own piece type.
    if (myPieceType !== 'K' && !canControlPiece(square)) {
      setEventLog(prev => [...prev, { id: nextId(), type: 'system', text: `You control the ${myPieceType || '?'} pieces only.` }]);
      return;
    }

    if (cur?.square === square) {
      stopSpeaking();
      setSelectedPiece(null);
      return;
    }
    if (cur && cur.square !== square) stopSpeaking();
    setSelectedPiece({ square, type });

    // First-time greeting (only King player can trigger full chat with any piece)
    const ps = pieceStatesRef.current[square];
    if (ps && ps.messages.length === 0 && !isThinking && type !== 'K' && myPieceType === 'K') {
      setIsThinking(true);
      try {
        const sysPrompt = buildPieceSystemPrompt(type, ps.name, ps.traits, ps.trust, ps.love);
        const vis       = buildVisibleBoard(chess, square);
        await streamPieceMsg(square, type, (onChunk) =>
          getPieceGreeting(sysPrompt, ps.name, square, vis, onChunk)
        );
      } catch {}
      setIsThinking(false);
    } else if (ps && ps.messages.length === 0 && !isThinking && type !== 'K' && myPieceType === type) {
      // Non-knight players get a brief greeting from their own piece type
      setIsThinking(true);
      try {
        const sysPrompt = buildPieceSystemPrompt(type, ps.name, ps.traits, ps.trust, ps.love);
        const vis       = buildVisibleBoard(chess, square);
        await streamPieceMsg(square, type, (onChunk) =>
          getPieceGreeting(sysPrompt, ps.name, square, vis, onChunk)
        );
      } catch {}
      setIsThinking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver, validMoves, isThinking, myPieceType]);

  // ── Player chat with piece (King player only can chat with any piece) ──────

  const handlePlayerChat = useCallback(async (message) => {
    if (!message.trim()) return;
    const cur = selectedPieceRef.current;
    if (!cur) return;

    // Only King players can chat with pieces in multiplayer
    if (myPieceType !== 'K') {
      setEventLog(prev => [...prev, { id: nextId(), type: 'system', text: 'Only the King commander can speak to pieces.' }]);
      return;
    }

    const { square, type } = cur;
    const ps = pieceStatesRef.current[square];
    if (!ps) return;

    addMsgToPiece(square, { type: 'player', text: message });

    // Broadcast to others that a chat was sent
    mpService.sendChatToPiece(square, message);

    // Check for move intent
    const lower = message.toLowerCase();
    const squareMatch = lower.match(/(?<![a-z])([a-h][1-8])(?![0-9])/);
    const targetSquare = squareMatch?.[1];
    const isMoveCommand = targetSquare || /\b(go|move|advance|march|charge|attack|take|capture)\b/.test(lower);

    if (isMoveCommand && targetSquare && chess.turn() === 'w') {
      await executeMove(square, type, targetSquare);
      return;
    }

    adjustStats(square, 0, 3);
    setIsThinking(true);
    try {
      const sysPrompt = buildPieceSystemPrompt(type, ps.name, ps.traits, ps.trust, ps.love);
      const vis       = buildVisibleBoard(chess, square);
      await streamPieceMsg(square, type, (onChunk) =>
        getPieceResponse(sysPrompt, ps.name, square, vis, message, onChunk)
      );
    } catch {}
    setIsThinking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPieceType]);

  // ── Reset ───────────────────────────────────────────────────────────────

  function resetGame() {
    stopSpeaking();
    chess.reset();
    setBoard(chess.board());
    setSelectedPiece(null);
    setPieceStates(initPieceStates(chess));
    setLastMove(null);
    setGameOver(false);
    setEventLog([{ id: nextId(), type: 'system', text: 'New game.' }]);
    if (isHost) broadcastState(initPieceStates(chess), chess.fen(), null, false, false);
  }

  return {
    board,
    selectedPiece,
    validMoves,
    visibleSquares,
    pieceStates,
    lastMove,
    eventLog,
    playerChatLog,
    isThinking,
    gameOver,
    chess,
    myPieceType,
    canControlPiece,
    handleSquareClick,
    handlePlayerChat,
    resetGame,
    claudeTypes,
    assignedTypes,
  };
}
