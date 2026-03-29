import { useState, useCallback, useRef, useMemo, useLayoutEffect, useEffect } from 'react';
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

// ── Move intent parser ────────────────────────────────────────────────────────
function parseMoveIntent(message) {
  const lower = message.toLowerCase();
  const squareMatch = lower.match(/(?<![a-z])([a-h][1-8])(?![0-9])/);
  const targetSquare = squareMatch ? squareMatch[1] : null;
  const isMoveCommand =
    targetSquare !== null ||
    /\b(go|move|advance|march|charge|attack|take|capture|forward|step|to)\b/.test(lower);
  return { targetSquare, isMoveCommand };
}

// ── Fog of war ────────────────────────────────────────────────────────────────
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

// ── Per-piece state init ──────────────────────────────────────────────────────
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
        trust:      type === 'K' ? 100 : 40,
        love:       type === 'K' ? 100 : 50,
        instanceId: idx,
        name:       getNameForInstance(type, idx),
        traits:     getTraitsForInstance(type, idx),
        messages:   [],
      };
    });
  });

  return states;
}

/** Below this trust, a white piece (except the King) defects — becomes Black and is bot-controlled. */
export const DEFECT_TRUST_THRESHOLD = 10;

function squareRank(sq) {
  return parseInt(sq[1], 10);
}

/** Any white unit on rank 5+ (crossed the midline toward Black). */
function whiteInvadesBlackHalf(chess) {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== 'w') continue;
      const rank = 8 - r;
      if (rank >= 5) return true;
    }
  }
  return false;
}

/** Black has at least one piece on rank 4 or below (deep in White's camp) — easy to overpress. */
function blackOverextended(chess) {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== 'b') continue;
      const rank = 8 - r;
      if (rank <= 4) return true;
    }
  }
  return false;
}

/**
 * Heuristic bot: prefers captures, reacts when White advances early, avoids moving the same
 * black piece twice in a row when alternatives exist, and discourages reckless deep pushes in the opening.
 */
