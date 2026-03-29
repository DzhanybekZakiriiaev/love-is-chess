const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function evaluateBoard(chess) {
  let score = 0;
  chess.board().forEach(row => {
    row.forEach(piece => {
      if (!piece) return;
      const val = PIECE_VALUES[piece.type] || 0;
      score += piece.color === 'b' ? val : -val;
    });
  });
  if (chess.isCheckmate()) return chess.turn() === 'b' ? -1000 : 1000;
  return score;
}

export function getBotMove(chess) {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;

  let bestScore = -Infinity;
  let bestMoves = [];

  for (const move of moves) {
    chess.move(move);
    const score = -evaluateBoard(chess);
    chess.undo();

    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}
