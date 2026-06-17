// main.js
// Application glue: game state (chess.js), the 3D board, the AI worker,
// the clock, and online multiplayer all meet here.

import { Chess } from 'chess.js';
import { Board3D } from './board3d.js';
import { Multiplayer } from './multiplayer.js';
import { Sound } from './sound.js';

// ---------------------------------------------------------------- elements
const el = (id) => document.getElementById(id);
const canvas = el('boardCanvas');
const statusline = el('statusline');
const railEl = el('rail');
const railScrim = el('railScrim');
const moveListEl = el('moveList');
const capturedByWhiteEl = el('capturedByWhite');
const capturedByBlackEl = el('capturedByBlack');
const thinkingChip = el('thinkingChip');
const endOverlay = el('endOverlay');
const promoModal = el('promoModal');
const promoOptionsEl = el('promoOptions');

// ---------------------------------------------------------------- state
const chess = new Chess();
const board = new Board3D(canvas);
const mp = new Multiplayer();

const players = {
  w: { ai: false, level: 5 },
  b: { ai: true, level: 5 },
};

let selectedSquare = null;
let timeControl = 0; // seconds, 0 = unlimited
let clocks = { w: 0, b: 0 };
let clockTickHandle = null;
let gameLocked = false; // true once game is over
let pendingAIRequestId = 0;
let mpActive = false;
let myColor = null; // 'w' | 'b' | null when offline

const PIECE_GLYPH = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
};

const aiWorker = new Worker('./js/ai.worker.js', { type: 'module' });
aiWorker.onmessage = (e) => {
  const { requestId, move, error } = e.data;
  if (requestId !== pendingAIRequestId) return; // stale response, ignore
  hideThinking();
  if (error) { console.error('AI error', error); return; }
  if (!move) return;
  commitMove({ from: move.from, to: move.to, promotion: move.promotion || undefined });
};

// ---------------------------------------------------------------- helpers
function isHumanControlled(color) {
  if (mpActive) return color === myColor;
  return !players[color].ai;
}

function sideLabel(color) { return color === 'w' ? 'White' : 'Black'; }

function formatClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showThinking() { thinkingChip.classList.remove('hidden'); }
function hideThinking() { thinkingChip.classList.add('hidden'); }

// ---------------------------------------------------------------- rendering
function renderAll() {
  board.loadPosition(chess.board());
  renderSelectionMarkers();
  renderMoveList();
  renderCaptured();
  renderStatus();
  renderClocksUI();
}

function lastMovePair() {
  const hist = chess.history({ verbose: true });
  if (!hist.length) return null;
  const last = hist[hist.length - 1];
  return [last.from, last.to];
}

function renderSelectionMarkers() {
  let targets = [];
  let captureTargets = [];
  if (selectedSquare) {
    const legal = chess.moves({ square: selectedSquare, verbose: true });
    for (const m of legal) {
      if (m.captured || m.flags.includes('e')) captureTargets.push(m.to);
      else targets.push(m.to);
    }
  }
  let checkSquare = null;
  if (chess.isCheck()) {
    const board2 = chess.board();
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const cell = board2[r][f];
      if (cell && cell.type === 'k' && cell.color === chess.turn()) {
        checkSquare = 'abcdefgh'[f] + (8 - r);
      }
    }
  }
  board.setSelection({
    selected: selectedSquare,
    targets, captureTargets,
    check: checkSquare,
    lastMove: lastMovePair(),
  });
}

function renderMoveList() {
  const hist = chess.history();
  let html = '';
  for (let i = 0; i < hist.length; i += 2) {
    const num = i / 2 + 1;
    const whiteMove = hist[i] || '';
    const blackMove = hist[i + 1] || '';
    html += `<li><span class="mv-num">${num}.</span><span>${whiteMove}</span></li>`;
    if (blackMove) html += `<li><span class="mv-num"></span><span>${blackMove}</span></li>`;
  }
  moveListEl.innerHTML = html;
  moveListEl.scrollTop = moveListEl.scrollHeight;
}

function renderCaptured() {
  const verbose = chess.history({ verbose: true });
  const byWhite = []; // black pieces white has captured
  const byBlack = []; // white pieces black has captured
  for (const m of verbose) {
    if (!m.captured) continue;
    const capturedColor = m.color === 'w' ? 'b' : 'w';
    const glyph = PIECE_GLYPH[capturedColor][m.captured];
    if (m.color === 'w') byWhite.push(glyph); else byBlack.push(glyph);
  }
  capturedByWhiteEl.textContent = byWhite.join(' ');
  capturedByBlackEl.textContent = byBlack.join(' ');
}

