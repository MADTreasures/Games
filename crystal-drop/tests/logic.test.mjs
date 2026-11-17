// Rule tests for src/logic.js. Expected values come from the Kotlin sources of the Android project
// (GameState.kt, Board.kt, Tetromino.kt, Randomizer.kt).   Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/logic.js';

const L = globalThis.KF.Logic;
const { COLS, ROWS, SPAWN_ROWS, Phase } = L;
const TOTAL = ROWS + SPAWN_ROWS;

function seeded(seed = 1) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function newGame(opts = {}) {
  const g = new L.GameState({ rng: seeded(opts.seed || 1), clearDelayMs: opts.clearDelayMs });
  const events = [];
  g.onEvent = (name, p) => events.push([name, p]);
  g.startGame(0);
  return { g, events };
}
function setPiece(g, type, x, y, rotations = 0) {
  const p = g.createPiece(type);
  for (let i = 0; i < rotations; i++) p.shape = L.rotateCW(p.shape);
  p.x = x; p.y = y;
  g.currentPiece = p;
  g.phase = Phase.FALLING;
  return p;
}
function fillRow(g, displayRow, exceptCols = []) {
  for (let c = 0; c < COLS; c++) if (!exceptCols.includes(c)) g.board.grid[displayRow + SPAWN_ROWS][c] = { type: 'O', pid: 900 + c, seed: c };
}
const filled = (shape) => shape.flat().filter(Boolean).length;

test('constants match the original', () => {
  assert.deepEqual([COLS, ROWS, SPAWN_ROWS], [10, 20, 4]);
  assert.deepEqual(L.POINTS, { 1: 100, 2: 300, 3: 500, 4: 800 });
  assert.deepEqual(L.SPEEDS, [800, 720, 630, 550, 470, 380, 300, 220, 130, 100, 80, 80, 80, 70, 70, 70, 50, 50, 50, 30]);
  assert.deepEqual([L.LOCK_DELAY_MS, L.DAS_DELAY_MS, L.ARR_DELAY_MS, L.HARD_DROP_DEBOUNCE_MS, L.MAX_LOCK_RESETS], [500, 170, 50, 50, 15]);
  assert.deepEqual(L.SIMPLE_KICKS, [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, -2]]);
  assert.deepEqual(L.TYPES, ['I', 'O', 'T', 'S', 'Z', 'J', 'L']);
});

test('shapes: four blocks each, rotateCW matches rotated[i][j] = shape[n-1-j][i]', () => {
  for (const t of L.TYPES) assert.equal(filled(L.SHAPES[t]), 4, t);
  assert.deepEqual(L.rotateCW([[0, 1, 0], [1, 1, 1], [0, 0, 0]]), [[0, 1, 0], [0, 1, 1], [0, 1, 0]]);
  assert.deepEqual(L.rotateCW(L.SHAPES.I), [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]]);
  for (const t of L.TYPES) {
    let s = L.SHAPES[t];
    for (let i = 0; i < 4; i++) s = L.rotateCW(s);
    assert.deepEqual(s, L.SHAPES[t], t + ' four turns');
    assert.deepEqual(L.rotateCCW(L.rotateCW(L.SHAPES[t])), L.SHAPES[t], t + ' cw then ccw');
  }
});

test('7-bag: every seven pieces contain each type once', () => {
  const r = new L.Randomizer(seeded(42));
  for (let bag = 0; bag < 50; bag++) {
    const got = [];
    for (let i = 0; i < 7; i++) got.push(r.next());
    assert.deepEqual(got.slice().sort(), L.TYPES.slice().sort());
  }
});

test('spawn: centred, y = -2, next piece prepared', () => {
  const { g } = newGame();
  const p = g.currentPiece;
  assert.equal(p.y, -2);
  assert.equal(p.x, Math.floor((COLS - p.shape[0].length) / 2));
  assert.ok(g.nextPiece);
  assert.equal(g.phase, Phase.FALLING);
  assert.equal(g.createPiece('I').x, 3);
  assert.equal(g.createPiece('O').x, 4);
  assert.equal(g.createPiece('T').x, 3);
});

