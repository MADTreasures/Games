// Kristallfall – game rules (no DOM, no clocks, no rendering).
// Ported 1:1 from the Kotlin sources (Board.kt, Tetromino.kt, Randomizer.kt, GameState.kt).
// Every method that depends on time takes `now` (ms on the caller's game clock).
(function (KF) {
  'use strict';

  const COLS = 10;
  const ROWS = 20;        // visible rows
  const SPAWN_ROWS = 4;   // hidden rows above the visible field
  const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  };

  const POINTS = { 1: 100, 2: 300, 3: 500, 4: 800 };
  const SPEEDS = [800, 720, 630, 550, 470, 380, 300, 220, 130, 100, 80, 80, 80, 70, 70, 70, 50, 50, 50, 30];
  const HARD_DROP_DEBOUNCE_MS = 50;
  const LOCK_DELAY_MS = 500;
  const DAS_DELAY_MS = 170;
  const ARR_DELAY_MS = 50;
  const MAX_LOCK_RESETS = 15;
  // Time between "row is complete" and "row is removed": the crystals crack during this window, then burst.
  const CLEAR_DELAY_MS = 240;

  // Kick table of the original (tried in order after a clockwise rotation).
  const SIMPLE_KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, -2]];

  const Phase = Object.freeze({
    IDLE: 'IDLE', SPAWNING: 'SPAWNING', FALLING: 'FALLING', LOCKING: 'LOCKING', CLEARING: 'CLEARING', GAME_OVER: 'GAME_OVER',
  });

  function rotateCW(shape) {
    const n = shape.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(new Array(n));
      for (let j = 0; j < n; j++) out[i][j] = shape[n - 1 - j][i];
    }
    return out;
  }

  function rotateCCW(shape) {
    const n = shape.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(new Array(n));
      for (let j = 0; j < n; j++) out[i][j] = shape[j][n - 1 - i];
    }
    return out;
  }

  // Stable 32-bit hash; gives every block of every piece its own look (facet variation) for its whole life.
  function cellSeed(pid, blockId) {
    let h = (Math.imul(pid | 0, 0x9E3779B1) ^ Math.imul((blockId | 0) + 0x7F4A7C15, 0x85EBCA6B)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0;
    h ^= h >>> 12; h = Math.imul(h, 0x297A2D39) >>> 0;
    h ^= h >>> 15;
    return h >>> 0;
  }

  // ---------------------------------------------------------------- Board

  class Board {
    constructor(cols = COLS, visibleRows = ROWS, spawnRows = SPAWN_ROWS) {
      this.cols = cols;
      this.visibleRows = visibleRows;
      this.spawnRows = spawnRows;
      this.totalRows = visibleRows + spawnRows;
      this.grid = [];
      this.reset();
    }

    _emptyRow() { return new Array(this.cols).fill(null); }

    reset() {
      this.grid = [];
      for (let r = 0; r < this.totalRows; r++) this.grid.push(this._emptyRow());
    }

    // pieceY is in visible coordinates (0 = first visible row, negative = hidden spawn rows).
    isValid(shape, pieceX, pieceY, offsetX = 0, offsetY = 0) {
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c] === 0) continue;
          const nx = pieceX + c + offsetX;
          const ny = pieceY + r + offsetY;
          if (nx < 0 || nx >= this.cols) return false;
          if (ny >= this.visibleRows) return false;
          const boardY = ny + this.spawnRows;
          if (boardY >= 0 && boardY < this.totalRows && this.grid[boardY][nx] !== null) return false;
        }
      }
      return true;
    }

    lockPiece(piece) {
      const cells = [];
      for (let r = 0; r < piece.shape.length; r++) {
        for (let c = 0; c < piece.shape[r].length; c++) {
          const k = piece.shape[r][c];
          if (k === 0) continue;
          const by = piece.y + r + this.spawnRows;
          const bx = piece.x + c;
          if (by >= 0 && by < this.totalRows && bx >= 0 && bx < this.cols) {
            const cell = { type: piece.type, pid: piece.pid, seed: cellSeed(piece.pid, k) };
            this.grid[by][bx] = cell;
            cells.push({ col: bx, row: by - this.spawnRows, type: cell.type, pid: cell.pid, seed: cell.seed });
          }
        }
      }
      return cells;
    }

    findCompleteRows() {
      const complete = [];
      for (let r = this.spawnRows; r < this.totalRows; r++) {
        if (this.grid[r].every((cell) => cell !== null)) complete.push(r);
      }
      return complete;
    }

    removeRows(rows) {
      const rowSet = new Set(rows);
      const next = [];
      for (let i = 0; i < rows.length; i++) next.push(this._emptyRow());
      for (let r = 0; r < this.totalRows; r++) {
        if (!rowSet.has(r)) next.push(this.grid[r]);
      }
      this.grid = next;
    }

    getCell(boardRow, col) {
      if (boardRow < 0 || boardRow >= this.totalRows || col < 0 || col >= this.cols) return null;
      return this.grid[boardRow][col];
    }

    getGhostY(piece) {
      let ghostY = piece.y;
      while (this.isValid(piece.shape, piece.x, ghostY + 1)) ghostY++;
      return ghostY;
    }
  }

  // ---------------------------------------------------------------- Randomizer (7-bag)

  class Randomizer {
    constructor(rng) {
      this.rng = typeof rng === 'function' ? rng : Math.random;
      this.bag = [];
    }

    reset() { this.bag = []; }

    next() {
      if (this.bag.length === 0) this._fillBag();
      return this.bag.pop();
    }

    _fillBag() {
      const bag = TYPES.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
      }
      this.bag = bag;
    }
  }

  // ---------------------------------------------------------------- GameState

  class GameState {
    // opts: { rng: () => [0,1), clearDelayMs: number }
    constructor(opts = {}) {
      this.board = new Board(COLS, ROWS, SPAWN_ROWS);
      this.randomizer = new Randomizer(opts.rng);
      this.clearDelayMs = typeof opts.clearDelayMs === 'number' ? opts.clearDelayMs : CLEAR_DELAY_MS;

      // Single hook for sound and effects: onEvent(name, payload).
      // Names: start, spawn, move, rotate, softDrop, hardDrop, lock, clearStart, clearEnd, levelUp, gameOver, pause.
      this.onEvent = null;

      this.currentPiece = null;
      this.nextPiece = null;
      this.score = 0;
      this.level = 1;
      this.lines = 0;
      this.phase = Phase.IDLE;
      this.gameRunning = false;
      this.paused = false;

      this.dropInterval = SPEEDS[0];
      this.lastDropTime = 0;
      this.lastHardDropTime = -Infinity;

      this.lockDelayStartTime = 0;
      this.lockDelayActive = false;
      this.lockDelayMoveResets = 0;

      this.dasDirection = 0;
      this.dasStartTime = 0;
      this.dasActive = false;
      this.lastArrTime = 0;

      // While rows are cracking: { rows: [boardRow…], displayRows: [row…], startTime, cells: [{col,row,type,pid,seed}] }
      this.clearing = null;
      this._pid = 0;
    }

    _emit(name, payload) {
      if (typeof this.onEvent === 'function') this.onEvent(name, payload);
    }

    startGame(now) {
      this.board.reset();
      this.randomizer.reset();
      this.clearing = null;
      this.currentPiece = null;
      this.nextPiece = null;
      this.score = 0;
      this.level = 1;
      this.lines = 0;
      this.dropInterval = SPEEDS[0];
      this.paused = false;
      this.gameRunning = true;
      this.lockDelayActive = false;
      this.lockDelayMoveResets = 0;
      this.lastHardDropTime = -Infinity;
      this.stopDAS();
      this._pid = 0;
      this.phase = Phase.SPAWNING;
      this._emit('start');
      this.spawn();
      this.lastDropTime = now;
    }

    togglePause(now) {
      if (!this.gameRunning) return;
      this.paused = !this.paused;
      if (!this.paused) this.lastDropTime = now;
      this._emit('pause', { paused: this.paused });
    }

    update(now) {
      if (!this.gameRunning || this.paused) return;

      // Auto-shift while a direction is held (DAS, then ARR).
      if (this.dasActive && this.dasDirection !== 0 && this.phase === Phase.FALLING && this.currentPiece) {
        if (now - this.dasStartTime >= DAS_DELAY_MS && now - this.lastArrTime >= ARR_DELAY_MS) {
          const p = this.currentPiece;
          if (this.board.isValid(p.shape, p.x, p.y, this.dasDirection, 0)) {
            p.x += this.dasDirection;
            this._resetLockDelay(now);
            this._emit('move', { dx: this.dasDirection, auto: true });
          }
          this.lastArrTime = now;
        }
      }

      if (this.phase === Phase.FALLING) {
        const piece = this.currentPiece;
        if (!piece) return;
        if (!this.board.isValid(piece.shape, piece.x, piece.y, 0, 1)) {
          // Resting on something: lock after the delay.
          if (!this.lockDelayActive) {
            this.lockDelayActive = true;
            this.lockDelayStartTime = now;
          }
          if (now - this.lockDelayStartTime >= LOCK_DELAY_MS) this._performLock(now);
        } else {
          this.lockDelayActive = false;
          if (now - this.lastDropTime >= this.dropInterval) {
            piece.y += 1;
            this.lastDropTime = now;
          }
        }
      } else if (this.phase === Phase.CLEARING) {
        if (this.clearing && now - this.clearing.startTime >= this.clearDelayMs) this._finishClear(now);
      }
    }

    _performLock(now) {
      const piece = this.currentPiece;
      if (!piece) return;
      this.phase = Phase.LOCKING;
      const cells = this.board.lockPiece(piece);
      this.currentPiece = null;
      this.lockDelayActive = false;
      this.lockDelayMoveResets = 0;
      this._emit('lock', { type: piece.type, cells });

      const complete = this.board.findCompleteRows();
      if (complete.length > 0) {
        this._startClear(complete, now);
      } else {
        this.phase = Phase.SPAWNING;
        this.spawn();
        this.lastDropTime = now;
      }
    }

    _startClear(rows, now) {
      const cells = [];
      for (const r of rows) {
        for (let c = 0; c < COLS; c++) {
          const cell = this.board.getCell(r, c);
          if (cell) cells.push({ col: c, row: r - SPAWN_ROWS, type: cell.type, pid: cell.pid, seed: cell.seed });
        }
      }
      this.clearing = { rows: rows.slice(), displayRows: rows.map((r) => r - SPAWN_ROWS), startTime: now, cells };
      this.phase = Phase.CLEARING;
      this._emit('clearStart', { rows: this.clearing.displayRows, cells, count: rows.length });
      if (this.clearDelayMs <= 0) this._finishClear(now);
    }

    _finishClear(now) {
      const clearing = this.clearing;
      if (!clearing) return;
      this.clearing = null;

      this.board.removeRows(clearing.rows);

      const count = clearing.rows.length;
      const gained = (POINTS[count] || 0) * this.level;
      this.lines += count;
      this.score += gained;
      const newLevel = Math.floor(this.lines / 10) + 1;
      let leveledUp = false;
      if (newLevel !== this.level) {
        this.level = newLevel;
        this.dropInterval = SPEEDS[Math.min(this.level - 1, SPEEDS.length - 1)];
        leveledUp = true;
      }
      this._emit('clearEnd', { rows: clearing.displayRows, cells: clearing.cells, count, gained });
      if (leveledUp) this._emit('levelUp', { level: this.level });

      this.phase = Phase.SPAWNING;
      this.spawn();
      this.lastDropTime = now;
    }

    spawn() {
      this.currentPiece = this.nextPiece || this.createPiece(this.randomizer.next());
      this.nextPiece = this.createPiece(this.randomizer.next());

      const piece = this.currentPiece;
      if (!this.board.isValid(piece.shape, piece.x, piece.y)) {
        this.gameRunning = false;
        this.phase = Phase.GAME_OVER;
        this._emit('gameOver', { score: this.score, level: this.level, lines: this.lines });
        return;
      }
      this.phase = Phase.FALLING;
      this._emit('spawn', { type: piece.type });
    }

    createPiece(type) {
      // Non-zero entries become block ids 1..4 so each block keeps its identity (and look) through rotations.
      let k = 0;
      const shape = SHAPES[type].map((row) => row.map((v) => (v ? ++k : 0)));
      const x = Math.floor((COLS - shape[0].length) / 2);
      return { type, shape, x, y: -2, rotation: 0, pid: ++this._pid };
    }

    // ---- input actions

    moveLeft(now) { return this._move(-1, now); }
    moveRight(now) { return this._move(1, now); }

    _move(dx, now) {
      if (this.phase !== Phase.FALLING) return false;
      const piece = this.currentPiece;
      if (!piece) return false;
      if (!this.board.isValid(piece.shape, piece.x, piece.y, dx, 0)) return false;
      piece.x += dx;
      this._resetLockDelay(now);
      this._emit('move', { dx, auto: false });
      return true;
    }

    startDAS(direction, now) {
      this.dasDirection = direction;
      this.dasStartTime = now;
      this.dasActive = true;
      this.lastArrTime = now + DAS_DELAY_MS;
    }

    stopDAS() {
      this.dasActive = false;
      this.dasDirection = 0;
    }

    tryRotate(now) {
      if (this.phase !== Phase.FALLING) return false;
      const piece = this.currentPiece;
      if (!piece) return false;
      const rotated = rotateCW(piece.shape);
      for (const kick of SIMPLE_KICKS) {
        if (this.board.isValid(rotated, piece.x, piece.y, kick[0], kick[1])) {
          piece.shape = rotated;
          piece.x += kick[0];
          piece.y += kick[1];
          piece.rotation = (piece.rotation + 1) % 4;
          this._resetLockDelay(now);
          this._emit('rotate', { type: piece.type });
          return true;
        }
      }
      return false;
    }

    softDrop(now) {
      if (this.phase !== Phase.FALLING) return false;
      const piece = this.currentPiece;
      if (!piece) return false;
      if (!this.board.isValid(piece.shape, piece.x, piece.y, 0, 1)) return false;
      piece.y += 1;
      this.score += 1;
      this.lastDropTime = now;
      this._emit('softDrop');
      return true;
    }

    hardDrop(now) {
      if (this.phase !== Phase.FALLING) return false;
      const piece = this.currentPiece;
      if (!piece) return false;
      if (now - this.lastHardDropTime < HARD_DROP_DEBOUNCE_MS) return false;
      this.lastHardDropTime = now;

      const fromY = piece.y;
      let dropCount = 0;
      while (this.board.isValid(piece.shape, piece.x, piece.y, 0, 1)) {
        piece.y += 1;
        dropCount++;
      }
      this.score += dropCount * 2;
      this._emit('hardDrop', { type: piece.type, x: piece.x, fromY, toY: piece.y, shape: piece.shape, distance: dropCount });
      this._performLock(now);
      return true;
    }

    _resetLockDelay(now) {
      if (this.lockDelayActive && this.lockDelayMoveResets < MAX_LOCK_RESETS) {
        this.lockDelayStartTime = now;
        this.lockDelayMoveResets++;
      }
    }

    canAcceptInput() {
      return this.currentPiece !== null && this.gameRunning && !this.paused && this.phase === Phase.FALLING;
    }

    getGhostY() {
      const piece = this.currentPiece;
      if (!piece) return 0;
      return this.board.getGhostY(piece);
    }
  }

  KF.Logic = {
    COLS, ROWS, SPAWN_ROWS, TYPES, SHAPES, POINTS, SPEEDS, SIMPLE_KICKS,
    HARD_DROP_DEBOUNCE_MS, LOCK_DELAY_MS, DAS_DELAY_MS, ARR_DELAY_MS, MAX_LOCK_RESETS, CLEAR_DELAY_MS,
    Phase, rotateCW, rotateCCW, cellSeed, Board, Randomizer, GameState,
  };
})(globalThis.KF = globalThis.KF || {});
