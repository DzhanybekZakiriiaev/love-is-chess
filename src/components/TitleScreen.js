import React from 'react';

export default function TitleScreen({ onSingleplayer, onMultiplayer }) {
  return (
    <div className="title-screen">
      <div className="title-screen__inner">
        <h1 className="title-screen__title">♔ Love is Chess</h1>
        <p className="title-screen__tagline">Where pieces have feelings</p>

        <img
          className="title-screen__sprites"
          src="/pieces-sprites/Gemini_Generated_Image_6zfwo06zfwo06zfw.png"
          alt="Chess pieces"
        />

        <div className="title-screen__buttons">
          <button
            type="button"
            className="title-screen__btn title-screen__btn--primary"
            onClick={onSingleplayer}
          >
            ♟ Singleplayer
          </button>
          <button
            type="button"
            className="title-screen__btn title-screen__btn--secondary"
            onClick={onMultiplayer}
          >
            🌐 Multiplayer
          </button>
        </div>
      </div>
    </div>
  );
}
