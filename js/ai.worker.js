// ai.worker.js
// Runs entirely off the main thread. Receives { fen, level } and replies
// with { from, to, promotion }. Levels 1-10 scale search depth and add
// deliberate imprecision at the low end so weak levels feel human-fallible
// rather than just "slow strong play cut short".

import { Chess } from './vendor/chess.esm.js';

const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Simplified piece-square tables (from White's perspective, rank 1 -> rank 8).
// Mirrored for Black at lookup time.
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, -20, -20, 10, 10, 5,
    5, -5, -10, 0, 0, -10, -5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, 5, 10, 25, 25, 10, 5, 5,
    10, 10, 20, 30, 30, 20, 10, 10,
    50, 50, 50, 50, 50, 50, 50, 50,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 5, 5, 0, 0, 0,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    5, 10, 10, 10, 10, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    20, 30, 10, 0, 0, 10, 30, 20,
    20, 20, 0, 0, 0, 0, 20, 20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
  ],
};

function squareIndex(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  return rank * 8 + file;
}

function evaluate(chess) {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? -100000 : 100000;
  if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition()) return 0;

  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (!cell) continue;
      const idx = cell.color === 'w' ? (7 - r) * 8 + f : r * 8 + f;
      const value = PIECE_VALUE[cell.type] + (PST[cell.type][idx] || 0);
      score += cell.color === 'w' ? value : -value;
    }
  }
  // small mobility term encourages active, non-passive play
  const mobility = chess.moves().length;
  score += (chess.turn() === 'w' ? mobility : -mobility) * 1.5;
  return score;
}

function orderMoves(chess, moves) {
  return moves
    .map(m => {
      let s = 0;
      if (m.captured) s += (PIECE_VALUE[m.captured] || 0) * 10 - (PIECE_VALUE[m.piece] || 0);
      if (m.promotion) s += PIECE_VALUE[m.promotion] || 0;
      if (m.san && m.san.includes('+')) s += 50;
      return { m, s };
    })
    .sort((a, b) => b.s - a.s)
    .map(x => x.m);
}

function minimax(chess, depth, alpha, beta, maximizing) {
  if (depth === 0 || chess.isGameOver()) {
    return { score: evaluate(chess) };
  }
  const moves = orderMoves(chess, chess.moves({ verbose: true }));
  let best = null;

  for (const move of moves) {
    chess.move(move.san);
    const result = minimax(chess, depth - 1, alpha, beta, !maximizing);
    chess.undo();

    if (maximizing) {
      if (best === null || result.score > best.score) best = { score: result.score, move };
      alpha = Math.max(alpha, result.score);
    } else {
      if (best === null || result.score < best.score) best = { score: result.score, move };
      beta = Math.min(beta, result.score);
    }
    if (beta <= alpha) break; // alpha-beta cutoff
  }

  return best || { score: evaluate(chess) };
}

// Level -> { depth, blunderChance, noise } tuning curve.
function levelConfig(level) {
  const l = Math.max(1, Math.min(10, level | 0));
  const depth = l <= 2 ? 1 : l <= 4 ? 2 : l <= 6 ? 2 : l <= 8 ? 3 : 4;
  const noise = Math.max(0, (10 - l) * 18);       // eval noise (centipawns)
  const blunderChance = Math.max(0, (10 - l) * 0.045); // chance to play a random legal move
  return { depth, noise, blunderChance };
}

function chooseMove(fen, level) {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  if (legal.length === 0) return null;

  const { depth, noise, blunderChance } = levelConfig(level);

  if (Math.random() < blunderChance) {
    return legal[Math.floor(Math.random() * legal.length)];
  }

  const maximizing = chess.turn() === 'w';
  const ordered = orderMoves(chess, legal);

  let best = null;
  for (const move of ordered) {
    chess.move(move.san);
    const result = minimax(chess, depth - 1, -Infinity, Infinity, !maximizing);
    chess.undo();
    const noisy = result.score + (Math.random() * 2 - 1) * noise;
    if (best === null || (maximizing ? noisy > best.noisy : noisy < best.noisy)) {
      best = { move, noisy };
    }
  }
  return best ? best.move : ordered[0];
}

self.onmessage = (e) => {
  const { fen, level, requestId } = e.data;
  try {
    const move = chooseMove(fen, level);
    self.postMessage({
      requestId,
      move: move ? { from: move.from, to: move.to, promotion: move.promotion || null } : null,
    });
  } catch (err) {
    self.postMessage({ requestId, error: String(err && err.message || err) });
  }
};
