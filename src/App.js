import React, { useState } from 'react';
import ChessBoard from './components/ChessBoard';
import PieceChat from './components/PieceChat';
import Settings from './components/Settings';
import TitleScreen from './components/TitleScreen';
import MultiplayerLobby from './components/MultiplayerLobby';
import MultiplayerGame from './components/MultiplayerGame';
import { useChessGame } from './hooks/useChessGame';
import { hasApiKey } from './services/claudeService';
import { isVoiceEnabled, setVoiceEnabled } from './services/voiceService';
import './App.css';

export default function App() {
  const [screen, setScreen] = useState('title');
  // Multiplayer session info
  const [mpConfig, setMpConfig] = useState(null);

  const {
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
  } = useChessGame();

  const [showSettings, setShowSettings] = useState(!hasApiKey());
  const [voiceOn, setVoiceOn] = useState(isVoiceEnabled());

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceEnabled(next);
    setVoiceOn(next);
  }

  const statusText = gameOver
    ? 'Game over'
    : chess.inCheck() && chess.turn() === 'w'
    ? '⚠ Your King is in CHECK!'
    : isThinking
    ? 'Enemy thinking...'
    : chess.turn() === 'w'
    ? 'Your turn, my King'
    : '';

  const inCheck = chess.inCheck() && chess.turn() === 'w';
  const latestEvent = eventLog[eventLog.length - 1];

  // ── Screens ───────────────────────────────────────────────────────────────

  if (screen === 'title') {
    return (
      <TitleScreen
        onSingleplayer={() => setScreen('game')}
        onMultiplayer={() => setScreen('multiplayer-lobby')}
      />
    );
  }

  if (screen === 'multiplayer-lobby') {
    return (
      <MultiplayerLobby
        onBack={() => setScreen('title')}
        onSessionJoined={(config) => {
          setMpConfig(config);
          setScreen('multiplayer-game');
        }}
      />
    );
  }

  if (screen === 'multiplayer-game' && mpConfig) {
    return (
      <MultiplayerGame
        isHost={mpConfig.isHost}
        myPieceType={mpConfig.myPieceType}
        session={mpConfig.session}
        playerName={mpConfig.playerName}
        onLeave={() => {
          setMpConfig(null);
          setScreen('title');
        }}
      />
    );
  }

  // ── Singleplayer game ─────────────────────────────────────────────────────

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">♔ Love is Chess</h1>
          <span className="app-subtitle">Where pieces have feelings</span>
        </div>
        <div className="header-right">
          {statusText && (
            <span className={`status-text ${inCheck ? 'in-check' : ''}`}>{statusText}</span>
          )}
          <button className="btn-voice" onClick={toggleVoice} title={voiceOn ? 'Mute voices' : 'Unmute voices'}>
            {voiceOn ? '🔊' : '🔇'}
          </button>
          <button className="btn-reset" onClick={resetGame}>New Game</button>
          <button className="btn-settings" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
          <button
            className="btn-reset"
            style={{ background: '#c0a0b0' }}
            onClick={() => setScreen('title')}
          >
            Menu
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="board-section">
          <ChessBoard
            board={board}
            selectedPiece={selectedPiece}
            validMoves={validMoves}
            visibleSquares={visibleSquares}
            lastMove={lastMove}
            onSquareClick={handleSquareClick}
          />
          {latestEvent && latestEvent.type === 'capture' && (
            <div className="event-strip event-capture">⚔ {latestEvent.text}</div>
          )}
        </div>

        <div className="chat-section">
          <PieceChat
            selectedPiece={selectedPiece}
            pieceState={selectedPiece ? pieceStates[selectedPiece.square] : null}
            isThinking={isThinking}
            onSendMessage={handlePlayerChat}
            onClose={() => handleSquareClick(selectedPiece?.square)}
          />
        </div>
      </main>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
