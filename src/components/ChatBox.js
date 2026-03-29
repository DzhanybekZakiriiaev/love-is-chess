import React, { useRef, useEffect, useState } from 'react';
import './ChatBox.css';

const PIECE_TYPE_TO_SPRITE = {
  p: 'pawn',
  r: 'rook',
  n: 'knight',
  b: 'bishop',
  q: 'queen',
  k: 'king',
};

const PIECE_TYPE_TITLES = {
  p: 'Pawn',
  r: 'Rook',
  n: 'Knight',
  b: 'Bishop',
  q: 'Queen',
  k: 'King',
};

function HeartMeter({ value, max = 100 }) {
  const filled = Math.round((value / max) * 10);
  return (
    <div className="meter-row">
      <span className="meter-icon">❤️</span>
      <div className="meter-hearts">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={i < filled ? 'heart filled' : 'heart empty'}>
            {i < filled ? '❤️' : '🖤'}
          </span>
        ))}
      </div>
      <span className="meter-value">{value}</span>
    </div>
  );
}

function TrustMeter({ value, max = 100 }) {
  const filled = Math.round((value / max) * 10);
  return (
    <div className="meter-row">
      <span className="meter-icon">🛡️</span>
      <div className="meter-hearts">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={i < filled ? 'shield filled' : 'shield empty'}>
            {i < filled ? '🛡️' : '⬡'}
          </span>
        ))}
      </div>
      <span className="meter-value">{value}</span>
    </div>
  );
}

function stripTags(text) {
  return text.replace(/^\[(AGREE|REFUSE)\]\s*/i, '').trim();
}

function getResponseTag(text) {
  if (text.startsWith('[AGREE]')) return 'agree';
  if (text.startsWith('[REFUSE]')) return 'refuse';
  return null;
}

export default function ChatBox({
  piece,
  messages,
  onSendMessage,
  onClose,
  isLoading,
  pendingMoveSquare,
  onConfirmMove,
  onCancelMove,
  voiceEnabled,
  onToggleVoice,
}) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, [piece]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || isLoading) return;
    setInputText('');
    onSendMessage(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!piece) return null;

  const spriteName = PIECE_TYPE_TO_SPRITE[piece.type] || 'pawn';
  const typeTitle = PIECE_TYPE_TITLES[piece.type] || 'Piece';

  return (
    <div className="chatbox">
      {/* Character portrait section */}
      <div className="chatbox-portrait-section">
        <button className="chatbox-close-btn" onClick={onClose} title="Close">✕</button>
        <button
          className={`chatbox-voice-btn ${voiceEnabled ? 'voice-on' : 'voice-off'}`}
          onClick={onToggleVoice}
          title={voiceEnabled ? 'Mute voice' : 'Enable voice'}
        >
          {voiceEnabled ? '🔊' : '🔇'}
        </button>

        <div className="portrait-frame">
          <img
            src={`/pieces-sprites/${spriteName}.jpg`}
            alt={piece.name}
            className="portrait-img"
          />
        </div>

        <div className="character-info">
          <h2 className="character-name">{piece.name}</h2>
          <p className="character-title">The {typeTitle}</p>
          <HeartMeter value={piece.love || 0} />
          <TrustMeter value={piece.trust || 0} />
        </div>
      </div>

      {/* Pending move banner */}
      {pendingMoveSquare && (
        <div className="pending-move-banner">
          <span>Request <strong>{piece.name}</strong> to move to <strong>{pendingMoveSquare}</strong>?</span>
          <div className="pending-move-buttons">
            <button className="confirm-btn" onClick={onConfirmMove} disabled={isLoading}>
              ✓ Ask Her
            </button>
            <button className="cancel-btn" onClick={onCancelMove} disabled={isLoading}>
              ✗ Cancel
            </button>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="chatbox-messages">
        {messages.length === 0 && (
          <div className="chat-empty-hint">
            <p>Speak to {piece.name}...</p>
          </div>
        )}
        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="chat-message player-message">
                <span className="message-sender">The King:</span>
                <div className="message-bubble player-bubble">{msg.content}</div>
              </div>
            );
          } else if (msg.role === 'assistant') {
            const tag = getResponseTag(msg.content);
            const displayText = stripTags(msg.content);
            return (
              <div key={msg.id} className="chat-message piece-message">
                <span className="message-sender">{piece.name}:</span>
                {tag === 'agree' && (
                  <div className="response-tag tag-agree">Moving!</div>
                )}
                {tag === 'refuse' && (
                  <div className="response-tag tag-refuse">Refused!</div>
                )}
                <div className="message-bubble piece-bubble">{displayText}</div>
              </div>
            );
          } else if (msg.role === 'error') {
            return (
              <div key={msg.id} className="chat-message error-message">
                <div className="message-bubble error-bubble">{msg.content}</div>
              </div>
            );
          }
          return null;
        })}

        {isLoading && (
          <div className="chat-message piece-message loading-message">
            <span className="message-sender">{piece.name}:</span>
            <div className="message-bubble piece-bubble loading-bubble">
              <span className="loading-dot">•</span>
              <span className="loading-dot">•</span>
              <span className="loading-dot">•</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="chatbox-input-area">
        <input
          ref={inputRef}
          type="text"
          className="chatbox-input"
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Speak to ${piece.name}...`}
          disabled={isLoading}
          maxLength={200}
        />
        <button
          className="chatbox-send-btn"
          onClick={handleSend}
          disabled={isLoading || !inputText.trim()}
        >
          ➤
        </button>
      </div>
    </div>
  );
}
