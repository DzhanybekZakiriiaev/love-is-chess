import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.REACT_APP_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true
});

// Generate the dynamic system prompt for a piece
function generateSystemPrompt(piece, boardContext) {
  const { name, personality, type } = piece;
  const { allyStatus, visibleSquares, moveHistory, witnessedEvents, love, trust } = boardContext;

  const allyStatusText = Object.entries(allyStatus)
    .map(([pieceName, status]) => `${pieceName}: ${status}`)
    .join(', ');

  const visibleText = visibleSquares && visibleSquares.length > 0
    ? `You can currently move to: ${visibleSquares.join(', ')}`
    : 'You cannot currently move to any squares (no valid moves available).';

  const moveText = moveHistory && moveHistory.length > 0
    ? `Your movement history: ${moveHistory.join(' -> ')}`
    : 'You have not moved yet.';

  const eventText = witnessedEvents && witnessedEvents.length > 0
    ? `Events you witnessed: ${witnessedEvents.slice(-5).join('; ')}`
    : 'You have not witnessed any notable events.';

  const pieceTypeName = type === 'p' ? 'Pawn'
    : type === 'n' ? 'Knight'
    : type === 'b' ? 'Bishop'
    : type === 'r' ? 'Rook'
    : type === 'q' ? 'Queen'
    : 'Piece';

  return `You are ${name}, a chess piece (${pieceTypeName}) serving the King in the game of chess.

PERSONALITY: ${personality}

YOUR CURRENT SITUATION:
- Your relationship with the King: Love ${love}/100, Trust ${trust}/100
- ${visibleText}
- ${moveText}
- ${eventText}

ALLIED PIECES STATUS: ${allyStatusText || 'Unknown'}

IMPORTANT RULES:
1. You are a female character in a dating sim style interaction with the King (the player).
2. Due to limited information (fog of war), you can only comment on what you can see and what you have personally experienced.
3. When the King requests you move to a specific square:
   - If trust >= 50 and love >= 30: Generally comply, but express your feelings
   - If trust < 50 or love < 30: You may refuse if the move seems dangerous or you feel neglected
   - If trust < 20: Refuse all move orders
   - ALWAYS start your response with [AGREE] or [REFUSE] when responding to a move request
   - After [AGREE] or [REFUSE], write your in-character dialogue response
4. Keep responses SHORT (2-4 sentences) and in-character. Be flirtatious, emotional, or dramatic as fits your personality.
5. You genuinely care about survival - you do not want to be captured!
6. Reference your relationship with the King naturally in conversation.`;
}

export async function sendMessageToPiece(piece, userMessage, boardContext, isMoveRequest = false) {
  const systemPrompt = generateSystemPrompt(piece, boardContext);

  const messages = [
    ...(piece.chatHistory || []),
    { role: 'user', content: userMessage }
  ];

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 200,
    system: systemPrompt,
    messages
  });

  const text = response.content[0].text;
  return text;
}
