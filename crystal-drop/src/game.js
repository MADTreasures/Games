// Crystal Drop – app shell: layout, rendering, input, HUD, menu, title screen.
// Rules live in logic.js (KF.Logic), the crystal look + shatter effect in crystal.js (KF.Crystal),
// the animated cave backdrop in cave.js (KF.Cave), sound in audio.js (KF.Audio).
(function (KF) {
  'use strict';

  const L = KF.Logic;
  const C = KF.Crystal;
  const A = KF.Audio || { unlock() {}, play() {}, setMuted() {}, suspend() {}, resume() {} };
  const { COLS, ROWS, SPAWN_ROWS, Phase } = L;

  const ENTRY_ROWS = 2;                  // rows above the field where the incoming piece is already visible
  const STORE_KEY = 'kristallfall.v1';   // unchanged so existing records survive the rename
  const TITLE_LINES = ['CRYSTAL', 'DROP'];
  const FONT = "'Fredoka', ui-rounded, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";
  const SOFT_REPEAT_FIRST_MS = 150;
  const SOFT_REPEAT_MS = 45;
  const CLEAR_WORDS = { 2: 'DOPPELT!', 3: 'DREIFACH!', 4: 'KRISTALLBRUCH!' };

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ settings

  const settings = { best: 0, sound: true, ghost: true, vibrate: true };

  function loadSettings() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return;
      if (Number.isFinite(o.best)) settings.best = Math.max(0, Math.floor(o.best));
      for (const k of ['sound', 'ghost', 'vibrate']) if (typeof o[k] === 'boolean') settings[k] = o[k];
    } catch (e) { /* storage unavailable: play without persistence */ }
  }

  function saveSettings() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ state

  const game = new L.GameState();
  const fx = C.createFx();

  let gameTime = 0;      // advances only while a game is running and not paused; all rule timing uses it
  let animTime = 0;      // advances whenever effects may animate (frozen during pause)
  let lastTs = 0;

  // W/H: window size (all canvases cover it); colX/colW: the game column; board*: the playfield, in window coordinates
  const view = { W: 0, H: 0, dpr: 1, dprCap: 3, caveRatio: 1, colX: 0, colW: 0, cell: 20, boardX: 0, boardY: 0, boardW: 0, boardH: 0 };
  let els = null;
  let bgCtx = null;
  let fgCtx = null;
  let caveCtx = null;
  let cave = null;              // KF.Cave instance (animated backdrop), null if unavailable
  let caveLevel = 1;
  let caveAcc = 0;
  let caveKick = 0;
  let caveDirty = true;
  let reduceMotion = false;

  let boardCells = [];
  let boardDirty = true;
  let needRender = true;
  let lastIdleRender = 0;

  let collapse = null;          // { t0, dur, shift[] } rows settling after a clear
  let pendingShatter = null;    // pixel cells captured when the rows start cracking
  let suppressLockSound = false;
  let overAt = 0;
  const shake = { amp: 0 };
  const bump = { amp: 0 };
  const popups = [];
  const trails = [];
  const vis = { pid: 0, x: 0, y: 0, ox: 0, oy: 0 };   // eased offset of the falling piece (in cells)

  const input = { keyLeft: false, keyRight: false, keyDir: 0, pointerDir: 0, pointers: [], softKey: false, softBtn: false, softNext: 0 };
  const perf = { sum: 0, n: 0 };
  let modal = null;             // null | 'menu' | 'help'
  let newGameArmed = false;
  let uiKey = '';
  let nextKey = '';

  // ------------------------------------------------------------------ helpers

  function play(name, opts) { if (settings.sound) A.play(name, opts); }

  function buzz(pattern) {
    if (!settings.vibrate || typeof navigator === 'undefined' || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* not allowed here */ }
  }

  function requestRender() { needRender = true; }

  // Keep the record as soon as a game is left (game over, pause, new game, page closed).
  function commitBest() {
    if (game.score > settings.best) { settings.best = game.score; saveSettings(); }
  }

  function inProgress() { return game.gameRunning; }

  // ------------------------------------------------------------------ layout

  function isTitle() { return game.phase === Phase.IDLE; }

  function sizeCanvas(cv, w, h) {
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
  }

  // All three canvases cover the whole window; the game column (#kf-app) sits centred on top of them.
  function layout() {
    const app = els.app;
    const body = document.body.getBoundingClientRect();
    if (body.width < 60 || body.height < 120) return;
    // Phones (tall, narrow windows) use the full width; wide windows get a narrow column that hugs the field.
    const colW = body.width / body.height <= 0.6 ? body.width : Math.min(body.width, Math.round(body.height * 0.44));
    app.style.width = colW + 'px';
    app.style.setProperty('--u', (colW / 100).toFixed(3) + 'px');
    const rect = app.getBoundingClientRect();

    const vw = Math.max(colW, els.cave.clientWidth || window.innerWidth || colW);
    const vh = Math.max(rect.height, els.cave.clientHeight || window.innerHeight || rect.height);
    const topB = els.top.getBoundingClientRect().bottom;
    const botT = els.bottom.getBoundingClientRect().top;
    const pad = 4;
    const availH = Math.max(40, botT - topB - pad * 2);
    const cell = Math.max(6, Math.floor(Math.min(availH / (ROWS + ENTRY_ROWS), (colW * 0.9) / COLS)));
    const dpr = Math.min(window.devicePixelRatio || 1, view.dprCap);

    view.W = vw; view.H = vh; view.dpr = dpr; view.cell = cell;
    view.colX = rect.left; view.colW = colW;
    view.boardW = cell * COLS;
    view.boardH = cell * ROWS;
    view.boardX = Math.round(rect.left + (colW - view.boardW) / 2);
    view.boardY = Math.round(topB + pad + (availH - (ROWS + ENTRY_ROWS) * cell) / 2 + ENTRY_ROWS * cell);
    view.caveRatio = Math.min(window.devicePixelRatio || 1, view.dprCap, 2);   // the backdrop needs less detail

    sizeCanvas(els.bg, Math.round(vw * dpr), Math.round(vh * dpr));
    sizeCanvas(els.fg, Math.round(vw * dpr), Math.round(vh * dpr));
    app.style.setProperty('--board-w', view.boardW + 'px');
    app.style.setProperty('--card-y', (view.boardY + view.boardH * 0.4 - topB).toFixed(1) + 'px');
    app.style.setProperty('--toast-y', (view.boardY + view.boardH * 0.2 - topB).toFixed(1) + 'px');

    C.invalidate();
    caveResize();
    drawFrame();
    drawLogo();
    boardDirty = true;
    nextKey = '';
    requestRender();
  }

  // ------------------------------------------------------------------ cave backdrop (KF.Cave), level themes

  function paintFallbackCave() {
    const g = caveCtx, r = view.caveRatio || 1;
    g.setTransform(r, 0, 0, r, 0, 0);
    const sky = g.createLinearGradient(0, 0, 0, view.H);
    sky.addColorStop(0, '#12295a');
    sky.addColorStop(0.55, '#0a1630');
    sky.addColorStop(1, '#050a18');
    g.fillStyle = sky;
    g.fillRect(0, 0, view.W, view.H);
  }

  // The backdrop must never take the game down with it.
  function caveCall(fn) {
    if (!cave) return;
    try { fn(cave); } catch (e) { cave = null; paintFallbackCave(); }
  }

  function caveFocus(c) {
    if (isTitle() || !c.setFocus) return;
    const { cell, boardX, boardY, boardW, boardH } = view;
    c.setFocus(boardX, boardY - ENTRY_ROWS * cell, boardW, boardH + ENTRY_ROWS * cell);
  }

  function caveResize() {
    const r = view.caveRatio;
    sizeCanvas(els.cave, Math.round(view.W * r), Math.round(view.H * r));
    if (!cave) { paintFallbackCave(); return; }
    caveCall((c) => { c.resize(view.W, view.H, r); caveFocus(c); c.setLevel(caveLevel, true); });
    caveDirty = true;
  }

  function setCaveLevel(level, immediate) {
    caveLevel = level;
    caveKick = 2600;            // keep animating through the crossfade even with reduced motion
    caveDirty = true;
    caveCall((c) => { caveFocus(c); c.setLevel(level, !!immediate); });
  }

  function tickCave(dt) {
    if (!cave) return;
    caveAcc += dt;
    if (caveAcc < 32 && !caveDirty) return;                     // ~30 fps is plenty for a slow backdrop
    const step = Math.min(caveAcc, 120);
    caveAcc = 0;
    const animate = !reduceMotion || caveKick > 0;
    if (!animate && !caveDirty) return;
    caveKick = Math.max(0, caveKick - step);
    caveDirty = false;
    caveCall((c) => {
      if (animate) c.update(step);
      const r = view.caveRatio;
      caveCtx.setTransform(r, 0, 0, r, 0, 0);
      c.draw(caveCtx);
    });
  }

  // ------------------------------------------------------------------ static playfield frame

  function drawFrame() {
    const g = bgCtx;
    const { W, H, dpr, cell, boardX, boardY, boardW, boardH } = view;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const f = Math.max(4, Math.round(cell * 0.24));       // rail thickness
    const o = 2.5;                                        // ink outline
    const ey = boardY - ENTRY_ROWS * cell;
    const xl = boardX - f, xr = boardX + boardW, yb = boardY + boardH;

    // chunky 3D rails: left, right, bottom (lit from the top-left)
    g.fillStyle = '#06102a';
    g.fillRect(xl - o, ey, f + o * 2, yb + f + o - ey);
    g.fillRect(xr - o, ey, f + o * 2, yb + f + o - ey);
    g.fillRect(xl - o, yb - o, boardW + f * 2 + o * 2, f + o * 2);
    const rail = (x) => {
      g.fillStyle = '#4f9df0'; g.fillRect(x, ey, f, yb + f - ey);
      g.fillStyle = '#c4e9ff'; g.fillRect(x, ey, f * 0.32, yb + f - ey);
      g.fillStyle = '#2459b4'; g.fillRect(x + f * 0.72, ey, f * 0.28, yb + f - ey);
    };
    rail(xl); rail(xr);
    g.fillStyle = '#4f9df0'; g.fillRect(xl, yb, boardW + f * 2, f);
    g.fillStyle = '#c4e9ff'; g.fillRect(xl + f * 0.32, yb, boardW + f * 2 - f * 0.6, f * 0.3);
    g.fillStyle = '#2459b4'; g.fillRect(xl, yb + f * 0.7, boardW + f * 2, f * 0.3);
    // corner studs
    for (const cx of [xl + f / 2, xr + f / 2]) {
      g.fillStyle = '#06102a'; g.beginPath(); g.arc(cx, yb + f / 2, f * 0.95, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffd23e'; g.beginPath(); g.arc(cx, yb + f / 2, f * 0.62, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff6ae'; g.beginPath(); g.arc(cx - f * 0.18, yb + f / 2 - f * 0.2, f * 0.22, 0, Math.PI * 2); g.fill();
    }
    // the rails fade out upwards through the entry shaft
    g.globalCompositeOperation = 'destination-out';
    const fade = g.createLinearGradient(0, ey, 0, boardY);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(xl - o - 1, ey - 1, boardW + f * 2 + o * 2 + 2, boardY - ey + 1);
    g.globalCompositeOperation = 'source-over';

    // entry shaft and field: dark glass, the cave stays faintly visible behind it
    const shaft = g.createLinearGradient(0, ey, 0, boardY);
    shaft.addColorStop(0, 'rgba(4,9,24,0)');
    shaft.addColorStop(1, 'rgba(4,9,24,0.66)');
    g.fillStyle = shaft;
    g.fillRect(boardX, ey, boardW, ENTRY_ROWS * cell);
    const field = g.createLinearGradient(0, boardY, 0, yb);
    field.addColorStop(0, 'rgba(6,13,32,0.78)');
    field.addColorStop(1, 'rgba(4,9,24,0.86)');
    g.fillStyle = field;
    g.fillRect(boardX, boardY, boardW, boardH);

    g.strokeStyle = 'rgba(150,200,255,0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let c = 1; c < COLS; c++) { g.moveTo(boardX + c * cell + 0.5, boardY); g.lineTo(boardX + c * cell + 0.5, yb); }
    for (let r = 1; r < ROWS; r++) { g.moveTo(boardX, boardY + r * cell + 0.5); g.lineTo(boardX + boardW, boardY + r * cell + 0.5); }
    g.stroke();
    g.strokeStyle = 'rgba(160,210,255,0.3)';
    g.setLineDash([cell * 0.35, cell * 0.3]);
    g.beginPath(); g.moveTo(boardX, boardY + 0.5); g.lineTo(boardX + boardW, boardY + 0.5); g.stroke();
    g.setLineDash([]);
    // inner shade so the field reads as recessed
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(boardX, boardY, Math.max(2, cell * 0.09), boardH);
    g.fillRect(boardX, yb - Math.max(2, cell * 0.09), boardW, Math.max(2, cell * 0.09));

    // small chevrons mark the tap zones beside the field (only where the column leaves room for them)
    const zone = xl - o - view.colX;
    if (zone >= 12) {
      const s = Math.min(zone * 0.3, cell * 0.36);
      const cy = boardY + boardH * 0.5;
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const side of [-1, 1]) {
        const cx = side < 0 ? view.colX + zone / 2 : view.colX + view.colW - zone / 2;
        for (const dy of [-cell * 3, 0, cell * 3]) {
          for (const pass of [0, 1]) {
            g.lineWidth = pass ? Math.max(1.5, s * 0.4) : Math.max(3.5, s * 0.4 + 3);
            g.strokeStyle = pass ? 'rgba(220,240,255,0.55)' : 'rgba(6,16,42,0.55)';
            g.beginPath();
            g.moveTo(cx - side * s * 0.5, cy + dy - s);
            g.lineTo(cx + side * s * 0.5, cy + dy);
            g.lineTo(cx - side * s * 0.5, cy + dy + s);
            g.stroke();
          }
        }
      }
      g.lineCap = 'butt'; g.lineJoin = 'miter';
    }
  }

  // ------------------------------------------------------------------ title logo (drawn, not typed)

  const LOGO_INK = '#06102a';
  const LOGO_STYLES = [
    { hi: '#ffffff', mid: '#bfe8ff', lo: '#63b4f4', side: '#2a67bd' },     // ice
    { hi: '#fff8c4', mid: '#ffd23e', lo: '#ff9a14', side: '#b05a00' },     // citrine
  ];

  function drawLogo() {
    const cv = els.logo;
    if (!cv) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const wCss = Math.max(120, Math.min(view.colW - 32, 460));
    const font = (px) => '600 ' + px.toFixed(1) + 'px ' + FONT;
    const probe = cv.getContext('2d');
    const track = 0.03;                                    // letter spacing as a fraction of the size
    const widthAt = (text, px) => {
      probe.font = font(px);
      let w = 0;
      for (const ch of text) w += probe.measureText(ch).width + px * track;
      return w - px * track;
    };
    // line sizes: each line is fitted to the available width, the second one is the bigger word
    const fit = (text, share, cap) => Math.min(cap, 100 * (wCss * share) / widthAt(text, 100));
    const sizes = [fit(TITLE_LINES[0], 0.92, wCss * 0.26), fit(TITLE_LINES[1], 0.8, wCss * 0.36)];
    const padY = sizes[1] * 0.2;
    const hCss = sizes[0] * 0.98 + sizes[1] * 1.02 + padY * 2;
    cv.style.width = wCss + 'px';
    cv.style.height = hCss + 'px';
    cv.width = Math.round(wCss * ratio);
    cv.height = Math.round(hCss * ratio);
    const g = cv.getContext('2d');
    const face = document.createElement('canvas');
    face.width = cv.width; face.height = cv.height;
    const fg = face.getContext('2d');
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    fg.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, wCss, hCss);

    const rnd = mulberry32(77031);
    let baseline = padY + sizes[0] * 0.78;
    TITLE_LINES.forEach((text, li) => {
      const px = sizes[li], st = LOGO_STYLES[li % LOGO_STYLES.length];
      const depth = px * 0.1;
      // letter placement: slight alternating tilt and bounce
      const letters = [];
      let x = (wCss - widthAt(text, px)) / 2;
      probe.font = font(px);
      let i = 0;
      for (const ch of text) {
        const w = probe.measureText(ch).width;
        letters.push({ ch, x: x + w / 2, y: baseline + Math.sin(i * 1.9 + li) * px * 0.035, rot: (i % 2 ? 1 : -1) * (0.025 + rnd() * 0.03) });
        x += w + px * track;
        i++;
      }
      const each = (ctx, fn) => { for (const l of letters) { ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot); fn(l); ctx.restore(); } };

      // 1) ink body including the extruded side
      g.font = font(px); g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      g.strokeStyle = LOGO_INK; g.lineWidth = px * 0.15;
      each(g, (l) => { for (let d = depth; d >= 0; d -= 1.5) g.strokeText(l.ch, 0, d); g.strokeText(l.ch, 0, 0); });
      g.fillStyle = st.side;
      each(g, (l) => { for (let d = depth; d >= 1; d -= 1) g.fillText(l.ch, 0, d); });

      // 2) crystal face on a scratch layer: letters as a mask, then tones, facets and gloss inside them
      fg.globalCompositeOperation = 'source-over';
      fg.clearRect(0, 0, wCss, hCss);
      fg.font = font(px); fg.textAlign = 'center'; fg.textBaseline = 'alphabetic';
      fg.fillStyle = '#ffffff';
      each(fg, (l) => { fg.fillText(l.ch, 0, 0); });
      fg.globalCompositeOperation = 'source-atop';
      const top = baseline - px * 0.78, bottom = baseline + px * 0.06;
      const grd = fg.createLinearGradient(0, top, 0, bottom);
      grd.addColorStop(0, st.hi); grd.addColorStop(0.45, st.mid); grd.addColorStop(1, st.lo);
      fg.fillStyle = grd;
      fg.fillRect(0, top - px * 0.2, wCss, px * 1.4);
      // hard-edged facet planes running diagonally through the word
      const span = wCss + px;
      for (let k = 0; k < 9; k++) {
        const fx0 = -px * 0.5 + rnd() * span, fw = px * (0.12 + rnd() * 0.3);
        fg.fillStyle = k % 3 === 2 ? 'rgba(0,30,90,0.10)' : 'rgba(255,255,255,' + (0.28 + rnd() * 0.3).toFixed(2) + ')';
        fg.beginPath();
        fg.moveTo(fx0, bottom + px * 0.1); fg.lineTo(fx0 + fw, bottom + px * 0.1);
        fg.lineTo(fx0 + fw + px * 0.55, top - px * 0.1); fg.lineTo(fx0 + px * 0.55, top - px * 0.1);
        fg.closePath(); fg.fill();
      }
      // darker foot and a glossy cap
      fg.fillStyle = 'rgba(0,25,80,0.16)';
      fg.fillRect(0, baseline - px * 0.2, wCss, px * 0.4);
      fg.fillStyle = 'rgba(255,255,255,0.55)';
      fg.beginPath(); fg.ellipse(wCss / 2, top - px * 0.02, wCss * 0.62, px * 0.3, 0, 0, Math.PI * 2); fg.fill();
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(face, 0, 0); g.restore();

      // 3) sparkles
      const stars = li === 0 ? [[0.06, -0.72, 0.16], [0.93, -0.16, 0.1]] : [[0.9, -0.74, 0.19], [0.1, -0.1, 0.11]];
      const x0 = (wCss - widthAt(text, px)) / 2, ww = widthAt(text, px);
      for (const [ux, uy, ur] of stars) {
        const sx = x0 + ww * ux, sy = baseline + px * uy, R = px * ur, r = R * 0.22;
        const path = () => { g.beginPath(); g.moveTo(sx, sy - R); g.lineTo(sx + r, sy - r); g.lineTo(sx + R, sy); g.lineTo(sx + r, sy + r); g.lineTo(sx, sy + R); g.lineTo(sx - r, sy + r); g.lineTo(sx - R, sy); g.lineTo(sx - r, sy - r); g.closePath(); };
        path(); g.lineWidth = px * 0.07; g.strokeStyle = LOGO_INK; g.stroke();
        g.fillStyle = '#ffffff'; g.fill();
      }
      baseline += sizes[0] * 0.2 + sizes[1] * 0.86;
    });
  }

  // ------------------------------------------------------------------ cell lists for the crystal renderer

  function connOfGrid(grid, r, c) {
    const me = grid[r][c];
    let m = 0;
    if (r > 0 && grid[r - 1][c] && grid[r - 1][c].pid === me.pid) m |= 1;
    if (c < COLS - 1 && grid[r][c + 1] && grid[r][c + 1].pid === me.pid) m |= 2;
    if (r < grid.length - 1 && grid[r + 1][c] && grid[r + 1][c].pid === me.pid) m |= 4;
    if (c > 0 && grid[r][c - 1] && grid[r][c - 1].pid === me.pid) m |= 8;
    return m;
  }

  function rebuildBoardCells() {
    const grid = game.board.grid;
    const { cell, boardX, boardY } = view;
    const out = [];
    for (let r = SPAWN_ROWS - ENTRY_ROWS; r < grid.length; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = grid[r][c];
        if (!k) continue;
        const y = boardY + (r - SPAWN_ROWS) * cell;
        out.push({ x: boardX + c * cell, y, baseY: y, size: cell, type: k.type, seed: k.seed, conn: connOfGrid(grid, r, c), crack: 0, row: r });
      }
    }
    boardCells = out;
    boardDirty = false;
  }

  // Cells of a free piece. px/py are in field cells and may be fractional (eased movement).
  function shapeCells(piece, px, py, ox, oy, size, minRow) {
    const sh = piece.shape;
    const out = [];
    for (let r = 0; r < sh.length; r++) {
      for (let c = 0; c < sh[r].length; c++) {
        const k = sh[r][c];
        if (!k) continue;
        if (py + r < minRow) continue;
        let m = 0;
        if (r > 0 && sh[r - 1][c]) m |= 1;
        if (c < sh[r].length - 1 && sh[r][c + 1]) m |= 2;
        if (r < sh.length - 1 && sh[r + 1][c]) m |= 4;
        if (c > 0 && sh[r][c - 1]) m |= 8;
        out.push({ x: ox + (px + c) * size, y: oy + (py + r) * size, size, type: piece.type, seed: L.cellSeed(piece.pid, k), conn: m, crack: 0 });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ rule events -> sound / effects

  function cellPx(c, conn) {
    const { cell, boardX, boardY } = view;
    return { x: boardX + c.col * cell, y: boardY + c.row * cell, size: cell, type: c.type, seed: c.seed, conn, crack: 0 };
  }

  function onHardDrop(p) {
    suppressLockSound = true;
    play('hardDrop');
    buzz(12);
    if (!reduceMotion) bump.amp = Math.min(5, 1.5 + p.distance * 0.22);
    if (p.distance <= 0) return;
    const { cell, boardX, boardY } = view;
    const sh = p.shape;
    for (let c = 0; c < sh[0].length; c++) {
      let top = -1;
      for (let r = 0; r < sh.length; r++) if (sh[r][c]) { top = r; break; }
      if (top < 0) continue;
      const y0 = Math.max(boardY - ENTRY_ROWS * cell, boardY + (p.fromY + top) * cell);
      const y1 = boardY + (p.toY + top) * cell;
      if (y1 > y0) trails.push({ x: boardX + (p.x + c) * cell, y0, y1, w: cell, t0: animTime });
    }
  }

  function onLock(p) {
    boardDirty = true;
    if (!suppressLockSound) play('lock');
    suppressLockSound = false;
    if (fx.sparkle) fx.sparkle(p.cells.filter((c) => c.row >= -ENTRY_ROWS).map((c) => cellPx(c, 0)));
  }

  function onClearStart(p) {
    const grid = game.board.grid;
    pendingShatter = p.cells.map((c) => cellPx(c, connOfGrid(grid, c.row + SPAWN_ROWS, c.col)));
    play('crack', { rows: p.count });
    boardDirty = true;
  }

  function onClearEnd(p) {
    const cells = pendingShatter || p.cells.map((c) => cellPx(c, 0));
    pendingShatter = null;
    fx.shatter(cells, { rows: p.count });
    play('shatter', { rows: p.count });
    buzz(p.count >= 4 ? [0, 30, 40, 60] : 14 + p.count * 8);
    if (!reduceMotion) shake.amp = [0, 2.2, 3.4, 4.8, 8][p.count] || 3;

    // rows above settle into place
    const total = ROWS + SPAWN_ROWS;
    const cleared = new Set(p.rows.map((r) => r + SPAWN_ROWS));
    const shift = new Array(total).fill(0);
    let below = 0, ni = total - 1;
    for (let old = total - 1; old >= 0; old--) {
      if (cleared.has(old)) { below++; continue; }
      shift[ni--] = below;
    }
    collapse = { t0: animTime, dur: 110 + 28 * p.count, shift };
    boardDirty = true;

    const { cell, boardX, boardY, boardW } = view;
    const y = boardY + (Math.min.apply(null, p.rows) + 0.5) * cell;
    const big = p.count >= 4;
    if (CLEAR_WORDS[p.count]) {
      popups.push({ text: CLEAR_WORDS[p.count], x: boardX + boardW / 2, y: y - cell * 1.1, t0: animTime, dur: big ? 1500 : 1100, size: cell * (big ? 0.95 : 0.82), color: big ? '#ffd257' : '#e0f4ff' });
    }
    popups.push({ text: '+' + p.gained, x: boardX + boardW / 2, y, t0: animTime, dur: 1000, size: cell * 0.9, color: '#ffd257' });
  }

  function onLevelUp(p) {
    toast('LEVEL ' + p.level);
    // The new cave is baked in one frame: do that after the burst of the clear, not during it.
    window.setTimeout(() => { if (game.gameRunning && game.level === p.level) setCaveLevel(p.level, false); }, 650);
    window.setTimeout(() => play('levelUp'), 380);
  }

  function onGameOver(p) {
    commitBest();
    overAt = animTime;
    clearHeld();
    play('gameOver');
    buzz([40, 60, 120]);
  }

  game.onEvent = function (name, p) {
    switch (name) {
      case 'start':
        fx.reset(); popups.length = 0; trails.length = 0; collapse = null; pendingShatter = null;
        shake.amp = 0; bump.amp = 0; boardDirty = true; suppressLockSound = false;
        setCaveLevel(1, false);
        play('start');
        break;
      case 'move': play('move'); break;
      case 'rotate': play('rotate'); break;
      case 'softDrop': play('softDrop'); break;
      case 'hardDrop': onHardDrop(p); break;
      case 'lock': onLock(p); break;
      case 'clearStart': onClearStart(p); break;
      case 'clearEnd': onClearEnd(p); break;
      case 'levelUp': onLevelUp(p); break;
      case 'gameOver': onGameOver(p); break;
      case 'pause': play(p.paused ? 'pause' : 'resume'); break;
      default: break;
    }
    requestRender();
  };

  // ------------------------------------------------------------------ rendering

  function render() {
    const g = fgCtx;
    const { W, H, dpr, cell, boardX, boardY, boardW, boardH } = view;
    const t = animTime;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (isTitle()) return;                     // title screen: only the cave and the logo

    let sx = 0, sy = 0;
    if (shake.amp > 0.05) { sx = Math.sin(t * 0.093) * shake.amp; sy = Math.cos(t * 0.127) * shake.amp * 0.7; }
    if (bump.amp > 0.05) sy += bump.amp;
    g.save();
    g.translate(sx, sy);

    {
      if (boardDirty) rebuildBoardCells();

      const clearing = game.clearing;
      if (clearing) {
        const k = clamp((gameTime - clearing.startTime) / Math.max(1, game.clearDelayMs), 0, 1);
        for (const c of boardCells) c.crack = clearing.rows.indexOf(c.row) >= 0 ? k : 0;
      }
      if (collapse) {
        const k = (t - collapse.t0) / collapse.dur;
        if (k >= 1) {
          collapse = null;
          for (const c of boardCells) c.y = c.baseY;
        } else {
          const e = 1 - k * k;
          for (const c of boardCells) c.y = c.baseY - collapse.shift[c.row] * cell * e;
        }
      }
      C.drawCells(g, boardCells, { t, dpr });

      const piece = game.currentPiece;
      if (piece && game.gameRunning) {
        const px = piece.x + vis.ox;
        if (settings.ghost && game.phase === Phase.FALLING) {
          const gy = game.getGhostY();
          if (gy !== piece.y) C.drawCells(g, shapeCells(piece, px, gy, boardX, boardY, cell, -ENTRY_ROWS), { t, dpr, ghost: true });
        }
        C.drawCells(g, shapeCells(piece, px, piece.y + vis.oy, boardX, boardY, cell, -ENTRY_ROWS - 1), { t, dpr });
      }
    }

    for (const tr of trails) {
      const k = (t - tr.t0) / 180;
      if (k >= 1) continue;
      const grd = g.createLinearGradient(0, tr.y0, 0, tr.y1);
      grd.addColorStop(0, 'rgba(224,244,255,0)');
      grd.addColorStop(1, 'rgba(224,244,255,' + (0.4 * (1 - k)).toFixed(3) + ')');
      g.fillStyle = grd;
      g.fillRect(tr.x + tr.w * 0.14, tr.y0, tr.w * 0.72, tr.y1 - tr.y0);
    }

    // veil over the field when no piece is in play
    let veil = 0;
    if (game.phase === Phase.GAME_OVER) veil = 0.55 * clamp((t - overAt) / 500, 0, 1);
    else if (game.paused) veil = 0.92;
    if (veil > 0) {
      g.fillStyle = 'rgba(5,12,26,' + veil.toFixed(3) + ')';
      g.fillRect(boardX, boardY - ENTRY_ROWS * cell, boardW, boardH + ENTRY_ROWS * cell);
    }
    g.restore();

    if (!game.paused) fx.draw(g, { dpr });

    if (popups.length && !game.paused) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      for (const p of popups) {
        const k = (t - p.t0) / p.dur;
        if (k < 0 || k >= 1) continue;
        const rise = 1 - (1 - k) * (1 - k);
        const s = p.size * (k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : Math.max(1, 1.1 - (k - 0.12) * 0.8));
        g.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        g.font = '600 ' + s.toFixed(1) + 'px ' + FONT;
        g.lineWidth = s * 0.3;
        g.strokeStyle = '#050d1c';
        g.strokeText(p.text, p.x, p.y - cell * 1.2 * rise);
        g.fillStyle = p.color;
        g.fillText(p.text, p.x, p.y - cell * 1.2 * rise);
      }
      g.globalAlpha = 1;
    }
  }

  function drawNext() {
    const piece = game.nextPiece && game.phase !== Phase.IDLE ? game.nextPiece : null;
    const pc = clamp(Math.round(view.colW * 0.026), 7, 13);
    const key = (piece ? piece.pid + piece.type : '-') + ':' + pc + ':' + view.dpr;
    if (key === nextKey) return;
    nextKey = key;
    const cv = els.next;
    const cw = pc * 4.3, ch = pc * 2.2;
    cv.style.width = cw + 'px';
    cv.style.height = ch + 'px';
    cv.width = Math.round(cw * view.dpr);
    cv.height = Math.round(ch * view.dpr);
    const g = cv.getContext('2d');
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    if (!piece) return;
    const sh = piece.shape;
    let minR = 9, maxR = -1, minC = 9, maxC = -1;
    for (let r = 0; r < sh.length; r++) for (let c = 0; c < sh[r].length; c++) if (sh[r][c]) {
      if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c;
    }
    const ox = (cw - (maxC - minC + 1) * pc) / 2 - minC * pc;
    const oy = (ch - (maxR - minR + 1) * pc) / 2 - minR * pc;
    C.drawCells(g, shapeCells(piece, 0, 0, ox, oy, pc, -99), { t: 1000, dpr: view.dpr });
  }

  // ------------------------------------------------------------------ HUD / cards / menu

  function toast(text) {
    const el = els.toast;
    el.textContent = text;
    el.classList.remove('is-on');
    void el.offsetWidth;          // restart the animation
    el.classList.add('is-on');
  }

  function setBest(el, always) {
    el.querySelector('b').textContent = String(settings.best);
    el.hidden = !always && settings.best <= 0;
  }

  function syncUi() {
    const st = game.phase === Phase.GAME_OVER ? 'over' : !game.gameRunning ? 'idle' : game.paused ? 'paused' : 'run';
    const showOver = st === 'over' && animTime - overAt > 650;
    const key = [st, modal || '', showOver ? 1 : 0, game.level, game.score, settings.best].join('|');
    drawNext();
    if (key === uiKey) return;
    uiKey = key;

    els.level.textContent = String(game.level);
    els.score.textContent = String(game.score);
    els.main.textContent = st === 'run' ? 'PAUSE' : st === 'paused' ? 'WEITER' : 'START';

    els.app.classList.toggle('is-title', st === 'idle');
    els.title.hidden = !(st === 'idle' && !modal);
    els.bg.hidden = st === 'idle';
    els.cardPause.hidden = !(st === 'paused' && !modal);
    els.cardOver.hidden = !(showOver && !modal);
    if (showOver) els.finalScore.textContent = String(game.score);
    setBest(els.bestStart, false);
    setBest(els.bestOver, true);
    setBest(els.bestMenu, true);

    els.menu.hidden = modal !== 'menu';
    els.help.hidden = modal !== 'help';
    els.menuResume.hidden = st !== 'paused';
    requestRender();
  }

  function syncSwitches() {
    els.optSound.setAttribute('aria-checked', String(settings.sound));
    els.optGhost.setAttribute('aria-checked', String(settings.ghost));
    els.optVibrate.setAttribute('aria-checked', String(settings.vibrate));
    if (A.setMuted) A.setMuted(!settings.sound);
  }

  function clearHeld() {
    input.keyLeft = input.keyRight = false;
    input.keyDir = 0; input.pointerDir = 0; input.pointers.length = 0;
    input.softKey = input.softBtn = false;
    game.stopDAS();
  }

  function startNewGame() {
    commitBest();
    modal = null;
    newGameArmed = false;
    clearHeld();
    vis.pid = 0;
    game.startGame(gameTime);
  }

  function pauseGame() {
    if (game.gameRunning && !game.paused) game.togglePause(gameTime);
    commitBest();
    clearHeld();
  }

  function resumeGame() {
    modal = null;
    if (game.gameRunning && game.paused) game.togglePause(gameTime);
  }

  function mainButton() {
    if (!game.gameRunning) startNewGame();
    else if (game.paused) resumeGame();
    else pauseGame();
  }

  function openMenu() {
    pauseGame();
    newGameArmed = false;
    els.menuNew.textContent = 'NEUES SPIEL';
    modal = 'menu';
  }

  function menuNewGame() {
    // A running game is only thrown away after a second tap.
    if (inProgress() && !newGameArmed) {
      newGameArmed = true;
      els.menuNew.textContent = 'WIRKLICH NEU STARTEN?';
      return;
    }
    startNewGame();
  }

  // The game-over card appears where the thumbs were just tapping: ignore it for a moment.
  function playAgain() {
    if (animTime - overAt >= 1300) startNewGame();
  }

  // ------------------------------------------------------------------ input

  function setDir(dir) {
    // called when a direction is newly pressed
    if (!game.canAcceptInput()) return;
    if (dir < 0) game.moveLeft(gameTime); else game.moveRight(gameTime);
    game.startDAS(dir, gameTime);
  }

  function softPress() {
    if (game.canAcceptInput()) game.softDrop(gameTime);
    input.softNext = gameTime + SOFT_REPEAT_FIRST_MS;
  }

  // Right after a game over the drop key must not start the next game by accident.
  function canRestartByKey() {
    return game.phase !== Phase.GAME_OVER || animTime - overAt > 900;
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    A.unlock();
    if (modal) {
      if (e.key === 'Escape') { modal = modal === 'help' ? 'menu' : null; e.preventDefault(); }
      return;
    }
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        if (!e.repeat) { input.keyLeft = true; input.keyDir = -1; setDir(-1); }
        break;
      case 'ArrowRight':
        if (!e.repeat) { input.keyRight = true; input.keyDir = 1; setDir(1); }
        break;
      case 'ArrowDown':
        if (!e.repeat) { input.softKey = true; softPress(); }
        break;
      case 'ArrowUp': case 'x': case 'X':
        if (!e.repeat && game.canAcceptInput()) game.tryRotate(gameTime);
        break;
      case ' ': case 'Spacebar':
        if (!e.repeat) {
          if (!game.gameRunning) { if (canRestartByKey()) startNewGame(); }
          else if (game.canAcceptInput()) game.hardDrop(gameTime);
        }
        break;
      case 'Enter':
        if (e.target && e.target.tagName === 'BUTTON') { handled = false; break; }
        if (!e.repeat && !game.gameRunning) { if (canRestartByKey()) startNewGame(); } else handled = false;
        break;
      case 'p': case 'P':
        if (!e.repeat && game.gameRunning) { if (game.paused) resumeGame(); else pauseGame(); }
        break;
      case 'Escape':
        openMenu();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  function onKeyUp(e) {
    switch (e.key) {
      case 'ArrowLeft': input.keyLeft = false; break;
      case 'ArrowRight': input.keyRight = false; break;
      case 'ArrowDown': input.softKey = false; return;
      default: return;
    }
    const dir = input.keyRight ? 1 : input.keyLeft ? -1 : 0;
    if (dir === input.keyDir) return;
    input.keyDir = dir;
    if (input.pointerDir) return;
    if (dir === 0) game.stopDAS();
    else if (game.canAcceptInput()) game.startDAS(dir, gameTime);
  }

  function onFieldPointerDown(e) {
    const target = e.target;
    if (target !== els.mid && target !== els.cave && target !== document.body && target !== document.documentElement) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    A.unlock();
    if (!game.gameRunning || game.paused || modal) return;
    const x = e.clientX;
    const y = e.clientY;
    const { cell, boardX, boardY, boardW } = view;

    let dir = 0;
    if (x < boardX) dir = -1;
    else if (x > boardX + boardW) dir = 1;
    else {
      // inside the field: a tap near the piece rotates it, anywhere else moves towards that half
      if (!game.canAcceptInput()) return;
      const piece = game.currentPiece;
      const gx = Math.floor((x - boardX) / cell);
      const gy = Math.floor((y - boardY) / cell);
      let minX = 99, maxX = -99, minY = 99, maxY = -99;
      for (let r = 0; r < piece.shape.length; r++) for (let c = 0; c < piece.shape[r].length; c++) if (piece.shape[r][c]) {
        const bx = piece.x + c, by = piece.y + r;
        if (bx < minX) minX = bx; if (bx > maxX) maxX = bx; if (by < minY) minY = by; if (by > maxY) maxY = by;
      }
      const dx = gx - (minX + maxX + 1) / 2;
      const dy = gy - (minY + maxY + 1) / 2;
      const radius = Math.max(maxX - minX, maxY - minY) / 2 + 2.5;
      if (Math.sqrt(dx * dx + dy * dy) <= radius) { game.tryRotate(gameTime); return; }
      dir = gx < COLS / 2 ? -1 : 1;
    }
    // Remember the finger even if no piece can move right now (row cracking): the frame loop starts
    // the auto-shift as soon as the next piece accepts input.
    input.pointers.push({ id: e.pointerId, dir });
    input.pointerDir = dir;
    try { if (target.setPointerCapture) target.setPointerCapture(e.pointerId); } catch (err) { /* older WebView */ }
    setDir(dir);
  }

  function onFieldPointerUp(e) {
    const i = input.pointers.findIndex((p) => p.id === e.pointerId);
    if (i < 0) return;
    input.pointers.splice(i, 1);
    // a finger that is still down keeps (or takes back) its direction
    const n = input.pointers.length;
    const dir = n ? input.pointers[n - 1].dir : 0;
    if (dir === input.pointerDir) return;
    input.pointerDir = dir;
    const eff = dir || input.keyDir;
    if (eff !== 0 && game.canAcceptInput()) game.startDAS(eff, gameTime);
    else game.stopDAS();
  }

  // Immediate reaction on touch (pointerdown), keyboard activation via the synthetic click.
  function bindPress(el, down, up) {
    const release = () => { el.classList.remove('is-down'); if (up) up(); };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      A.unlock();
      el.classList.add('is-down');
      down();
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('click', (e) => { if (e.detail === 0) { A.unlock(); down(); if (up) up(); } });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function bindClick(el, fn) {
    el.addEventListener('click', () => { A.unlock(); play('uiTap'); fn(); uiKey = ''; });
  }

  function bindSwitch(el, key) {
    bindClick(el, () => { settings[key] = !settings[key]; saveSettings(); syncSwitches(); if (key === 'vibrate') buzz(20); });
  }

  // ------------------------------------------------------------------ main loop

  function frame(ts) {
    window.requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    let dt = ts - lastTs;
    lastTs = ts;
    if (!(dt >= 0)) dt = 0;
    const rawDt = dt;
    if (dt > 100) dt = 100;      // tab was in the background: do not fast-forward the game
    tickCave(dt);

    const running = game.gameRunning && !game.paused;
    if (running) {
      gameTime += dt;
      const dir = input.pointerDir || input.keyDir;
      if (dir !== 0 && (!game.dasActive || game.dasDirection !== dir) && game.canAcceptInput()) game.startDAS(dir, gameTime);
      if ((input.softKey || input.softBtn) && gameTime >= input.softNext && game.canAcceptInput()) {
        game.softDrop(gameTime);
        input.softNext = gameTime + SOFT_REPEAT_MS;
      }
      game.update(gameTime);
    }

    if (!game.paused) {
      animTime += dt;
      fx.update(dt);
      if (shake.amp > 0) shake.amp *= Math.exp(-dt / 90);
      if (bump.amp > 0) bump.amp *= Math.exp(-dt / 55);
      while (popups.length && animTime - popups[0].t0 >= popups[0].dur) popups.shift();
      while (trails.length && animTime - trails[0].t0 >= 180) trails.shift();
    }

    // eased movement of the falling piece (purely visual; rules stay on the grid)
    const piece = game.currentPiece;
    if (piece) {
      if (vis.pid !== piece.pid) { vis.pid = piece.pid; vis.ox = 0; vis.oy = 0; }
      else {
        vis.ox = clamp(vis.ox + (vis.x - piece.x), -1.5, 1.5);
        vis.oy = clamp(vis.oy + (vis.y - piece.y), -1.5, 1.5);
      }
      vis.x = piece.x; vis.y = piece.y;
      const decay = reduceMotion ? 0 : Math.exp(-dt / 26);
      vis.ox *= decay; vis.oy *= decay;
      if (Math.abs(vis.ox) < 0.01) vis.ox = 0;
      if (Math.abs(vis.oy) < 0.01) vis.oy = 0;
    } else {
      vis.pid = 0;
    }

    syncUi();

    const animating = running || fx.active || shake.amp > 0.05 || bump.amp > 0.05 || popups.length > 0 || trails.length > 0 || collapse !== null ||
      (game.phase === Phase.GAME_OVER && animTime - overAt < 800);
    if (animating || needRender || (!game.paused && !isTitle() && ts - lastIdleRender > 90)) {
      render();
      needRender = false;
      lastIdleRender = ts;
    }

    // If the device cannot hold the frame rate, render at a lower pixel density.
    if (running) {
      perf.sum += rawDt; perf.n++;
      if (perf.n >= 150) {
        const avg = perf.sum / perf.n;
        perf.sum = 0; perf.n = 0;
        if (avg > 25 && view.dprCap > 1.5 && view.dpr > 1.5) {
          view.dprCap = Math.max(1.5, Math.min(view.dprCap, view.dpr) - 0.5);
          layout();
        }
      }
    }
  }

  // ------------------------------------------------------------------ boot

  function boot() {
    els = {
      app: $('kf-app'), cave: $('kf-cave'), bg: $('kf-bg'), fg: $('kf-fg'), top: $('kf-top'), mid: $('kf-mid'), bottom: $('kf-bottom'),
      title: $('kf-title'), logo: $('kf-logo'),
      main: $('kf-btn-main'), level: $('kf-level'), score: $('kf-score'), next: $('kf-next'), toast: $('kf-toast'),
      cardPause: $('kf-card-pause'), cardOver: $('kf-card-over'),
      finalScore: $('kf-final-score'), bestStart: $('kf-best-start'), bestOver: $('kf-best-over'), bestMenu: $('kf-best-menu'),
      menu: $('kf-menu'), help: $('kf-help'), menuResume: $('kf-menu-resume'), menuNew: $('kf-menu-new'),
      optSound: $('kf-opt-sound'), optGhost: $('kf-opt-ghost'), optVibrate: $('kf-opt-vibrate'),
    };
    bgCtx = els.bg.getContext('2d');
    fgCtx = els.fg.getContext('2d');
    caveCtx = els.cave.getContext('2d');
    try { cave = KF.Cave && KF.Cave.create ? KF.Cave.create() : null; } catch (e) { cave = null; }

    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reduceMotion = mq.matches;
      const onMq = (ev) => { reduceMotion = ev.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    } catch (e) { /* matchMedia unavailable */ }

    loadSettings();
    syncSwitches();
    if (typeof navigator === 'undefined' || !navigator.vibrate) $('kf-row-vibrate').hidden = true;

    // game controls
    bindPress($('kf-btn-drop'), () => { if (game.canAcceptInput()) game.hardDrop(gameTime); });
    bindPress($('kf-btn-rot'), () => { if (game.canAcceptInput()) game.tryRotate(gameTime); });
    bindPress($('kf-btn-soft'), () => { input.softBtn = true; softPress(); }, () => { input.softBtn = false; });
    window.addEventListener('pointerdown', onFieldPointerDown);
    window.addEventListener('pointerup', onFieldPointerUp);
    window.addEventListener('pointercancel', onFieldPointerUp);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeld);

    // HUD, cards, menu
    bindClick(els.main, mainButton);
    bindClick($('kf-btn-menu'), openMenu);
    bindClick($('kf-start'), startNewGame);
    bindClick($('kf-title-menu'), openMenu);
    bindClick($('kf-again'), playAgain);
    bindClick($('kf-resume'), resumeGame);
    bindClick(els.menuResume, resumeGame);
    bindClick(els.menuNew, menuNewGame);
    bindClick($('kf-menu-help'), () => { modal = 'help'; });
    bindClick($('kf-menu-close'), () => { modal = null; });
    bindClick($('kf-help-back'), () => { modal = 'menu'; });
    bindSwitch(els.optSound, 'sound');
    bindSwitch(els.optGhost, 'ghost');
    bindSwitch(els.optVibrate, 'vibrate');
    for (const m of [els.menu, els.help]) {
      m.addEventListener('click', (e) => { if (e.target === m) { modal = m === els.help ? 'menu' : null; uiKey = ''; } });
    }

    // leaving the page pauses the game (like the app going to the background)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { pauseGame(); commitBest(); if (A.suspend) A.suspend(); }
      else { lastTs = 0; if (A.resume) A.resume(); }
    });

    window.addEventListener('pagehide', commitBest);

    if (typeof ResizeObserver === 'function') new ResizeObserver(layout).observe(document.body);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => window.setTimeout(layout, 120));
    layout();
    if (document.fonts && document.fonts.load) {
      document.fonts.load("600 20px 'Fredoka'").then(layout).catch(() => {});
    }
    window.requestAnimationFrame(frame);
  }

  // Small surface for tests and debugging.
  KF.App = {
    game, view, settings, input,
    get gameTime() { return gameTime; },
    get cave() { return cave; },
    setCaveLevel,
    start: startNewGame, pause: pauseGame, resume: resumeGame, openMenu, layout,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(globalThis.KF = globalThis.KF || {});
