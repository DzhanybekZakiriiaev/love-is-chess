import React from 'react';

const FILES = 'abcdefgh';

function squareName(r, c) { return FILES[c] + (8 - r); }

const PIECE_UNICODE = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

export default function ChessBoard({
  board, selectedPiece, validMoves, visibleSquares,
  lastMove, onSquareClick,
}) {
  const selectedSquare = selectedPiece?.square || null;

  return (
    <div className="board-wrapper">
      <div className="rank-labels">
        {[8,7,6,5,4,3,2,1].map(n => <span key={n}>{n}</span>)}
      </div>
      <div>
        <div className="chess-board">
          {board.map((row, rowIndex) =>
            row.map((piece, colIndex) => {
              const sq         = squareName(rowIndex, colIndex);
              const isLight    = (rowIndex + colIndex) % 2 === 0;
              const isSelected = sq === selectedSquare;
              const isHint     = validMoves.includes(sq);
              const isLastMove = lastMove?.from === sq || lastMove?.to === sq;
              const isFogged   = visibleSquares != null && !visibleSquares.has(sq);

              const cls = [
                'square',
                isLight    ? 'light'     : 'dark',
                isSelected ? 'selected'  : '',
                isLastMove ? 'last-move' : '',
              ].filter(Boolean).join(' ');

              const unicode = piece ? PIECE_UNICODE[`${piece.color}${piece.type}`] : null;

              return (
                <div
                  key={sq}
                  className={cls}
                  onClick={() => onSquareClick(sq)}
                  title={sq}
                >
                  {!isFogged && isHint && !piece && <div className="move-dot" />}
                  {!isFogged && isHint &&  piece && <div className="capture-ring" />}

                  {!isFogged && unicode && (
                    <span className={`piece ${piece.color === 'w' ? 'white-piece clickable' : 'black-piece'}`}>
                      {unicode}
                    </span>
                  )}

                  {isFogged && <div className="fog-overlay" />}
                </div>
              );
            })
          )}
        </div>
        <div className="file-labels">
          {FILES.split('').map(f => <span key={f}>{f}</span>)}
        </div>
      </div>
    </div>
  );
}
