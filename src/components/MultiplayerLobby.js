import React, { useState, useEffect, useCallback } from 'react';
import mpService from '../services/multiplayerService';

const PIECE_LABELS = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
const PIECE_SYMBOLS = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };

export default function MultiplayerLobby({ onBack, onSessionJoined }) {
  const [serverUrl, setServerUrl]     = useState('localhost:3001');
  const [playerName, setPlayerName]   = useState('');
  const [status, setStatus]           = useState('idle'); // idle | connecting | connected | error
  const [errorMsg, setErrorMsg]       = useState('');
  const [sessions, setSessions]       = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [isHost, setIsHost]           = useState(false);
  const [pollTimer, setPollTimer]     = useState(null);
  const [serverInfo, setServerInfo]   = useState(null);
  const [playerChat, setPlayerChat]   = useState([]);
  const [chatInput, setChatInput]     = useState('');

  // ── Connect to server ──────────────────────────────────────────────────────

  const doConnect = useCallback(async () => {
    if (!playerName.trim()) { setErrorMsg('Enter your name first'); return; }
    setStatus('connecting');
    setErrorMsg('');
    try {
      await mpService.connect(`ws://${serverUrl}`);
      setStatus('connected');

      // Fetch server info (LAN IPs)
      try {
        const info = await mpService.fetchServerInfo();
        setServerInfo(info);
      } catch {}

      // Poll sessions every 3 s
      const t = setInterval(async () => {
        try { setSessions(await mpService.fetchSessions()); } catch {}
      }, 3000);
      setPollTimer(t);
      // Fetch immediately
      try { setSessions(await mpService.fetchSessions()); } catch {}

    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Could not connect to server');
    }
  }, [serverUrl, playerName]);

  // ── WS event listeners ─────────────────────────────────────────────────────

  useEffect(() => {
    const unsubs = [
      mpService.on('SESSION_CREATED', (msg) => {
        setCurrentSession(msg.session);
        setIsHost(true);
      }),
      mpService.on('SESSION_JOINED', (msg) => {
        setCurrentSession(msg.session);
        setIsHost(msg.session.hostPlayerId === mpService.playerId);
      }),
      mpService.on('PLAYER_JOINED', (msg) => {
        setCurrentSession(msg.session);
      }),
      mpService.on('PLAYER_LEFT', (msg) => {
        setCurrentSession(msg.session?.players?.length ? msg.session : null);
        if (!msg.session?.players?.length) setIsHost(false);
      }),
      mpService.on('PIECE_TYPE_SELECTED', (msg) => {
        setCurrentSession(msg.session);
      }),
      mpService.on('HOST_CHANGED', (msg) => {
        setCurrentSession(msg.session);
        setIsHost(msg.session?.hostPlayerId === mpService.playerId);
      }),
      mpService.on('GAME_STARTED', (msg) => {
        clearInterval(pollTimer);
        onSessionJoined({
          session: msg.session,
          isHost,
          playerName: playerName.trim(),
          myPieceType: msg.session.players.find(p => p.isHost === isHost && p.name === playerName.trim())?.pieceType
            ?? msg.session.players[0]?.pieceType,
        });
      }),
      mpService.on('PLAYER_CHAT', (msg) => {
        setPlayerChat(prev => [...prev, { from: msg.from, text: msg.message }]);
      }),
      mpService.on('ERROR', (msg) => {
        setErrorMsg(msg.message);
      }),
      mpService.on('DISCONNECTED', () => {
        setStatus('idle');
        setCurrentSession(null);
        clearInterval(pollTimer);
      }),
    ];
    return () => { unsubs.forEach(fn => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, playerName, pollTimer]);

  useEffect(() => () => clearInterval(pollTimer), [pollTimer]);

  // ── Actions ────────────────────────────────────────────────────────────────

  function handleCreate() {
    mpService.createSession(playerName.trim() || 'Host');
  }

  function handleJoin(sessionId) {
    mpService.joinSession(sessionId, playerName.trim() || 'Player');
  }

  function handleLeave() {
    mpService.leaveSession();
    setCurrentSession(null);
    setIsHost(false);
  }

  function handleStart() {
    mpService.startGame();
  }

  function handleSendChat() {
    if (!chatInput.trim()) return;
    setPlayerChat(prev => [...prev, { from: 'You', text: chatInput.trim() }]);
    mpService.sendPlayerChat(chatInput.trim());
    setChatInput('');
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────

  function pieceTypeLabel(t) {
    if (!t) return '—';
    return `${PIECE_SYMBOLS[t]} ${PIECE_LABELS[t]}`;
  }

  // ── Render: inside a session (lobby room) ──────────────────────────────────

  if (currentSession) {
    return (
      <div className="mp-screen">
        <div className="mp-inner">
          <div className="mp-header">
            <button className="mp-back-btn" onClick={handleLeave}>← Leave</button>
            <h2 className="mp-title">Session <span className="mp-session-id">{currentSession.id}</span></h2>
            <span className="mp-subtitle">
              {isHost ? '👑 You are the host' : `Hosted by ${currentSession.hostName}`}
            </span>
          </div>

          <div className="mp-lobby-body">

            {/* Players list */}
            <div className="mp-panel">
              <h3 className="mp-panel-title">Players ({currentSession.players.length})</h3>
              <div className="mp-players-list">
                {currentSession.players.map((p, i) => (
                  <div key={i} className="mp-player-row">
                    <span className="mp-player-name">
                      {p.isHost ? '👑 ' : ''}{p.name}
                      {p.name === playerName.trim() ? ' (you)' : ''}
                    </span>
                    <span className="mp-player-piece">
                      {p.pieceType ? pieceTypeLabel(p.pieceType) : <em>no piece selected</em>}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mp-unassigned">
                <span className="mp-unassigned-label">🤖 Claude will control:</span>{' '}
                {['K','Q','R','B','N','P']
                  .filter(t => !currentSession.players.some(p => p.pieceType === t))
                  .map(t => pieceTypeLabel(t))
                  .join(', ') || 'nothing (all assigned!)'}
              </div>
            </div>

            {/* Piece selection */}
            <div className="mp-panel">
              <h3 className="mp-panel-title">Choose Your Piece Type</h3>
              <p className="mp-panel-hint">You command ALL pieces of your chosen type.</p>
              <div className="mp-piece-select-grid">
                {['K','Q','R','B','N','P'].map(t => {
                  const takenBy = currentSession.players.find(p => p.pieceType === t);
                  const isMe    = takenBy?.name === playerName.trim();
                  const taken   = takenBy && !isMe;
                  return (
                    <button
                      key={t}
                      className={`mp-piece-btn ${isMe ? 'mp-piece-btn--selected' : ''} ${taken ? 'mp-piece-btn--taken' : ''}`}
                      disabled={taken}
                      onClick={() => mpService.selectPieceType(t)}
                      title={taken ? `Taken by ${takenBy.name}` : ''}
                    >
                      <img
                        src={`/pieces-sprites/${PIECE_LABELS[t].toLowerCase()}.jpg`}
                        alt={PIECE_LABELS[t]}
                        className="mp-piece-btn-img"
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                      <span className="mp-piece-btn-sym">{PIECE_SYMBOLS[t]}</span>
                      <span className="mp-piece-btn-name">{PIECE_LABELS[t]}</span>
                      {taken && <span className="mp-piece-btn-taken-tag">{takenBy.name}</span>}
                      {t === 'K' && <span className="mp-piece-btn-note">💬📞 chat + calls</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Player chat */}
            <div className="mp-panel mp-panel--chat">
              <h3 className="mp-panel-title">Team Chat</h3>
              <div className="mp-player-chat-log">
                {playerChat.length === 0 && <p className="mp-chat-empty">No messages yet…</p>}
                {playerChat.map((m, i) => (
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
                  onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                  placeholder="Say something…"
                />
                <button className="mp-chat-send" onClick={handleSendChat}>Send</button>
              </div>
            </div>
          </div>

          {/* Error + start */}
          {errorMsg && <p className="mp-error">{errorMsg}</p>}
          {isHost && (
            <button className="mp-start-btn" onClick={handleStart}>
              ▶ Start Game
            </button>
          )}
          {!isHost && (
            <p className="mp-waiting">Waiting for host to start the game…</p>
          )}
        </div>
      </div>
    );
  }

  // ── Render: connect / session browser ────────────────────────────────────

  return (
    <div className="mp-screen">
      <div className="mp-inner">
        <div className="mp-header">
          <button className="mp-back-btn" onClick={onBack}>← Back</button>
          <h2 className="mp-title">🌐 Multiplayer</h2>
          <span className="mp-subtitle">Play on your local network</span>
        </div>

        {/* Connection form */}
        <div className="mp-panel">
          <h3 className="mp-panel-title">Connect to Server</h3>
          <div className="mp-connect-form">
            <label className="mp-form-label">
              Your name
              <input
                className="mp-input"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                placeholder="Enter your name"
                disabled={status === 'connected'}
              />
            </label>
            <label className="mp-form-label">
              Server address
              <input
                className="mp-input"
                value={serverUrl}
                onChange={e => setServerUrl(e.target.value)}
                placeholder="localhost:3001 or 192.168.x.x:3001"
                disabled={status === 'connected'}
              />
            </label>
            {status !== 'connected' ? (
              <button
                className="mp-connect-btn"
                onClick={doConnect}
                disabled={status === 'connecting'}
              >
                {status === 'connecting' ? 'Connecting…' : '🔌 Connect'}
              </button>
            ) : (
              <span className="mp-status-ok">✅ Connected</span>
            )}
          </div>
          {errorMsg && <p className="mp-error">{errorMsg}</p>}
          {serverInfo && serverInfo.ips.length > 0 && (
            <div className="mp-server-ips">
              <strong>Share with friends on your LAN:</strong>{' '}
              {serverInfo.ips.map((ip, i) => (
                <code key={i} className="mp-ip">{ip}:3001</code>
              ))}
            </div>
          )}
        </div>

        {/* Session browser (only when connected) */}
        {status === 'connected' && (
          <>
            <div className="mp-panel">
              <div className="mp-panel-titlebar">
                <h3 className="mp-panel-title">Available Sessions</h3>
                <button className="mp-refresh-btn" onClick={async () => {
                  try { setSessions(await mpService.fetchSessions()); } catch {}
                }}>↻ Refresh</button>
              </div>

              {sessions.length === 0 ? (
                <p className="mp-no-sessions">No sessions yet — create one below!</p>
              ) : (
                <div className="mp-session-list">
                  {sessions.map(s => (
                    <div key={s.id} className="mp-session-row">
                      <div className="mp-session-info">
                        <span className="mp-session-host">👑 {s.hostName}</span>
                        <span className="mp-session-id-badge">{s.id}</span>
                        <span className="mp-session-players">
                          {s.players.length} player{s.players.length !== 1 ? 's' : ''}
                        </span>
                        <div className="mp-session-pieces">
                          {s.players.map((p, i) => p.pieceType && (
                            <span key={i} className="mp-session-piece-chip">
                              {PIECE_SYMBOLS[p.pieceType]} {p.name}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        className="mp-join-btn"
                        disabled={s.status !== 'lobby'}
                        onClick={() => handleJoin(s.id)}
                      >
                        {s.status === 'lobby' ? 'Join' : 'In Progress'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button className="mp-create-btn" onClick={handleCreate}>
              + Create Session
            </button>
          </>
        )}
      </div>
    </div>
  );
}