test('gravity: one row per drop interval, only when the interval has elapsed', () => {
  const { g } = newGame();
  const y0 = g.currentPiece.y;
  g.update(799); assert.equal(g.currentPiece.y, y0);
  g.update(800); assert.equal(g.currentPiece.y, y0 + 1);
  g.update(1599); assert.equal(g.currentPiece.y, y0 + 1);
  g.update(1600); assert.equal(g.currentPiece.y, y0 + 2);
});

test('board limits: walls, floor, cells above the field are allowed', () => {
  const b = new L.Board();
  const O = [[1, 1], [1, 1]];
  assert.equal(b.isValid(O, 0, 0), true);
  assert.equal(b.isValid(O, -1, 0), false);
  assert.equal(b.isValid(O, 8, 0), true);
  assert.equal(b.isValid(O, 9, 0), false);
  assert.equal(b.isValid(O, 0, 18), true);
  assert.equal(b.isValid(O, 0, 19), false);
  assert.equal(b.isValid(O, 0, -6), true);          // above the hidden rows: nothing to collide with
  b.grid[SPAWN_ROWS + 5][3] = { type: 'T', pid: 1, seed: 1 };
  assert.equal(b.isValid(O, 3, 4), false);
  assert.equal(b.isValid(O, 3, 3), true);
});

test('lock delay: 500 ms on the ground, then the piece locks and the next one spawns', () => {
  const { g, events } = newGame();
  const p = setPiece(g, 'O', 4, 18);
  g.update(1000);                                   // touches the floor -> delay starts
  assert.equal(g.lockDelayActive, true);
  g.update(1499); assert.equal(g.currentPiece, p);
  g.update(1500);
  assert.notEqual(g.currentPiece, p);
  assert.ok(events.some(([n]) => n === 'lock'));
  assert.ok(g.board.getCell(TOTAL - 1, 4) && g.board.getCell(TOTAL - 1, 5));
});

test('lock delay: moves reset it at most 15 times', () => {
  const { g } = newGame();
  const p = setPiece(g, 'O', 4, 18);
  let t = 1000;
  g.update(t);
  for (let i = 0; i < 15; i++) { t += 400; (i % 2 ? g.moveLeft(t) : g.moveRight(t)); g.update(t); assert.equal(g.currentPiece, p, 'reset ' + i); }
  assert.equal(g.lockDelayMoveResets, 15);
  t += 400; g.moveLeft(t); g.update(t);             // 16th move no longer resets
  assert.equal(g.currentPiece, p);
  t += 100; g.update(t);                            // 500 ms after the 15th reset
  assert.notEqual(g.currentPiece, p);
});

test('DAS and ARR: first auto step 220 ms after the press, then every 50 ms', () => {
  const { g } = newGame();
  const p = setPiece(g, 'O', 4, 5);
  g.dropInterval = 1e9;
  g.moveLeft(1000); g.startDAS(-1, 1000);
  assert.equal(p.x, 3);
  g.update(1169); assert.equal(p.x, 3);
  g.update(1219); assert.equal(p.x, 3);
  g.update(1220); assert.equal(p.x, 2);
  g.update(1269); assert.equal(p.x, 2);
  g.update(1270); assert.equal(p.x, 1);
  g.stopDAS();
  g.update(1400); assert.equal(p.x, 1);
});

test('rotation uses the simple kick table in order', () => {
  const { g } = newGame();
  const p = setPiece(g, 'I', 6, 5, 1);              // vertical I in matrix column 2 -> board column 8
  p.x = 7;                                          // board column 9, against the right wall
  assert.equal(g.tryRotate(100), true);             // needs a kick to the left
  assert.equal(p.rotation, 1);
  assert.ok(p.x < 7);
  for (let r = 0; r < p.shape.length; r++) for (let c = 0; c < 4; c++) if (p.shape[r][c]) assert.ok(p.x + c >= 0 && p.x + c < COLS);
});

test('soft drop: +1 point per row, hard drop: +2 per row and locks at once', () => {
  const { g } = newGame();
  setPiece(g, 'O', 4, 0);
  assert.equal(g.softDrop(10), true);
  assert.equal(g.score, 1);
  assert.equal(g.currentPiece.y, 1);
  const p = g.currentPiece;
  assert.equal(g.hardDrop(20), true);
  assert.equal(g.score, 1 + 17 * 2);
  assert.notEqual(g.currentPiece, p);
  assert.ok(g.board.getCell(TOTAL - 1, 4));
});

