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

/**
 * @param {object} props
 * @param {boolean}  props.isHost
 * @param {string}   props.myPieceType  — piece type letter this player controls
 * @param {object}   props.session      — session object
 * @param {string}   props.playerName
 * @param {function} props.onLeave
 */
export default function MultiplayerGame({ isHost, myPieceType, session, playerName, onLeave }) {
  const game = useMultiplayerGame({ isHost, myPieceType, session, playerName });

  const [showSettings, setShowSettings] = useState(!hasApiKey());
  const [voiceOn,      setVoiceOn]      = useState(isVoiceEnabled());
  const [showChat,     setShowChat]     = useState(false);
  const [chatInput,    setChatInput]    = useState('');

  // ── Voice call (King ↔ piece-type player) ──────────────────────────────────
  const voiceCall = useVoiceCall({ myPieceType, session });

  // Track which piece TYPE we last opened a call for (avoid restarting same call)
  const prevCallTypeRef = useRef(null);

  useEffect(() => {
    if (myPieceType !== 'K') return;

    const newType = game.selectedPiece?.type ?? null;

    // Same type selected — no change needed (King moved to another piece of same type)
    if (newType === prevCallTypeRef.current) return;

    // End previous call if there was one
    if (prevCallTypeRef.current) {
      voiceCall.endCall(prevCallTypeRef.current);
    }
    prevCallTypeRef.current = newType;

    // Don't call own King pieces, and don't call Claude-controlled types
    if (newType && newType !== 'K') {
      const isHuman = game.assignedTypes.includes(newType);
      if (isHuman) voiceCall.startCall(newType);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.selectedPiece?.type, myPieceType]);

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceEnabled(next);
    setVoiceOn(next);
  }

  function handleLeave() {
    // End any active call before leaving
    if (voiceCall.inCall && voiceCall.callWithType) {
      voiceCall.endCall(voiceCall.callWithType);
    }
    mpService.leaveSession();
    mpService.disconnect();
    onLeave();
  }

  function sendPlayerChat() {
    if (!chatInput.trim()) return;
    game.playerChatLog.push({ from: 'You', text: chatInput.trim() }); // optimistic
    mpService.sendPlayerChat(chatInput.trim());
    setChatInput('');
  }

  const statusText = game.gameOver
    ? 'Game over'
    : game.chess.inCheck() && game.chess.turn() === 'w'
    ? '⚠ King in CHECK!'
    : game.isThinking
    ? 'Thinking…'
    : game.chess.turn() === 'w'
    ? `Your turn (${myPieceType ? PIECE_LABELS[myPieceType] : '?'})`
    : "Black's turn";

  const inCheck     = game.chess.inCheck() && game.chess.turn() === 'w';
  const latestEvent = game.eventLog[game.eventLog.length - 1];

  return (
    <div className="app">
      {/* Hidden audio element for remote voice stream */}
      <audio ref={voiceCall.audioRef} autoPlay style={{ display: 'none' }} />

      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">♔ Love is Chess</h1>
          <span className="app-subtitle mp-mode-badge">
            🌐 Multiplayer
            {myPieceType && (
              <span className="mp-my-type">
                {PIECE_SYMBOLS[myPieceType]} {PIECE_LABELS[myPieceType]}
              </span>
            )}
          </span>
        </div>

        <div className="header-center">
          <div className="mp-players-strip">
            {session?.players?.map((p, i) => (
              <span
                key={i}
                className={`mp-player-chip ${p.name === playerName ? 'mp-player-chip--me' : ''}`}
              >
                {p.pieceType ? PIECE_SYMBOLS[p.pieceType] : '?'} {p.name}
                {p.isHost ? ' 👑' : ''}
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
          {/* Active voice call indicator */}
          {voiceCall.inCall && (
            <span className="mp-call-indicator" title={`In call with ${PIECE_LABELS[voiceCall.callWithType] || voiceCall.callWithType} player`}>
              📞 {myPieceType === 'K'
                ? PIECE_LABELS[voiceCall.callWithType] || voiceCall.callWithType
                : 'King'}
            </span>
          )}

          {statusText && (
            <span className={`status-text ${inCheck ? 'in-check' : ''}`}>{statusText}</span>
          )}
          <button
            className="btn-voice"
            onClick={() => setShowChat(c => !c)}
            title="Team chat"
          >
            💬
          </button>
          <button className="btn-voice" onClick={toggleVoice} title={voiceOn ? 'Mute' : 'Unmute'}>
            {voiceOn ? '🔊' : '🔇'}
          </button>
          <button className="btn-reset" onClick={game.resetGame}>New Game</button>
          <button className="btn-settings" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
          <button className="btn-reset" style={{ background: '#c0a0b0' }} onClick={handleLeave}>Leave</button>
        </div>
      </header>

      {/* Team chat overlay */}
      {showChat && (
        <div className="mp-team-chat-panel">
          <div className="mp-team-chat-header">
            <span>Team Chat</span>
            <button className="btn-close" onClick={() => setShowChat(false)}>✕</button>
          </div>
          <div className="mp-team-chat-log">
            {game.playerChatLog.length === 0 && <p className="mp-chat-empty">No messages yet…</p>}
            {game.playerChatLog.map((m, i) => (
              <div key={i} className="mp-chat-msg">
                <strong>{m.from}:</strong> {m.text}
              </div>
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
          {/* Non-King players: show who can chat */}
          {myPieceType && myPieceType !== 'K' && (
            <div className="mp-knight-notice">
              💬 Only the <strong>King</strong> commander can chat with pieces.
              You can still move your {PIECE_LABELS[myPieceType]}s by clicking squares.
              {voiceCall.inCall && (
                <span className="mp-call-notice"> 📞 King is calling…</span>
              )}
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
            /* King player gets full piece chat + voice call auto-triggers */
            <PieceChat
              selectedPiece={game.selectedPiece}
              pieceState={game.selectedPiece ? game.pieceStates[game.selectedPiece.square] : null}
              isThinking={game.isThinking}
              onSendMessage={game.handlePlayerChat}
              onClose={() => game.handleSquareClick(game.selectedPiece?.square)}
              voiceCallActive={voiceCall.inCall && voiceCall.callWithType === game.selectedPiece?.type}
            />
          ) : (
            /* Other players: read-only piece status */
            <div className="mp-piece-status-panel">
              {game.selectedPiece ? (
                <>
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
                        <div
                          className="mp-stat-fill"
                          style={{ width: `${game.pieceStates[game.selectedPiece.square]?.trust ?? 0}%`, background: '#ff69b4' }}
                        />
                      </div>
                      <span>{game.pieceStates[game.selectedPiece.square]?.trust ?? 0}</span>
                    </div>
                    <div className="mp-stat-row">
                      <span>Love</span>
                      <div className="mp-stat-bar">
                        <div
                          className="mp-stat-fill"
                          style={{ width: `${game.pieceStates[game.selectedPiece.square]?.love ?? 0}%`, background: '#e05080' }}
                        />
                      </div>
                      <span>{game.pieceStates[game.selectedPiece.square]?.love ?? 0}</span>
                    </div>
                  </div>
                  {/* Voice call banner — shown when King is calling this piece's player */}
                  {voiceCall.inCall && (
                    <div className="mp-call-banner">
                      📞 King is speaking with your {PIECE_LABELS[myPieceType]}s
                    </div>
                  )}
                  <p className="mp-piece-status-hint">Select a target square to move this piece.</p>
                  <div className="mp-piece-msgs">
                    {(game.pieceStates[game.selectedPiece.square]?.messages || []).map(m => (
                      <div key={m.id} className={`msg-row msg-row-${m.type === 'player' ? 'right' : 'left'}`}>
                        <div className={`bubble ${m.type === 'player' ? 'bubble-player' : 'bubble-piece'}`}>
                          {m.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="no-piece">
                  <p>Click one of your <strong>{myPieceType ? PIECE_LABELS[myPieceType] : 'piece'}s</strong> to select it</p>
                  {voiceCall.inCall && (
                    <div className="mp-call-banner">
                      📞 King is calling you
                    </div>
                  )}
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
