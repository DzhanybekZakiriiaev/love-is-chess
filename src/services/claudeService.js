const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-haiku-4-5-20251001';

function getApiKey() {
  return localStorage.getItem('claude_api_key') || process.env.REACT_APP_ANTHROPIC_API_KEY || '';
}

// ── Streaming (all piece responses) ──────────────────────────────────────────
// onChunk(partialText) called on every delta; resolves with full trimmed text.

async function streamClaude(systemPrompt, userMessage, maxTokens, onChunk) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer   = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const evt = JSON.parse(raw);
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          fullText += evt.delta.text;
          onChunk(fullText);
        }
      } catch {}
    }
  }

  return fullText.trim();
}

// ── Fog-of-war context builder ────────────────────────────────────────────────

function ctx(square, visibleBoard) {
  const lines = [`You are at ${square}.`];
  if (visibleBoard?.friendly?.length) lines.push(`Allies you can see: ${visibleBoard.friendly.join(', ')}.`);
  if (visibleBoard?.enemy?.length)    lines.push(`Enemies you can see: ${visibleBoard.enemy.join(', ')}.`);
  if (visibleBoard?.threatened)       lines.push('You are under direct attack right now!');
  return lines.join(' ');
}

// ── Piece response functions (all streaming) ──────────────────────────────────

export function getPieceGreeting(sysPrompt, pieceName, square, visibleBoard, onChunk) {
  return streamClaude(
    sysPrompt,
    `${ctx(square, visibleBoard)} The King has selected you, ${pieceName}. Greet him in one sentence — let your personality and current feelings toward him be unmistakably clear.`,
    90, onChunk
  );
}

export function getPieceResponse(sysPrompt, pieceName, square, visibleBoard, playerMessage, onChunk) {
  return streamClaude(
    sysPrompt,
    `${ctx(square, visibleBoard)} The King says: "${playerMessage}" — respond as ${pieceName} in 1–2 sentences. Your trust and love levels must show in your tone.`,
    120, onChunk
  );
}

export function getPieceMoveResponse(sysPrompt, pieceName, fromSquare, toSquare, visibleBoard, onChunk) {
  return streamClaude(
    sysPrompt,
    `${ctx(toSquare, visibleBoard)} You just moved from ${fromSquare} to ${toSquare} at the King's command. React in one sentence as ${pieceName} — lead with feeling, not a move description.`,
    90, onChunk
  );
}

export function getPieceRefusalResponse(sysPrompt, pieceName, square, targetSquare, visibleBoard, reason, onChunk) {
  const prompt = reason === 'willful'
    ? `${ctx(square, visibleBoard)} The King ordered you, ${pieceName}, to move to ${targetSquare}. You REFUSE. One defiant or hurt sentence.`
    : `${ctx(square, visibleBoard)} The King ordered you, ${pieceName}, to move to ${targetSquare} — but that move is illegal. Refuse in character in one sentence.`;
  return streamClaude(sysPrompt, prompt, 90, onChunk);
}

export function hasApiKey() {
  return !!(localStorage.getItem('claude_api_key') || process.env.REACT_APP_ANTHROPIC_API_KEY);
}