test('hard drop is ignored within 50 ms of the previous one', () => {
  const { g } = newGame();
  setPiece(g, 'O', 0, 0);
  assert.equal(g.hardDrop(1000), true);
  setPiece(g, 'O', 4, 0);
  assert.equal(g.hardDrop(1049), false);
  assert.equal(g.hardDrop(1050), true);
});

test('line clear: rows crack for clearDelayMs, then score = points x level, rows above move down', () => {
  const { g, events } = newGame({ clearDelayMs: 240 });
  fillRow(g, 19, [4, 5]);
  fillRow(g, 18, [4, 5]);
  g.board.grid[SPAWN_ROWS + 17][0] = { type: 'T', pid: 77, seed: 7 };
  setPiece(g, 'O', 4, 0);
  g.hardDrop(1000);
  assert.equal(g.phase, Phase.CLEARING);
  assert.deepEqual(g.clearing.displayRows, [18, 19]);
  assert.equal(g.currentPiece, null);
  g.update(1239); assert.equal(g.phase, Phase.CLEARING);
  g.update(1240);
  assert.equal(g.phase, Phase.FALLING);
  assert.equal(g.lines, 2);
  assert.equal(g.score, 18 * 2 + 300);
  assert.equal(g.board.getCell(TOTAL - 1, 0).pid, 77);
  assert.equal(g.board.findCompleteRows().length, 0);
  const names = events.map(([n]) => n);
  assert.ok(names.indexOf('clearStart') < names.indexOf('clearEnd'));
  assert.equal(events.find(([n]) => n === 'clearEnd')[1].gained, 300);
});

test('four rows at level 3 score 800 x 3; level = lines / 10 + 1 with the speed table', () => {
  const { g, events } = newGame({ clearDelayMs: 0 });
  g.level = 3; g.lines = 26;
  for (let r = 16; r < 20; r++) fillRow(g, r, [9]);
  setPiece(g, 'I', 7, 0, 1);
  g.hardDrop(500);
  assert.equal(g.lines, 30);
  assert.equal(g.score, 16 * 2 + 2400);
  assert.equal(g.level, 4);
  assert.equal(g.dropInterval, 550);
  assert.ok(events.some(([n, p]) => n === 'levelUp' && p.level === 4));
  g.lines = 500; g.level = 1;
  fillRow(g, 19, [4, 5]);
  setPiece(g, 'O', 4, 0);
  g.hardDrop(2000);
  assert.equal(g.level, 51);
  assert.equal(g.dropInterval, 30);
});

test('game over when the spawn position is blocked', () => {
  const { g, events } = newGame();
  for (let c = 0; c < COLS; c++) for (let r = 0; r < TOTAL; r++) if (c !== 0) g.board.grid[r][c] = { type: 'Z', pid: 5, seed: 5 };
  g.spawn();
  assert.equal(g.gameRunning, false);
  assert.equal(g.phase, Phase.GAME_OVER);
  assert.ok(events.some(([n]) => n === 'gameOver'));
  assert.equal(g.canAcceptInput(), false);
});

test('pause freezes updates and input gating follows the phase', () => {
  const { g } = newGame();
  const y = g.currentPiece.y;
  g.togglePause(100);
  g.update(5000);
  assert.equal(g.currentPiece.y, y);
  assert.equal(g.canAcceptInput(), false);
  g.togglePause(5000);
  g.update(5799); assert.equal(g.currentPiece.y, y);
  g.update(5800); assert.equal(g.currentPiece.y, y + 1);
});

test('ghost position and stable block seeds through rotation and lock', () => {
  const { g } = newGame();
  const p = setPiece(g, 'T', 3, 2);
  assert.equal(g.getGhostY(), 18);
  const seedsBefore = p.shape.flat().filter(Boolean).map((k) => L.cellSeed(p.pid, k)).sort();
  g.tryRotate(10);
  const seedsAfter = p.shape.flat().filter(Boolean).map((k) => L.cellSeed(p.pid, k)).sort();
  assert.deepEqual(seedsAfter, seedsBefore);
  g.hardDrop(100);
  const locked = [];
  for (let r = 0; r < TOTAL; r++) for (let c = 0; c < COLS; c++) { const cell = g.board.getCell(r, c); if (cell && cell.pid === p.pid) locked.push(cell.seed); }
  assert.deepEqual(locked.sort(), seedsBefore);
});
