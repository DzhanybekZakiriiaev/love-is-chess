import React, { useState } from 'react';

export default function Settings({ onClose }) {
  const [claudeKey, setClaudeKey] = useState(
    localStorage.getItem('claude_api_key') || ''
  );
  const [elKey, setElKey] = useState(
    localStorage.getItem('elevenlabs_api_key') || ''
  );
  const [saved, setSaved] = useState(false);

  function handleSave() {
    if (claudeKey.trim()) localStorage.setItem('claude_api_key', claudeKey.trim());
    else localStorage.removeItem('claude_api_key');

    if (elKey.trim()) localStorage.setItem('elevenlabs_api_key', elKey.trim());
    else localStorage.removeItem('elevenlabs_api_key');

    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  }

  return (
    <div className="settings-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          <label>
            Claude API Key <span className="required">*</span>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={claudeKey}
              onChange={(e) => setClaudeKey(e.target.value)}
            />
            <small>
              Required for piece personalities.{' '}
              <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">
                Get one here
              </a>
            </small>
          </label>

          <label>
            ElevenLabs API Key <span className="optional">(optional)</span>
            <input
              type="password"
              placeholder="Your ElevenLabs key..."
              value={elKey}
              onChange={(e) => setElKey(e.target.value)}
            />
            <small>For premium female voices. Falls back to browser TTS if not set.</small>
          </label>
        </div>

        <div className="settings-footer">
          <p className="settings-note">
            Keys stored in localStorage only — never sent anywhere except their respective APIs.
          </p>
          <button className="btn-save" onClick={handleSave}>
            {saved ? '✓ Saved!' : 'Save & Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