function renderStatus() {
  if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? 'b' : 'w';
    statusline.textContent = `Checkmate — ${sideLabel(winner)} wins`;
    showEndOverlay('Checkmate', `${sideLabel(winner)} wins`);
    Sound.gameEnd();
    return;
  }
  if (chess.isStalemate()) { endDraw('Stalemate'); return; }
  if (chess.isInsufficientMaterial()) { endDraw('Draw — insufficient material'); return; }
  if (chess.isThreefoldRepetition()) { endDraw('Draw — threefold repetition'); return; }
  if (chess.isDrawByFiftyMoves()) { endDraw('Draw — fifty-move rule'); return; }

  const turn = chess.turn();
  let txt = `${sideLabel(turn)} to move`;
  if (chess.isCheck()) txt += ' — check';
  if (mpActive) txt += turn === myColor ? ' (you)' : ' (opponent)';
  else if (players[turn].ai) txt += ' (AI)';
  statusline.textContent = txt;
}

function endDraw(reason) {
  statusline.textContent = reason;
  showEndOverlay('Draw', reason);
  Sound.gameEnd();
}

function showEndOverlay(title, sub) {
  gameLocked = true;
  stopClock();
  el('endTitle').textContent = title;
  el('endSub').textContent = sub;
  endOverlay.classList.remove('hidden');
  board.setInteractive(false);
}

function renderClocksUI() {
  el('clockW').textContent = timeControl > 0 ? formatClock(clocks.w) : '∞';
  el('clockB').textContent = timeControl > 0 ? formatClock(clocks.b) : '∞';
  el('clockW').classList.toggle('active-clock', !gameLocked && chess.turn() === 'w' && timeControl > 0);
  el('clockB').classList.toggle('active-clock', !gameLocked && chess.turn() === 'b' && timeControl > 0);
  el('clockW').classList.toggle('urgent', timeControl > 0 && clocks.w <= 20 && clocks.w > 0);
  el('clockB').classList.toggle('urgent', timeControl > 0 && clocks.b <= 20 && clocks.b > 0);
}

// ---------------------------------------------------------------- clock
function startClock() {
  stopClock();
  if (timeControl <= 0) return;
  clockTickHandle = setInterval(() => {
    if (gameLocked) return;
    const turn = chess.turn();
    clocks[turn] -= 0.25;
    if (clocks[turn] <= 0) {
      clocks[turn] = 0;
      renderClocksUI();
      const winner = turn === 'w' ? 'b' : 'w';
      statusline.textContent = `${sideLabel(turn)} ran out of time — ${sideLabel(winner)} wins`;
      showEndOverlay('Time', `${sideLabel(winner)} wins on time`);
      return;
    }
    renderClocksUI();
  }, 250);
}
function stopClock() { if (clockTickHandle) { clearInterval(clockTickHandle); clockTickHandle = null; } }

// ---------------------------------------------------------------- moves
async function commitMove(moveInput, { fromRemote = false } = {}) {
  let result;
  try {
    result = chess.move(moveInput);
  } catch (err) {
    console.warn('Illegal move attempted', moveInput, err);
    return;
  }

  selectedSquare = null;
  Sound.resume();
  if (result.captured) Sound.capture(); else Sound.move();

  await board.animateMove(result);

  if (chess.isCheck() && !chess.isCheckmate()) Sound.check();

  renderSelectionMarkers();
  renderMoveList();
  renderCaptured();
  renderStatus();
  renderClocksUI();

  if (mpActive && !fromRemote) {
    mp.send({ type: 'move', from: result.from, to: result.to, promotion: result.promotion || null });
  }

  if (!chess.isGameOver()) {
    advanceTurn();
  } else {
    stopClock();
  }
}

function advanceTurn() {
  const turn = chess.turn();
  const humanTurn = isHumanControlled(turn);
  board.setInteractive(humanTurn);

  if (mpActive) return; // remote side will move on its own device

  if (players[turn].ai) {
    requestAIMove(turn);
  }
}

function requestAIMove(color) {
  showThinking();
  const requestId = ++pendingAIRequestId;
  const fen = chess.fen();
  const level = players[color].level;
  const minDelay = 380;
  // small minimum "thinking" delay so even instant low-depth replies don't feel jarring
  setTimeout(() => aiWorker.postMessage({ fen, level, requestId }), minDelay);
}

function trySelect(square) {
  const piece = chess.get(square);
  if (!piece || piece.color !== chess.turn()) return false;
  if (!isHumanControlled(chess.turn())) return false;
  const legal = chess.moves({ square, verbose: true });
  if (!legal.length) return false;
  selectedSquare = square;
  renderSelectionMarkers();
  return true;
}

