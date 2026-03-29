// Voice service — ElevenLabs (premium) or Web Speech API (fallback)
// All white piece voices are female.

function getElevenLabsKey() {
  return localStorage.getItem('elevenlabs_api_key') || process.env.REACT_APP_ELEVENLABS_API_KEY || '';
}

// ElevenLabs female voice IDs
// Q  → Rachel   (mature, commanding, passionate)
// B  → Bella    (soft, gentle, mystical)
// R  → Domi     (strong, composed, guarded)
// N  → Elli     (energetic, playful, bold)
// P  → Grace    (young, hopeful, earnest)
// ENEMY → Charlotte (cold, menacing)
const ELEVENLABS_VOICES = {
  Q:     '21m00Tcm4TlvDq8ikWAM', // Rachel
  B:     'EXAVITQu4vr4xnSDxMaL', // Bella
  R:     'AZnzlk1XvdvUeBnXmlld', // Domi
  N:     'MF3mGyEYCl7XYWbV9V6O', // Elli
  P:     'oWAxZDx7w5VEj9dCyTzz', // Grace
  ENEMY: 'XB0fDUnXU5powFXDhCwa', // Charlotte
};

// ── Voice enabled toggle ───────────────────────────────────────────────────

export function isVoiceEnabled() {
  return localStorage.getItem('voice_enabled') !== 'false';
}

export function setVoiceEnabled(enabled) {
  localStorage.setItem('voice_enabled', enabled ? 'true' : 'false');
  if (!enabled) stopSpeaking();
}

// ── TTS ───────────────────────────────────────────────────────────────────

/** Active ElevenLabs blob URL so we can revoke on stop */
let activeObjectUrl = null;
let activeAudio = null;

export async function speakText(text, pieceType = null, options = {}) {
  if (!isVoiceEnabled()) return;
  if (options.onlyIf && !options.onlyIf()) return;

  // One utterance at a time — avoids overlap when new lines play after closing chat or switching piece
  stopSpeaking();

  const elKey = getElevenLabsKey();

  if (elKey && pieceType) {
    const voiceId = ELEVENLABS_VOICES[pieceType] || ELEVENLABS_VOICES.P;
    try {
      await speakElevenLabs(text, voiceId, elKey, options.onlyIf);
      return;
    } catch (e) {
      console.warn('ElevenLabs failed, falling back to Web Speech:', e);
    }
  }

  if (options.onlyIf && !options.onlyIf()) return;
  speakWebSpeech(text, pieceType);
}

async function speakElevenLabs(text, voiceId, apiKey, onlyIf) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_v3',
      output_format: 'mp3_44100_128',
      voice_settings: { stability: 0.5, similarity_boost: 0.78 },
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);

  const blob = await res.blob();
  // Piece may be captured / chat closed while the TTS request was in flight
  if (onlyIf && !onlyIf()) return;

  const url  = URL.createObjectURL(blob);
  if (onlyIf && !onlyIf()) {
    URL.revokeObjectURL(url);
    return;
  }

  const audio = new Audio(url);
  activeObjectUrl = url;
  activeAudio = audio;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (activeAudio === audio) activeAudio = null;
      if (activeObjectUrl === url) {
        URL.revokeObjectURL(url);
        activeObjectUrl = null;
      }
    };
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = (err) => {
      cleanup();
      reject(err);
    };
    if (onlyIf && !onlyIf()) {
      cleanup();
      resolve();
      return;
    }
    audio.play().catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

function speakWebSpeech(text, pieceType) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();

  // Prefer a female-sounding voice by name heuristic
  const femaleKeywords = ['female', 'woman', 'girl', 'samantha', 'zira', 'karen', 'moira', 'tessa', 'victoria', 'fiona'];
  const femaleVoice = voices.find(v =>
    femaleKeywords.some(k => v.name.toLowerCase().includes(k))
  );

  // Per-piece pitch/rate so each type sounds distinct
  const voiceParams = {
    Q:     { pitch: 1.1, rate: 0.92 }, // mature, measured
    B:     { pitch: 1.05, rate: 0.88 }, // gentle, contemplative
    R:     { pitch: 0.95, rate: 0.90 }, // steady, composed
    N:     { pitch: 1.25, rate: 1.05 }, // bright, energetic
    P:     { pitch: 1.20, rate: 0.97 }, // young, earnest
    ENEMY: { pitch: 0.75, rate: 0.85 }, // cold, threatening
  };

  const params  = voiceParams[pieceType] || { pitch: 1.1, rate: 0.95 };
  utter.pitch   = params.pitch;
  utter.rate    = params.rate;

  if (femaleVoice) {
    utter.voice = femaleVoice;
  } else if (voices.length > 1) {
    // Assign different voices by piece type for variety
    const idx   = pieceType ? Object.keys(voiceParams).indexOf(pieceType) : 0;
    utter.voice = voices[idx % voices.length] || voices[0];
  }

  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

// ── STT ───────────────────────────────────────────────────────────────────

export function startListening() {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      reject(new Error('Speech recognition not supported'));
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => resolve(e.results[0][0].transcript);
    recognition.onerror  = (e) => reject(new Error(e.error));
    recognition.start();
  });
}

export function isMicSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
