import React, { useState, useEffect, useRef } from 'react';
import ChessBoard from './ChessBoard';
import PieceChat from './PieceChat';
import Settings from './Settings';
import { useMultiplayerGame } from '../hooks/useMultiplayerGame';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { hasApiKey } from '../services/claudeService';
import { isVoiceEnabled, setVoiceEnabled } from '../services/voiceService';
import mpService from '../services/multiplayerService';

const PIECE_LABELS  = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
const PIECE_SYMBOLS = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };
const PIECE_SPRITE  = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };

// ── King ↔ Human player chat panel ───────────────────────────────────────────
// Shown when King clicks on a piece type controlled by a human player.
// No Claude bot — pure player-to-player text + optional voice call.

function PlayerPieceChat({ pieceType, playerName, inCall, onStartCall, onEndCall, onClose, chatLog, onSend }) {
  const [input, setInput] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [chatLog?.length]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  }

  return (
    <div className="player-piece-chat">
      {/* Header */}
      <div className="ppc-header">
        <div className="ppc-header-left">
          <img
            src={`/pieces-sprites/${PIECE_SPRITE[pieceType]}.jpg`}
            alt={PIECE_LABELS[pieceType]}
            className="ppc-portrait"
            onError={e => { e.target.style.display = 'none'; }}
          />
          <div className="ppc-header-info">
            <span className="ppc-piece-name">{PIECE_SYMBOLS[pieceType]} {PIECE_LABELS[pieceType]} Commander</span>
            <span className="ppc-player-name">{playerName}</span>
          </div>
        </div>
        <div className="ppc-header-right">
          {/* Voice call button */}
          {inCall ? (
            <button className="ppc-call-btn ppc-call-btn--active" onClick={onEndCall} title="End voice call">
              📵 End Call
            </button>
          ) : (
            <button className="ppc-call-btn" onClick={onStartCall} title="Start voice call">
              📞 Call
            </button>
          )}
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Active call indicator */}
      {inCall && (
        <div className="ppc-call-active-bar">
          📞 Voice call active with {playerName}
        </div>
      )}

      {/* Chat log */}
      <div className="ppc-chat-log" ref={logRef}>
        {(!chatLog || chatLog.length === 0) && (
          <p className="ppc-empty">No messages yet. Send a command or start a call.</p>
        )}
        {chatLog && chatLog.map((m, i) => (
          <div key={i} className={`ppc-msg ppc-msg-${m.from === 'king' ? 'right' : 'left'}`}>
            <div className="ppc-bubble">
              <span className="ppc-from">{m.from === 'king' ? '♔ King' : `${PIECE_SYMBOLS[pieceType]} ${playerName}`}</span>
              <p>{m.text}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="ppc-input-row">
        <input
          className="ppc-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder={`Message ${playerName}…`}
        />
        <button className="ppc-send" onClick={handleSend} disabled={!input.trim()}>
          Send ♥
        </button>
      </div>
    </div>
  );
}

// ── Piece player → King reply input ──────────────────────────────────────────

function KingReplyInput({ onSend }) {
  const [input, setInput] = useState('');
  function send() {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  }
  return (
    <>
      <input
        className="ppc-input"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && send()}
        placeholder="Reply to King…"
      />
      <button className="ppc-send" onClick={send} disabled={!input.trim()}>Send</button>
    </>
  );
}

// ── King-calling banner (non-King player's panel when King is calling) ────────

function KingCallingBanner() {
  return (
    <div className="king-calling-banner">
      <div className="king-calling-icon">📞</div>
      <div className="king-calling-text">
        <strong>King is calling</strong>
        <span>Voice call active — your mic is live</span>
      </div>
    </div>
  );
}

// ── King text chat to human piece player ──────────────────────────────────────
// Banner for the piece player showing King's text messages