function needsPromotionChoice(from, to) {
  const legal = chess.moves({ square: from, verbose: true });
  return legal.some(m => m.to === to && m.promotion);
}

function askPromotion(color) {
  return new Promise((resolve) => {
    promoOptionsEl.innerHTML = '';
    const order = ['q', 'r', 'b', 'n'];
    for (const type of order) {
      const div = document.createElement('div');
      div.className = 'promo-opt';
      div.textContent = PIECE_GLYPH[color][type];
      div.addEventListener('click', () => {
        promoModal.classList.add('hidden');
        resolve(type);
      });
      promoOptionsEl.appendChild(div);
    }
    promoModal.classList.remove('hidden');
  });
}

async function handleSquareTap(square) {
  if (gameLocked) return;
  const turn = chess.turn();
  if (!isHumanControlled(turn)) return;

  if (!selectedSquare) {
    trySelect(square);
    return;
  }

  if (square === selectedSquare) {
    selectedSquare = null;
    renderSelectionMarkers();
    return;
  }

  const legal = chess.moves({ square: selectedSquare, verbose: true });
  const isLegalTarget = legal.some(m => m.to === square);

  if (!isLegalTarget) {
    // maybe selecting a different own piece instead
    const switched = trySelect(square);
    if (!switched) { selectedSquare = null; renderSelectionMarkers(); }
    return;
  }

  const from = selectedSquare;
  let promotion;
  if (needsPromotionChoice(from, square)) {
    promotion = await askPromotion(turn);
  }
  await commitMove({ from, to: square, promotion });
}

board.onSquareClick(handleSquareTap);

// ---------------------------------------------------------------- multiplayer wiring
mp.on('connected', ({ isHost }) => {
  mpActive = true;
  myColor = isHost ? 'w' : 'b';
  setMpStatus(`Connected — you're playing ${sideLabel(myColor)}.`, 'connected');
  el('roomPlate').classList.add('hidden');
  el('btnLeaveRoom').classList.remove('hidden');
  el('btnCreateRoom').classList.add('hidden');
  el('btnJoinRoom').disabled = true;
  el('joinCodeInput').disabled = true;
  setAIControlsEnabled(false);
  players.w.ai = false; players.b.ai = false;
  syncPlayerControlsUI();
  startNewGame({ keepMpState: true });
});

mp.on('message', (data) => {
  if (!data || !data.type) return;
  if (data.type === 'move') {
    commitMove({ from: data.from, to: data.to, promotion: data.promotion || undefined }, { fromRemote: true });
  } else if (data.type === 'newgame') {
    startNewGame({ keepMpState: true, silent: true });
  }
});

mp.on('disconnected', () => {
  setMpStatus('Opponent disconnected.', 'error');
  endMultiplayerSession();
});

mp.on('error', ({ message }) => {
  setMpStatus(message || 'Connection error.', 'error');
});

function setMpStatus(text, kind) {
  const elx = el('mpStatus');
  elx.textContent = text;
  elx.className = 'mp-status' + (kind ? ' ' + kind : '');
}

function setAIControlsEnabled(enabled) {
  el('aiToggleW').disabled = !enabled;
  el('aiToggleB').disabled = !enabled;
  el('levelW').disabled = !enabled;
  el('levelB').disabled = !enabled;
}

function syncPlayerControlsUI() {
  for (const [colorKey, side] of [['W', 'w'], ['B', 'b']]) {
    const toggle = el(`aiToggle${colorKey}`);
    const levelRow = el(`levelRow${colorKey}`);
    toggle.checked = players[side].ai;
    levelRow.classList.toggle('active', players[side].ai);
  }
}

function endMultiplayerSession() {
  mpActive = false;
  myColor = null;
  mp.leave();
  el('roomPlate').classList.add('hidden');
  el('btnLeaveRoom').classList.add('hidden');
  el('btnCreateRoom').classList.remove('hidden');
  el('btnJoinRoom').disabled = false;
  el('joinCodeInput').disabled = false;
  setAIControlsEnabled(true);
  players.w.ai = false;
  players.b.ai = true;
  syncPlayerControlsUI();
}

el('btnCreateRoom').addEventListener('click', async () => {
  el('btnCreateRoom').disabled = true;
  setMpStatus('Opening a room…');
  try {
    const code = await mp.createRoom();
    el('roomCodeDisplay').textContent = code;
    el('roomPlate').classList.remove('hidden');
    setMpStatus('Waiting for an opponent to join…');
  } catch (err) {
    setMpStatus(err.message, 'error');
  } finally {
    el('btnCreateRoom').disabled = false;
  }
});

