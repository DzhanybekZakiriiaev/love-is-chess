import React, { useState, useRef, useEffect } from 'react';
import { isMicSupported, startListening, stopSpeaking } from '../services/voiceService';
import {
  PIECE_META,
  PIECE_SPRITE,
  getTrustLabel,
  getTrustColor,
  getLoveLabel,
  getLoveColor,
} from '../data/piecePersonalities';

// ── Love meter ────────────────────────────────────────────────────────────────
function LoveMeter({ love }) {
  const filled = Math.round((love / 100) * 10);
  const color  = getLoveColor(love);
  return (
    <div className="love-meter-row">
      <span className="meter-label" style={{ color }}>♥ {getLoveLabel(love)}</span>
      <div className="love-hearts">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={`heart ${i < filled ? 'heart-filled' : 'heart-empty'}`}>
            {i < filled ? '♥' : '♡'}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Trust bar ─────────────────────────────────────────────────────────────────
function TrustBar({ trust }) {
  const color = getTrustColor(trust);
  return (
    <div className="trust-bar-wrap">
      <span className="meter-label" style={{ color }}>🛡 {getTrustLabel(trust)}</span>
      <div className="trust-bar-track">
        <div className="trust-bar-fill" style={{ width: `${trust}%`, background: color }} />
      </div>
    </div>
  );
}

// ── Floating hearts ───────────────────────────────────────────────────────────
function FloatingHearts({ love }) {
  const color = getLoveColor(love);
  return (
    <div className="floating-hearts" aria-hidden="true">
      {[0,1,2,3,4].map(i => (
        <span
          key={i}
          className="float-heart"
          style={{ '--delay': `${i * 0.56}s`, '--color': color }}
        >♥</span>
      ))}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, pieceName, loveColor }) {
  if (msg.type === 'system') return <div className="msg-system">{msg.text}</div>;
  if (msg.type === 'error')  return <div className="msg-error">{msg.text}</div>;

  if (msg.type === 'enemy') {
    return (
      <div className="msg-row msg-row-left">
        <span className="msg-avatar enemy-avatar">☠</span>
        <div className="bubble bubble-enemy">
          <span className="bubble-label" style={{ color: '#c03030' }}>Enemy</span>
          <p>{msg.text}</p>
        </div>
      </div>
    );
  }

  if (msg.type === 'player') {
    return (
      <div className="msg-row msg-row-right">
        <div className="bubble bubble-player">
          <span className="bubble-label" style={{ color: '#b07030' }}>The King</span>
          <p>{msg.text}</p>
        </div>
        <span className="msg-avatar king-avatar">♔</span>
      </div>
    );
  }

  if (msg.type === 'piece') {
    const streaming = msg.text === '';
    return (
      <div className="msg-row msg-row-left">
        <div
          className={`bubble bubble-piece${streaming ? ' bubble-streaming' : ''}`}
          style={{ borderColor: streaming ? undefined : loveColor }}
        >
          {streaming
            ? <span className="thinking-dots"><span /><span /><span /></span>
            : <>
                <span className="bubble-label" style={{ color: loveColor }}>{pieceName}</span>
                <p>{msg.text}</p>
              </>
          }
        </div>
      </div>
    );
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PieceChat({
  selectedPiece,
  pieceState,
  isThinking,
  onSendMessage,
  onClose,
}) {
  const [input,       setInput]       = useState('');
  const [isListening, setIsListening] = useState(false);
  const feedRef   = useRef(null);
  const inputRef  = useRef(null);
  const micAvail  = isMicSupported();

  const messages = pieceState?.messages || [];
  const trust    = pieceState?.trust ?? 70;
  const love     = pieceState?.love  ?? 50;
  const traits   = pieceState?.traits || [];
  const name     = pieceState?.name  || 'Unknown';
  const msgCount = messages.length;

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgCount, isThinking]);

  useEffect(() => { setInput(''); }, [selectedPiece?.square]);

  useEffect(() => {
    if (selectedPiece) inputRef.current?.focus();
  }, [selectedPiece?.square]);

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, [selectedPiece?.square]);

  if (!selectedPiece) {
    return (
      <div className="piece-chat no-piece">
        <p>Click a white piece to speak with her.</p>
      </div>
    );
  }

  const type      = selectedPiece.type;
  const meta      = PIECE_META[type] || { name: type };
  const sprite    = PIECE_SPRITE[type.toLowerCase()] || 'pawn';
  const loveColor = getLoveColor(love);

  function handleSend() {
    const text = input.trim();
    if (!text || isThinking) return;
    onSendMessage(text);
    setInput('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  async function handleMic() {
    if (isListening) return;
    setIsListening(true);
    try { const t = await startListening(); setInput(t); } catch {}
    setIsListening(false);
  }

  return (
    <div
      className="piece-chat"
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) stopSpeaking();
      }}
    >

      {/* ── VN scene: background + portrait + floating hearts ── */}
      <div className="vn-scene">
        <button
          className="btn-close portrait-close"
          onClick={() => {
            stopSpeaking();
            onClose();
          }}
          title="Close"
        >
          ✕
        </button>

        {/* Portrait with floating hearts */}
        <div className="vn-portrait-wrap">
          <FloatingHearts love={love} />
          <img
            src={`/pieces-sprites/${sprite}.jpg`}
            alt={name}
            className="vn-portrait-img"
          />
        </div>

        {/* Name badge */}
        <div className="vn-name-strip">
          <span className="vn-piece-name">{name}</span>
          <span className="vn-piece-subtitle">The {meta.name} · {selectedPiece.square}</span>
        </div>

        {/* Meters */}
        <div className="vn-meters">
          <LoveMeter love={love} />
          <TrustBar trust={trust} />
          {traits.length > 0 && (
            <div className="trait-badges">
              {traits.map(([tname]) => (
                <span key={tname} className="trait-badge">{tname}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── VN dialogue box at bottom ── */}
      <div className="vn-dialogue-area">
        <div className="vn-messages" ref={feedRef}>
          {messages.length === 0 && (
            <div className="msg-system">Speak to {name}, or click a square to command her.</div>
          )}
          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              pieceName={name}
              loveColor={loveColor}
            />
          ))}
          {isThinking && !messages.some(m => m.type === 'piece' && m.text === '') && (
            <div className="msg-row msg-row-left">
              <div className="bubble bubble-thinking">
                <span className="thinking-dots"><span /><span /><span /></span>
              </div>
            </div>
          )}
        </div>

        <div className="vn-input-row">
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            placeholder={`Speak to ${name}...`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isThinking}
          />
          <div className="chat-buttons">
            {micAvail && (
              <button
                className={`btn-mic ${isListening ? 'listening' : ''}`}
                onClick={handleMic}
                disabled={isThinking || isListening}
                title="Speak"
              >
                {isListening ? '⏹' : '🎤'}
              </button>
            )}
            <button
              className="btn-send"
              onClick={handleSend}
              disabled={isThinking || !input.trim()}
            >
              Send ♥
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