function KingMessageBanner({ messages, myPieceType }) {
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages?.length]);

  if (!messages || messages.length === 0) return null;
  return (
    <div className="king-msg-banner">
      <div className="king-msg-title">♔ Messages from King</div>
      <div className="king-msg-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className="king-msg-row">
            <span className="king-msg-from">{m.from === 'king' ? '♔ King' : `${PIECE_SYMBOLS[myPieceType]} You`}</span>
            <span className="king-msg-text">{m.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MultiplayerGame({ isHost, myPieceType, session, playerName, onLeave }) {
  const game = useMultiplayerGame({ isHost, myPieceType, session, playerName });

  const [showSettings, setShowSettings] = useState(!hasApiKey());
  const [voiceOn,      setVoiceOn]      = useState(isVoiceEnabled());
  const [showChat,     setShowChat]     = useState(false);
  const [chatInput,    setChatInput]    = useState('');

  // King ↔ piece-player direct chat log (keyed by piece type)
  const [kingChats, setKingChats] = useState({}); // { 'N': [{from, text}], ... }

  const voiceCall = useVoiceCall({ myPieceType, session });

  const prevCallTypeRef = useRef(null);
  const sessionRef      = useRef(session);
  sessionRef.current    = session;

  // ── Call lifecycle (King side) ──────────────────────────────────────────────
  useEffect(() => {
    if (myPieceType !== 'K') return;
    const newType = game.selectedPiece?.type ?? null;
    if (newType === prevCallTypeRef.current) return;
    if (prevCallTypeRef.current) voiceCall.endCall(prevCallTypeRef.current);
    prevCallTypeRef.current = newType;
    // Don't auto-start call — King presses the 📞 button manually
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.selectedPiece?.type, myPieceType]);

  // ── Listen for King→piece text messages (piece player side) ────────────────
  useEffect(() => {
    if (myPieceType === 'K') return;
    const unsub = mpService.on('KING_CHAT', (msg) => {
      setKingChats(prev => {
        const key = myPieceType;
        const prev_msgs = prev[key] || [];
        return { ...prev, [key]: [...prev_msgs, { from: 'king', text: msg.text }] };
      });
    });
    return () => unsub();
  }, [myPieceType]);

  // ── Listen for piece→King replies (King side) ───────────────────────────────
  useEffect(() => {
    if (myPieceType !== 'K') return;
    const unsub = mpService.on('PIECE_PLAYER_REPLY', (msg) => {
      setKingChats(prev => {
        const key = msg.pieceType;
        const prev_msgs = prev[key] || [];
        return { ...prev, [key]: [...prev_msgs, { from: msg.pieceType, text: msg.text, senderName: msg.senderName }] };
      });
    });
    return () => unsub();
  }, [myPieceType]);

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceEnabled(next);
    setVoiceOn(next);
  }

  function handleLeave() {
    if (voiceCall.inCall && voiceCall.callWithType) voiceCall.endCall(voiceCall.callWithType);
    mpService.leaveSession();
    mpService.disconnect();
    onLeave();
  }

  function handleEndCall() {
    const type = voiceCall.callWithType ?? prevCallTypeRef.current;
    voiceCall.endCall(type);
  }

  function handleStartCall(targetType) {
    voiceCall.startCall(targetType);
  }

  // King sends text to a human piece player
  function handleKingSendText(targetType, text) {
    if (!text.trim()) return;
    // Add to local chat log
    setKingChats(prev => {
      const prev_msgs = prev[targetType] || [];
      return { ...prev, [targetType]: [...prev_msgs, { from: 'king', text }] };
    });
    // Send via WebSocket
    mpService.send({ type: 'KING_CHAT', targetPieceType: targetType, text });
  }

  function sendPlayerChat() {
    if (!chatInput.trim()) return;
    game.playerChatLog.push({ from: 'You', text: chatInput.trim() });
    mpService.sendPlayerChat(chatInput.trim());
    setChatInput('');
  }

  const statusText = game.gameOver
    ? 'Game over'
    : game.chess.inCheck() && game.chess.turn() === 'w'
    ? '⚠ King in CHECK!'
    : game.isThinking ? 'Thinking…'
    : game.chess.turn() === 'w'
    ? `Your turn (${myPieceType ? PIECE_LABELS[myPieceType] : '?'})`
    : "Black's turn";

  const inCheck     = game.chess.inCheck() && game.chess.turn() === 'w';
  const latestEvent = game.eventLog[game.eventLog.length - 1];

  // Find the human player who controls the currently selected piece type
  const selectedPiecePlayer = game.selectedPiece
    ? session?.players?.find(p => p.pieceType === game.selectedPiece.type && p.name !== playerName) ?? null
    : null;
  const selectedIsHuman = myPieceType === 'K' && !!selectedPiecePlayer;

  return (
    <div className="app">
      <audio ref={voiceCall.audioRef} autoPlay style={{ display: 'none' }} />

      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">♔ Love is Chess</h1>
          <span className="app-subtitle mp-mode-badge">
            🌐 Multiplayer
            {myPieceType && (
              <span className="mp-my-type">{PIECE_SYMBOLS[myPieceType]} {PIECE_LABELS[myPieceType]}</span>
            )}
          </span>
        </div>

        <div className="header-center">
          <div className="mp-players-strip">
            {session?.players?.map((p, i) => (
              <span key={i} className={`mp-player-chip ${p.name === playerName ? 'mp-player-chip--me' : ''}`}>
                {p.pieceType ? PIECE_SYMBOLS[p.pieceType] : '?'} {p.name}{p.isHost ? ' 👑' : ''}
              </span>
            ))}
            {(game.claudeTypes || []).map(t => (
              <span key={t} className="mp-player-chip mp-player-chip--claude">
                {PIECE_SYMBOLS[t]} 🤖 Claude
              </span>
            ))}
          </div>
        </div>

        <div className="header-right">
          {voiceCall.inCall && (
            <button className="mp-call-indicator" onClick={handleEndCall} title="Click to end call">
              📞 {myPieceType === 'K'
                ? (PIECE_LABELS[voiceCall.callWithType] ?? voiceCall.callWithType)
                : 'King'} ✕
            </button>
          )}
          {statusText && (
            <span className={`status-text ${inCheck ? 'in-check' : ''}`}>{statusText}</span>
          )}
          <button className="btn-voice" onClick={() => setShowChat(c => !c)} title="Team chat">💬</button>
          <button className="btn-voice" onClick={toggleVoice} title={voiceOn ? 'Mute' : 'Unmute'}>
            {voiceOn ? '🔊' : '🔇'}
          </button>
          <button className="btn-reset" onClick={game.resetGame}>New Game</button>
          <button className="btn-settings" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
          <button className="btn-reset" style={{ background: '#c0a0b0' }} onClick={handleLeave}>Leave</button>
        </div>
      </header>

      {showChat && (
        <div className="mp-team-chat-panel">
          <div className="mp-team-chat-header">
            <span>Team Chat</span>
            <button className="btn-close" onClick={() => setShowChat(false)}>✕</button>
          </div>
          <div className="mp-team-chat-log">
            {game.playerChatLog.length === 0 && <p className="mp-chat-empty">No messages yet…</p>}
            {game.playerChatLog.map((m, i) => (
              <div key={i} className="mp-chat-msg"><strong>{m.from}:</strong> {m.text}</div>
            ))}
          </div>
          <div className="mp-chat-input-row">
            <input
              className="mp-chat-input"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendPlayerChat()}
              placeholder="Talk to your team…"
            />
            <button className="mp-chat-send" onClick={sendPlayerChat}>Send</button>
          </div>
        </div>
      )}

      <main className="app-main">
        <div className="board-section">
          {myPieceType && myPieceType !== 'K' && (
            <div className="mp-knight-notice">
              💬 Only the <strong>King</strong> commander can initiate chats.
              Move your {PIECE_LABELS[myPieceType]}s by clicking squares.
            </div>
          )}
          <ChessBoard
            board={game.board}
            selectedPiece={game.selectedPiece}
            validMoves={game.validMoves}
            visibleSquares={game.visibleSquares}
            lastMove={game.lastMove}
            onSquareClick={game.handleSquareClick}
          />
          {latestEvent && latestEvent.type === 'capture' && (
            <div className="event-strip event-capture">⚔ {latestEvent.text}</div>
          )}
          <div className="mp-event-log">
            {game.eventLog.slice(-4).map(e => (
              <div key={e.id} className="mp-event-entry">{e.text}</div>
            ))}
          </div>
        </div>

        <div className="chat-section">
          {myPieceType === 'K' ? (
            // ── King right panel ────────────────────────────────────────────
            selectedIsHuman ? (
              // Human player controls this piece → player-to-player chat + call button
              <PlayerPieceChat
                pieceType={game.selectedPiece.type}
                playerName={selectedPiecePlayer.name}
                inCall={voiceCall.inCall && voiceCall.callWithType === game.selectedPiece.type}
                onStartCall={() => handleStartCall(game.selectedPiece.type)}
                onEndCall={handleEndCall}
                onClose={() => game.handleSquareClick(game.selectedPiece?.square)}
                chatLog={kingChats[game.selectedPiece?.type] || []}
                onSend={(text) => handleKingSendText(game.selectedPiece.type, text)}
              />
            ) : (
              // Claude controls this piece → normal singleplayer bot chat
              <PieceChat
                selectedPiece={game.selectedPiece}
                pieceState={game.selectedPiece ? game.pieceStates[game.selectedPiece.square] : null}
                isThinking={game.isThinking}
                onSendMessage={game.handlePlayerChat}
                onClose={() => game.handleSquareClick(game.selectedPiece?.square)}
              />
            )
          ) : (
            // ── Non-King player right panel ─────────────────────────────────
            // King command channel is always open — primary UI for piece players
            <div className="piece-player-panel">

              {/* ── Command channel: always visible ── */}
              <div className="command-channel">
                <div className="command-channel-header">
                  {voiceCall.inCall
                    ? <span className="cc-title cc-title--call">📞 King is calling</span>
                    : <span className="cc-title">♔ Command Channel</span>
                  }
                  <span className="cc-subtitle">{PIECE_SYMBOLS[myPieceType]} {PIECE_LABELS[myPieceType]} Commander</span>
                </div>

                <div className="cc-log">
                  {(!kingChats[myPieceType] || kingChats[myPieceType].length === 0) && (
                    <p className="cc-empty">Waiting for orders from the King…</p>
                  )}
                  {(kingChats[myPieceType] || []).map((m, i) => (
                    <div key={i} className={`cc-msg cc-msg-${m.from === 'king' ? 'left' : 'right'}`}>
                      <span className="cc-msg-from">{m.from === 'king' ? '♔ King' : `${PIECE_SYMBOLS[myPieceType]} You`}</span>
                      <p className="cc-msg-text">{m.text}</p>
                    </div>
                  ))}
                </div>

                <div className="ppc-input-row">
                  <KingReplyInput
                    myPieceType={myPieceType}
                    onSend={(text) => {
                      setKingChats(prev => {
                        const prev_msgs = prev[myPieceType] || [];
                        return { ...prev, [myPieceType]: [...prev_msgs, { from: myPieceType, text }] };
                      });
                      mpService.sendPiecePlayerReply(text);
                    }}
                  />
                </div>
              </div>

              {/* ── Selected piece stats (below command channel) ── */}
              {game.selectedPiece && (
                <div className="cc-piece-stats">
                  <div className="mp-piece-status-header">
                    <span className="mp-piece-status-name">
                      {game.pieceStates[game.selectedPiece.square]?.name || game.selectedPiece.type}
                    </span>
                    <span className="mp-piece-status-type">
                      {PIECE_SYMBOLS[game.selectedPiece.type]} {PIECE_LABELS[game.selectedPiece.type]}
                    </span>
                  </div>
                  <div className="mp-piece-status-stats">
                    <div className="mp-stat-row">
                      <span>Trust</span>
                      <div className="mp-stat-bar">
                        <div className="mp-stat-fill" style={{ width: `${game.pieceStates[game.selectedPiece.square]?.trust ?? 0}%`, background: '#ff69b4' }} />
                      </div>
                      <span>{game.pieceStates[game.selectedPiece.square]?.trust ?? 0}</span>
                    </div>
                    <div className="mp-stat-row">
                      <span>Love</span>
                      <div className="mp-stat-bar">
                        <div className="mp-stat-fill" style={{ width: `${game.pieceStates[game.selectedPiece.square]?.love ?? 0}%`, background: '#e05080' }} />
                      </div>
                      <span>{game.pieceStates[game.selectedPiece.square]?.love ?? 0}</span>
                    </div>
                  </div>
                  <p className="mp-piece-status-hint">Click a target square to move this piece.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
