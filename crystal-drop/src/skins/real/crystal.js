// Kristallfall - crystal renderer, REALISTIC skin ("real") and shatter effect.
//
// Every tetromino is ONE chunk of smoky, see-through crystal (template: a roughly square cleavage block
// of clear quartz / halite). The sprites carry real alpha: the body is thin smoke that lets the cave
// shine through and gets denser and brighter where the stone is thick - in the side faces seen through
// the top, along cleavage steps, fracture veils and reflecting planes. There is no outline: the lit
// (top-left) edges carry crisp broken highlights, the far edges gather a little coloured light, and a
// soft contact shadow lifts the piece off the playfield. The silhouette is chipped, not bevelled.
// Cells of one piece are fused: the slab model, the periodic textures and the cleavage lines that leave
// a cell through fixed "ports" run straight through the joints; seeded detail stays inside a cell.
// Cleared rows crack along seeded fracture polygons (internal, masked by the stone) and then shatter
// into exactly those polygons - each shard is a piece of the block's own sprite.
//
// Classic script, Canvas 2D only, no assets, no clocks, no Math.random. Per-pixel work happens only in
// cached sprites, never per frame.
// Public API: KF.Crystal = { id, palette, drawCells, drawLight, createFx, invalidate }.
(function (KF) {
  'use strict';

  /* ------------------------------------------------------------------------------------------------ *
   * Palette - the same crystal, tinted. Tones run from the smoky depth (shade) to the milky veils
   * (pale); `glow` is the light that gathers inside the far edges.
   * ------------------------------------------------------------------------------------------------ */
  const palette = {
    I: { name: 'Bergkristall', hi: '#ffffff', pale: '#f1f4f8', light: '#c6ccd6', mid: '#8d95a2', deep: '#565d69', shade: '#2b3038', line: '#1c2027', glow: '#dfe9f7' },
    O: { name: 'Rosenquarz',   hi: '#fff7f9', pale: '#ffe3ec', light: '#f7b4c9', mid: '#e5809f', deep: '#a8496a', shade: '#5c2239', line: '#451628', glow: '#ff9dba' },
    T: { name: 'Citrin',       hi: '#fffbe8', pale: '#fff0b4', light: '#f6d05e', mid: '#e3a31d', deep: '#a66d0a', shade: '#5c3c05', line: '#432a03', glow: '#ffc533' },
    S: { name: 'Blauquarz',    hi: '#f0f6ff', pale: '#d3e6ff', light: '#78aef4', mid: '#2e6ede', deep: '#183f9a', shade: '#0a1e54', line: '#07143c', glow: '#4b94ff' },
    Z: { name: 'Amethyst',     hi: '#fbf2ff', pale: '#f1daff', light: '#cb8cf2', mid: '#a047d4', deep: '#68249c', shade: '#360e58', line: '#250944', glow: '#bf66ff' },
    J: { name: 'Prasiolith',   hi: '#f4fff8', pale: '#dcf8e7', light: '#92ddb2', mid: '#43b47c', deep: '#1d7650', shade: '#0e3f2a', line: '#092d1e', glow: '#5ee69b' },
    L: { name: 'Karneol',      hi: '#fff3e6', pale: '#ffdcbd', light: '#f8985a', mid: '#e5551b', deep: '#a52e0b', shade: '#5e1504', line: '#450e02', glow: '#ff6c20' },
  };
  // Nature is smoky, not candy: the body tones of the tinted types lean towards the grey of the clear
  // crystal. Their colour lives in the reflections, the frosted faces and the edges (light, pale, glow).
  ['O', 'T', 'S', 'Z', 'J', 'L'].forEach(function (k) {
    const p = palette[k], g = palette.I;
    p.mid = mix(p.mid, g.mid, 0.16); p.deep = mix(p.deep, g.deep, 0.2); p.shade = mix(p.shade, g.shade, 0.26);
  });
  const TYPE_INDEX = { I: 0, O: 1, T: 2, S: 3, Z: 4, J: 5, L: 6 };
  // Material per type: [body alpha, body tone, milkiness, gloss, light gathered in the far edges]
  const MAT = [
    [0.50, 0.46, 1.00, 1.25, 0.36],   // I  clear, smoky
    [0.58, 0.50, 1.05, 1.00, 0.50],   // O  milky rose
    [0.56, 0.50, 0.90, 1.25, 0.66],   // T  honey
    [0.58, 0.50, 1.00, 1.15, 0.58],   // S
    [0.58, 0.50, 0.95, 1.20, 0.58],   // Z
    [0.56, 0.50, 1.00, 1.15, 0.54],   // J
    [0.58, 0.50, 0.95, 1.10, 0.70],   // L
  ];
  const PALS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map(function (k) {
    const p = palette[k];
    // tone ramp (0 = smoky depth .. 1 = palest veil) as a 256-entry RGB table for the per-pixel bake
    const stops = [[0, p.shade], [0.3, p.deep], [0.56, p.mid], [0.8, p.light], [1, p.pale]];
    const lut = new Uint8Array(768);
    for (let i = 0, s = 0; i < 256; i++) {
      const t = i / 255;
      while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
      const a = hexRgb(stops[s][1]), b = hexRgb(stops[s + 1][1]), f = (t - stops[s][0]) / (stops[s + 1][0] - stops[s][0]);
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(a[c] + (b[c] - a[c]) * f);
    }
    p.lut = lut;
    p.rgb = { glow: hexRgb(p.glow), veil: hexRgb(mix(p.pale, '#ffffff', 0.45)) };
    return p;
  });
  const O_INDEX = 1;

  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = function (sh) { return Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t); };
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Deterministic randomness
   * ------------------------------------------------------------------------------------------------ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash32(a, b) {
    let h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA6B)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 13;
    return h >>> 0;
  }
  const TAU = Math.PI * 2;

  /* ------------------------------------------------------------------------------------------------ *
   * Cell geometry. Edges and corners are indexed clockwise: edges N=0 E=1 S=2 W=3 (bit 1<<k of conn),
   * corner k is the start of edge k (NW=0 NE=1 SE=2 SW=3). All shapes are described in the frame of a
   * corner: a = distance along edge k, d = depth into the cell; mapPt rotates that into cell space.
   * ------------------------------------------------------------------------------------------------ */
  const VARIANTS = 8;        // seeded variations per type/conn, picked by cell seed
  const PAD = 2;             // transparent border around a crack sprite (device px); body sprites: padOf()
  const SPRITE_BUDGET = 4e6; // soft cap of the sprite cache in pixels (~16 MB): beyond it, sprites that are neither on the board nor recently used are dropped
  const PIECE_BUDGET = 3e6;  // the same for the cache of fused pieces
  const K = {                // fractions of the cell edge
    margin: 0.02,            // gap between silhouette and cell boundary on outer edges
    // Small sawtooth nick the silhouette dips into at every joint (keeps the cells of a chunk countable):
    // depth, and the length of its slope at the start / end of an edge (clockwise).
    pinch: 0.034, pinchStart: 0.13, pinchEnd: 0.04,
  };
  // The block is a slab seen slightly from the top-left: its side faces show through the top as bands of
  // these widths along the outer edges N E S W. Everything that touches an open edge (joint) is the same
  // in every sprite, whatever its variant: slab, periodic textures and the two cleavage "ports" below.
  const BAND = [0.34, 0.26, 0.28, 0.32];
  const PORT_H = 0.37, PORT_V = 0.61;   // a cleavage line crosses every E/W joint at v = PORT_H, every N/S joint at u = PORT_V
  const LX = 0.64, LY = 0.77;           // direction of the light (it comes from the top-left)

  function mapPt(S, k, a, d) {
    switch (k) {
      case 0: return [a, d];
      case 1: return [S - d, a];
      case 2: return [S - a, S - d];
      default: return [d, S - a];
    }
  }

  function makeGeo(ti, conn, variant, S, ghost) {
    const rnd = mulberry32(hash32(ti * 64 + conn * 4 + variant, 0x51ED));
    const closed = [!(conn & 1), !(conn & 2), !(conn & 4), !(conn & 8)];
    const ch = [], chips = [], leg = [];
    const nOpen = (conn & 1) + (conn >> 1 & 1) + (conn >> 2 & 1) + (conn >> 3 & 1);
    for (let k = 0; k < 4; k++) {
      // Outer corner: broken off irregularly - two unequal legs and a seeded vertex between them that
      // bulges or hollows the cut. Most corners are small nicks, now and then a big unequal chamfer.
      // Crystal terminations: the free end of an arm and a lone nugget are cut to a point, other corners less.
      const base = ghost ? 0.2 : (nOpen === 1 ? 0.23 : nOpen === 0 ? 0.19 : 0.14) + rnd() * 0.08, skew = ghost ? 1 : 0.68 + rnd() * 0.75;
      const L0 = S * Math.min(0.38, base * skew), L1 = S * Math.min(0.38, base / skew);
      const t = ghost ? 0.5 : 0.3 + rnd() * 0.4, off = ghost ? 0 : (rnd() - 0.42) * 0.36, L = Math.hypot(L0, L1);
      ch.push([0, L1, L0 * t - L1 / L * off * Math.min(L0, L1), L1 * (1 - t) - L0 / L * off * Math.min(L0, L1), L0, 0]);
      leg.push(L0 / S, L1 / S);
    }
    for (let k = 0; k < 4; k++) {
      // Outer edge: at most one break - a conchoidal chip or a shallow stepped ledge - between the corners
      // (a = position along the edge, d = extra depth).
      const list = [];
      const lo = Math.max(0.15, leg[k * 2] + 0.05), hi = 1 - Math.max(0.09, leg[((k + 1) & 3) * 2 + 1] + 0.05);
      if (!ghost && closed[k] && hi - lo > 0.14 && rnd() < 0.55) {
        const w = Math.min(hi - lo, 0.1 + rnd() * 0.2), a0 = lo + rnd() * (hi - lo - w), dp = 0.014 + rnd() * 0.046;
        if (rnd() < 0.45) {
          const r1 = Math.min(w * 0.3, 0.012 + rnd() * 0.02), r2 = Math.min(w * 0.3, 0.012 + rnd() * 0.035), d1 = dp * 0.62;
          list.push(S * a0, 0, S * (a0 + r1), S * d1, S * (a0 + w - r2), S * d1 * (0.65 + rnd() * 0.5), S * (a0 + w), 0);
        } else {
          const tt = 0.2 + rnd() * 0.6;
          list.push(S * a0, 0, S * (a0 + w * tt), S * dp, S * (a0 + w), 0);
        }
      }
      chips.push(list);
    }
    return {
      S: S, closed: closed, ch: ch, chips: chips, rnd: rnd, variant: variant,
      m: Math.round(S * K.margin),
      pinch: ghost ? 0 : S * K.pinch, pinchStart: S * K.pinchStart, pinchEnd: S * K.pinchEnd,
      // Two open edges meeting at a corner leave a concave notch - except in the O piece, the only
      // tetromino that contains a filled 2x2 (conn carries no diagonal information).
      concave: ti !== O_INDEX,
      ext: 1,                                // one device pixel beyond every joint; blit() crops it to fit
    };
  }

  // Closed polygon of the cell silhouette.
  function ring(geo) {
    const S = geo.S, pts = [], i = geo.m, e = -geo.ext;
    const j = i + geo.pinch;                         // inset is `j` wherever the outline crosses a joint
    for (let k = 0; k < 4; k++) {
      const A = geo.closed[(k + 3) & 3], B = geo.closed[k];
      if (A && B) {
        const c = geo.ch[k];
        for (let n = 0; n < 6; n += 2) pts.push(mapPt(S, k, i + c[n], i + c[n + 1]));
      } else if (A) pts.push(mapPt(S, k, i, geo.pinchEnd), mapPt(S, k, j, 0), mapPt(S, k, j, e));
      else if (B) pts.push(mapPt(S, k, e, j), mapPt(S, k, 0, j), mapPt(S, k, geo.pinchStart, i));
      else if (geo.concave) pts.push(mapPt(S, k, e, j), mapPt(S, k, j, j), mapPt(S, k, j, e));
      else pts.push(mapPt(S, k, e, e));
      if (B) { const c = geo.chips[k]; for (let n = 0; n < c.length; n += 2) pts.push(mapPt(S, k, c[n], i + c[n + 1])); }
    }
    return pts;
  }

  function tracePoly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Sprite baking. A body sprite is shaded per pixel (colour AND alpha) from
   *   - the SLAB: every point belongs to the outer edge of the piece that reaches it first; within
   *     BAND of an edge it lies on a side face (seen through the top), further in on the flat top. An
   *     open edge has no face of its own; at a reflex corner the edges of the two neighbouring arms
   *     reach into the cell. Faces, inner contour, hips and valleys continue seamlessly across joints.
   *   - the distance to the chipped silhouette (edge highlights, far-edge light, contact shadow),
   *   - textures that are either periodic per cell (cloud, fibres, the diagonal reflection, the two
   *     cleavage ports) or fade out towards the joints (seeded planes, veils), so that a joint looks
   *     the same from both sides.
   * ------------------------------------------------------------------------------------------------ */
  const sprites = new Map();
  let spritePixels = 0, spriteLimit = SPRITE_BUDGET;
  // Cache policy (sprites and fused pieces): an entry stays while it is part of the settled board
  // (`ep` = the epoch of the last board paint) or was used lately (`used`); everything else goes once
  // the soft budget is exceeded. A board that needs more than the budget is never thrashed.
  let useClock = 0, boardEpoch = 0, onBoard = false;
  function touch(e) { e.used = useClock; if (onBoard) e.ep = boardEpoch; return e; }
  function sweep(map) {
    let left = 0;
    map.forEach(function (e, key) {
      if (e.ep >= boardEpoch || e.used > useClock - 400) left += e.cost; else map.delete(key);
    });
    return left;
  }

  // Padding around a body sprite (device px): AA + room for the contact shadow.
  function padOf(px) { return Math.max(PAD, Math.round(px * 0.075)); }
  // ... and around a preview light map: room for its soft halo.
  function ghostPad(px) { return Math.max(PAD, Math.round(px * 0.17)); }

  // Tileable value noise, period 1 in both directions, shared by all sprites.
  let noiseTab = null;
  function noiseTable() {
    if (noiseTab) return noiseTab;
    const N = 64, tab = new Float32Array(N * N), rnd = mulberry32(0xC0FFEE);
    [[3, 0.5], [6, 0.3], [12, 0.2]].forEach(function (oct) {
      const n = oct[0], lat = new Float32Array(n * n);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = x / N * n, fy = y / N * n, x0 = fx | 0, y0 = fy | 0, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
        let tx = fx - x0, ty = fy - y0;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const a = lat[y0 * n + x0], b = lat[y0 * n + x1], c = lat[y1 * n + x0], d = lat[y1 * n + x1];
        tab[y * N + x] += oct[1] * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    });
    return (noiseTab = tab);
  }
  function tnoise(tab, u, v) {                     // bilinear lookup, wraps
    u = (u - Math.floor(u)) * 64; v = (v - Math.floor(v)) * 64;
    const x0 = u | 0, y0 = v | 0, tx = u - x0, ty = v - y0;
    const r0 = (y0 & 63) * 64, r1 = ((y0 + 1) & 63) * 64, c0 = x0 & 63, c1 = (x0 + 1) & 63;
    const a = tab[r0 + c0], b = tab[r1 + c0];
    const top = a + (tab[r0 + c1] - a) * tx, bot = b + (tab[r1 + c1] - b) * tx;
    return top + (bot - top) * ty;
  }

  // Scratch canvas for coverage masks (the only canvas that is ever read back).
  let maskCv = null, maskG = null;
  function coverage(pts, side, P) {
    if (!maskCv) { maskCv = document.createElement('canvas'); maskG = maskCv.getContext('2d', { willReadFrequently: true }) || maskCv.getContext('2d'); }
    if (maskCv.width < side) maskCv.width = maskCv.height = side;
    maskG.setTransform(1, 0, 0, 1, 0, 0);
    maskG.clearRect(0, 0, side, side);
    maskG.setTransform(1, 0, 0, 1, P, P);
    tracePoly(maskG, pts);
    maskG.fillStyle = '#ffffff';
    maskG.fill();
    return maskG.getImageData(0, 0, side, side);
  }

  // Cell sprite for type index / conn mask / variant, baked at px device pixels (plus padOf(px)).
  // Body sprites carry their contact shadow as a second canvas in `.shadow`. Ghost sprites are white
  // light maps for the landing preview (independent of type and variant).
  function getSprite(ti, conn, variant, px, ghost) {
    if (ghost) { ti = ti === O_INDEX ? O_INDEX : 0; variant = 0; }
    const key = ((((px * 2 + (ghost ? 1 : 0)) * 7 + ti) * 16 + conn) * VARIANTS) + variant;
    let cv = sprites.get(key);
    if (!cv) {
      const P = ghost ? ghostPad(px) : padOf(px), side = px + P * 2, cost = side * side * (ghost ? 1 : 2);
      cv = document.createElement('canvas');
      cv.width = cv.height = side;
      const baked = shadeBody(makeGeo(ti, conn, variant, px, ghost), PALS[ti], ti, P, ghost);
      cv.getContext('2d').putImageData(baked.body, 0, 0);
      if (!ghost) {
        const sh = document.createElement('canvas');
        sh.width = sh.height = side;
        sh.getContext('2d').putImageData(baked.shadow, 0, 0);
        cv.shadow = sh;
      }
      cv.cost = cost; cv.ep = ghost ? Infinity : -1; cv.used = useClock;
      sprites.set(key, cv);
      spritePixels += cost;
      if (spritePixels > spriteLimit) { spritePixels = sweep(sprites); spriteLimit = Math.max(SPRITE_BUDGET, spritePixels * 1.3); }
    }
    cv.used = useClock;
    if (onBoard && cv.ep < boardEpoch) cv.ep = boardEpoch;
    return cv;
  }

  // Draws a cell sprite so that fused cells tile EXACTLY (sprites are translucent: an overlap or a gap
  // of one device pixel would show as a seam). On open edges the sprite is cropped to the device-pixel
  // rectangle of its cell; closed edges keep their padding. k: device px -> units of g, (ox, oy): origin.
  function blit(g, sp, c, size, dpr, P, k, ox, oy) {
    const conn = c.conn & 15, side = sp.width, X = Math.round(c.x * dpr), Y = Math.round(c.y * dpr);
    const sx0 = conn & 8 ? P : 0, sy0 = conn & 1 ? P : 0;
    const sx1 = conn & 2 ? Math.min(side, P + Math.round((c.x + size) * dpr) - X) : side;
    const sy1 = conn & 4 ? Math.min(side, P + Math.round((c.y + size) * dpr) - Y) : side;
    const w = sx1 - sx0, h = sy1 - sy0;
    if (w > 0 && h > 0) g.drawImage(sp, sx0, sy0, w, h, (X - P + sx0 - ox) * k, (Y - P + sy0 - oy) * k, w * k, h * k);
  }

  // Response by face: 0..3 = N E S W side faces, 4..7 = corner cuts NW NE SE SW, 8 = flat top.
  const F_LIT = [1, 0, 0, 1, 1, 1, 0, 0, 1];
  const F_LINE = [0.4, 0.17, 0.14, 0.32, 0.4, 0.24, 0.12, 0.2, 0.24];    // brightness of the face's contour lines (faint: the faces are frosted, not outlined)
  const F_SHIFT = [0, 0.37, 0.61, 0.17, 0.52, 0.83, 0.26, 0.71, 0.45];   // the reflection breaks where it enters a side face
  const C_TONE = [0.26, 0.14, 0.03, 0.10];
  const UNIT_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

  // Returns { body: ImageData, shadow: ImageData | null } for one cell.
  function shadeBody(geo, pal, ti, P, ghost) {
    const S = geo.S, side = S + P * 2, cl = geo.closed, rnd = geo.rnd, mat = MAT[ti], lut = pal.lut;
    const tab = noiseTable(), inv = 1 / S, m = geo.m;
    const outline = ring(geo);
    const img = coverage(outline, side, P), px = img.data;
    const shadow = ghost ? null : maskG.createImageData(side, side), sd = shadow ? shadow.data : null;

    // (a) Outer boundary: the silhouette without the pieces that run along / beyond a joint. Every
    //     segment gets its own seeded sparkle, so the edge light is broken like on a chipped stone.
    const segs = [];
    const edgeDepth = function (k, p) { return k === 0 ? p[1] : k === 1 ? S - p[0] : k === 2 ? S - p[1] : p[0]; };
    for (let n = 0; n < outline.length; n++) {
      const a = outline[n], b = outline[(n + 1) % outline.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      let joint = l2 < 1e-6;
      for (let k = 0; k < 4 && !joint; k++) joint = !cl[k] && edgeDepth(k, a) <= 0.001 && edgeDepth(k, b) <= 0.001;
      if (joint) continue;
      const l = Math.sqrt(l2);
      segs.push(a[0], a[1], dx, dy, 1 / l2, dy / l, -dx / l, rnd());   // start, direction, 1/len^2, outward normal, sparkle
    }
    const nSeg = segs.length;
    const reflex = [];
    for (let k = 0; k < 4; k++) reflex.push(!cl[k] && !cl[(k + 3) & 3] && geo.concave);

    if (ghost) {
      // Landing preview: a white light map - a soft pool of light inside the shape that gathers gently
      // towards the contour, and a wide soft halo outside. No hard line anywhere.
      const w1 = S * 0.16, w2 = S * 0.07;
      for (let yy = 0, o = 0; yy < side; yy++) {
        const y = yy - P + 0.5;
        for (let xx = 0; xx < side; xx++, o += 4) {
          const cov = px[o + 3], x = xx - P + 0.5;
          px[o] = px[o + 1] = px[o + 2] = 255;
          if (!cov && !((x >= 0 || cl[3]) && (x <= S || cl[1]) && (y >= 0 || cl[0]) && (y <= S || cl[2]))) continue;
          let d2 = 1e12;
          for (let s = 0; s < nSeg; s += 8) {
            const ax = x - segs[s], ay = y - segs[s + 1];
            let t = (ax * segs[s + 2] + ay * segs[s + 3]) * segs[s + 4];
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = ax - segs[s + 2] * t, ey = ay - segs[s + 3] * t, q = ex * ex + ey * ey;
            if (q < d2) d2 = q;
          }
          const ai = 0.11 + 0.38 * Math.exp(-d2 / (w1 * w1)), ao = 0.40 * Math.exp(-d2 / (w2 * w2)), c = cov / 255;
          px[o + 3] = (ao + (ai - ao) * c) * 255;
        }
      }
      return { body: img, shadow: null };
    }

    // (b) Slab faces and corner cuts.
    const ih = [1 / BAND[0], 1 / BAND[1], 1 / BAND[2], 1 / BAND[3]];
    const cham = [];
    for (let k = 0; k < 4; k++) {
      if (cl[k] && cl[(k + 3) & 3]) {
        const c = geo.ch[k], L0 = c[4], L1 = c[1], L = Math.hypot(L0, L1);
        cham.push([L1 / L, L0 / L, L0 * L1 / L, 1 / (S * (0.07 + rnd() * 0.05) + L * 0.3)]);
      } else cham.push(null);
    }

    // (c) Seeded interior (never reaches a joint at full strength).
    const det = S < 44 ? 0.45 + 0.55 * S / 44 : 1;           // small sprites: calmer, or they turn to mud
    // The side faces change their width in steps along an edge (broken terraces, not a ruled bevel):
    // one seeded profile per edge, 0.5 .. 1.6 times BAND. Faded out towards the joints, see `win`.
    const steps = new Float32Array(4 * 34);
    for (let k = 0; k < 4; k++) {
      // (prism faces: nearly straight, with an occasional small growth step)
      let val = 0.94 + rnd() * 0.12, next = 0.3 + rnd() * 0.5;
      for (let i = 0; i < 34; i++) {
        if (i / 32 > next) { val = rnd() < 0.3 ? 1.04 + rnd() * 0.1 : 0.88 + rnd() * 0.14; next += 0.3 + rnd() * 0.5; }
        steps[k * 34 + i] = val;
      }
    }
    // straight cleavage planes: thin steps and (fewer) broad reflecting panes - the big planes that
    // cross a whole stone are laid over the fused piece, see overlayPiece()
    const cuts = [];
    for (let n = 1 + (rnd() * 2.5 | 0); n > 0; n--) {
      const pane = rnd() < 0.4, fam = rnd();
      const ang = (fam < 0.3 ? 0 : fam < 0.55 ? Math.PI / 2 : fam < 0.82 ? -0.63 : 0.94) + (rnd() - 0.5) * 0.24;
      const len = 0.3 + rnd() * 0.5, mx = 0.25 + rnd() * 0.5, my = 0.25 + rnd() * 0.5;
      const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len, sgn = rnd() < 0.5 ? 1 : -1;
      cuts.push(mx - dx / 2, my - dy / 2, dx, dy, 1 / (len * len), -dy / len * sgn, dx / len * sgn,
        pane ? 0.14 + rnd() * 0.2 : 0.035 + rnd() * 0.05, ((pane ? 0.45 : 0.8) + rnd() * 0.5) * det, pane ? 1 : 0, rnd(), len);
    }
    // facets: the stone is a patchwork of angular zones that differ a little in depth
    const facets = [];
    for (let n = 0; n < 2; n++) {
      const fam = rnd(), ang = (fam < 0.3 ? 0 : fam < 0.55 ? Math.PI / 2 : fam < 0.82 ? -0.63 : 0.94) + (rnd() - 0.5) * 0.3;
      facets.push(0.3 + rnd() * 0.4, 0.3 + rnd() * 0.4, -Math.sin(ang), Math.cos(ang), (0.05 + rnd() * 0.07) * (rnd() < 0.5 ? 1 : -1));
    }
    // the two cleavage lines through the ports: seeded strength inside the cell, seeded end where the
    // far side is closed (or at the crossing with the other line: an L-shaped step)
    const hOn = !cl[1] || !cl[3] || rnd() < 0.42, vOn = !cl[0] || !cl[2] || rnd() < 0.36;
    const hAmp = (0.1 + rnd() * 1.1) * det, vAmp = (0.1 + rnd() * 1.1) * det;
    const stop = function (open, cross, on) { return open ? 9 : on && rnd() < 0.5 ? cross : 0.12 + rnd() * 0.3; };
    const hA0 = cl[3] ? stop(false, PORT_V, vOn && cl[1] === false) : -9, hA1 = cl[1] ? 1 - stop(false, 1 - PORT_V, vOn && cl[3] === false) : 9;
    const vA0 = cl[0] ? stop(false, PORT_H, hOn && cl[2] === false) : -9, vA1 = cl[2] ? 1 - stop(false, 1 - PORT_H, hOn && cl[0] === false) : 9;
    // fracture hairlines: long, faint, wandering polylines with a thin milky sheet on one side. Each one
    // starts on a port line, a cleavage plane or an older hairline, so they meet and form a network.
    const veils = [], VS = 15;
    let v0n = 1;
    for (let n = 0, nV = 3 + (rnd() < 0.4 ? 1 : 0); n < nV; n++) {
      const turn = (0.5 + rnd() * 0.8) * (rnd() < 0.5 ? 1 : -1) + (rnd() < 0.5 ? Math.PI : 0);
      let x, y, ang, s0 = 0;
      if (n === 0) { x = 0.18 + rnd() * 0.64; y = PORT_H; ang = turn; }
      else if (n === 1) { x = PORT_V; y = 0.18 + rnd() * 0.64; ang = Math.PI / 2 + turn; }
      else if (n === 2) { const t = 0.25 + rnd() * 0.5; x = cuts[0] + cuts[2] * t; y = cuts[1] + cuts[3] * t; ang = Math.atan2(cuts[3], cuts[2]) + turn; }
      else { const j = VS * Math.min(v0n - 1, 1 + (rnd() * 2 | 0)); x = veils[j]; y = veils[j + 1]; ang = Math.atan2(veils[j + 3], veils[j + 2]) + turn; }
      const segN = 4 + (rnd() * 3 | 0), str = (0.45 + rnd() * 0.75) * det, fwv = 0.14 + rnd() * 0.12, sgn = rnd() < 0.5 ? 1 : -1;
      const slant = 0.6 + rnd() * 1.2, seed = rnd() * 8, first = veils.length;
      for (let j = 0; j < segN; j++) {
        const len = 0.14 + rnd() * 0.16, dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
        veils.push(x, y, dx, dy, 1 / (len * len), -dy / len, dx / len, s0, len, str, fwv, sgn, slant, seed, 0);
        x += dx; y += dy; s0 += len; ang += (rnd() - 0.5) * 0.5;
        if (x < 0.04 || x > 0.96 || y < 0.04 || y > 0.96) break;
      }
      for (let j = first; j < veils.length; j += VS) veils[j + 14] = s0;
      if (n === 0) v0n = (veils.length - first) / VS;
    }
    let vx0 = 9, vy0 = 9, vx1 = -9, vy1 = -9;                // everything the hairlines can touch (sheet + warp)
    for (let j = 0; j < veils.length; j += VS) {
      const r = veils[j + 10] + 0.03, ex = veils[j] + veils[j + 2], ey = veils[j + 1] + veils[j + 3];
      vx0 = Math.min(vx0, veils[j] - r, ex - r); vx1 = Math.max(vx1, veils[j] + r, ex + r);
      vy0 = Math.min(vy0, veils[j + 1] - r, ey - r); vy1 = Math.max(vy1, veils[j + 1] + r, ey + r);
    }
    // one soft specular point: the lit corner of a chunk
    const spots = [];
    if (cl[3] && cl[0]) spots.push(0.15, 0.13, 1 / (0.03 * 0.03), 0.4, 0.15, 0.13, 1 / (0.1 * 0.1), 0.1);
    const gPh = rnd(), gPh2 = rnd();                         // where along its edges this stone catches the light
    const bandAmp = [rnd() * rnd() * 1.5, rnd() * rnd() * 1.5, rnd() * rnd() * 1.5, rnd() * rnd() * 1.5];   // mostly faint, now and then a stronger one
    const ox = rnd(), oy = rnd();
    const fib = new Float32Array(side);                      // vertical fibres: one soft profile per column
    for (let xx = 0; xx < side; xx++) fib[xx] = (tnoise(tab, (xx - P + 0.5) * inv * 2 + 0.21, 0.4) - 0.5) * 0.08;

    const aa = 1.3 * inv;                                    // one device pixel (soft edges)
    const lw = Math.max(0.85 * inv, 0.011);                  // half width of a fine line
    const fc = Math.max(1.0 * inv, 0.018), fw = Math.max(1.05 * inv, 0.017);   // edge highlight: centre, half width
    const jw = Math.max(1.4 * inv, 0.016);                   // joint line
    const A0 = mat[0], T0 = mat[1], gloss = mat[3];
    const veilC = pal.rgb.veil, glowC = pal.rgb.glow, hv = [0, 0, 0, 0];
    let o = 0;
    for (let yy = 0; yy < side; yy++) {
      const y = yy - P + 0.5, v = y * inv;
      for (let xx = 0; xx < side; xx++, o += 4) {
        const cov = px[o + 3], x = xx - P + 0.5, u = x * inv;
        if (!cov && !((x >= 0 || cl[3]) && (x <= S || cl[1]) && (y >= 0 || cl[0]) && (y <= S || cl[2]))) continue;

        // distance to the silhouette (exact near the edge; deep inside nothing needs it)
        let near = 1;
        if (cl[0] && v < near) near = v;
        if (cl[1] && 1 - u < near) near = 1 - u;
        if (cl[2] && 1 - v < near) near = 1 - v;
        if (cl[3] && u < near) near = u;
        for (let k = 0; k < 4; k++) {
          if (!reflex[k]) continue;
          const du = Math.abs(u - UNIT_CORNERS[k][0]), dv = Math.abs(v - UNIT_CORNERS[k][1]), q = du > dv ? du : dv;
          if (q < near) near = q;
        }
        let dOut = S, bnx = 0, bny = 0, bex = 0, bey = 0, bg = 0;
        if (cov < 255 || near < 0.27) {
          let d2 = 1e12;
          for (let s = 0; s < nSeg; s += 8) {
            const ax = x - segs[s], ay = y - segs[s + 1];
            let t = (ax * segs[s + 2] + ay * segs[s + 3]) * segs[s + 4];
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = ax - segs[s + 2] * t, ey = ay - segs[s + 3] * t, q = ex * ex + ey * ey;
            if (q < d2) { d2 = q; bnx = segs[s + 5]; bny = segs[s + 6]; bex = ex; bey = ey; bg = segs[s + 7]; }
          }
          dOut = Math.sqrt(d2);
        }

        // contact shadow: only outside the stone, soft, a little longer away from the light
        if (cov < 250) {
          const f = dOut > 0.01 ? Math.max(0, (bex * 0.6 + bey * 0.8) / dOut) : 0.5;
          const k = 1 - dOut / (S * (0.03 + 0.045 * f));
          if (k > 0) sd[o + 3] = (0.32 + 0.3 * f) * k * k * 255;
        }
        if (!cov) continue;

        // seeded details fade out towards the joints
        let win = 1;
        for (let k = 0; k < 4; k++) {
          if (cl[k]) continue;
          const dk = k === 0 ? v : k === 1 ? 1 - u : k === 2 ? 1 - v : u;
          win *= dk < 0.02 ? 0 : dk > 0.17 ? 1 : (dk - 0.02) * 6.67;
        }
        // slab: the lowest face wins
        hv[0] = v * ih[0]; hv[1] = (1 - u) * ih[1]; hv[2] = (1 - v) * ih[2]; hv[3] = u * ih[3];
        if (win > 0) {
          const su = u <= 0 ? 0 : u >= 1 ? 32 : u * 32, sv = v <= 0 ? 0 : v >= 1 ? 32 : v * 32;
          const iu = su | 0, fu = su - iu, iv = sv | 0, fv = sv - iv;
          if (cl[0]) hv[0] /= 1 + win * (steps[iu] + (steps[iu + 1] - steps[iu]) * fu - 1);
          if (cl[1]) hv[1] /= 1 + win * (steps[34 + iv] + (steps[35 + iv] - steps[34 + iv]) * fv - 1);
          if (cl[2]) hv[2] /= 1 + win * (steps[68 + iu] + (steps[69 + iu] - steps[68 + iu]) * fu - 1);
          if (cl[3]) hv[3] /= 1 + win * (steps[102 + iv] + (steps[103 + iv] - steps[102 + iv]) * fv - 1);
        }
        let h1 = 9, h2 = 9, k1 = -1, k2 = -1, vd1 = 9;
        for (let k = 0; k < 4; k++) {
          let hk = hv[k], pk = k, vd = 9;
          if (!cl[k]) {
            if (!reflex[k]) continue;
            const kp = (k + 3) & 3, hb = hv[kp];
            if (hk > hb) vd = hk - hb; else { vd = hb - hk; hk = hb; pk = kp; }
          }
          if (pk === k1 || pk === k2) continue;
          if (hk < h1) { h2 = h1; k2 = k1; h1 = hk; k1 = pk; vd1 = vd; } else if (hk < h2) { h2 = hk; k2 = pk; }
        }
        for (let k = 0; k < 4; k++) {
          const c = cham[k];
          if (!c) continue;
          const a = k === 0 ? x : k === 1 ? y : k === 2 ? S - x : S - y, d = k === 0 ? y : k === 1 ? S - x : k === 2 ? S - y : x;
          const hk = ((a - m) * c[0] + (d - m) * c[1] - c[2]) * c[3];
          if (hk < h1) { h2 = h1; k2 = k1; h1 = hk; k1 = 4 + k; vd1 = 9; } else if (hk < h2) { h2 = hk; k2 = 4 + k; }
        }
        if (k1 < 0 || h1 > 1) { h2 = k1 < 0 ? 9 : h1; k2 = k1; h1 = 1; k1 = 8; vd1 = 9; }
        else if (h2 > 1) { h2 = 1; k2 = 8; }
        const h = h1 < 0 ? 0 : h1;

        // body: thin smoke, a soft cloud and vertical fibres (all periodic)
        const nA = tnoise(tab, u + 0.13, v + 0.71);
        const nC = tnoise(tab, 2 * u + v + 0.31, 2 * v - u + 0.57);
        let tone = T0 + (nA - 0.5) * 0.26 + fib[xx] * (0.4 + 1.2 * nC);
        let a = A0 + (nA - 0.5) * 0.2 + fib[xx] * 0.7 - (k1 === 8 ? 0.04 : 0);
        let milk = 0, spec = 0, glow = 0;

        // side faces seen through the top: denser, striated across; corner cuts
        if (k1 < 4) {
          const lit = F_LIT[k1], g = 1 - h;
          const sN = tnoise(tab, ((k1 & 1) ? v : u) * 4 + 0.3 + k1 * 0.17, 0.77 + h * 0.07) - 0.5;
          // prism faces: the lit ones bright and glassy, the others dark and clear
          tone += (lit ? 0.2 : -0.02) + (lit ? 0.14 : 0.03) * g + sN * 0.16;
          a += (lit ? 0.2 : 0.12) + 0.1 * g + sN * 0.1;
          milk += (lit ? 0.12 : 0.05) * (0.5 + nA) + (sN > 0 ? sN * 0.16 : 0);
        } else if (k1 < 8) { tone += C_TONE[k1 - 4]; a += 0.2; milk += 0.1 * (0.5 + nA); }
        // contour of the top face, hips of the corners: fine broken lines
        const eD = (h2 - h1) * (k1 < 4 ? BAND[k1] : k1 < 8 ? 0.1 : k2 >= 0 && k2 < 4 ? BAND[k2] : 0.1);
        if (eD < lw * 1.5 && k2 >= 0) {
          const li = k1 === 8 ? F_LINE[k2] : k2 === 8 ? F_LINE[k1] : (F_LINE[k1] + F_LINE[k2]) * 0.5;
          const k = (1 - eD / (lw * 1.5)) * li * (nC < 0.4 ? 0.3 : nC > 0.6 ? 1 : 0.3 + (nC - 0.4) * 3.5);
          milk += 0.42 * k; spec += 0.14 * k * gloss;
        }
        if (k1 === 8 && k2 >= 0 && k2 < 4 && F_LIT[k2] && h2 < 1.7) {     // back edge of the lit faces, seen through the slab
          tone += 0.03; a += 0.04;
          const e2 = (1.7 - h2) * BAND[k2];
          if (e2 < lw) milk += 0.06 * (1 - e2 / lw) * (0.2 + 1.2 * nA);
        }
        if (vd1 * 0.12 < lw * 1.5) milk += 0.3 * (1 - vd1 * 0.12 / (lw * 1.5));

        // broad diagonal reflection (periodic, so it bridges every joint) with fine parallel striations
        let f = u + v + F_SHIFT[k1];
        const fi = Math.floor(f) & 3;
        f -= Math.floor(f);
        const band = f < 0.3 ? 0 : f < 0.3 + aa ? (f - 0.3) / aa : f < 0.38 ? 1 : f < 0.62 ? (0.62 - f) * 4.17 : 0;
        if (band > 0) {
          const bb = band * (0.14 + win * (bandAmp[fi] - 0.14)) * (0.3 + 1.4 * tnoise(tab, f * 5 + 0.1, 0.23)) * (0.5 + nA);
          tone += 0.13 * bb; a += 0.12 * bb; spec += 0.03 * bb * gloss;
        }

        // cleavage lines through the ports: a fine line, a striated lit riser below / right of it
        if (hOn && u > hA0 && u < hA1) {
          const s = v - PORT_H;
          if (s > -lw * 3 && s < 0.13) {
            let k = (0.28 + win * (hAmp - 0.28)) * (0.4 + 1.2 * tnoise(tab, u * 3 + 0.5, 0.11));
            const e = Math.min(u - hA0, hA1 - u) * 16;
            if (e < 1) k *= e;
            if (s < -lw) tone -= 0.05 * k;
            else {
              const core = s < lw ? 1 - Math.abs(s) / lw : 0, riser = s > 0 ? Math.exp(-s * 26) * (0.35 + 1.3 * tnoise(tab, u * 7 + 0.9, 0.5)) : 0;
              milk += k * (0.3 * core + 0.16 * riser); tone += k * 0.14 * riser; a += k * 0.1 * riser; spec += k * 0.06 * core * gloss;
            }
          }
        }
        if (vOn && v > vA0 && v < vA1) {
          const s = u - PORT_V;
          if (s > -lw * 3 && s < 0.13) {
            let k = (0.28 + win * (vAmp - 0.28)) * (0.4 + 1.2 * tnoise(tab, 0.37, v * 3 + 0.2));
            const e = Math.min(v - vA0, vA1 - v) * 16;
            if (e < 1) k *= e;
            if (s < -lw) tone -= 0.05 * k;
            else {
              const core = s < lw ? 1 - Math.abs(s) / lw : 0, riser = s > 0 ? Math.exp(-s * 26) * (0.35 + 1.3 * tnoise(tab, 0.63, v * 7 + 0.4)) : 0;
              milk += k * (0.26 * core + 0.14 * riser); tone += k * 0.12 * riser; a += k * 0.09 * riser; spec += k * 0.05 * core * gloss;
            }
          }
        }
        // the joints themselves: a faint cleavage line with a slight step behind it (drawn by the cell
        // right of / below the joint only)
        if (!cl[3] && x < S * 0.1) { tone += 0.05 * (1 - u * 10); if (x < jw * S) milk += 0.13 * (1 - x / (jw * S)) * (0.2 + 1.4 * nC); }
        if (!cl[0] && y < S * 0.1) { tone += 0.05 * (1 - v * 10); if (y < jw * S) milk += 0.13 * (1 - y / (jw * S)) * (0.2 + 1.4 * nC); }

        if (win > 0.01) {
          // seeded cleavage planes
          for (let s = 0; s < cuts.length; s += 12) {
            const ax = u - cuts[s], ay = v - cuts[s + 1], q = ax * cuts[s + 5] + ay * cuts[s + 6], bw = cuts[s + 7];
            if (q < -lw || q > bw) continue;
            const t = (ax * cuts[s + 2] + ay * cuts[s + 3]) * cuts[s + 4];
            if (t < 0 || t > 1) continue;
            let tp = (t < 0.5 ? t : 1 - t) * cuts[s + 11] * 14;
            if (tp > 1) tp = 1;
            const k = cuts[s + 8] * tp * win, core = q < lw ? 1 - Math.abs(q) / lw : 0;
            let pan = 0;
            if (q > 0) { const e = 1 - q / bw; pan = cuts[s + 9] ? e * (0.4 + 1.2 * tnoise(tab, q * 9 + cuts[s + 10], t * cuts[s + 11] * 0.7 + 0.3)) : e * e; }
            tone += k * 0.22 * pan; a += k * 0.19 * pan; milk += k * (0.2 * core + 0.07 * pan); spec += k * 0.04 * core * gloss;
          }
          for (let s = 0; s < 10; s += 5) {
            const q = ((u - facets[s]) * facets[s + 2] + (v - facets[s + 1]) * facets[s + 3]) / aa;
            const e = (q < -1 ? -1 : q > 1 ? 1 : q) * facets[s + 4] * win;
            tone += e; a += e * 0.8;
          }
          // hairlines (their coordinates are warped a little: fractures wander, they are not ruled lines)
          let mv = 0, wu = 0, wv = 0, nv = 0;
          if (u > vx0 && u < vx1 && v > vy0 && v < vy1) {
            nv = veils.length;
            wu = u + (tnoise(tab, u * 1.5 + ox, v * 1.5 + oy) - 0.5) * 0.05; wv = v + (tnoise(tab, u * 1.5 + oy + 0.5, v * 1.5 + ox) - 0.5) * 0.05;
          }
          for (let s = 0; s < nv; s += 15) {
            const ax = wu - veils[s], ay = wv - veils[s + 1];
            let t = (ax * veils[s + 2] + ay * veils[s + 3]) * veils[s + 4];
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = ax - veils[s + 2] * t, ey = ay - veils[s + 3] * t, d2 = ex * ex + ey * ey, fwv = veils[s + 10];
            if (d2 > fwv * fwv) continue;
            const d = Math.sqrt(d2), sl = veils[s + 7] + t * veils[s + 8], q = 1 - d / fwv;
            const lee = (ex * veils[s + 5] + ey * veils[s + 6]) * veils[s + 11] > 0;
            let c = (lee ? 0.18 : 0.05) * q * q * (0.4 + 1.2 * nA);                // the thin milky sheet
            if (d < lw) c += (1 - d / lw) * (0.05 + 0.4 * tnoise(tab, sl * 7 + veils[s + 13], 0.3));
            if (lee && d < fwv * 0.6) {
              const barb = tnoise(tab, (sl + d * veils[s + 12]) * 9 + veils[s + 13], d * 2.5 + 0.6) - 0.4;
              if (barb > 0) c += 1.3 * barb * q * Math.sqrt(q);
            }
            c *= veils[s + 9] * Math.min(1, sl * 12 + 0.6) * Math.min(1, (veils[s + 14] - sl) * 5 + 0.05);
            if (c > mv) mv = c;
          }
          milk += win * mv; spec += win * mv * 0.04 * gloss;
          // seeded density of the stone
          const nB = tnoise(tab, u * 0.8 + ox, v * 0.8 + oy) - 0.5;
          tone += win * nB * 0.4; a += win * nB * 0.28;
        }

        // the silhouette: crisp broken highlights on the lit side, frosted thickness right behind
        // them, light gathering inside the far edges. No dark rim.
        const dn = dOut * inv;
        if (dn < 0.26) {
          const ld = -(bnx * LX + bny * LY), le = ld > 0 ? ld : 0, se = ld < 0 ? -ld : 0;
          const eb = 1 - Math.abs(dn - fc) / fw, gq = se > 0 && dn > 0.02 ? 1 - Math.abs(dn - 0.11) * 9 : 0;
          if (eb > 0 || gq > 0) {
            // Only stretches of an edge catch the light hard (low-frequency noise along the edge: periodic,
            // so a run bridges a joint; inside a cell it is shifted per stone). The rest stays frosted.
            const al = u * bny - v * bnx;
            let gate = (tnoise(tab, al + bnx * 0.37 + bny * 0.21 + 0.5, 0.9) + win * (tnoise(tab, al * 1.3 + gPh, 0.35 + gPh2) - 0.5) * 0.9 - 0.5) * 5;
            gate = gate < 0 ? 0 : gate > 1 ? 1 : gate;
            if (eb > 0) spec += eb * (le > 0 ? Math.sqrt(le) * (0.5 + 0.75 * bg) * (0.07 + (0.2 + 1.0 * nC) * gate) : 0.02 + (bg > 0.7 ? se * (bg - 0.7) * 1.5 * gate : 0));
            if (gq > 0) glow += se * gq * (0.25 + 1.4 * nA) * mat[4] * (0.22 + 0.78 * gate);
          }
          if (dn < 0.07) { const q = 1 - dn * 14.3; milk += q * q * le * (0.24 + 0.22 * bg); a += q * 0.2 * se; tone -= q * 0.07 * se; }
        }
        for (let s = 0; s < spots.length; s += 4) {
          const dx = u - spots[s], dy = v - spots[s + 1], q = (dx * dx + dy * dy) * spots[s + 2];
          if (q < 5) spec += spots[s + 3] * Math.exp(-q) * gloss;
        }

        // compose: smoky body -> milk (veils, lines) -> gathered light -> speculars; alpha follows density
        const idx = tone <= 0 ? 0 : tone >= 1 ? 765 : ((tone * 255) | 0) * 3;
        let r = lut[idx], gg = lut[idx + 1], b = lut[idx + 2];
        a = a < 0.16 ? 0.16 : a > 0.96 ? 0.96 : a;
        milk *= mat[2];
        if (milk > 1) milk = 1;
        r += (veilC[0] - r) * milk; gg += (veilC[1] - gg) * milk; b += (veilC[2] - b) * milk;
        a += (1 - a) * milk * 0.92;
        if (glow > 0) {
          r += glowC[0] * glow * 0.5; gg += glowC[1] * glow * 0.5; b += glowC[2] * glow * 0.5;
          a += (1 - a) * (glow > 1 ? 1 : glow) * 0.6;
        }
        if (spec > 0) {
          r += 255 * spec; gg += 255 * spec; b += 255 * spec;
          a += (1 - a) * (spec > 0.62 ? 1 : spec * 1.6);
        }
        px[o] = r; px[o + 1] = gg; px[o + 2] = b; px[o + 3] = cov * a;
      }
    }
    return { body: img, shadow: shadow };
  }

  // Soft round glint (idle glints, lock sparkle, shards catching the light). No rays.
  let glintCv = null;
  function glintSprite() {
    if (glintCv) return glintCv;
    const N = 48, c = (N - 1) / 2;
    glintCv = document.createElement('canvas');
    glintCv.width = glintCv.height = N;
    const g = glintCv.getContext('2d'), img = g.createImageData(N, N), d = img.data;
    for (let y = 0, o = 0; y < N; y++) for (let x = 0; x < N; x++, o += 4) {
      const dx = (x - c) / c, dy = (y - c) / c, r2 = dx * dx + dy * dy;
      const a = (Math.exp(-r2 / 0.014) + 0.3 * Math.exp(-r2 / 0.12)) * Math.max(0, 1 - Math.sqrt(r2));
      d[o] = d[o + 1] = d[o + 2] = 255;
      d[o + 3] = Math.min(255, a * 255);
    }
    g.putImageData(img, 0, 0);
    return glintCv;
  }

  function growCanvas(cv, w, h) {
    cv = cv || document.createElement('canvas');
    if (cv.width < w) cv.width = w;
    if (cv.height < h) cv.height = h;
    return cv;
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Fracture patterns. A cell breaks along one of a small set of patterns (picked by its seed). Half of
   * them are cleavage breaks: straight cracks that run from side to side and split the block again and
   * again; the others radiate from an impact point - off-centre (a fan) or central - and kink once.
   * The very same polygons are drawn as crack lines by drawCells and released as shards by fx.shatter,
   * so crack -> burst is continuous. A fixed set keeps the crack overlays bakeable.
   *   lines:  cracks as polylines { pts, len, at } - `at` = when the crack starts to grow (0..0.62)
   *   polys:  all shards (flat x,y lists);  wedges: a coarser tiling of the same cell
   * ------------------------------------------------------------------------------------------------ */
  const FRACTURE_PATTERNS = 20, CRACK_LEVELS = 7;
  const fractures = [];

  function fracture(seed) {
    const id = (seed >>> 0) % FRACTURE_PATTERNS;
    return fractures[id] || (fractures[id] = makeFracture(id));
  }

  function polyArea(q) {
    let s = 0;
    for (let i = 0, n = q.length; i < n; i += 2) s += q[i] * q[(i + 3) % n] - q[(i + 2) % n] * q[i + 1];
    return s / 2;
  }

  // Cuts a convex polygon along the line through (px, py) with direction (dx, dy).
  function splitPoly(q, px, py, dx, dy) {
    const n = q.length, A = [], B = [], cut = [];
    for (let i = 0; i < n; i += 2) {
      const x0 = q[i], y0 = q[i + 1], x1 = q[(i + 2) % n], y1 = q[(i + 3) % n];
      const s0 = (x0 - px) * dy - (y0 - py) * dx, s1 = (x1 - px) * dy - (y1 - py) * dx;
      (s0 >= 0 ? A : B).push(x0, y0);
      if ((s0 >= 0) !== (s1 >= 0)) {
        const t = s0 / (s0 - s1), cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
        A.push(cx, cy); B.push(cx, cy); cut.push(cx, cy);
      }
    }
    return cut.length === 4 && A.length >= 6 && B.length >= 6 ? [A, B, cut] : null;
  }

  function makeFracture(id) {
    const rnd = mulberry32(hash32(id, 0x2F6E2B1)), style = id & 3;
    const lines = [];
    let polys, wedges, px, py;
    if (style < 2) {
      // cleavage break
      polys = [[0, 0, 1, 0, 1, 1, 0, 1]];
      const a0 = 0, steps = 4 + (rnd() * 3 | 0);
      for (let s = 0; s < steps; s++) {
        let bi = 0, ba = 0;
        for (let i = 0; i < polys.length; i++) { const ar = Math.abs(polyArea(polys[i])); if (ar > ba) { ba = ar; bi = i; } }
        const q = polys[bi];
        let cx = 0, cy = 0;
        for (let i = 0; i < q.length; i += 2) { cx += q[i]; cy += q[i + 1]; }
        cx = cx / (q.length / 2) + (rnd() - 0.5) * 0.22; cy = cy / (q.length / 2) + (rnd() - 0.5) * 0.22;
        // the first crack runs straight through the cell from port to port (it goes on in the neighbours),
        // each further one about 60 degrees off the last: wedges and daggers
        let ang = a0 + s * 1.05 + (rnd() - 0.5) * 0.8;
        if (s === 0) { cx = 0.5; cy = PORT_H; ang = 0; }
        const r = splitPoly(q, cx, cy, Math.cos(ang), Math.sin(ang));
        if (!r) continue;
        polys.splice(bi, 1, r[0], r[1]);
        const c = r[2];
        // a crack branches off an older one: it starts at the end that lies deeper inside the cell
        const e0 = Math.min(c[0], 1 - c[0], c[1], 1 - c[1]), e1 = Math.min(c[2], 1 - c[2], c[3], 1 - c[3]);
        lines.push({ pts: (s === 0 ? id & 4 : e0 < e1) ? [c[2], c[3], c[0], c[1]] : c, at: s / steps * 0.62 });
        if (lines.length === 1) { px = (c[0] + c[2]) / 2; py = (c[1] + c[3]) / 2; }
        if (polys.length === 4) wedges = polys.slice();
      }
      if (!wedges) wedges = polys.slice();
      if (px == null) { px = 0.5; py = 0.5; }
    } else {
      // radial break: cracks radiate from an impact point, kink once and reach the cell border
      if (style === 2) {
        const near = 0.13 + rnd() * 0.2, far = 0.22 + rnd() * 0.56, flip = rnd() < 0.5;
        px = rnd() < 0.5 ? near : 1 - near; py = far;
        if (flip) { const t = px; px = py; py = t; }
      } else { px = 0.32 + rnd() * 0.36; py = 0.32 + rnd() * 0.36; }
      const n = 4 + (rnd() * 2 | 0), base = rnd() * TAU, rays = [], angs = [];
      for (let i = 0; i < n; i++) angs.push(base + (i + (rnd() - 0.5) * 0.55) * TAU / n);
      // Two cracks (four in every other pattern) leave the cell through the ports it shares with its
      // neighbours, so a fracture runs on from cell to cell: the ray that points there best is bent to it.
      const ports = id & 4 ? [0, PORT_H, 1, PORT_H, PORT_V, 0, PORT_V, 1] : [0, PORT_H, 1, PORT_H], taken = [];
      for (let k = 0; k < ports.length; k += 2) {
        const want = Math.atan2(ports[k + 1] - py, ports[k] - px);
        let best = -1, bd = 9;
        for (let i = 0; i < n; i++) {
          if (taken.indexOf(i) >= 0) continue;
          const d = Math.abs(Math.atan2(Math.sin(angs[i] - want), Math.cos(angs[i] - want)));
          if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0) { angs[best] = want; taken.push(best); }
      }
      for (let i = 0; i < n; i++) {
        const ang = angs[i];
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const tx = dx > 1e-9 ? (1 - px) / dx : dx < -1e-9 ? -px / dx : 1e9;
        const ty = dy > 1e-9 ? (1 - py) / dy : dy < -1e-9 ? -py / dy : 1e9;
        const t = Math.min(tx, ty);
        const bx = Math.min(1, Math.max(0, px + dx * t)), by = Math.min(1, Math.max(0, py + dy * t));
        // position on the perimeter, clockwise from the top-left corner (0..4)
        const s = tx < ty ? (dx > 0 ? 1 + by : 3 + (1 - by)) : (dy > 0 ? 2 + (1 - bx) : bx);
        const kt = t * (0.36 + rnd() * 0.28), kn = t * (rnd() - 0.5) * 0.26;   // the kink
        rays.push({ kx: px + dx * kt - dy * kn, ky: py + dy * kt + dx * kn, bx: bx, by: by, s: s });
        lines.push({ pts: [px, py, rays[i].kx, rays[i].ky, bx, by], at: i ? rnd() * 0.5 : 0 });
      }
      rays.sort(function (p, q) { return p.s - q.s; });
      polys = []; wedges = [];
      for (let i = 0; i < n; i++) {
        const r = rays[i], q = rays[(i + 1) % n];
        const outer = [r.kx, r.ky, r.bx, r.by];
        const end = q.s > r.s ? q.s : q.s + 4;
        for (let c = Math.floor(r.s) + 1; c < end; c++) outer.push(UNIT_CORNERS[c & 3][0], UNIT_CORNERS[c & 3][1]);
        outer.push(q.bx, q.by, q.kx, q.ky);
        const wedge = outer.concat(px, py);
        wedges.push(wedge);
        if (rnd() < 0.24) {                                       // a concentric crack splits the wedge
          polys.push([px, py, r.kx, r.ky, q.kx, q.ky], outer);
          lines.push({ pts: [r.kx, r.ky, q.kx, q.ky], at: 0.5 + rnd() * 0.12 });
        } else polys.push(wedge);
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const q = lines[i].pts;
      let len = 0;
      for (let j = 2; j < q.length; j += 2) len += Math.hypot(q[j] - q[j - 2], q[j + 1] - q[j - 1]);
      lines[i].len = len || 1e-6;
    }
    return { px: px, py: py, lines: lines, polys: polys, wedges: wedges, radial: style >= 2 };
  }

  // Point and direction at `dist` along a polyline (flat x,y list).
  function alongLine(q, dist) {
    for (let j = 2; j < q.length; j += 2) {
      const dx = q[j] - q[j - 2], dy = q[j + 1] - q[j - 1], sl = Math.hypot(dx, dy) || 1e-6;
      if (dist <= sl || j === q.length - 2) { const k = Math.min(1, dist / sl); return [q[j - 2] + dx * k, q[j - 1] + dy * k, dx / sl, dy / sl]; }
      dist -= sl;
    }
    return [q[0], q[1], 1, 0];
  }

  // Crack overlay of one pattern at growth step `level` (1..CRACK_LEVELS): hairline fractures with
  // short feathers, a milky sheet beside them (one-sided: a fracture plane seen at an angle), a thin
  // refraction shadow and the shards-to-be starting to reflect differently. drawCracks() masks the
  // overlay with the stone itself, so the fractures sit INSIDE the crystal.
  const crackSprites = new Map();

  function crackSprite(seed, level, px) {
    const id = (seed >>> 0) % FRACTURE_PATTERNS, key = (px * FRACTURE_PATTERNS + id) * 8 + level;
    let cv = crackSprites.get(key);
    if (cv) return cv;
    if (crackSprites.size >= 320) crackSprites.clear();
    cv = document.createElement('canvas');
    cv.width = cv.height = px + PAD * 2;
    const g = cv.getContext('2d'), f = fracture(id), grow = level / CRACK_LEVELS, S = px;
    const rnd = mulberry32(hash32(id, 0xFEA7));
    g.translate(PAD, PAD);
    g.lineCap = g.lineJoin = 'round';
    const feathers = [], roots = [];
    for (let i = 0; i < f.lines.length; i++) {                     // same seeded feathers at every level
      const L = f.lines[i], u = Math.min(1, (grow - L.at) / 0.38);
      for (let j = 0, n = 3 + (L.len * 4 | 0); j < n; j++) {
        const fu = 0.08 + rnd() * 0.86, sgn = rnd() < 0.7 ? 1 : -1, ang = sgn * (0.3 + rnd() * 0.55), len = S * (0.035 + rnd() * 0.08), two = rnd() < 0.3;
        if (u < fu + 0.05) continue;
        const p = alongLine(L.pts, fu * L.len), ca = Math.cos(ang), sa = Math.sin(ang);
        const ex = (p[2] * ca - p[3] * sa) * len, ey = (p[2] * sa + p[3] * ca) * len;
        feathers.push(p[0] * S, p[1] * S, ex, ey);
        if (two) feathers.push(p[0] * S + ex * 0.55, p[1] * S + ey * 0.55, (p[2] * 0.9 - ey / len * 0.4) * len * 0.5, (p[3] * 0.9 + ex / len * 0.4) * len * 0.5);
      }
      if (u > 0 && (i === 0 || !f.radial)) roots.push(L.pts[0] * S, L.pts[1] * S);
    }
    const trace = function (group) {                               // group: -1 = all cracks, 0 / 1 = the faint / the bright ones
      g.beginPath();
      for (let i = 0; i < f.lines.length; i++) {
        if (group >= 0 && (hash32(id, i) & 1) !== group) continue;
        const L = f.lines[i], q = L.pts;
        let rest = Math.min(1, (grow - L.at) / 0.38) * L.len;
        if (rest <= 0) continue;
        g.moveTo(q[0] * S, q[1] * S);
        for (let j = 2; j < q.length && rest > 0; j += 2) {
          const sl = Math.hypot(q[j] - q[j - 2], q[j + 1] - q[j - 1]) || 1e-6, k = sl > rest ? rest / sl : 1;
          g.lineTo((q[j - 2] + (q[j] - q[j - 2]) * k) * S, (q[j - 1] + (q[j + 1] - q[j - 1]) * k) * S);
          rest -= sl;
        }
      }
    };
    g.save();
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    const frost = Math.min(1, Math.max(0, (grow - 0.4) / 0.6)), rf = mulberry32(hash32(id, 0xF205));
    for (let i = 0; i < f.polys.length; i++) {                    // the shards-to-be start to reflect differently
      const q = f.polys[i], r = rf(), a = (r - 0.42) * 0.26 * frost;
      if (Math.abs(a) < 0.02) continue;
      g.beginPath();
      g.moveTo(q[0] * S, q[1] * S);
      for (let v = 2; v < q.length; v += 2) g.lineTo(q[v] * S, q[v + 1] * S);
      g.fillStyle = a > 0 ? 'rgba(255,255,255,' + a.toFixed(3) + ')' : 'rgba(4,8,20,' + (-a * 0.9).toFixed(3) + ')';
      g.fill();
    }
    const off = Math.max(0.8, S * 0.03);
    g.translate(off * 1.6, off * 1.2);                             // the milky sheet lies to one side of the crack
    trace(-1);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = Math.max(3, S * 0.2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = Math.max(2, S * 0.09); g.stroke();
    g.translate(-off * 0.9, -off * 0.5);
    g.strokeStyle = 'rgba(4,8,22,0.15)'; g.lineWidth = Math.max(1, S * 0.018); g.stroke();         // refraction shadow (faint: no second line)
    g.translate(-off * 0.7, -off * 0.7);
    g.beginPath();                                                 // feathers
    for (let i = 0; i < feathers.length; i += 4) {
      g.moveTo(feathers[i], feathers[i + 1]);
      g.lineTo(feathers[i] + feathers[i + 2], feathers[i + 1] + feathers[i + 3]);
    }
    g.strokeStyle = 'rgba(255,255,255,0.36)'; g.lineWidth = Math.max(0.5, S * 0.008); g.stroke();
    for (let pass = 0; pass < 2; pass++) {                         // the fractures: hairlines, some catch the light, some hardly
      const a = pass ? 0.96 : 0.6;
      trace(pass);
      g.strokeStyle = 'rgba(255,255,255,' + (a * 0.16).toFixed(3) + ')'; g.lineWidth = Math.max(2, S * 0.04); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,' + a + ')'; g.lineWidth = Math.max(0.9, S * 0.0125); g.stroke();
    }
    for (let i = 0; i < roots.length; i += 2) {                    // a small frosted bruise where a crack starts
      const R = S * (f.radial ? 0.06 + 0.07 * Math.min(1, grow * 1.5) : 0.045);
      const spot = g.createRadialGradient(roots[i], roots[i + 1], 0, roots[i], roots[i + 1], R);
      spot.addColorStop(0, 'rgba(255,255,255,' + (f.radial ? 0.85 : 0.5) + ')'); spot.addColorStop(0.4, 'rgba(255,255,255,0.3)'); spot.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = spot;
      g.fillRect(roots[i] - R, roots[i + 1] - R, R * 2, R * 2);
    }
    g.restore();
    crackSprites.set(key, cv);
    return cv;
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Fused pieces. The cells of one stone (linked by their conn bits) are composed once into a small
   * canvas, and what is bigger than a cell is laid over the whole stone there: one or two cleavage
   * planes that cross it from edge to edge with a bright striated band, long faint fracture hairlines
   * that branch off each other, a clearer and a milkier region. That is what makes a tetromino read as
   * ONE crystal and no two stones alike. The canvases are cached per piece (cells, seeds, conn), so the
   * falling piece and the settled board cost what they did before: one blit per cell at most.
   * ------------------------------------------------------------------------------------------------ */
  const PIECE_B = 2;                                 // transparent border of a piece canvas (device px)
  const pieces = new Map(), pieceOfSeed = new Map();
  let piecePixels = 0, pieceLimit = PIECE_BUDGET, ovCv = null, ovMask = null;

  function spriteOf(c, px) { return getSprite(TYPE_INDEX[c.type] | 0, c.conn & 15, ((c.seed >>> 0) >>> 7) % VARIANTS, px, false); }

  // Where the pixels of a cell come from: its fused piece if that is known (so that shards carry the
  // big planes too), else its own sprite. Returns [canvas, x, y] of the cell's top-left corner.
  function cellSource(c, px) {
    const r = pieceOfSeed.get(c.seed >>> 0);
    if (r && r.e.px === px && r.conn === (c.conn & 15) && r.type === c.type) return [r.e.cv, PIECE_B + r.gx * px, PIECE_B + r.gy * px];
    const P = padOf(px);
    return [spriteOf(c, px), P, P];
  }

  // Groups the cells of a call into pieces. Cells of one piece are neighbours and say so in their conn
  // bits; while rows collapse, the lower partner of a vertical joint may still be on its way (then it
  // is the next cell below in that column). Returns a list of { e: cached piece | null, idx: cell
  // indices, exact, X0, Y0 } with .gx / .gy (grid position of every cell inside its piece).
  function resolvePieces(cells, size, px, dpr) {
    const n = cells.length, X = new Int32Array(n), Y = new Int32Array(n), at = new Map();
    const lE = new Int32Array(n).fill(-1), lW = new Int32Array(n).fill(-1), lS = new Int32Array(n).fill(-1), lN = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      X[i] = Math.round(c.x * dpr); Y[i] = Math.round(c.y * dpr);
      at.set((X[i] + 32768) * 65536 + Y[i] + 32768, i);
    }
    for (let i = 0; i < n; i++) {
      const c = cells[i], conn = c.conn & 15;
      if (conn & 2) {
        const j = at.get((Math.round((c.x + size) * dpr) + 32768) * 65536 + Y[i] + 32768);
        if (j !== undefined && j !== i && (cells[j].conn & 8) && cells[j].type === c.type) { lE[i] = j; lW[j] = i; }
      }
      if (conn & 4) {
        let j = at.get((X[i] + 32768) * 65536 + Math.round((c.y + size) * dpr) + 32768);
        if (j === undefined) {
          let by = Y[i] + px * 5.5;
          j = -1;
          for (let q = 0; q < n; q++) if (X[q] === X[i] && Y[q] > Y[i] && Y[q] < by) { by = Y[q]; j = q; }
        }
        if (j >= 0 && j !== i && (cells[j].conn & 1) && cells[j].type === c.type && lN[j] < 0) { lS[i] = j; lN[j] = i; }
      }
    }
    const seen = new Uint8Array(n), gx = new Int16Array(n), gy = new Int16Array(n), out = [], stack = [];
    const byGrid = function (p, q) { return (gy[p] - gy[q]) || (gx[p] - gx[q]); };
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      const idx = [];
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
      seen[i] = 1; gx[i] = 0; gy[i] = 0; stack.push(i);
      while (stack.length) {
        const a = stack.pop();
        idx.push(a);
        if (gx[a] < x0) x0 = gx[a]; if (gx[a] > x1) x1 = gx[a]; if (gy[a] < y0) y0 = gy[a]; if (gy[a] > y1) y1 = gy[a];
        let b = lE[a]; if (b >= 0 && !seen[b]) { seen[b] = 1; gx[b] = gx[a] + 1; gy[b] = gy[a]; stack.push(b); }
        b = lW[a]; if (b >= 0 && !seen[b]) { seen[b] = 1; gx[b] = gx[a] - 1; gy[b] = gy[a]; stack.push(b); }
        b = lS[a]; if (b >= 0 && !seen[b]) { seen[b] = 1; gx[b] = gx[a]; gy[b] = gy[a] + 1; stack.push(b); }
        b = lN[a]; if (b >= 0 && !seen[b]) { seen[b] = 1; gx[b] = gx[a]; gy[b] = gy[a] - 1; stack.push(b); }
      }
      const nx = x1 - x0 + 1, ny = y1 - y0 + 1, m = idx.length;
      let e = null, exact = false, X0 = 0, Y0 = 0;
      if (nx <= 5 && ny <= 5 && m <= 9 && (nx * px + 4) * (ny * px + 4) <= 1.5e6) {
        if (m > 1) idx.sort(byGrid);
        let h = px | 0, sum = 0;
        for (let j = 0; j < m; j++) {
          const a = idx[j], c = cells[a];
          gx[a] -= x0; gy[a] -= y0;
          h = Math.imul(h ^ (gx[a] + gy[a] * 8 + 1), 0x9E3779B1);
          h = Math.imul(h ^ (c.seed >>> 0) ^ ((c.conn & 15) << 4) ^ (TYPE_INDEX[c.type] | 0), 0xC2B2AE35); h ^= h >>> 15;
          sum = (sum + (c.seed >>> 0)) | 0;
        }
        h = ((h ^ m) >>> 0) || 1;
        e = pieces.get(h);
        if (e && (e.px !== px || e.n !== m || e.nx !== nx || e.ny !== ny)) e = null;
        if (!e) {
          e = bakePiece(cells, idx, gx, gy, nx, ny, px, sum);
          pieces.set(h, e);
          piecePixels += e.cost;
          if (piecePixels > pieceLimit) { piecePixels = sweep(pieces); pieceLimit = Math.max(PIECE_BUDGET, piecePixels * 1.3); if (pieceOfSeed.size > 3000) pieceOfSeed.clear(); }
        }
        touch(e);
        X0 = X[idx[0]] - gx[idx[0]] * px; Y0 = Y[idx[0]] - gy[idx[0]] * px;
        exact = true;
        for (let j = 0; j < m; j++) {
          const a = idx[j], c = cells[a], sd = c.seed >>> 0, r = pieceOfSeed.get(sd);
          if (X[a] !== X0 + gx[a] * px || Y[a] !== Y0 + gy[a] * px) exact = false;
          if (!r || r.e !== e || r.gx !== gx[a] || r.gy !== gy[a] || r.conn !== (c.conn & 15)) pieceOfSeed.set(sd, { e: e, gx: gx[a], gy: gy[a], conn: c.conn & 15, type: c.type });
        }
      }
      out.push({ e: e, idx: idx, exact: exact, X0: X0, Y0: Y0 });
    }
    out.gx = gx; out.gy = gy; out.X = X; out.Y = Y;
    return out;
  }

  function bakePiece(cells, idx, gx, gy, nx, ny, px, seed) {
    const B = PIECE_B, w = nx * px + B * 2, h = ny * px + B * 2, P = padOf(px);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    for (let i = 0; i < idx.length; i++) {
      const a = idx[i];
      g.drawImage(spriteOf(cells[a], px), P, P, px, px, B + gx[a] * px, B + gy[a] * px, px, px);
    }
    overlayPiece(g, cv, w, h, px, cells, idx, gx, gy, seed);
    return { cv: cv, px: px, n: idx.length, nx: nx, ny: ny, cost: w * h, ep: -1, used: useClock };
  }

  // What is bigger than a cell. Light things (planes, striations, hairlines, milk) are drawn into a
  // scratch layer, masked with the stone and laid over it - they make the stone denser and brighter;
  // the clear region is taken out of the stone's alpha - you look through it, so it goes dark.
  function overlayPiece(g, cv, w, h, S, cells, idx, gx, gy, seed) {
    const n = idx.length, B = PIECE_B, vc = PALS[TYPE_INDEX[cells[idx[0]].type] | 0].rgb.veil;
    const rnd = mulberry32(hash32(seed, 0x9A7E11));
    const det = S < 44 ? 0.45 + 0.55 * S / 44 : 1, diag = Math.hypot(w, h), fine = S >= 24;
    const veil = function (a) { return 'rgba(' + vc[0] + ',' + vc[1] + ',' + vc[2] + ',' + a.toFixed(3) + ')'; };
    const white = function (a) { return 'rgba(255,255,255,' + a.toFixed(3) + ')'; };
    const clear = function (a) { return 'rgba(0,0,0,' + a.toFixed(3) + ')'; };
    const pick = function (lo) {
      const a = idx[rnd() * n | 0], span = 1 - lo * 2;
      return [B + (gx[a] + lo + rnd() * span) * S, B + (gy[a] + lo + rnd() * span) * S];
    };
    ovMask = growCanvas(ovMask, w, h); ovCv = growCanvas(ovCv, w, h);
    const mg = ovMask.getContext('2d'), o = ovCv.getContext('2d');
    mg.globalCompositeOperation = 'source-over';
    mg.clearRect(0, 0, ovMask.width, ovMask.height);
    for (let i = 0; i < 4; i++) mg.drawImage(cv, 0, 0);            // the stone as a mask (thin smoke still counts)
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
    o.clearRect(0, 0, ovCv.width, ovCv.height);
    o.lineCap = 'butt';
    const dash = typeof o.setLineDash === 'function';

    // a clearer region and a milkier one
    let q = pick(0.3), R = S * (0.7 + rnd() * 0.6) * (n > 1 ? 1 : 0.7);
    let grd = g.createRadialGradient(q[0], q[1], 0, q[0], q[1], R);
    grd.addColorStop(0, clear(0.2 * det)); grd.addColorStop(1, clear(0));
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = grd; g.fillRect(q[0] - R, q[1] - R, R * 2, R * 2);
    q = pick(0.2); R = S * (0.5 + rnd() * 0.55);
    grd = o.createRadialGradient(q[0], q[1], 0, q[0], q[1], R);
    grd.addColorStop(0, veil(0.13 * det)); grd.addColorStop(1, veil(0));
    o.fillStyle = grd; o.fillRect(q[0] - R, q[1] - R, R * 2, R * 2);

    // cleavage planes across the whole stone: the two directions of the crystal (-36 and 54 degrees)
    const nPl = n >= 3 ? (rnd() < 0.6 ? 2 : 1) : n === 2 ? 1 : rnd() < 0.5 ? 1 : 0;
    let fam = rnd() < 0.62 ? 0 : 1, p0 = null, a0 = 0;
    for (let i = 0; i < nPl; i++) {
      const p = pick(0.2), ang = (fam ? 0.942 : -0.628) + (rnd() - 0.5) * 0.21, sd = rnd() < 0.5 ? 1 : -1;
      const wd = S * (0.5 + rnd() * 0.4) * (i ? 0.55 : 1), al = (i ? 0.17 : 0.27) * det;
      if (!i) { p0 = p; a0 = ang; }
      // behind the plane the stone is clear
      g.save();
      g.translate(p[0], p[1]); g.rotate(ang); g.scale(1, -sd);
      grd = g.createLinearGradient(0, 0, 0, S * 0.45);
      grd.addColorStop(0, clear((i ? 0.1 : 0.17) * det)); grd.addColorStop(1, clear(0));
      g.fillStyle = grd; g.fillRect(-diag, 0, diag * 2, S * 0.45);
      g.restore();
      // the bright band beside it, striated parallel to the plane
      o.save();
      o.translate(p[0], p[1]); o.rotate(ang); o.scale(1, sd);
      grd = o.createLinearGradient(0, 0, 0, wd);
      grd.addColorStop(0, veil(al)); grd.addColorStop(0.3, veil(al * 0.5)); grd.addColorStop(1, veil(0));
      o.fillStyle = grd; o.fillRect(-diag, 0, diag * 2, wd);
      o.lineWidth = 1;
      for (let j = fine ? 6 + (rnd() * 5 | 0) : 0; j > 0; j--) {
        const y = wd * (0.04 + 0.9 * rnd() * rnd());
        if (dash) { o.setLineDash([S * (0.25 + rnd() * 0.9), S * (0.08 + rnd() * 0.5)]); o.lineDashOffset = rnd() * S * 2; }
        o.strokeStyle = white((0.05 + rnd() * 0.07) * det * (i ? 0.7 : 1));
        o.beginPath(); o.moveTo(-diag, y); o.lineTo(diag, y); o.stroke();
      }
      if (dash) { o.setLineDash([S * (0.45 + rnd()), S * (0.05 + rnd() * 0.12), S * (0.15 + rnd() * 0.5), S * (0.03 + rnd() * 0.08)]); o.lineDashOffset = rnd() * S * 2; }
      o.strokeStyle = white((i ? 0.34 : 0.5) * (0.6 + 0.4 * det));
      o.beginPath(); o.moveTo(-diag, 0); o.lineTo(diag, 0); o.stroke();
      if (dash) o.setLineDash([]);
      o.restore();
      if (rnd() < 0.7) fam = 1 - fam;
    }
    g.globalCompositeOperation = 'source-over';

    // fracture hairlines: long, faint, of changing brightness; each starts on the plane or on an older one
    const nodes = [];
    for (let i = 0, nH = !fine ? 0 : n >= 3 ? 2 + (rnd() < 0.5 ? 1 : 0) : n; i < nH; i++) {
      let x, y, ang;
      if (i === 0 && p0) {
        const t = (rnd() - 0.5) * S * 1.2;
        x = p0[0] + Math.cos(a0) * t; y = p0[1] + Math.sin(a0) * t; ang = a0 + (rnd() < 0.5 ? 1 : -1) * (1.0 + rnd() * 0.9);
      } else if (nodes.length) {
        const j = (rnd() * (nodes.length / 3) | 0) * 3;
        x = nodes[j]; y = nodes[j + 1]; ang = nodes[j + 2] + (rnd() < 0.5 ? 1 : -1) * (0.7 + rnd() * 0.9);
      } else { const p = pick(0.2); x = p[0]; y = p[1]; ang = rnd() * TAU; }
      for (let j = 0; j < 6; j++) {
        const len = S * (0.28 + rnd() * 0.45), ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len, al = (0.08 + 0.3 * rnd() * rnd()) * det;
        o.beginPath(); o.moveTo(x, y); o.lineTo(ex, ey);
        o.strokeStyle = veil(al * 0.18); o.lineWidth = Math.max(2, S * 0.07); o.stroke();
        o.strokeStyle = white(al); o.lineWidth = 1; o.stroke();
        x = ex; y = ey; ang += (rnd() - 0.5) * 0.6;
        nodes.push(x, y, ang);
        if (x < 0 || x > w || y < 0 || y > h) break;
      }
    }
    o.globalCompositeOperation = 'destination-in';
    o.drawImage(ovMask, 0, 0);
    o.globalCompositeOperation = 'source-over';
    g.drawImage(ovCv, 0, 0, w, h, 0, 0, w, h);
  }

  // Paints a group of cells: all contact shadows first (they never darken a neighbour's edge light),
  // then the stones, piece by piece. k: device px -> units of g, (ox, oy): origin in device px.
  function paintCells(g, cells, size, px, dpr, k, ox, oy) {
    const P = padOf(px), res = resolvePieces(cells, size, px, dpr), gx = res.gx, gy = res.gy, X = res.X, Y = res.Y;
    for (let i = 0; i < cells.length; i++) blit(g, spriteOf(cells[i], px).shadow, cells[i], size, dpr, P, k, ox, oy);
    for (let j = 0; j < res.length; j++) {
      const G = res[j], e = G.e, idx = G.idx;
      if (!e) {
        for (let i = 0; i < idx.length; i++) blit(g, spriteOf(cells[idx[i]], px), cells[idx[i]], size, dpr, P, k, ox, oy);
      } else if (G.exact) {
        const w = e.nx * px, h = e.ny * px;
        g.drawImage(e.cv, PIECE_B, PIECE_B, w, h, (G.X0 - ox) * k, (G.Y0 - oy) * k, w * k, h * k);
      } else {
        for (let i = 0; i < idx.length; i++) {                     // cell by cell, cropped to the device-pixel rectangle on open edges
          const a = idx[i], c = cells[a], conn = c.conn & 15;
          const w = conn & 2 ? Math.min(px + 1, Math.round((c.x + size) * dpr) - X[a]) : px;
          const h = conn & 4 ? Math.min(px + 1, Math.round((c.y + size) * dpr) - Y[a]) : px;
          if (w > 0 && h > 0) g.drawImage(e.cv, PIECE_B + gx[a] * px, PIECE_B + gy[a] * px, w, h, (X[a] - ox) * k, (Y[a] - oy) * k, w * k, h * k);
        }
      }
    }
  }

  /* ------------------------------------------------------------------------------------------------ *
   * drawCells
   * ------------------------------------------------------------------------------------------------ */
  // Big groups that hold still (the settled board) are flattened into one layer canvas, so a static
  // board costs a single blit per frame instead of one per cell. Cracks and glints stay per frame.
  // Translucent groups are flattened too (into a scratch layer): their contact shadows overlap.
  const LAYER_MIN_CELLS = 24, MAX_LAYERS = 2, MAX_LAYER_PIXELS = 6e6;
  const layers = [], seenSigs = [0, 0, 0, 0];
  let seenAt = 0, layerClock = 0, scratch = null, lastDpr = 0, fieldBottom = -Infinity, fieldSize = 0;

  // Returns { cv, x, y, w, h } (device px) holding the whole group, or null if it should be drawn directly.
  function groupLayer(cells, size, px, dpr, cacheable, mustFlatten) {
    let h = px | 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < cells.length; i++) {           // signature of everything that affects the pixels
      const c = cells[i], X = Math.round(c.x * dpr), Y = Math.round(c.y * dpr);
      h = Math.imul(h ^ X, 0x9E3779B1); h = Math.imul(h ^ Y, 0x85EBCA6B);
      h = Math.imul(h ^ (c.seed >>> 0) ^ ((c.conn & 15) << 4) ^ (TYPE_INDEX[c.type] | 0), 0xC2B2AE35);
      h ^= h >>> 15;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    h = ((h ^ cells.length) >>> 0) || 1;
    const P = padOf(px), w = x1 - x0 + px + P * 2, hh = y1 - y0 + px + P * 2;
    if (!(w > 0 && hh > 0) || w > 4096 || hh > 4096 || w * hh > MAX_LAYER_PIXELS) return null;
    let L = null;
    if (cacheable) {
      layerClock++;
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].sig === h && layers[i].px === px) { layers[i].used = layerClock; return layers[i]; }
      }
      // First sighting: only cache once the group shows up unchanged again.
      if (seenSigs.indexOf(h) < 0) seenSigs[seenAt++ & 3] = h;
      else if (layers.length < MAX_LAYERS) { L = { cv: document.createElement('canvas'), used: 0 }; layers.push(L); }
      else {
        L = layers[0];
        for (let i = 1; i < layers.length; i++) if (layers[i].used < L.used) L = layers[i];
        if (layerClock - L.used <= MAX_LAYERS * 2) L = null;     // every slot is in active use: do not thrash
      }
    }
    if (L) { L.sig = h; L.px = px; L.used = layerClock; }
    else if (mustFlatten) L = scratch || (scratch = { cv: document.createElement('canvas') });
    else return null;
    if (L === scratch) {                                         // scratch only ever grows
      if (L.cv.width < w) L.cv.width = w;
      if (L.cv.height < hh) L.cv.height = hh;
    } else if (L.cv.width !== w || L.cv.height !== hh) { L.cv.width = w; L.cv.height = hh; }
    const g = L.cv.getContext('2d');
    g.clearRect(0, 0, w, hh);
    if (cacheable) { boardEpoch++; onBoard = true; }             // what the settled board shows stays cached
    paintCells(g, cells, size, px, dpr, 1, x0 - P, y0 - P);
    onBoard = false;
    L.x = x0 - P; L.y = y0 - P; L.w = w; L.h = hh;
    return L;
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Landing preview: light resting where the piece will land. A steady pool of light in the shape of
   * the piece - soft inside, gently brighter towards its rim, a wide soft halo outside. It is white
   * light, a touch warmer on one side and cooler on the other; no colours, no line. Nothing moves,
   * nothing pulses: the picture only changes when the piece does.
   * ------------------------------------------------------------------------------------------------ */
  const LIGHT_WARM = [255, 243, 222], LIGHT_COOL = [222, 235, 255];
  const GLOW_ALPHA = 0.5;                                         // overall strength of the resting light
  let glowCv = null, glowSig = 0;

  function drawGlow(ctx, cells, size, px, dpr, alpha) {
    const inv = 1 / dpr, P = ghostPad(px);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sig = px | 0;
    for (let i = 0; i < cells.length; i++) {
      const X = Math.round(cells[i].x * dpr), Y = Math.round(cells[i].y * dpr);
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    const w = x1 - x0 + px + P * 2, h = y1 - y0 + px + P * 2;
    if (!(w > 0 && h > 0) || w * h > 4e6) return;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      sig = Math.imul(sig ^ (Math.round(c.x * dpr) - x0), 0x9E3779B1); sig = Math.imul(sig ^ (Math.round(c.y * dpr) - y0), 0x85EBCA6B);
      sig = Math.imul(sig ^ (c.conn & 15) ^ (c.type === 'O' ? 16 : 0), 0xC2B2AE35); sig ^= sig >>> 15;
    }
    sig = ((sig ^ cells.length) >>> 0) || 1;
    if (!glowCv || glowSig !== sig || glowCv.width < w || glowCv.height < h) {
      glowCv = growCanvas(glowCv, w, h);
      glowSig = sig;
      const g = glowCv.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, glowCv.width, glowCv.height);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        blit(g, getSprite(c.type === 'O' ? O_INDEX : 0, c.conn & 15, 0, px, true), c, size, dpr, P, 1, x0 - P, y0 - P);
      }
      // white light, warm on one side and cool on the other (anchored to the piece, so it never travels)
      g.globalCompositeOperation = 'source-in';
      const grd = g.createLinearGradient(P, P, w - P, h - P);
      grd.addColorStop(0, 'rgb(' + LIGHT_WARM.join(',') + ')');
      grd.addColorStop(0.5, 'rgb(255,255,255)');
      grd.addColorStop(1, 'rgb(' + LIGHT_COOL.join(',') + ')');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * GLOW_ALPHA;
    ctx.drawImage(glowCv, 0, 0, w, h, (x0 - P) * inv, (y0 - P) * inv, w * inv, h * inv);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Light from above: a soft white shaft falls onto the falling crystal and leaves it as a short, faint
   * pale glow (warm on one side, cool on the other). Steady - it only moves with the piece.
   * cells: the falling piece. opts: { t, top (y where the shaft starts), maxLen (free space below), alpha }
   * ------------------------------------------------------------------------------------------------ */
  function drawLight(ctx, cells, opts) {
    if (!ctx || !cells || !cells.length) return;
    opts = opts || {};
    const size = +cells[0].size;
    if (!(size > 0)) return;
    const top = +opts.top || 0;
    const alpha = opts.alpha == null ? 1 : Math.max(0, Math.min(1, +opts.alpha));
    const cols = new Map();
    let xa = Infinity, xb = -Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], key = Math.round(c.x * 4), e = cols.get(key);
      if (!e) cols.set(key, { x: c.x, y0: c.y, y1: c.y + size });
      else { if (c.y < e.y0) e.y0 = c.y; if (c.y + size > e.y1) e.y1 = c.y + size; }
      if (c.x < xa) xa = c.x; if (c.x + size > xb) xb = c.x + size;
    }
    const width = xb - xa;
    if (!(width > 0)) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // White light arriving from above: one vertical gradient shared by all columns (no seams), faint
    // high up and a little stronger right above the crystal. Three nested passes soften the sides.
    let low = -Infinity;
    cols.forEach(function (e) { if (e.y0 > low) low = e.y0; });
    if (low - top > 2) {
      const fall = ctx.createLinearGradient(0, top, 0, low);
      fall.addColorStop(0, 'rgba(255,255,255,0.012)');
      fall.addColorStop(1, 'rgba(255,255,255,0.052)');
      ctx.fillStyle = fall;
      ctx.globalAlpha = alpha;
      for (let pass = 0; pass < 3; pass++) {
        const inset = pass * size * 0.16, l = xa + inset, r = xb - inset;
        cols.forEach(function (e) {
          const x0 = Math.max(e.x, l), x1 = Math.min(e.x + size, r);
          if (x1 > x0 && e.y0 > top) ctx.fillRect(x0, top, x1 - x0, e.y0 - top + size * 0.1);
        });
      }
    }

    // The light leaves the crystal as a short pale glow that fades out quickly (one gradient per column).
    const out = Math.min(size * 1.6, +opts.maxLen || 0);
    if (out > size * 0.15) {
      ctx.globalAlpha = 1;
      cols.forEach(function (e) {
        const f = Math.max(0, Math.min(1, (e.x + size / 2 - xa) / width));
        const rgb = Math.round(LIGHT_WARM[0] + (LIGHT_COOL[0] - LIGHT_WARM[0]) * f) + ',' + Math.round(LIGHT_WARM[1] + (LIGHT_COOL[1] - LIGHT_WARM[1]) * f) + ',' + Math.round(LIGHT_WARM[2] + (LIGHT_COOL[2] - LIGHT_WARM[2]) * f);
        const glow = ctx.createLinearGradient(0, e.y1, 0, e.y1 + out);
        glow.addColorStop(0, 'rgba(' + rgb + ',' + (0.06 * alpha).toFixed(3) + ')');
        glow.addColorStop(0.45, 'rgba(' + rgb + ',' + (0.02 * alpha).toFixed(3) + ')');
        glow.addColorStop(1, 'rgba(' + rgb + ',0)');
        ctx.fillStyle = glow;
        ctx.fillRect(e.x, e.y1 - size * 0.04, size, out + size * 0.04);
      });
    }
    ctx.restore();
  }

  function drawCells(ctx, cells, opts) {
    if (!ctx || !cells || !cells.length) return;
    opts = opts || {};
    const size = +cells[0].size;
    if (!(size > 0)) return;
    const dpr = opts.dpr > 0 ? opts.dpr : 1, inv = 1 / dpr;
    const ghost = !!opts.ghost, t = +opts.t || 0;
    const alpha = opts.alpha == null ? 1 : Math.max(0, Math.min(1, +opts.alpha));
    const px = Math.max(4, Math.min(512, Math.round(size * dpr)));
    let cracked = null, glints = null;
    lastDpr = dpr;
    useClock++;

    if (ghost) {                                   // landing preview: resting light, see drawGlow
      const ga = alpha * ctx.globalAlpha;
      ctx.save();
      drawGlow(ctx, cells, size, px, dpr, ga);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha *= alpha;
    const ga = ctx.globalAlpha;
    const big = cells.length >= LAYER_MIN_CELLS, sheer = alpha < 1 && cells.length > 1;
    if (big && fieldSize !== size) { fieldSize = size; fieldBottom = -Infinity; }
    if (size === fieldSize) {                      // remember where the field ends (shards fall out of it)
      for (let i = 0; i < cells.length; i++) if (cells[i].y + size > fieldBottom) fieldBottom = cells[i].y + size;
    }
    const layer = big || sheer ? groupLayer(cells, size, px, dpr, big, sheer) : null;
    if (layer) ctx.drawImage(layer.cv, 0, 0, layer.w, layer.h, layer.x * inv, layer.y * inv, layer.w * inv, layer.h * inv);
    else {
      if (big) { boardEpoch++; onBoard = true; }
      paintCells(ctx, cells, size, px, dpr, inv, 0, 0);          // snapped to device pixels
      onBoard = false;
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], conn = c.conn & 15, seed = c.seed >>> 0;
      if (c.crack > 0) (cracked || (cracked = [])).push(c);
      // Idle glints: now and then a point on a lit edge flares up for a moment. Rare, soft, and out of
      // phase between cells (seed).
      if (conn & 1 && conn & 8) continue;
      const period = 4200 + seed % 3100, tt = t + (seed >>> 3) % period, ph = (tt % period) / 560;
      if (ph < 1) {
        const pick = hash32(seed, Math.floor(tt / period)), r = ((pick >>> 8) & 255) / 255;
        if (pick % 3) continue;
        const top = !(conn & 1) && (conn & 8 || pick & 16);
        (glints || (glints = [])).push(c.x + size * (top ? 0.14 + r * 0.72 : 0.05), c.y + size * (top ? 0.05 : 0.14 + r * 0.72), Math.sin(ph * Math.PI) * (0.5 + 0.3 * r));
      }
    }
    if (cracked) drawCracks(ctx, cracked, size, px, dpr, ga);
    if (glints) {
      const sp = glintSprite(), R = size * 0.3;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < glints.length; i += 3) {
        ctx.globalAlpha = ga * glints[i + 2];
        ctx.drawImage(sp, glints[i] - R, glints[i + 1] - R, R * 2, R * 2);
      }
    }
    ctx.restore();
  }

  // Fracture overlay for cells with crack > 0. The stones turn slightly milky, and baked crack patterns
  // grow step by step; the fracture sweeps outwards from the middle of the cracking group. The overlay
  // is composed off-screen and masked with the stones themselves (one cached mask per group), so the
  // cracks stay inside the crystal.
  let crackCv = null, crackMask = null, crackSig = 0;

  function drawCracks(ctx, list, size, px, dpr, ga) {
    const inv = 1 / dpr, n = list.length, P = padOf(px);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, minX = Infinity, maxX = -Infinity, sig = px | 0;
    for (let i = 0; i < n; i++) {
      const c = list[i], X = Math.round(c.x * dpr), Y = Math.round(c.y * dpr);
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
      if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
      sig = Math.imul(sig ^ X, 0x9E3779B1); sig = Math.imul(sig ^ Y, 0x85EBCA6B);
      sig = Math.imul(sig ^ (c.seed >>> 0) ^ ((c.conn & 15) << 4) ^ (TYPE_INDEX[c.type] | 0), 0xC2B2AE35); sig ^= sig >>> 15;
    }
    sig = ((sig ^ n) >>> 0) || 1;
    const w = x1 - x0 + px + 2, h = y1 - y0 + px + 2;
    if (!(w > 0 && h > 0) || w * h > 4e6) return;
    const midX = (minX + maxX) / 2, half = Math.max(size, (maxX - minX) / 2);
    if (!crackMask || crackSig !== sig || crackMask.width < w || crackMask.height < h) {   // the stones as a mask
      crackMask = growCanvas(crackMask, w, h);
      crackSig = sig;
      const mg = crackMask.getContext('2d');
      mg.clearRect(0, 0, crackMask.width, crackMask.height);
      for (let i = 0; i < n; i++) {
        const c = list[i];
        blit(mg, spriteOf(c, px), c, size, dpr, P, 1, x0, y0);
      }
      mg.drawImage(crackMask, 0, 0); mg.drawImage(crackMask, 0, 0);     // thin smoke still carries a crack
    }
    crackCv = growCanvas(crackCv, w, h);
    const cg = crackCv.getContext('2d');
    cg.globalCompositeOperation = 'source-over';
    cg.clearRect(0, 0, w, h);
    let kSum = 0;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      // per-cell progress 0..1; cells further from the middle lag behind
      const k = Math.max(0.04, Math.min(1, Math.min(1, c.crack) * 1.6 - 0.6 * Math.abs(c.x - midX) / half));
      kSum += k;
      cg.drawImage(crackSprite(c.seed >>> 0, Math.max(1, Math.ceil(k * CRACK_LEVELS)), px), Math.round(c.x * dpr) - x0 - PAD, Math.round(c.y * dpr) - y0 - PAD);
    }
    cg.globalCompositeOperation = 'destination-in';
    cg.drawImage(crackMask, 0, 0, w, h, 0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';                    // the strained stone turns a little milky
    ctx.globalAlpha = ga * 0.1 * kSum / n;
    ctx.drawImage(crackMask, 0, 0, w, h, x0 * inv, y0 * inv, w * inv, h * inv);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = ga;
    ctx.drawImage(crackCv, 0, 0, w, h, x0 * inv, y0 * inv, w * inv, h * inv);
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Effects: shatter and lock sparkle.
   * The stone breaks like glass: every shard is cut out of the block's own sprite (one atlas canvas per
   * burst: sprite pieces, masked by the fracture polygons) and drawn per frame with setTransform +
   * drawImage - it starts exactly where it sat in the stone, then spins and tumbles (x scale flips
   * around a seeded axis, y scale tilts) and FALLS: a small push away from the break, then gravity,
   * until it has dropped out of the bottom of the field. Nothing shrinks or fades in mid-air. The
   * bigger shards carry a hairline of light on the cut that faces the light; a shard whose face passes
   * the mirror angle flashes white for a moment. Around them: fine splinters (glittering needles) and
   * grit, and one short soft flash of light at the heart of the break.
   * ------------------------------------------------------------------------------------------------ */
  const GRAVITY = 0.00006;       // cell sizes per ms^2
  const SHARD_LIFE = 1100;       // ms: by then a shard has left the field (or fades out)
  const SPIN_BUDGET = 32;        // cell areas of shards that may spin in the picture plane per burst (the rest only tumbles)

  let touchCv = null;

  function createFx() {
    let shards = [], bits = [], glints = [], flashes = [];

    function shatter(cells, o) {
      if (!cells || !cells.length) return;
      const rows = Math.max(1, Math.min(4, (o && o.rows) | 0 || 1));
      const power = 0.8 + 0.2 * rows;                             // more rows: a bigger event
      // The shard budget per burst is roughly constant: one row breaks into fine shards, four rows use
      // the coarser tiling of each cell.
      const fine = rows === 1;
      const dpr = o && o.dpr > 0 ? o.dpr : lastDpr > 0 ? lastDpr : (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const rowY = new Map();
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (!(c.size > 0)) continue;
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x + c.size);
        minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y + c.size);
        const key = Math.round(c.y), r = rowY.get(key);
        if (r) { r.x0 = Math.min(r.x0, c.x); r.x1 = Math.max(r.x1, c.x + c.size); }
        else rowY.set(key, { x0: c.x, x1: c.x + c.size, y: c.y, h: c.size });
      }
      if (!(maxX > minX)) return;
      const midX = (minX + maxX) / 2, half = Math.max(1, (maxX - minX) / 2), midY = (minY + maxY) / 2, halfY = Math.max(1, (maxY - minY) / 2);
      const cs = (maxY - minY) / Math.max(1, rowY.size);          // cell size
      flashes.push({ x: midX, y: midY, R: cs * (2.2 + 0.3 * rows), life: 90, max: 90 });
      // where the field ends: shards fall out of it there
      const bottom = Math.max(maxY, fieldBottom > maxY && fieldBottom < maxY + cs * 30 ? fieldBottom : maxY);

      const fresh = [];
      let total = 0, cellPx = 1;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i], s = c.size;
        if (!(s > 0)) continue;
        const seed = c.seed >>> 0, f = fracture(seed), rnd = mulberry32(seed ^ 0x51F15E), ti = TYPE_INDEX[c.type] | 0;
        const px = Math.max(4, Math.min(512, Math.round(s * dpr))), P = padOf(px);
        const src = cellSource(c, px);
        const cx0 = Math.round(c.x * dpr), cy0 = Math.round(c.y * dpr);
        const side = (c.x + s / 2 - midX) / half;                 // -1..1 across the cleared rows
        // A single row can afford finer debris: every shard with 4+ corners breaks once more, along
        // its shortest diagonal so the halves stay chunky.
        let polys = rows === 4 ? f.wedges : f.polys;
        if (fine) {
          polys = [];
          for (let j = 0; j < f.polys.length; j++) {
            const q = f.polys[j], n = q.length >> 1, m = n >> 1;
            if (n < 4) { polys.push(q); continue; }
            let best = 0, bd = Infinity;
            for (let v = 0; v < n; v++) {
              const u = (v + m) % n, d = Math.hypot(q[v * 2] - q[u * 2], q[v * 2 + 1] - q[u * 2 + 1]);
              if (d < bd) { bd = d; best = v; }
            }
            const r = q.slice(best * 2).concat(q.slice(0, best * 2));      // rotate so the cut starts at 0
            polys.push(r.slice(0, m * 2 + 2), r.slice(m * 2).concat(r[0], r[1]));
          }
        }
        for (let j = 0; j < polys.length; j++) {
          const poly = polys[j], n = poly.length >> 1;
          let cx = 0, cy = 0, bx0 = 1, by0 = 1, bx1 = 0, by1 = 0;
          for (let v = 0; v < n; v++) {
            const qx = poly[v * 2], qy = poly[v * 2 + 1];
            cx += qx; cy += qy;
            if (qx < bx0) bx0 = qx; if (qx > bx1) bx1 = qx; if (qy < by0) by0 = qy; if (qy > by1) by1 = qy;
          }
          cx /= n; cy /= n;
          let rad = 0;
          for (let v = 0; v < n; v++) rad = Math.max(rad, Math.hypot(poly[v * 2] - cx, poly[v * 2 + 1] - cy));
          // slot in the atlas: the shard's bounding box in sprite pixels, one pixel of air around it
          const sx = Math.floor(bx0 * px) - 1, sy = Math.floor(by0 * px) - 1;
          const aw = Math.min(px + 1, Math.ceil(bx1 * px) + 1) - sx, ah = Math.min(px + 1, Math.ceil(by1 * px) + 1) - sy;
          total += aw * ah; cellPx = px;
          // motion: a sharp impulse away from the impact point and from the break line, a small hop,
          // then gravity; big shards are slower, turn slower and feel less air
          let dx = cx - f.px, dy = cy - f.py;
          const dl = Math.hypot(dx, dy) || 1, big = Math.min(1, rad * 1.7);
          dx /= dl; dy /= dl;
          const up = (c.y + cy * s - midY) / halfY;               // -1..1 across the cleared block
          const v0 = s * (0.003 + rnd() * 0.006) * power / (0.6 + 1.1 * big);
          const axis = rnd() * TAU, life = SHARD_LIFE;
          const loc = new Float32Array(n * 2);                     // polygon around the pivot (atlas pixels)
          let skip = 0;                                            // edges on the stone's own outline are no break faces
          for (let v = 0; v < n; v++) {
            const qx = poly[v * 2], qy = poly[v * 2 + 1], w = (v + 1) % n, rx = poly[w * 2], ry = poly[w * 2 + 1];
            loc[v * 2] = (qx - cx) * px; loc[v * 2 + 1] = (qy - cy) * px;
            if ((qy < 0.001 && ry < 0.001 && !(c.conn & 1)) || (qx > 0.999 && rx > 0.999 && !(c.conn & 2)) ||
                (qy > 0.999 && ry > 0.999 && !(c.conn & 4)) || (qx < 0.001 && rx < 0.001 && !(c.conn & 8))) skip |= 1 << v;
          }
          fresh.push({
            sp: src[0], ox: src[1], oy: src[2], sx: sx, sy: sy, poly: poly, px: px, bottom: bottom, sm: false,
            ax: 0, ay: 0, aw: aw, ah: ah, pvx: cx * px - sx, pvy: cy * px - sy, sc: 1 / dpr, s: s, big: big,
            x: (cx0 + cx * px) / dpr, y: (cy0 + cy * px) / dpr,
            vx: dx * v0 + side * s * 0.0026 * power * rnd(),
            vy: dy * v0 * 0.7 + up * s * 0.002 * power * rnd() - s * (0.001 + rnd() * 0.005) * (0.85 + 0.07 * rows) / (0.75 + 0.5 * big),
            a: axis, c0: Math.cos(axis), s0: Math.sin(axis), va: (rnd() - 0.5) * 0.014 / (0.5 + big),
            ph: 0, vph: (0.0035 + rnd() * 0.009) / (0.55 + big), ph2: 0, vph2: (0.0015 + rnd() * 0.006) / (0.55 + big), fo: 0.45 + rnd() * 2.2,
            kd: 0.0011 + 0.002 * (1 - big), life: life, max: life, cv: null, loc: loc, w: new Float32Array(n * 2), n: n, skip: skip,
            cw: polyArea(poly) > 0 ? 1 : -1, gl: 0, on: false,
          });
        }
        // splinters (glittering needles) and dust
        const nN = [9, 6, 5, 4][rows - 1], nD = [6, 4, 3, 2][rows - 1];
        for (let j = 0; j < nN + nD; j++) {
          const needle = j < nN, ang = rnd() * TAU, v0 = s * (needle ? 0.003 + rnd() * 0.013 : 0.001 + rnd() * 0.005) * power;
          const life = needle ? 260 + rnd() * 460 : 420 + rnd() * 560;
          bits.push({
            needle: needle, x: c.x + rnd() * s, y: c.y + rnd() * s, s: s,
            vx: Math.cos(ang) * v0 + side * s * 0.003 * rnd(), vy: Math.sin(ang) * v0 - s * (needle ? 0.004 : 0.0015) * rnd(),
            r: s * (needle ? 0.035 + rnd() * 0.075 : 0.022 + rnd() * 0.03), rot: rnd() * TAU, vr: (rnd() - 0.5) * 0.03,
            ph: rnd() * TAU, vph: 0.012 + rnd() * 0.02, life: life, max: life,
          });
        }
      }
      if (!fresh.length) return;
      // Spinning in the picture plane is the expensive part of a shard on software canvases: a big burst
      // lets only its small shards and a seeded share of the others spin; the rest tumbles about the
      // screen axes (heavy pieces turn slowly anyway).
      const rs = mulberry32((cells[0].seed >>> 0) ^ 0x5B1A7), pSpin = SPIN_BUDGET * cellPx * cellPx / total;
      for (let i = 0; i < fresh.length; i++) {
        const p = fresh[i];
        if (rs() >= pSpin && p.aw * p.ah > cellPx * cellPx * 0.12) { p.va = 0; p.a = 0; p.c0 = 1; p.s0 = 0; }
      }
      // the largest shards keep their smooth edges even in a big burst (see draw)
      const bySize = fresh.slice().sort(function (p, q) { return q.aw * q.ah - p.aw * p.ah; });
      for (let i = 0; i < bySize.length && i < 40; i++) bySize[i].sm = true;
      // shelf packing, tallest first
      const order = fresh.slice().sort(function (p, q) { return q.ah - p.ah; });
      const W = Math.min(2048, Math.max(cellPx + 4, Math.ceil(Math.sqrt(total * 1.2) / 64) * 64));
      let X = 1, Y = 1, rowH = 0;
      for (let i = 0; i < order.length; i++) {
        const p = order[i];
        if (X + p.aw + 1 > W) { X = 1; Y += rowH + 1; rowH = 0; }
        if (p.ah > rowH) rowH = p.ah;
        p.ax = X; p.ay = Y; X += p.aw + 1;
      }
      bakeAtlas(fresh, W, Y + rowH + 1);
      for (let i = 0; i < fresh.length; i++) shards.push(fresh[i]);
    }

    // One canvas per burst: every shard's piece of its sprite, masked by its fracture polygon.
    function bakeAtlas(list, width, height) {
      const cv = document.createElement('canvas');
      cv.width = width; cv.height = height;
      const g = cv.getContext('2d');
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        g.drawImage(p.sp, p.ox + p.sx, p.oy + p.sy, p.aw, p.ah, p.ax, p.ay, p.aw, p.ah);
      }
      g.beginPath();
      for (let i = 0; i < list.length; i++) {
        const p = list[i], q = p.poly, n = q.length >> 1, ox = p.ax - p.sx, oy = p.ay - p.sy;
        g.moveTo(q[0] * p.px + ox, q[1] * p.px + oy);
        for (let v = 1; v < n; v++) g.lineTo(q[v * 2] * p.px + ox, q[v * 2 + 1] * p.px + oy);
        g.closePath();
        p.cv = cv; p.sp = null; p.poly = null;
      }
      g.globalCompositeOperation = 'destination-in';
      g.fill();
      g.globalCompositeOperation = 'source-over';
      // Canvas drawing is deferred: use the atlas once now, so that it is rendered here, as part of the
      // one-off bake, and not in the middle of the first frame of the burst.
      touchCv = touchCv || document.createElement('canvas');
      if (touchCv.width !== 2) touchCv.width = touchCv.height = 2;
      touchCv.getContext('2d').drawImage(cv, 0, 0, 2, 2, 0, 0, 2, 2);
    }

    // Subtle twinkle when a piece locks: a soft glint on each chunk's lit corner plus a few rising motes.
    function sparkle(cells) {
      if (!cells || !cells.length) return;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i], s = c.size;
        if (!(s > 0)) continue;
        const rnd = mulberry32((c.seed >>> 0) ^ 0x7A11CE);
        if (!(c.conn & 9)) glints.push({ x: c.x + s * 0.15, y: c.y + s * 0.13, R: s * 0.34, life: 300, max: 300 });
        if (!(c.conn & 1)) {
          const life = 240 + rnd() * 220;
          bits.push({
            needle: false, x: c.x + rnd() * s, y: c.y + s * 0.08, s: s, vx: (rnd() - 0.5) * s * 0.003, vy: -s * (0.002 + rnd() * 0.003),
            r: s * (0.02 + rnd() * 0.016), rot: rnd() * TAU, vr: 0, ph: rnd() * TAU, vph: 0.02, life: life, max: life,
          });
        }
      }
    }

    function age(list, dt) {                                      // advance lifetimes, drop the dead
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.life -= dt;
        if (p.life > 0) list[n++] = p;
      }
      list.length = n;
    }

    function update(dt) {
      dt = +dt;
      if (!(dt > 0)) return;
      for (let i = 0; i < shards.length; i++) {
        const p = shards[i], drag = Math.exp(-dt * p.kd);
        p.vx *= drag; p.vy = p.vy * drag + GRAVITY * p.s * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt; p.ph += p.vph * dt; p.ph2 += p.vph2 * dt;
      }
      const needleDrag = Math.exp(-dt * 0.0036), dustDrag = Math.exp(-dt * 0.005);
      for (let i = 0; i < bits.length; i++) {
        const p = bits[i], drag = p.needle ? needleDrag : dustDrag;
        p.vx *= drag; p.vy = p.vy * drag + GRAVITY * (p.needle ? 0.7 : 0.3) * p.s * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.ph += p.vph * dt;
      }
      age(shards, dt); age(bits, dt); age(glints, dt); age(flashes, dt);
    }

    function draw(ctx, opts) {
      if (!ctx || !(flashes.length || count() > 0)) return;
      const dpr = opts && opts.dpr > 0 ? opts.dpr : 1;
      ctx.save();
      // one short soft flash of light at the heart of the break
      if (flashes.length) {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < flashes.length; i++) {
          const fl = flashes[i], a = 0.35 * fl.life / fl.max, R = fl.R;
          const spot = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, R);
          spot.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')');
          spot.addColorStop(0.35, 'rgba(255,255,255,' + (a * 0.4).toFixed(3) + ')');
          spot.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = spot;
          ctx.fillRect(fl.x - R, fl.y - R, R * 2, R * 2);
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // shards: pieces of the stone itself
      const B = typeof ctx.getTransform === 'function' ? ctx.getTransform() : { a: dpr, b: 0, c: 0, d: dpr, e: 0, f: 0 };
      const baseA = ctx.globalAlpha, cw = ctx.canvas ? ctx.canvas.width : 1e9, chh = ctx.canvas ? ctx.canvas.height : 1e9;
      let nFl = 0, area = 0;
      for (let i = 0; i < shards.length; i++) area += shards[i].aw * shards[i].ah;
      // a big burst is drawn unfiltered (the shards are in fast motion; software canvases need the help) -
      // all but its largest shards, whose edges would show the stair-steps
      const rough = area > 110000;
      for (let pass = rough ? 0 : 1; pass < 2; pass++) {
        ctx.imageSmoothingEnabled = pass === 1;
        for (let i = 0; i < shards.length; i++) {
          const p = shards[i];
          if (rough && p.sm !== (pass === 1)) continue;
          const ex = B.a * p.x + B.c * p.y + B.e, ey = B.b * p.x + B.d * p.y + B.f, R = p.aw > p.ah ? p.aw : p.ah;
          p.on = false; p.gl = 0;
          // it falls out of the field: gone within half a cell below the frame (or at the end of its time)
          let fade = 1 - (p.y - p.bottom) / (p.s * 0.5);
          if (p.life < 160 && p.life / 160 < fade) fade = p.life / 160;
          if (fade <= 0 || ey - R > chh || (ex + R < 0 && p.vx < 0) || (ex - R > cw && p.vx > 0)) { p.life = 0; continue; }
          if (fade > 1) fade = 1;
          const flip = Math.cos(p.ph), tilt = Math.cos(p.ph2);
          const k = p.sc, fx = (flip < 0 ? -k : k) * Math.max(0.1, Math.abs(flip)), fy = k * (0.45 + 0.55 * Math.abs(tilt));
          const ca = Math.cos(p.a), sa = Math.sin(p.a), c0 = p.c0, s0 = p.s0;
          // M = R(a) * scale(fx, fy) * R(-axis): identity (times 1/dpr) at the moment of the burst
          const m00 = ca * fx * c0 + sa * fy * s0, m01 = ca * fx * s0 - sa * fy * c0;
          const m10 = sa * fx * c0 - ca * fy * s0, m11 = sa * fx * s0 + ca * fy * c0;
          const ta = B.a * m00 + B.c * m10, tb = B.b * m00 + B.d * m10, tc = B.a * m01 + B.c * m11, td = B.b * m01 + B.d * m11;
          ctx.setTransform(ta, tb, tc, td, ex, ey);
          ctx.globalAlpha = baseA * fade;
          ctx.drawImage(p.cv, p.ax, p.ay, p.aw, p.ah, -p.pvx, -p.pvy, p.aw, p.ah);
          if (fade < 0.6) continue;
          const q = p.loc, w = p.w;                                // outline in device pixels, for edges and flashes
          for (let v = 0, n2 = p.n * 2; v < n2; v += 2) { w[v] = ta * q[v] + tc * q[v + 1] + ex; w[v + 1] = tb * q[v] + td * q[v + 1] + ey; }
          p.on = true;
          // specular flash: twice per turn the face passes the mirror angle
          let g = (p.ph % Math.PI) - p.fo;
          g = g < 0 ? -g : g;
          if (g < 0.24) { p.gl = 1 - g / 0.24; nFl++; }
        }
      }
      ctx.imageSmoothingEnabled = true;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = baseA;
      // break edges: only the bigger shards show one, and only where the cut faces the light - a hairline
      ctx.lineCap = 'butt';
      {
        ctx.beginPath();
        for (let i = 0; i < shards.length; i++) {
          const p = shards[i];
          if (!p.on || p.big <= 0.3) continue;
          const w = p.w, n = p.n, sgn = Math.cos(p.ph) < 0 ? -p.cw : p.cw;
          for (let v = 0; v < n; v++) {
            if (p.skip >> v & 1) continue;
            const u = (v + 1) % n, x = w[v * 2], y = w[v * 2 + 1], dx = w[u * 2] - x, dy = w[u * 2 + 1] - y;
            if (-(dy * LX - dx * LY) * sgn <= 0.3 * (Math.abs(dx) + Math.abs(dy))) continue;
            ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy);
          }
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;                                         // hairline: the cheapest stroke there is
        ctx.stroke();
      }
      for (let pass = 0; pass < 2 && nFl; pass++) {               // the face turns into a white mirror (two strengths, batched)
        ctx.beginPath();
        for (let i = 0; i < shards.length; i++) {
          const p = shards[i];
          if (!(p.gl > 0) || (p.gl > 0.55) !== (pass === 1)) continue;
          const w = p.w;
          ctx.moveTo(w[0], w[1]);
          for (let v = 2, n2 = p.n * 2; v < n2; v += 2) ctx.lineTo(w[v], w[v + 1]);
          ctx.closePath();
        }
        ctx.fillStyle = pass ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
        ctx.fill();
      }
      ctx.setTransform(B.a, B.b, B.c, B.d, B.e, B.f);
      if (nFl || glints.length) {                                 // soft bloom on the brightest mirrors
        const sp = glintSprite();
        let left = 36;
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < shards.length && left > 0; i++) {
          const p = shards[i];
          if (!(p.gl > 0.4) || p.big < 0.4) continue;
          const R = p.s * (0.3 + 0.3 * p.big);
          ctx.globalAlpha = baseA * p.gl * 0.75;
          ctx.drawImage(sp, p.x - R, p.y - R, R * 2, R * 2);
          left--;
        }
        for (let i = 0; i < glints.length; i++) {
          const p = glints[i], e = Math.sin(Math.PI * p.life / p.max), R = p.R * (0.9 + 0.5 * e);
          ctx.globalAlpha = baseA * e * 0.8;
          ctx.drawImage(sp, p.x - R, p.y - R, R * 2, R * 2);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = baseA;
      }

      // splinters: needles that glitter while they spin (bright when they face the light), and dust
      if (bits.length) {
        ctx.lineCap = 'butt';
        for (let pass = 0; pass < 2; pass++) {
          ctx.beginPath();
          for (let i = 0; i < bits.length; i++) {
            const p = bits[i];
            if (!p.needle) continue;
            const tw = Math.cos(p.ph);
            if ((tw > 0.55) !== (pass === 1)) continue;
            const l = p.r * Math.min(1, p.life / p.max * 2.5) * (0.35 + 0.65 * Math.abs(tw)), ex = Math.cos(p.rot) * l, ey = Math.sin(p.rot) * l;
            ctx.moveTo(p.x - ex, p.y - ey); ctx.lineTo(p.x + ex, p.y + ey);
          }
          ctx.strokeStyle = pass ? 'rgba(255,255,255,0.95)' : 'rgba(214,228,255,0.34)';
          ctx.lineWidth = (pass ? 1.5 : 1) / dpr;
          ctx.stroke();
        }
        // grit: tiny three-cornered slivers that turn (bright while they face the light)
        for (let pass = 0; pass < 2; pass++) {
          ctx.beginPath();
          for (let i = 0; i < bits.length; i++) {
            const p = bits[i];
            if (p.needle) continue;
            const tw = Math.sin(p.ph);
            if ((tw > 0.3) !== (pass === 1)) continue;
            const r = p.r * Math.min(1, p.life / p.max * 1.8) * (0.6 + 0.4 * Math.abs(tw));
            if (r * dpr < 0.35) continue;
            const c = Math.cos(p.rot + p.ph * 0.3) * r, sn = Math.sin(p.rot + p.ph * 0.3) * r;
            ctx.moveTo(p.x + c, p.y + sn); ctx.lineTo(p.x - c * 0.6 - sn * 0.55, p.y - sn * 0.6 + c * 0.55); ctx.lineTo(p.x - c * 0.3 + sn * 0.45, p.y - sn * 0.3 - c * 0.45);
            ctx.closePath();
          }
          ctx.fillStyle = pass ? 'rgba(255,255,255,0.9)' : 'rgba(220,232,255,0.4)';
          ctx.fill();
        }
      }
      ctx.restore();
    }

    function count() { return shards.length + bits.length + glints.length; }

    return {
      shatter: shatter, sparkle: sparkle, update: update, draw: draw,
      get active() { return count() + flashes.length > 0; },
      get count() { return count(); },
      reset: function () { shards = []; bits = []; glints = []; flashes = []; },
    };
  }

  KF.Crystal = {
    id: 'real',
    palette: palette,
    drawCells: drawCells,
    drawLight: drawLight,
    createFx: createFx,
    // Drop every cached canvas (call on resize / DPR change).
    invalidate: function () {
      sprites.clear(); spritePixels = 0; spriteLimit = SPRITE_BUDGET; crackSprites.clear();
      pieces.clear(); pieceOfSeed.clear(); piecePixels = 0; pieceLimit = PIECE_BUDGET; ovCv = null; ovMask = null;
      fieldBottom = -Infinity; fieldSize = 0;
      layers.length = 0; seenSigs.fill(0); scratch = null;
      glowCv = null; glowSig = 0; crackCv = null; crackMask = null; crackSig = 0;
    },
  };
})(globalThis.KF = globalThis.KF || {});
