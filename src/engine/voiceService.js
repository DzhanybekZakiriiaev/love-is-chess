// Try ElevenLabs first, fall back to browser TTS
export async function speak(text, voiceId, pieceType) {
  try {
    const apiKey = process.env.REACT_APP_ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('No ElevenLabs key');

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!response.ok) throw new Error('ElevenLabs failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
  } catch {
    // Browser TTS fallback - use female voice
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      const femaleVoice = voices.find(v =>
        v.name.includes('Female') || v.name.includes('Samantha') ||
        v.name.includes('Zira') || v.name.includes('Karen') || v.name.includes('Moira')
      );
      if (femaleVoice) utterance.voice = femaleVoice;
      utterance.pitch = 1.1;
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);
    }
  }
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