function makeAiMove(chess, lastBlackPieceSquare) {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;

  const halfMoves = chess.history().length;
  const opening = halfMoves < 24;
  const invaded = opening && whiteInvadesBlackHalf(chess);
  const overext = opening && blackOverextended(chess);

  const scored = moves.map(m => {
    let score = Math.random() * 14;
    const toRank = squareRank(m.to);
    const fromRank = squareRank(m.from);

    if (m.captured) score += 100;
    if (m.promotion) score += 45;

    if (lastBlackPieceSquare && m.from === lastBlackPieceSquare) score -= 80;

    if (invaded) {
      if (m.captured) score += 35;
      if (m.san.includes('+')) score += 28;
    }

    if (overext && !m.captured) {
      if (toRank <= 3) score -= 60;
      if (toRank <= 2) score -= 35;
      if (fromRank >= 7 && m.piece !== 'p') score += 20;
    }

    if (opening && !overext && ['n', 'b'].includes(m.piece) && fromRank === 8) score += 14;

    if (opening && !overext && m.piece === 'p') {
      const central = ['d5', 'e5', 'd6', 'e6', 'c6', 'f6', 'c5', 'f5'];
      if (central.includes(m.to)) score += 20;
    }

    return { m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const tier = scored.filter(x => x.score >= best - 30);
  const pool = tier.slice(0, Math.min(tier.length, 7));
  return pool[Math.floor(Math.random() * pool.length)].m;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useChessGame() {
  const chessRef = useRef(new Chess());
  const chess    = chessRef.current;
  const msgId    = useRef(1);
  const nextId   = () => msgId.current++;

  const [board,         setBoard]         = useState(() => chess.board());
  const [selectedPiece, setSelectedPiece] = useState(null); // { square, type }
  const [pieceStates,   setPieceStates]   = useState(() => initPieceStates(chess));
  const [lastMove,      setLastMove]      = useState(null);
  const [isThinking,    setIsThinking]    = useState(false);
  const [gameOver,      setGameOver]      = useState(false);
  const [eventLog,      setEventLog]      = useState([
    { id: 0, type: 'system', text: 'Click any white piece to open its chat.' },
  ]);

  // Keep refs in sync for reading inside async callbacks
  const pieceStatesRef   = useRef(pieceStates);
  const selectedPieceRef = useRef(selectedPiece);
  /** Square where the black piece that last moved currently sits (avoid same piece two turns in a row). */
  const lastBlackPieceSquareRef = useRef(null);
  pieceStatesRef.current   = pieceStates;
  selectedPieceRef.current = selectedPiece;

  const refreshBoard = () => setBoard(chess.board().map(r => [...r]));

  // Close chat if the selected white piece is gone (e.g. captured by Black) or square is not white.
  useEffect(() => {
    if (!selectedPiece) return;
    const p = chess.get(selectedPiece.square);
    if (!p || p.color !== 'w') {
      stopSpeaking();
      selectedPieceRef.current = null;
      setSelectedPiece(null);
    }
  }, [board, selectedPiece, chess]);

  // ── Piece state helpers ───────────────────────────────────────────────────

  function addMsgToPiece(square, msg) {
    setPieceStates(prev => {
      const s = prev[square];
      if (!s) return prev;
      return { ...prev, [square]: { ...s, messages: [...s.messages, { id: nextId(), ...msg }] } };
    });
  }

  function updateMsgInPiece(square, msgId, newText) {
    setPieceStates(prev => {
      const s = prev[square];
      if (!s) return prev;
      return {
        ...prev,
        [square]: { ...s, messages: s.messages.map(m => m.id === msgId ? { ...m, text: newText } : m) },
      };
    });
  }

  // Stream a piece response: adds empty placeholder → fills chunk by chunk
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
      setPieceStates(prev => {
        const s = prev[square];
        if (!s) return prev;
        return { ...prev, [square]: { ...s, messages: s.messages.map(m => m.id === id ? { ...m, type: 'error' } : m) } };
      });
      throw e;
    }
    speakText(finalText, type, {
      onlyIf: () =>
        selectedPieceRef.current?.square === square &&
        chess.get(square)?.color === 'w',
    });
    return finalText;
  }

  function adjustStats(square, trustDelta = 0, loveDelta = 0) {
    setPieceStates(prev => {
      const s = prev[square];
      if (!s) return prev;
      return {
        ...prev,
        [square]: {
          ...s,
          trust: Math.max(0, Math.min(100, s.trust + trustDelta)),
          love:  Math.max(0, Math.min(100, s.love  + loveDelta)),
        },
      };
    });
  }

  // Move piece state atomically
  function relocatePiece(from, to, trustDelta = 0, loveDelta = 0) {
    setPieceStates(prev => {
      if (!prev[from]) return prev;
      const s    = prev[from];
      const next = { ...prev };
      next[to]   = {
        ...s,
        trust: Math.max(0, Math.min(100, s.trust + trustDelta)),
        love:  Math.max(0, Math.min(100, s.love  + loveDelta)),
      };
      delete next[from];
      return next;
    });
  }

  // ── Game state checks ─────────────────────────────────────────────────────

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
      // All pieces lose trust and love when King is endangered
      const files = 'abcdefgh';
      chess.board().forEach((row, r) => row.forEach((p, c) => {
        if (p?.color === 'w') adjustStats(files[c] + (8 - r), -10, -5);
      }));
    }
  }

  // When trust drops below threshold, convert piece to Black in chess.js and drop personality state.
  useLayoutEffect(() => {
    const victims = Object.entries(pieceStates).filter(
      ([, s]) => s.trust < DEFECT_TRUST_THRESHOLD
    );
    if (victims.length === 0) return;

    const defectedSquares = [];
    const logLines = [];

    for (const [sq, s] of victims) {
      const p = chess.get(sq);
      if (!p || p.color !== 'w' || p.type === 'k') continue;
      const pieceType = p.type;
      chess.remove(sq);
      if (!chess.put({ type: pieceType, color: 'b' }, sq)) {
        chess.put({ type: pieceType, color: 'w' }, sq);
        continue;
      }
      defectedSquares.push(sq);
      const typeLabel = PIECE_META[pieceType.toUpperCase()]?.name || pieceType;
      logLines.push(`${s.name} (${typeLabel}) has lost all trust — she now fights for Black.`);
    }

    if (defectedSquares.length === 0) return;

    setPieceStates(prev => {
      const next = { ...prev };
      defectedSquares.forEach(sq => {
        delete next[sq];
      });
      return next;
    });

    if (selectedPieceRef.current && defectedSquares.includes(selectedPieceRef.current.square)) {
      stopSpeaking();
      selectedPieceRef.current = null;
      setSelectedPiece(null);
    }

    setEventLog(ev => [
      ...ev,
      ...logLines.map(text => ({ id: nextId(), type: 'system', text })),
    ]);
    refreshBoard();
    checkGameState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceStates]);

  // ── AI turn ───────────────────────────────────────────────────────────────

  function runAiTurn() {
    setIsThinking(true);

    const move = makeAiMove(chess, lastBlackPieceSquareRef.current);
    if (!move) { setIsThinking(false); return; }

    const capturedType = move.captured?.toUpperCase() || null;

    chess.move(move);
    lastBlackPieceSquareRef.current = move.to;
    setLastMove({ from: move.from, to: move.to });
    refreshBoard();

    if (capturedType) {
      if (selectedPieceRef.current?.square === move.to) {
        stopSpeaking();
        selectedPieceRef.current = null;
        setSelectedPiece(null);
      }
      // Remove captured white piece state; surviving pieces lose trust & love
      setPieceStates(prev => {
        const next = { ...prev };
        delete next[move.to];
        Object.keys(next).forEach(sq => {
          next[sq] = {
            ...next[sq],
            trust: Math.max(0, next[sq].trust - 5),
            love:  Math.max(0, next[sq].love  - 5),
          };
        });
        return next;
      });
    }

    // Pieces under attack after the move lose trust & love
    const files = 'abcdefgh';
    setPieceStates(prev => {
      const next = { ...prev };
      chess.board().forEach((row, r) => row.forEach((p, c) => {
        if (!p || p.color !== 'w') return;
        const sq = files[c] + (8 - r);
        try {
          if (chess.isAttacked(sq, 'b') && next[sq]) {
            next[sq] = {
              ...next[sq],
              trust: Math.max(0, next[sq].trust - 8),
              love:  Math.max(0, next[sq].love  - 4),
            };
          }
        } catch {}
      }));
      return next;
    });

    checkGameState();
    setIsThinking(false);
  }

  // ── Valid moves + fog-of-war squares ─────────────────────────────────────

  const validMoves = useMemo(() => {
    if (!selectedPiece) return [];
    try {
      return chess.moves({ square: selectedPiece.square, verbose: true }).map(m => m.to);
    } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPiece, board]);

  const visibleSquares = useMemo(() => {
    if (!selectedPiece) return null;
    return new Set([selectedPiece.square, ...validMoves]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPiece, validMoves]);

  // ── Move execution ────────────────────────────────────────────────────────

  async function executeMoveCommand(square, type, targetSquare) {
    const ps = pieceStatesRef.current[square];
    if (!ps || isThinking) return;

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

    // Trust-based compliance
    const roll     = Math.random();
    const complies =
      ps.trust >= 75 ? true :
      ps.trust >= 50 ? true :
      ps.trust >= 25 ? roll < 0.72 :
      roll < 0.35;

    if (!complies) {
      try {
        const vis = buildVisibleBoard(chess, square);
        await streamPieceMsg(square, type, (onChunk) =>
          getPieceRefusalResponse(sysPrompt, ps.name, square, targetSquare, vis, 'willful', onChunk)
        );
      } catch {}
      adjustStats(square, -10, -3);
      setIsThinking(false);
      return;
    }

    const moveResult = chess.move({ from: square, to: targetSquare, promotion: 'q' });
    if (!moveResult) { setIsThinking(false); return; }

    const newVisBoard  = buildVisibleBoard(chess, targetSquare);
    const trustDelta   = 5 + (moveResult.captured ? 5 : 0);
    const loveDelta    = 3 + (moveResult.captured ? 3 : 0);

    try {
      await streamPieceMsg(square, type, (onChunk) =>
        getPieceMoveResponse(sysPrompt, ps.name, square, targetSquare, newVisBoard, onChunk)
      );
    } catch {}

    relocatePiece(square, targetSquare, trustDelta, loveDelta);

    setSelectedPiece({ square: targetSquare, type });
    setLastMove({ from: square, to: targetSquare });
    refreshBoard();

    if (moveResult.captured) {
      const capName = PIECE_META[moveResult.captured.toUpperCase()]?.name || moveResult.captured;
      setEventLog(p => [...p, {
        id: nextId(),
        type: 'capture',
        text: `${ps.name} (${PIECE_META[type]?.name}) captured enemy ${capName}!`,
      }]);
    }

    checkGameState();
    if (!chess.isGameOver()) setTimeout(() => runAiTurn(), 800);
    setIsThinking(false);
  }

  // ── Square click: select or command ──────────────────────────────────────

  const handleSquareClick = useCallback(async (square) => {
    if (gameOver) return;
    const piece = chess.get(square);
    const cur   = selectedPieceRef.current;

    // Clicking an enemy square → treat as move command
    if (piece?.color === 'b' && chess.turn() === 'w') {
      if (cur) {
        addMsgToPiece(cur.square, { type: 'player', text: `Go to ${square}` });
        executeMoveCommand(cur.square, cur.type, square);
      }
      return;
    }

    // Clicking a valid empty square → quick move command
    if (cur && !piece && validMoves.includes(square) && chess.turn() === 'w') {
      addMsgToPiece(cur.square, { type: 'player', text: `Go to ${square}` });
      executeMoveCommand(cur.square, cur.type, square);
      return;
    }

    if (!piece) {
      stopSpeaking();
      setSelectedPiece(null);
      return;
    }

    // Only white pieces have chat; defected (black) pieces are bot-controlled
    if (piece.color !== 'w') return;

    const type = piece.type.toUpperCase();

    // Toggle off
    if (cur?.square === square) {
      stopSpeaking();
      setSelectedPiece(null);
      return;
    }

    if (cur && cur.square !== square) stopSpeaking();
    setSelectedPiece({ square, type });

    // First-time greeting
    const ps = pieceStatesRef.current[square];
    if (ps && ps.messages.length === 0 && !isThinking && type !== 'K') {
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
  }, [gameOver, validMoves, isThinking]);

  // ── Player chat ───────────────────────────────────────────────────────────

  const handlePlayerChat = useCallback(async (message) => {
    if (!message.trim()) return;
    const cur = selectedPieceRef.current;
    if (!cur) return;

    const { square, type } = cur;
    const ps = pieceStatesRef.current[square];
    if (!ps) return;

    addMsgToPiece(square, { type: 'player', text: message });

    const { targetSquare, isMoveCommand } = parseMoveIntent(message);

    if (isMoveCommand && targetSquare && chess.turn() === 'w') {
      await executeMoveCommand(square, type, targetSquare);
      return;
    }

    // General chat — boost love slightly for engagement
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
  }, []);

  // ── Reset ─────────────────────────────────────────────────────────────────

  function resetGame() {
    stopSpeaking();
    lastBlackPieceSquareRef.current = null;
    chess.reset();
    setBoard(chess.board());
    setSelectedPiece(null);
    setPieceStates(initPieceStates(chess));
    setLastMove(null);
    setGameOver(false);
    setEventLog([{ id: nextId(), type: 'system', text: 'New game. Click a white piece to speak with her.' }]);
  }

  return {
    board,
    selectedPiece,
    validMoves,
    visibleSquares,
    pieceStates,
    lastMove,
    eventLog,
    isThinking,
    gameOver,
    chess,
    handleSquareClick,
    handlePlayerChat,
    resetGame,
  };
}