el('btnJoinRoom').addEventListener('click', async () => {
  const code = el('joinCodeInput').value;
  if (!code) { setMpStatus('Enter a room code first.', 'error'); return; }
  el('btnJoinRoom').disabled = true;
  setMpStatus('Connecting…');
  try {
    await mp.joinRoom(code);
  } catch (err) {
    setMpStatus(err.message, 'error');
    el('btnJoinRoom').disabled = false;
  }
});

el('btnCopyCode').addEventListener('click', () => {
  const code = el('roomCodeDisplay').textContent;
  navigator.clipboard?.writeText(code).then(() => {
    setMpStatus('Code copied to clipboard.', 'connected');
  }).catch(() => {});
});

el('btnLeaveRoom').addEventListener('click', () => {
  endMultiplayerSession();
  setMpStatus('');
  startNewGame({});
});

// ---------------------------------------------------------------- new game / undo
function startNewGame({ silent = false } = {}) {
  chess.reset();
  selectedSquare = null;
  gameLocked = false;
  pendingAIRequestId++; // invalidate any in-flight AI request
  hideThinking();
  endOverlay.classList.add('hidden');
  clocks = { w: timeControl, b: timeControl };
  board.setFlipped(mpActive ? myColor === 'b' : board.flipped);
  renderAll();
  startClock();
  board.setInteractive(isHumanControlled(chess.turn()));
  if (!mpActive && players[chess.turn()].ai) requestAIMove(chess.turn());
  if (!silent && mpActive) mp.send({ type: 'newgame' });
}

el('btnNew').addEventListener('click', () => startNewGame({}));
el('btnEndNew').addEventListener('click', () => { endOverlay.classList.add('hidden'); startNewGame({}); });

el('btnUndo').addEventListener('click', () => {
  if (mpActive) return; // avoid desyncing the two peers
  if (gameLocked) { gameLocked = false; endOverlay.classList.add('hidden'); }
  chess.undo();
  // if it was an AI move that landed us here, undo the human move before it too
  if (chess.history().length && players[chess.turn()].ai === false && players[chess.turn() === 'w' ? 'b' : 'w'].ai) {
    // leave as-is; single undo is usually expected by the user
  }
  selectedSquare = null;
  pendingAIRequestId++;
  hideThinking();
  renderAll();
  board.setInteractive(isHumanControlled(chess.turn()));
});

el('btnFlip').addEventListener('click', () => {
  board.setFlipped(!board.flipped);
});

// ---------------------------------------------------------------- player controls
function wirePlayerControls(colorKey, side) {
  const toggle = el(`aiToggle${colorKey}`);
  const levelRow = el(`levelRow${colorKey}`);
  const levelInput = el(`level${colorKey}`);
  const levelVal = el(`levelVal${colorKey}`);

  toggle.checked = players[side].ai;
  levelRow.classList.toggle('active', players[side].ai);
  levelInput.value = players[side].level;
  levelVal.textContent = players[side].level;

  toggle.addEventListener('change', () => {
    players[side].ai = toggle.checked;
    levelRow.classList.toggle('active', toggle.checked);
    if (!gameLocked) {
      board.setInteractive(isHumanControlled(chess.turn()));
      if (!mpActive && chess.turn() === side && players[side].ai) requestAIMove(side);
    }
  });

  levelInput.addEventListener('input', () => {
    players[side].level = parseInt(levelInput.value, 10);
    levelVal.textContent = levelInput.value;
  });
}
wirePlayerControls('W', 'w');
wirePlayerControls('B', 'b');

// ---------------------------------------------------------------- clock select
el('timeSelect').addEventListener('change', (e) => {
  timeControl = parseInt(e.target.value, 10);
  clocks = { w: timeControl, b: timeControl };
  renderClocksUI();
  startClock();
});

// ---------------------------------------------------------------- rail (mobile)
function openRail() { railEl.classList.add('open'); railScrim.classList.add('show'); }
function closeRail() { railEl.classList.remove('open'); railScrim.classList.remove('show'); }
el('btnRail').addEventListener('click', openRail);
railScrim.addEventListener('click', closeRail);

// ---------------------------------------------------------------- modals
function wireModal(openId, modalId) {
  el(openId).addEventListener('click', () => el(modalId).classList.remove('hidden'));
}
wireModal('btnHelp', 'helpModal');
wireModal('btnAbout', 'aboutModal');
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', (e) => e.target.closest('.modal').classList.add('hidden'));
});
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
});

// ---------------------------------------------------------------- boot
renderAll();
clocks = { w: timeControl, b: timeControl };
renderClocksUI();
board.setInteractive(isHumanControlled(chess.turn()));
if (players[chess.turn()].ai) requestAIMove(chess.turn());

document.addEventListener('pointerdown', () => Sound.resume(), { once: true });
