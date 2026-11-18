// Kristallfall - crystal renderer, REALISTIC skin ("real") and shatter effect.
//
// Every tetromino reads as ONE chunk of real quartz. Cells of the same piece are fused: the geometry is
// a ridged prism whose ridges, hips and valleys run straight through the joints (same model as the
// cartoon skin). There is no ink outline: each sprite is lit per pixel WHILE BAKING - facet gradients,
// a dark saturated rim where the stone is thick, a thin fresnel edge on the lit side, inner reflection
// planes, veils, a soft inner glow, small speculars along the ridges - and gets a soft contact shadow.
// Cleared rows crack along seeded shard polygons and then shatter into exactly those shards.
//
// Classic script, Canvas 2D only, no assets, no clocks, no Math.random. Per-pixel work happens only in
// cached sprites, never per frame.
// Public API: KF.Crystal = { id, palette, drawCells, drawLight, createFx, invalidate }.
(function (KF) {
  'use strict';

  /* ------------------------------------------------------------------------------------------------ *
   * Palette - seven quartz varieties in their natural colours. Tones run from specular to the dark rim;
   * `glow` is the light that gathers inside the stone. All types share the same value structure.
   * ------------------------------------------------------------------------------------------------ */
  const palette = {
    I: { name: 'Bergkristall', hi: '#ffffff', pale: '#f4f6f8', light: '#dfe3e8', mid: '#b6bcc5', deep: '#7a828e', shade: '#3a414c', line: '#22272f', glow: '#eef4ff' },
    O: { name: 'Rosenquarz',   hi: '#fff6f6', pale: '#fae4e8', light: '#efc0cc', mid: '#dc9bb0', deep: '#b56b87', shade: '#80435c', line: '#5e2b43', glow: '#ffb9cb' },
    T: { name: 'Citrin',       hi: '#fffbe8', pale: '#f9e9b0', light: '#edc968', mid: '#d39c2e', deep: '#a16611', shade: '#643b08', line: '#472905', glow: '#ffc233' },
    S: { name: 'Blauquarz',    hi: '#f0f6ff', pale: '#c4d8f4', light: '#7fa3dc', mid: '#3a63b4', deep: '#1f3c7c', shade: '#10204a', line: '#0c1836', glow: '#5c92ee' },
    Z: { name: 'Amethyst',     hi: '#f9f2ff', pale: '#e3d2f5', light: '#b48ade', mid: '#8450be', deep: '#56288f', shade: '#2d1253', line: '#210d3f', glow: '#a868ff' },
    J: { name: 'Prasiolith',   hi: '#f4fff6', pale: '#ddf0de', light: '#abd2b2', mid: '#72aa86', deep: '#3f7a5b', shade: '#1f4b37', line: '#163828', glow: '#86dba2' },
    L: { name: 'Karneol',      hi: '#fff3e6', pale: '#f9c493', light: '#eb8842', mid: '#cf5520', deep: '#99300f', shade: '#5a1606', line: '#430e04', glow: '#ff641a' },
  };
  const TYPE_INDEX = { I: 0, O: 1, T: 2, S: 3, Z: 4, J: 5, L: 6 };
  // Material response per type: [veil / milkiness, facet contrast, gloss, inner glow, colour zoning, dispersion]
  const MAT = [
    [0.26, 1.25, 1.00, 0.10, 0.00, 0.34],   // I  clear, icy, strong reflections
    [0.62, 0.62, 0.62, 0.20, 0.00, 0.10],   // O  milky
    [0.10, 1.10, 1.00, 0.22, 0.00, 0.20],   // T  transparent honey
    [0.30, 0.85, 0.80, 0.12, 0.00, 0.14],   // S  dusty
    [0.14, 1.00, 0.95, 0.12, 0.26, 0.20],   // Z  zoned
    [0.20, 0.95, 0.90, 0.14, 0.00, 0.20],   // J
    [0.32, 0.72, 0.70, 0.32, 0.00, 0.08],   // L  waxy, glowing
  ];
  const PALS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map(function (k) {
    const p = palette[k];
    // tone ramp (0 = deepest shade .. 1 = palest) as a 256-entry RGB table for the per-pixel bake
    const stops = [[0, p.shade], [0.26, p.deep], [0.52, p.mid], [0.78, p.light], [1, p.pale]];
    const lut = new Uint8Array(768);
    for (let i = 0, s = 0; i < 256; i++) {
      const t = i / 255;
      while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
      const a = hexRgb(stops[s][1]), b = hexRgb(stops[s + 1][1]), f = (t - stops[s][0]) / (stops[s + 1][0] - stops[s][0]);
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(a[c] + (b[c] - a[c]) * f);
    }
    p.lut = lut;
    p.rgb = { hi: hexRgb(p.hi), light: hexRgb(p.light), line: hexRgb(p.line), glow: hexRgb(p.glow), veil: hexRgb(mix(p.pale, p.light, 0.35)) };
    // shard colours of the shatter effect: translucent body (lit / averted face), inner facet, bright edge
    p.shard = [rgba(mix(p.mid, p.light, 0.4), 0.6), rgba(mix(p.deep, p.mid, 0.25), 0.7), rgba(p.pale, 0.3), rgba(mix(p.hi, p.pale, 0.4), 0.85)];
    return p;
  });
  const O_INDEX = 1;

  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgba(h, a) { const c = hexRgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
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
  const VARIANTS = 4;        // facet variations per type/conn, picked by cell seed
  const PAD = 2;             // transparent border around a crack sprite (device px); body sprites: padOf()
  const SPRITE_BUDGET = 6e6; // sprite cache cap in pixels (~24 MB); the cache is dropped when it is exceeded
  const K = {                // fractions of the cell edge
    margin: 0.02,            // gap between silhouette and cell boundary on outer edges
    // Sawtooth nick the silhouette dips into at every joint (keeps the cells of a fused chunk countable):
    // depth, and the length of its slope at the start / end of an edge (clockwise).
    pinch: 0.045, pinchStart: 0.13, pinchEnd: 0.04,
    ridgeX: 0.40, ridgeY: 0.38,   // ridge position inside an arm (off-centre: lit facets are narrower)
  };
  // Everything that touches an open edge (joint) must look identical in every sprite, whatever its
  // variant: silhouette inset, rim, ridge position and the periodic textures are therefore the same for
  // all; seeded variation is confined to the inside of a cell and to its outer edges.

  const GLINT = { x: 0.27, y: 0.25 };         // specular spot on the lit top-left corner cell of a chunk
  function starPath(ctx, x, y, R) {            // four-pointed sparkle of the landing preview (drawShimmer)
    const r = R * 0.2;
    ctx.moveTo(x, y - R); ctx.lineTo(x + r, y - r); ctx.lineTo(x + R, y); ctx.lineTo(x + r, y + r);
    ctx.lineTo(x, y + R); ctx.lineTo(x - r, y + r); ctx.lineTo(x - R, y); ctx.lineTo(x - r, y - r);
    ctx.closePath();
  }

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
    const nOpen = (conn & 1) + (conn >> 1 & 1) + (conn >> 2 & 1) + (conn >> 3 & 1);
    const ch = [];
    for (let k = 0; k < 4; k++) {            // chipped outer corners, bigger on crystal tips and nuggets
      const base = (nOpen === 1 ? 0.25 : nOpen === 0 ? 0.2 : 0.17) + rnd() * 0.08;
      const skew = 0.64 + rnd() * 0.8;
      ch.push([S * Math.min(0.4, base * skew), S * Math.min(0.4, base / skew)]);
    }
    return {
      S: S, closed: closed, ch: ch, rnd: rnd, variant: variant,
      // Ridge junction C (unit coords). Arms of the other pieces are one cell wide and share one ridge
      // position. The 2x2 block of the O piece is a stubby prism with a slim flat ridge facet along its
      // horizontal middle, so C sits near the block centre: its offset depends on the cell's quadrant.
      center: ti !== O_INDEX ? [K.ridgeX, K.ridgeY] : [
        !closed[1] ? 0.56 : !closed[3] ? 0.44 : K.ridgeX,
        !closed[2] ? 0.9 : !closed[0] ? 0.1 : K.ridgeY,
      ],
      m: Math.round(S * K.margin),
      pinch: S * K.pinch, pinchStart: S * K.pinchStart, pinchEnd: S * K.pinchEnd,
      // Two open edges meeting at a corner leave a concave notch - except in the O piece, the only
      // tetromino that contains a filled 2x2 (conn carries no diagonal information).
      concave: ti !== O_INDEX,
      ext: ghost ? 0 : 1,                    // overlap across joints so fused cells never show a seam
    };
  }

  // Chamfer legs after offsetting the silhouette inwards by `ins` (keeps the band between both constant).
  function chamfer(c, ins) {
    if (!ins) return c;
    const L = Math.hypot(c[0], c[1]);
    return [Math.max(0, c[0] + ins * (L - c[0]) / c[1] - ins), Math.max(0, c[1] + ins * (L - c[1]) / c[0] - ins)];
  }

  // Closed polygon of the cell silhouette, inset by `ins` on outer edges (0 = the silhouette itself).
  function ring(geo, ins) {
    const S = geo.S, pts = [], i = geo.m + ins, e = -geo.ext;
    const j = i + geo.pinch;                         // inset is `j` wherever the outline crosses a joint
    for (let k = 0; k < 4; k++) {
      const A = geo.closed[(k + 3) & 3], B = geo.closed[k];
      if (A && B) {
        const c = chamfer(geo.ch[k], ins);
        pts.push(mapPt(S, k, i, i + c[1]), mapPt(S, k, i + c[0], i));
      } else if (A) pts.push(mapPt(S, k, i, geo.pinchEnd), mapPt(S, k, j, 0), mapPt(S, k, j, e));
      else if (B) pts.push(mapPt(S, k, e, j), mapPt(S, k, 0, j), mapPt(S, k, geo.pinchStart, i));
      else if (geo.concave) pts.push(mapPt(S, k, e, j), mapPt(S, k, j, j), mapPt(S, k, j, e));
      else pts.push(mapPt(S, k, e, e));
    }
    return pts;
  }

  function tracePoly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }
  function fillPoly(g, pts, color) { tracePoly(g, pts); g.fillStyle = color; g.fill(); }

  /* ------------------------------------------------------------------------------------------------ *
   * Sprite baking. A body sprite is shaded per pixel from three fields:
   *   - the ROOF: the chunk is a ridged prism (the straight skeleton of the piece). Every point belongs
   *     to the outer edge of the piece that reaches it first, so height h = the lowest of the planes that
   *     rise from the closed edges (0 at the edge, 1 on the ridge). An open edge has no plane of its own;
   *     at a reflex corner the outer edges of the two neighbouring arms reach into the cell (the larger
   *     of the two heights). Chipped corners add a chamfer plane. Planes, ridges, hips and valleys
   *     therefore continue seamlessly across joints.
   *   - the distance to the silhouette (rim, fresnel edge, contact shadow),
   *   - textures that are either periodic per cell (reflection planes, veils) or fade out towards the
   *     joints (seeded details), so that a joint looks the same from both sides.
   * ------------------------------------------------------------------------------------------------ */
  const sprites = new Map();
  let spritePixels = 0;

  // Padding around a body sprite (device px): joint overlap + AA + room for the contact shadow.
  function padOf(px) { return Math.max(PAD, Math.round(px * 0.075)); }

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
    fillPoly(maskG, pts, '#ffffff');
    return maskG.getImageData(0, 0, side, side);
  }

  // Cell sprite for type index / conn mask / facet variant, baked at px device pixels (plus padOf(px)).
  // Body sprites carry their contact shadow as a second canvas in `.shadow`.
  function getSprite(ti, conn, variant, px, ghost) {
    const key = ((((px * 2 + (ghost ? 1 : 0)) * 7 + ti) * 16 + conn) * VARIANTS) + variant;
    let cv = sprites.get(key);
    if (!cv) {
      const P = padOf(px), side = px + P * 2, cost = side * side * (ghost ? 1 : 2);
      if (spritePixels + cost > SPRITE_BUDGET && sprites.size > 64) { sprites.clear(); spritePixels = 0; }
      spritePixels += cost;
      cv = document.createElement('canvas');
      cv.width = cv.height = side;
      const g = cv.getContext('2d');
      const geo = makeGeo(ti, conn, variant, px, ghost);
      const baked = shadeBody(geo, PALS[ti], ti, P, !ghost);
      if (ghost) lightMap(baked.body.data);
      g.putImageData(baked.body, 0, 0);
      if (ghost) ghostContour(g, geo, P);
      else {
        const sh = document.createElement('canvas');
        sh.width = sh.height = side;
        sh.getContext('2d').putImageData(baked.shadow, 0, 0);
        cv.shadow = sh;
      }
      sprites.set(key, cv);
    }
    return cv;
  }

  // Facet response by plane: 0..3 = N E S W roof planes, 4..7 = chamfers NW NE SE SW, 8 = flat table.
  // Light comes from the top-left.
  const F_TONE = [0.68, 0.27, 0.37, 0.57, 0.85, 0.56, 0.22, 0.35, 0.78];
  const F_LIT = [1, 0, 0, 1, 1, 1, 0, 0, 1];
  const F_SHIFT = [0, 0.37, 0.61, 0.17, 0.52, 0.83, 0.26, 0.71, 0.45];   // reflection planes break at ridges
  const F_STEP = [0.13, -0.10, 0.10, 0.09];                              // seeded secondary facets

  // Returns { body: ImageData, shadow: ImageData | null } for one cell.
  function shadeBody(geo, pal, ti, P, wantShadow) {
    const S = geo.S, side = S + P * 2, cl = geo.closed, rnd = geo.rnd, mat = MAT[ti], lut = pal.lut;
    const tab = noiseTable(), inv = 1 / S, m = geo.m;
    const outline = ring(geo, 0);
    const img = coverage(outline, side, P), px = img.data;
    const shadow = wantShadow ? maskG.createImageData(side, side) : null, sd = shadow ? shadow.data : null;

    // (a) Outer boundary: the silhouette without the pieces that run along / beyond a joint.
    const segs = [];
    const edgeDepth = function (k, p) { return k === 0 ? p[1] : k === 1 ? S - p[0] : k === 2 ? S - p[1] : p[0]; };
    for (let n = 0; n < outline.length; n++) {
      const a = outline[n], b = outline[(n + 1) % outline.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      let joint = l2 < 1e-6;
      for (let k = 0; k < 4 && !joint; k++) joint = !cl[k] && edgeDepth(k, a) <= 0.001 && edgeDepth(k, b) <= 0.001;
      if (joint) continue;
      const l = Math.sqrt(l2);
      segs.push(a[0], a[1], dx, dy, 1 / l2, dy / l, -dx / l);      // start, direction, 1/len^2, outward normal
    }
    const nSeg = segs.length;

    // (b) Roof planes, chamfers and one seeded secondary facet (wedge or slanted growth step) per edge.
    const cx = geo.center[0], cy = geo.center[1];
    const ih = [1 / cy, 1 / (1 - cx), 1 / (1 - cy), 1 / cx];
    const depth = [cy * S, (1 - cx) * S, (1 - cy) * S, cx * S];
    const reflex = [], cham = [], sec = [];
    for (let k = 0; k < 4; k++) {
      const kp = (k + 3) & 3;
      reflex.push(!cl[k] && !cl[kp] && geo.concave);
      if (cl[k] && cl[kp]) {
        const c = geo.ch[k], L = Math.hypot(c[0], c[1]);
        cham.push([c[1] / L, c[0] / L, c[0] * c[1] / L, 1 / (S * (0.17 + rnd() * 0.12))]);
      } else cham.push(null);
      if (cl[k]) {
        const p1 = S * (0.2 + rnd() * 0.2), p2 = S * (0.56 + rnd() * 0.24);
        if (rnd() < 0.5) sec.push([1, p1, p2, p1 + (p2 - p1) * (0.25 + rnd() * 0.5), 0, 1 / (depth[k] * (0.5 + rnd() * 0.4))]);
        else sec.push([0, p1, p2, S * (rnd() - 0.5) * 0.3, S * (rnd() - 0.5) * 0.3, 1 / depth[k]]);
      } else sec.push(null);
    }
    // Soft specular spots: the lit corner of a chunk, and the vertex where ridges meet.
    const spots = [];
    if (cl[3] && cl[0]) spots.push(GLINT.x, GLINT.y, 1 / (0.034 * 0.034), 0.9, GLINT.x, GLINT.y, 1 / (0.11 * 0.11), 0.2);
    if (ti !== O_INDEX && !(cl[0] && cl[2] && !cl[1] && !cl[3]) && !(cl[1] && cl[3] && !cl[0] && !cl[2])) {
      spots.push(cx, cy, 1 / (0.03 * 0.03), 0.5, cx, cy, 1 / (0.09 * 0.09), 0.1);
    }
    const ox = rnd(), oy = rnd(), grain = (rnd() * 0xFFFFFF) | 0;
    const bandAmp = [0.15 + rnd() * 1.6, 0.15 + rnd() * 1.6, 0.15 + rnd() * 1.6, 0.15 + rnd() * 1.6];
    // Internal fracture planes: one or two seeded triangles that catch the light, bright at one corner.
    const tris = [];
    for (let n = rnd() < 0.6 ? 2 : 1; n > 0; n--) {
      const mx = 0.3 + rnd() * 0.4, my = 0.3 + rnd() * 0.4, a0 = rnd() * TAU, pt = [];
      for (let j = 0; j < 3; j++) {
        const a = a0 + (j + rnd() * 0.5) * TAU / 3, r = 0.13 + rnd() * 0.2;
        pt.push(mx + Math.cos(a) * r, my + Math.sin(a) * r);
      }
      const area = (pt[2] - pt[0]) * (pt[5] - pt[1]) - (pt[4] - pt[0]) * (pt[3] - pt[1]);
      tris.push(pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], 1 / area, 0.5 + rnd() * 0.5);
    }

    const aa = 1.3 * inv;                               // one device pixel (soft edges)
    const lw = Math.max(1.0 * inv, 0.014);              // half width of a ridge highlight
    const fc = Math.max(1.5 * inv, 0.03), fw = Math.max(1.15 * inv, 0.022);   // fresnel edge: centre, half width
    const strAmp = 0.012 * Math.min(1, S / 44);          // growth striations
    const veilC = pal.rgb.veil, rimC = pal.rgb.line, glowC = pal.rgb.glow, hiC = pal.rgb.hi, lightC = pal.rgb.light;
    const cF = 0.5 + 0.5 * mat[1], gloss = mat[2], hv = [0, 0, 0, 0];
    let o = 0;
    for (let yy = 0; yy < side; yy++) {
      const y = yy - P + 0.5, v = y * inv;
      for (let xx = 0; xx < side; xx++, o += 4) {
        const cov = px[o + 3], x = xx - P + 0.5;
        if (!cov && !sd) continue;

        // distance to the silhouette
        let d2 = 1e12, bnx = 0, bny = 0, bex = 0, bey = 0;
        for (let s = 0; s < nSeg; s += 7) {
          const ax = x - segs[s], ay = y - segs[s + 1];
          let t = (ax * segs[s + 2] + ay * segs[s + 3]) * segs[s + 4];
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax - segs[s + 2] * t, ey = ay - segs[s + 3] * t, q = ex * ex + ey * ey;
          if (q < d2) { d2 = q; bnx = segs[s + 5]; bny = segs[s + 6]; bex = ex; bey = ey; }
        }
        const dOut = Math.sqrt(d2);

        // contact shadow: soft, a little longer away from the light; never across a joint
        if (sd && (x >= 0 || cl[3]) && (x <= S || cl[1]) && (y >= 0 || cl[0]) && (y <= S || cl[2])) {
          let a = 0.5;
          if (cov < 128) {
            const f = dOut > 0.01 ? Math.max(0, (bex * 0.6 + bey * 0.8) / dOut) : 0.5;
            const k = 1 - dOut / (S * (0.032 + 0.048 * f));
            a = k > 0 ? (0.3 + 0.3 * f) * k * k : 0;
          }
          sd[o + 3] = a * 255;
        }
        if (!cov) continue;
        const u = x * inv;

        // roof: the lowest plane wins
        hv[0] = v * ih[0]; hv[1] = (1 - u) * ih[1]; hv[2] = (1 - v) * ih[2]; hv[3] = u * ih[3];
        let h1 = 9, h2 = 9, k1 = -1, k2 = -1, vd1 = 9, win = 1;
        for (let k = 0; k < 4; k++) {
          let hk = hv[k], pk = k, vd = 9;
          if (!cl[k]) {
            const dk = k === 0 ? v : k === 1 ? 1 - u : k === 2 ? 1 - v : u;     // seeded details fade out here
            win *= dk < 0.03 ? 0 : dk > 0.3 ? 1 : (dk - 0.03) * 3.7;
            if (!reflex[k]) continue;
            const kp = (k + 3) & 3, hb = hv[kp];
            if (hk > hb) vd = hk - hb; else { vd = hb - hk; hk = hb; pk = kp; }
          }
          if (pk === k1 || pk === k2) continue;
          if (hk < h1) { h2 = h1; k2 = k1; h1 = hk; k1 = pk; vd1 = vd; } else if (hk < h2) { h2 = hk; k2 = pk; }
        }
        const hRoof = h1 < 0 ? 0 : h1 > 1 ? 1 : h1;
        for (let k = 0; k < 4; k++) {
          const c = cham[k];
          if (!c) continue;
          const a = k === 0 ? x : k === 1 ? y : k === 2 ? S - x : S - y, d = k === 0 ? y : k === 1 ? S - x : k === 2 ? S - y : x;
          const hk = ((a - m) * c[0] + (d - m) * c[1] - c[2]) * c[3];
          if (hk < h1) { h2 = h1; k2 = k1; h1 = hk; k1 = 4 + k; vd1 = 9; } else if (hk < h2) { h2 = hk; k2 = 4 + k; }
        }
        if (k1 < 0 || h1 > 1) { h2 = k1 < 0 ? 9 : h1; k2 = k1; h1 = 1; k1 = 8; vd1 = 9; }
        const h = h1 < 0 ? 0 : h1, lit = F_LIT[k1];

        // facet tone: smooth gradient across the facet, plus the seeded secondary facet
        let tone = F_TONE[k1], shift = F_SHIFT[k1], spec = 0;
        if (k1 < 4) {
          tone += lit ? 0.14 * (h - 0.5) : 0.26 * (0.45 - h);
          const F = sec[k1];
          if (F) {
            const a = k1 === 0 ? x : k1 === 1 ? y : k1 === 2 ? S - x : S - y, t = (k1 === 0 ? y : k1 === 1 ? S - x : k1 === 2 ? S - y : x) * F[5];
            let lo, hi;
            if (F[0]) { lo = F[1] + (F[3] - F[1]) * t; hi = F[2] + (F[3] - F[2]) * t; }
            else { lo = F[1] + F[3] * (1 - t); hi = F[2] + F[4] * (1 - t); }
            let c = Math.min(a - lo, hi - a) + 0.5;
            if (c > 0) {
              if (c > 1) c = 1;
              tone += F_STEP[k1] * c;
              if (c > 0.5) shift += 0.23;
            }
          }
        } else if (k1 < 8) tone += (lit ? 0.1 : -0.05) * (1 - 2 * h);

        // inner reflection planes: periodic per cell, so they bridge every joint
        let f = u + v + shift;
        f -= Math.floor(f);
        const band = f < 0.3 ? 0 : f < 0.3 + aa ? (f - 0.3) / aa : f < 0.4 ? 1 : f < 0.58 ? (0.58 - f) * 5.556 : 0;
        const band2 = f > 0.66 && f < 0.715 ? Math.min(1, (f - 0.66) / aa, (0.715 - f) / aa) : 0;
        let f2 = u - v + shift * 1.7;
        f2 -= Math.floor(f2);
        const dark = f2 > 0.1 && f2 < 0.32 ? Math.min(1, (f2 - 0.1) / aa, (0.32 - f2) * 9) : 0;
        const fi = Math.floor(u + v + shift) & 3;
        tone += mat[1] * (1 + win * (bandAmp[fi] - 1)) * (0.1 * band + 0.07 * band2 - 0.06 * dark);
        if (lit) spec += 0.05 * band;

        // growth striations, colour zoning, inner glow along the spine of the chunk
        const nA = tnoise(tab, u + v + 0.13, 2 * v - u + 0.71);
        if (k1 < 4) tone += strAmp * Math.sin(hRoof * 52 + nA * 2.5);
        tone += (nA - 0.5) * 0.16;
        const hg = hRoof < 0.2 ? 0 : (hRoof - 0.2) * 1.25;
        if (mat[4]) tone -= mat[4] * (0.5 * hg + (hRoof > 0.5 && hRoof < 0.74 ? 0.5 * Math.min(1, (hRoof - 0.5) * 20, (0.74 - hRoof) * 20) : 0));

        // silhouette: thick dark rim, light gathering inside the far edges
        const dn = dOut * inv, ld = -(bnx * 0.64 + bny * 0.77);
        const le = ld > 0 ? ld : 0, se = ld < 0 ? -ld : 0;
        let rim = dn < 0.13 ? 1 - dn * 7.69 : 0;
        rim = rim * rim * (3 - 2 * rim) * (0.9 - 0.45 * le);
        const caustic = se > 0 && dn > 0.05 && dn < 0.3 ? se * (1 - Math.abs(dn - 0.175) * 8) * (0.1 + 1.5 * nA) : 0;

        // ridges: broken specular lines; valleys: a dark crease
        const er = (h2 - h1) * 0.25;
        if (er < lw) {
          const nR = tnoise(tab, 2 * u + v + 0.31, 2 * v - u + 0.57);
          const br = nR < 0.47 ? 0 : nR > 0.63 ? 1 : (nR - 0.47) * 6.25;
          spec += (1 - er / lw) * (lit !== F_LIT[k2] ? 1 : lit ? 0.5 : 0.2) * (0.1 + 1.1 * br) * gloss;
        }
        if (vd1 * 0.25 < lw * 1.8) tone -= 0.2 * (1 - vd1 * 0.25 / (lw * 1.8));
        for (let s = 0; s < spots.length; s += 4) {
          const dx = u - spots[s], dy = v - spots[s + 1], q = (dx * dx + dy * dy) * spots[s + 2];
          if (q < 5) spec += spots[s + 3] * Math.exp(-q) * gloss;
        }
        if (k1 === 4) spec += 0.2 * (1 - h);

        // veils / frosting: a periodic wisp plus a seeded cloud that stays clear of the joints
        let milk = nA < 0.5 ? 0 : nA > 0.72 ? 0.5 : (nA - 0.5) * 2.27;
        if (win > 0.01) {
          const nB = tnoise(tab, u * 0.8 + ox, v * 0.8 + oy);
          if (nB > 0.47) milk += win * (nB > 0.69 ? 0.8 : (nB - 0.47) * 3.64);
          tone += win * (nB - 0.5) * 0.5;                         // seeded density of the colour
          for (let s = 0; s < tris.length; s += 8) {
            const ax = u - tris[s], ay = v - tris[s + 1], bx = tris[s + 2] - tris[s], by = tris[s + 3] - tris[s + 1], qx = tris[s + 4] - tris[s], qy = tris[s + 5] - tris[s + 1];
            const w1 = (ax * qy - ay * qx) * tris[s + 6], w2 = (bx * ay - by * ax) * tris[s + 6], w0 = 1 - w1 - w2;
            const e = Math.min(w0, w1, w2) * S * 0.25;
            if (e <= 0) continue;
            const k = (e > 1 ? 1 : e) * win * w0 * tris[s + 7];
            tone += 0.14 * k; milk += 0.45 * k; spec += 0.05 * k;
          }
        }
        milk *= mat[0] + 0.12;

        // compose: body colour -> veil -> inner glow -> rim -> edge light -> speculars
        tone = 0.5 + (tone - 0.5) * cF + ((hash32(o, grain) & 255) - 127.5) * 0.00012;
        const idx = tone <= 0 ? 0 : tone >= 1 ? 765 : ((tone * 255) | 0) * 3;
        let r = lut[idx], gg = lut[idx + 1], b = lut[idx + 2];
        r += (veilC[0] - r) * milk; gg += (veilC[1] - gg) * milk; b += (veilC[2] - b) * milk;
        const gl = mat[3] * hg * hg + (0.2 + 0.5 * mat[3]) * caustic;
        r += glowC[0] * gl; gg += glowC[1] * gl; b += glowC[2] * gl;
        r += (rimC[0] - r) * rim; gg += (rimC[1] - gg) * rim; b += (rimC[2] - b) * rim;
        const eb = 1 - Math.abs(dn - fc) / fw;
        if (se > 0 && eb > 0) {                                   // faint edge light on the averted side
          const k = 0.16 * se * eb;
          r += (lightC[0] - r) * k; gg += (lightC[1] - gg) * k; b += (lightC[2] - b) * k;
        }
        let sr = spec, sg = spec, sb = spec;
        if (spec > 0.02) {                                        // a hint of dispersion in the highlights
          const ph = TAU * (2 * u - v), k = mat[5];
          sr *= 1 + k * Math.cos(ph); sg *= 1 + k * Math.cos(ph + 2.094); sb *= 1 + k * Math.cos(ph + 4.189);
        }
        if (le > 0) {                                             // thin fresnel edge on the lit side
          const k = Math.pow(le, 0.6) * (0.25 + 0.95 * nA), q = fw * 0.3;
          const er2 = 1 - Math.abs(dn - q - fc) / fw, eb2 = 1 - Math.abs(dn + q - fc) / fw;
          if (er2 > 0) sr += k * er2;
          if (eb > 0) sg += k * eb;
          if (eb2 > 0) sb += k * eb2;
        }
        px[o] = r + hiC[0] * sr; px[o + 1] = gg + hiC[1] * sg; px[o + 2] = b + hiC[2] * sb;
      }
    }
    return { body: img, shadow: shadow };
  }

  // Landing preview sprite: a white LIGHT MAP of the crystal (a soft body, slightly brighter on the lit
  // facets) inside a bright contour. drawShimmer() colours and animates these maps as shimmering light.
  function lightMap(d) {
    let lo = 1, hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      if (l < lo) lo = l; if (l > hi) hi = l;
    }
    const span = Math.max(0.05, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const l = ((d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255 - lo) / span;
      const k = l < GHOST_KNEE ? 0 : (l - GHOST_KNEE) / (1 - GHOST_KNEE);
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(d[i + 3] * (0.16 + 0.2 * Math.pow(k, 1.4)));
    }
  }
  const GHOST_KNEE = 0.1;      // knee and curve are matched so the preview is as bright as with the cartoon sprites
  function ghostContour(g, geo, P) {
    const wg = Math.max(1, Math.round(geo.S * 0.05));
    g.translate(P, P);
    g.globalAlpha = 0.62;
    g.fillStyle = '#ffffff';
    g.beginPath();
    [ring(geo, 0), ring(geo, wg)].forEach(function (pts) {
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
    });
    g.fill('evenodd');
    g.globalAlpha = 1;
  }

  // Soft glint: a bright point with a faint, short cross flare (idle glints, lock sparkle, shatter).
  let glintCv = null;
  function glintSprite() {
    if (glintCv) return glintCv;
    const N = 64, c = (N - 1) / 2;
    glintCv = document.createElement('canvas');
    glintCv.width = glintCv.height = N;
    const g = glintCv.getContext('2d'), img = g.createImageData(N, N), d = img.data;
    for (let y = 0, o = 0; y < N; y++) for (let x = 0; x < N; x++, o += 4) {
      const dx = (x - c) / c, dy = (y - c) / c, r2 = dx * dx + dy * dy, r = Math.sqrt(r2);
      const flare = Math.exp(-dy * dy / 0.0016) * Math.exp(-Math.abs(dx) * 4.2) + Math.exp(-dx * dx / 0.0016) * Math.exp(-Math.abs(dy) * 4.2);
      const a = (Math.exp(-r2 / 0.011) + 0.3 * Math.exp(-r2 / 0.09) + 0.5 * flare) * Math.max(0, 1 - r);
      d[o] = d[o + 1] = d[o + 2] = 255;
      d[o + 3] = Math.min(255, a * 255);
    }
    g.putImageData(img, 0, 0);
    return glintCv;
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Fracture patterns. A cell breaks along one of a small set of patterns (picked by its seed): cracks
   * radiate from an impact point, kink once and reach the cell border; a few wedges get a concentric
   * split. The very same polygons are drawn as crack lines by drawCells and released as shards by
   * fx.shatter, so crack -> burst is continuous. A fixed set keeps the crack overlays bakeable.
   * ------------------------------------------------------------------------------------------------ */
  const FRACTURE_PATTERNS = 20, CRACK_LEVELS = 7;
  const fractures = [];
  const UNIT_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

  function fracture(seed) {
    const id = (seed >>> 0) % FRACTURE_PATTERNS;
    return fractures[id] || (fractures[id] = makeFracture(id));
  }

  function makeFracture(id) {
    const rnd = mulberry32(hash32(id, 0x2F6E2B1));
    const px = 0.3 + rnd() * 0.4, py = 0.3 + rnd() * 0.4;        // impact point (unit square)
    const n = 4 + (rnd() * 2 | 0);
    const base = rnd() * TAU, rays = [];
    for (let i = 0; i < n; i++) {
      const ang = base + (i + (rnd() - 0.5) * 0.55) * TAU / n;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const tx = dx > 1e-9 ? (1 - px) / dx : dx < -1e-9 ? -px / dx : 1e9;
      const ty = dy > 1e-9 ? (1 - py) / dy : dy < -1e-9 ? -py / dy : 1e9;
      const t = Math.min(tx, ty);
      const bx = Math.min(1, Math.max(0, px + dx * t)), by = Math.min(1, Math.max(0, py + dy * t));
      // position on the perimeter, clockwise from the top-left corner (0..4)
      const s = tx < ty ? (dx > 0 ? 1 + by : 3 + (1 - by)) : (dy > 0 ? 2 + (1 - bx) : bx);
      const kt = t * (0.36 + rnd() * 0.28), kn = t * (rnd() - 0.5) * 0.34;   // kink makes the crack jagged
      // `at`: when this crack starts to grow (0..1 of the build-up) - staggered, so a half-cracked
      // block shows a few long fractures instead of a little asterisk
      rays.push({ kx: px + dx * kt - dy * kn, ky: py + dy * kt + dx * kn, bx: bx, by: by, s: s, at: i ? rnd() * 0.5 : 0 });
    }
    const polys = [], wedges = [], chords = [];
    for (let i = 0; i < n; i++) {
      const r = rays[i], q = rays[(i + 1) % n];
      const outer = [r.kx, r.ky, r.bx, r.by];
      const end = q.s > r.s ? q.s : q.s + 4;
      for (let c = Math.floor(r.s) + 1; c < end; c++) outer.push(UNIT_CORNERS[c & 3][0], UNIT_CORNERS[c & 3][1]);
      outer.push(q.bx, q.by, q.kx, q.ky);
      const wedge = outer.concat(px, py);
      wedges.push(wedge);
      if (rnd() < 0.22) {                                         // concentric crack splits the wedge
        polys.push([px, py, r.kx, r.ky, q.kx, q.ky], outer);
        chords.push([r.kx, r.ky, q.kx, q.ky]);
      } else polys.push(wedge);
    }
    // polys: all shards (flat x,y lists); wedges: the same tiling without the concentric splits
    return { px: px, py: py, rays: rays, chords: chords, polys: polys, wedges: wedges };
  }

  // Crack overlay of one pattern at growth step `level` (1..CRACK_LEVELS): internal fractures - fine
  // bright lines with short feathers, a milky bloom around them, a thin refraction shadow on the far
  // side (keeps them readable on the pale stones) and a frosted spot at the impact point.
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
    const feathers = [];                                           // x, y, dx, dy (device px)
    const trace = function (collect) {
      g.beginPath();
      for (let i = 0; i < f.rays.length; i++) {
        const r = f.rays[i], u = (grow - r.at) / 0.5;             // 0..1 along this crack
        if (collect) {                                            // same seeded feathers at every level
          for (let j = 0; j < 4; j++) {
            const fu = 0.12 + rnd() * 0.8, sgn = rnd() < 0.5 ? -1 : 1, ang = sgn * (0.45 + rnd() * 0.5), len = S * (0.05 + rnd() * 0.09);
            if (u < fu + 0.06) continue;
            const first = fu < 0.45, q = first ? fu / 0.45 : (fu - 0.45) / 0.55;
            const ax = first ? f.px : r.kx, ay = first ? f.py : r.ky, bx = first ? r.kx : r.bx, by = first ? r.ky : r.by;
            const dl = Math.hypot(bx - ax, by - ay) || 1, dx = (bx - ax) / dl, dy = (by - ay) / dl, ca = Math.cos(ang), sa = Math.sin(ang);
            feathers.push((ax + (bx - ax) * q) * S, (ay + (by - ay) * q) * S, (dx * ca - dy * sa) * len, (dx * sa + dy * ca) * len);
          }
        }
        if (u <= 0) continue;
        const u1 = Math.min(1, u / 0.45), u2 = Math.min(1, (u - 0.45) / 0.55);
        g.moveTo(f.px * S, f.py * S);
        g.lineTo((f.px + (r.kx - f.px) * u1) * S, (f.py + (r.ky - f.py) * u1) * S);
        if (u2 > 0) g.lineTo((r.kx + (r.bx - r.kx) * u2) * S, (r.ky + (r.by - r.ky) * u2) * S);
      }
      const uc = Math.min(1, (grow - 0.7) / 0.3);                 // concentric cracks close the pattern last
      for (let i = 0; uc > 0 && i < f.chords.length; i++) {
        const c = f.chords[i];
        g.moveTo(c[0] * S, c[1] * S);
        g.lineTo((c[0] + (c[2] - c[0]) * uc) * S, (c[1] + (c[3] - c[1]) * uc) * S);
      }
    };
    g.save();
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    trace(true);
    g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = Math.max(3, S * 0.2); g.stroke();       // milky bloom
    g.strokeStyle = 'rgba(255,255,255,0.17)'; g.lineWidth = Math.max(2, S * 0.1); g.stroke();
    const frost = Math.min(1, (grow - 0.5) / 0.5), rf = mulberry32(hash32(id, 0xF205));
    for (let i = 0; i < f.polys.length; i++) {                    // the shards-to-be start to reflect differently
      const q = f.polys[i], a = rf() * 0.17 * frost;
      if (a < 0.02) continue;
      g.beginPath();
      g.moveTo(q[0] * S, q[1] * S);
      for (let v = 2; v < q.length; v += 2) g.lineTo(q[v] * S, q[v + 1] * S);
      g.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      g.fill();
    }
    const off = Math.max(0.7, S * 0.024);
    g.translate(off, off);
    trace(false); g.strokeStyle = 'rgba(8,14,34,0.42)'; g.lineWidth = Math.max(1, S * 0.03); g.stroke();   // refraction shadow
    g.translate(-off, -off);
    g.beginPath();                                                 // feathers
    for (let i = 0; i < feathers.length; i += 4) {
      g.moveTo(feathers[i], feathers[i + 1]);
      g.lineTo(feathers[i] + feathers[i + 2], feathers[i + 1] + feathers[i + 3]);
    }
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = Math.max(0.6, S * 0.012); g.stroke();
    trace(false); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = Math.max(1, S * 0.021); g.stroke();
    const R = S * (0.07 + 0.11 * Math.min(1, grow * 1.5));        // frosted impact point
    const spot = g.createRadialGradient(f.px * S, f.py * S, 0, f.px * S, f.py * S, R);
    spot.addColorStop(0, 'rgba(255,255,255,0.95)'); spot.addColorStop(0.35, 'rgba(255,255,255,0.5)'); spot.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = spot;
    g.fillRect(f.px * S - R, f.py * S - R, R * 2, R * 2);
    g.restore();
    crackSprites.set(key, cv);
    return cv;
  }

  /* ------------------------------------------------------------------------------------------------ *
   * drawCells
   * ------------------------------------------------------------------------------------------------ */
  // Big groups that hold still (the settled board) are flattened into one layer canvas, so a static
  // board costs a single blit per frame instead of one per cell. Cracks and glints stay per frame.
  // Translucent groups are flattened too (into a scratch layer), because fused sprites overlap by a
  // pixel at the joints and would otherwise show seams when blended individually.
  const LAYER_MIN_CELLS = 24, MAX_LAYERS = 2, MAX_LAYER_PIXELS = 6e6;
  const layers = [], seenSigs = [0, 0, 0, 0];
  let seenAt = 0, layerClock = 0, scratch = null;

  // Returns { cv, x, y, w, h } (device px) holding the whole group, or null if it should be drawn directly.
  function groupLayer(cells, px, dpr, cacheable, mustFlatten) {
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
    for (let pass = 0; pass < 2; pass++) {                       // all contact shadows first, then the bodies
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const sp = getSprite(TYPE_INDEX[c.type] | 0, c.conn & 15, ((c.seed >>> 0) >>> 7) % VARIANTS, px, false);
        g.drawImage(pass ? sp : sp.shadow, Math.round(c.x * dpr) - x0, Math.round(c.y * dpr) - y0);
      }
    }
    L.x = x0 - P; L.y = y0 - P; L.w = w; L.h = hh;
    return L;
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Landing preview as shimmering light: the crystal's shape glows in drifting rainbow colours, bright
   * reflections sweep across it, the rim has a soft halo and small sparkles flicker inside. Everything is
   * additive light - it never looks like a solid block.
   * ------------------------------------------------------------------------------------------------ */
  const SPECTRUM = [[255, 77, 109], [255, 159, 67], [255, 230, 109], [92, 255, 157], [77, 216, 255], [91, 124, 255], [199, 125, 255]];
  const SPECTRUM_CSS = SPECTRUM.map(function (c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; });
  let prismMask = null, prismTint = null;

  function growCanvas(cv, w, h) {
    cv = cv || document.createElement('canvas');
    if (cv.width < w) cv.width = w;
    if (cv.height < h) cv.height = h;
    return cv;
  }

  function drawShimmer(ctx, cells, size, px, dpr, alpha, t) {
    const inv = 1 / dpr;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < cells.length; i++) {
      const X = Math.round(cells[i].x * dpr), Y = Math.round(cells[i].y * dpr);
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    const m = Math.ceil(px * 0.14) + PAD;                       // room for the halo
    const w = x1 - x0 + px + m * 2, h = y1 - y0 + px + m * 2;
    if (!(w > 0 && h > 0) || w * h > 4e6) return;
    prismMask = growCanvas(prismMask, w, h);
    prismTint = growCanvas(prismTint, w, h);

    // 1) white light map of the whole (fused) shape
    const mg = prismMask.getContext('2d');
    mg.clearRect(0, 0, w, h);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const sp = getSprite(TYPE_INDEX[c.type] | 0, c.conn & 15, ((c.seed >>> 0) >>> 7) % VARIANTS, px, true);
      mg.drawImage(sp, Math.round(c.x * dpr) - x0 + m - sp.width / 2 + px / 2, Math.round(c.y * dpr) - y0 + m - sp.height / 2 + px / 2);
    }

    // 2) colour it with a rainbow that drifts across the shape
    const tg = prismTint.getContext('2d');
    tg.globalCompositeOperation = 'source-over';
    tg.clearRect(0, 0, w, h);
    tg.drawImage(prismMask, 0, 0, w, h, 0, 0, w, h);
    tg.globalCompositeOperation = 'source-in';
    const period = Math.max(w, px * 3.2), phase = (t / 2800) % 1, sx = -phase * period;
    const grd = tg.createLinearGradient(sx, 0, sx + period * 2, period * 0.6);
    const n = SPECTRUM_CSS.length;
    for (let i = 0; i <= n * 2; i++) grd.addColorStop(i / (n * 2), SPECTRUM_CSS[i % n]);
    tg.fillStyle = grd;
    tg.fillRect(0, 0, w, h);

    tg.globalCompositeOperation = 'source-over';

    // 3) shimmer: reflections travel diagonally through the shape. Only the coloured light under these
    //    moving bands is drawn brightly, the rest of the shape stays a faint glow.
    const sg = prismMask.getContext('2d');                      // the white map is no longer needed: reuse it
    sg.globalCompositeOperation = 'source-over';
    sg.clearRect(0, 0, w, h);
    const bw = px * 0.62, travel = w + h + bw * 4;
    const band = function (pos, width, a) {                     // the strip pos <= x + y <= pos + width
      sg.fillStyle = 'rgba(255,255,255,' + a + ')';
      sg.beginPath();
      sg.moveTo(pos, 0); sg.lineTo(pos + width, 0); sg.lineTo(pos + width - h, h); sg.lineTo(pos - h, h);
      sg.closePath();
      sg.fill();
    };
    for (let k = 0; k < 3; k++) {
      const pos = (((t / (1500 + k * 640)) + k * 0.37) % 1) * travel - bw * 2;
      band(pos - bw * 0.7, bw * 0.7, 0.22);
      band(pos - bw * 0.3, bw * 0.3, 0.3);
      band(pos, bw, 1);
      band(pos + bw, bw * 0.3, 0.3);
      band(pos + bw, bw * 0.7, 0.22);
    }
    sg.globalCompositeOperation = 'source-in';
    sg.drawImage(prismTint, 0, 0, w, h, 0, 0, w, h);
    sg.globalCompositeOperation = 'source-over';

    // 4) put the light on the board: a faint glow of the whole shape, the bright reflections on top
    const dx = (x0 - m) * inv, dy = (y0 - m) * inv, dw = w * inv, dh = h * inv;
    const pulse = 0.82 + 0.18 * Math.sin(t / 340);
    ctx.globalCompositeOperation = 'lighter';
    const r = size * 0.07;
    ctx.globalAlpha = alpha * 0.045 * pulse;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.drawImage(prismTint, 0, 0, w, h, dx + Math.cos(a) * r, dy + Math.sin(a) * r, dw, dh);
    }
    ctx.globalAlpha = alpha * 0.46 * pulse;
    ctx.drawImage(prismTint, 0, 0, w, h, dx, dy, dw, dh);
    ctx.globalAlpha = alpha * 0.9;
    ctx.drawImage(prismMask, 0, 0, w, h, dx, dy, dw, dh);

    // 5) sparkles flickering at changing spots inside the shape
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], seed = c.seed >>> 0;
      const per = 480 + seed % 420, tt = t + seed % per;
      const f = (tt % per) / per, spot = hash32(seed, Math.floor(tt / per));
      const R = size * (0.085 + ((spot >>> 16) & 7) * 0.012) * Math.sin(f * Math.PI);
      if (R < 0.5) continue;
      starPath(ctx, c.x + size * (0.18 + (spot & 255) / 255 * 0.64), c.y + size * (0.18 + ((spot >>> 8) & 255) / 255 * 0.64), R);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Light from above: a soft white shaft falls onto the falling crystal and leaves it as a short, faint
   * spectrum glow. Together with the shimmering preview it reads as light shining through the crystal.
   * cells: the falling piece. opts: { t, top (y where the shaft starts), maxLen (free space below), alpha }
   * ------------------------------------------------------------------------------------------------ */
  function drawLight(ctx, cells, opts) {
    if (!ctx || !cells || !cells.length) return;
    opts = opts || {};
    const size = +cells[0].size;
    if (!(size > 0)) return;
    const t = +opts.t || 0, top = +opts.top || 0;
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
    const breathe = 0.84 + 0.16 * Math.sin(t / 880);
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
      ctx.globalAlpha = alpha * breathe;
      for (let pass = 0; pass < 3; pass++) {
        const inset = pass * size * 0.16, l = xa + inset, r = xb - inset;
        cols.forEach(function (e) {
          const x0 = Math.max(e.x, l), x1 = Math.min(e.x + size, r);
          // reach a little into the cell: the crystal's chamfered top would otherwise leave a dark notch
          if (x1 > x0 && e.y0 > top) ctx.fillRect(x0, top, x1 - x0, e.y0 - top + size * 0.35);
        });
      }
    }

    // The light leaves the crystal split into colours: a short glow that fades out quickly.
    const out = Math.min(size * 1.6, +opts.maxLen || 0);
    if (out > size * 0.15) {
      const STRIPS = 6, sw = size / STRIPS, n = SPECTRUM.length;
      ctx.globalAlpha = 1;
      cols.forEach(function (e) {
        for (let k = 0; k < STRIPS; k++) {
          const sx = e.x + k * sw;
          const f = Math.max(0, Math.min(0.9999, (sx + sw / 2 - xa) / width)) * (n - 1);
          const i = Math.floor(f), m = f - i, p = SPECTRUM[i], q = SPECTRUM[i + 1];
          const rgb = Math.round(p[0] + (q[0] - p[0]) * m) + ',' + Math.round(p[1] + (q[1] - p[1]) * m) + ',' + Math.round(p[2] + (q[2] - p[2]) * m);
          const gy = e.y1 - size * 0.25;                          // start behind the crystal's chamfered bottom
          const glow = ctx.createLinearGradient(0, e.y1, 0, e.y1 + out);
          glow.addColorStop(0, 'rgba(' + rgb + ',' + (0.17 * alpha * breathe).toFixed(3) + ')');
          glow.addColorStop(0.45, 'rgba(' + rgb + ',' + (0.05 * alpha * breathe).toFixed(3) + ')');
          glow.addColorStop(1, 'rgba(' + rgb + ',0)');
          ctx.fillStyle = glow;
          ctx.fillRect(sx, gy, sw, out + size * 0.25);
        }
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
    const P = padOf(px), pad = P * inv, dw = (px + P * 2) * inv;
    let cracked = null, glints = null;

    if (ghost) {                                   // landing preview: shimmering light, see drawShimmer
      const ga = alpha * ctx.globalAlpha;
      ctx.save();
      drawShimmer(ctx, cells, size, px, dpr, ga, t);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha *= alpha;
    const ga = ctx.globalAlpha;
    const big = cells.length >= LAYER_MIN_CELLS, sheer = alpha < 1 && cells.length > 1;
    const layer = big || sheer ? groupLayer(cells, px, dpr, big, sheer) : null;
    if (layer) ctx.drawImage(layer.cv, 0, 0, layer.w, layer.h, layer.x * inv, layer.y * inv, layer.w * inv, layer.h * inv);
    else {
      for (let i = 0; i < cells.length; i++) {     // contact shadows first: they never darken a neighbour
        const c = cells[i];
        const sp = getSprite(TYPE_INDEX[c.type] | 0, c.conn & 15, ((c.seed >>> 0) >>> 7) % VARIANTS, px, false);
        ctx.drawImage(sp.shadow, Math.round(c.x * dpr) * inv - pad, Math.round(c.y * dpr) * inv - pad, dw, dw);
      }
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], conn = c.conn & 15, seed = c.seed >>> 0, ti = TYPE_INDEX[c.type] | 0;
      if (!layer) {
        const sp = getSprite(ti, conn, (seed >>> 7) % VARIANTS, px, false);
        // snap to device pixels: crisp blit and gap-free joints
        ctx.drawImage(sp, Math.round(c.x * dpr) * inv - pad, Math.round(c.y * dpr) * inv - pad, dw, dw);
      }
      if (c.crack > 0) (cracked || (cracked = [])).push(c);
      // Idle glints: now and then a highlight flares up for a moment - on the lit corner of a chunk or
      // somewhere along its ridge. Rare, and out of phase between cells (seed).
      const period = 3800 + seed % 2900, tt = t + (seed >>> 3) % period, ph = (tt % period) / 620;
      if (ph < 1) {
        const pick = hash32(seed, Math.floor(tt / period)), corner = !(conn & 9), r = ((pick >>> 8) & 255) / 255;
        if (pick % 3 > (corner ? 1 : 0) || (ti === O_INDEX && !corner)) continue;
        let gx = K.ridgeX, gy = K.ridgeY;
        if (corner && (pick & 16 || ti === O_INDEX)) { gx = GLINT.x; gy = GLINT.y; }
        else if (!(conn & 5) && conn & 10) gx = 0.15 + r * 0.7;
        else if (!(conn & 10) && conn & 5) gy = 0.15 + r * 0.7;
        (glints || (glints = [])).push(c.x + size * gx, c.y + size * gy, Math.sin(ph * Math.PI) * (0.7 + 0.3 * r));
      }
    }
    if (cracked) drawCracks(ctx, cracked, size, px, dpr, alpha);
    if (glints) {
      const sp = glintSprite(), R = size * 0.36;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < glints.length; i += 3) {
        ctx.globalAlpha = ga * glints[i + 2];
        ctx.drawImage(sp, glints[i] - R, glints[i + 1] - R, R * 2, R * 2);
      }
    }
    ctx.restore();
  }

  // Fracture overlay for cells with crack > 0: the blocks light up from inside and baked crack patterns
  // grow step by step; the fracture sweeps outwards from the middle of the cracking group.
  function drawCracks(ctx, list, size, px, dpr, alpha) {
    const inv = 1 / dpr, pad = PAD * inv, dw = (px + PAD * 2) * inv, n = list.length;
    const P = padOf(px), bpad = P * inv, bdw = (px + P * 2) * inv;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < n; i++) { minX = Math.min(minX, list[i].x); maxX = Math.max(maxX, list[i].x); }
    const midX = (minX + maxX) / 2, half = Math.max(size, (maxX - minX) / 2);
    for (let pass = 0; pass < 2; pass++) {             // 0: additive brighten, 1: crack lines
      ctx.globalCompositeOperation = pass ? 'source-over' : 'lighter';
      if (pass) ctx.globalAlpha = alpha;
      for (let i = 0; i < n; i++) {
        const c = list[i], seed = c.seed >>> 0;
        // per-cell progress 0..1; cells further from the middle lag behind
        const k = Math.max(0.04, Math.min(1, Math.min(1, c.crack) * 1.6 - 0.6 * Math.abs(c.x - midX) / half));
        const X = Math.round(c.x * dpr) * inv, Y = Math.round(c.y * dpr) * inv;
        if (pass) ctx.drawImage(crackSprite(seed, Math.max(1, Math.ceil(k * CRACK_LEVELS)), px), X - pad, Y - pad, dw, dw);
        else {
          ctx.globalAlpha = alpha * 0.3 * k;
          ctx.drawImage(getSprite(TYPE_INDEX[c.type] | 0, c.conn & 15, (seed >>> 7) % VARIANTS, px, false), X - bpad, Y - bpad, bdw, bdw);
        }
      }
    }
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Effects: shatter (translucent shards, sparkling dust, soft glints, row flash) and lock sparkle
   * ------------------------------------------------------------------------------------------------ */
  const GRAVITY = 0.000037;      // cell sizes per ms^2

  function createFx() {
    const shards = [[], [], [], [], [], [], []];   // grouped by crystal type (palette lookup per group)
    let dust = [], stars = [], flashes = [];

    function addStar(x, y, R, life, delay) { stars.push({ x: x, y: y, R: R, life: life, max: life, delay: delay }); }

    function shatter(cells, o) {
      if (!cells || !cells.length) return;
      const rows = Math.max(1, Math.min(4, (o && o.rows) | 0 || 1));
      const power = 0.78 + 0.27 * rows;                           // more rows: faster, higher, longer
      // The polygon budget per burst is roughly constant: one row breaks into fine shards, more rows
      // trade fineness for sheer numbers (four rows also leave the small concentric splinters fused to
      // their wedge).
      const fine = rows === 1, rich = rows <= 2;
      let minX = Infinity, maxX = -Infinity;
      const rowY = new Map();
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (!(c.size > 0)) continue;
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x + c.size);
        const key = Math.round(c.y), r = rowY.get(key);
        if (r) { r.x0 = Math.min(r.x0, c.x); r.x1 = Math.max(r.x1, c.x + c.size); }
        else rowY.set(key, { x0: c.x, x1: c.x + c.size, y: c.y, h: c.size });
      }
      const midX = (minX + maxX) / 2, half = Math.max(1, (maxX - minX) / 2);
      rowY.forEach(function (r) {
        const life = 85 + 14 * rows;
        flashes.push({ x: r.x0, y: r.y, w: r.x1 - r.x0, h: r.h, life: life, max: life });
      });

      for (let i = 0; i < cells.length; i++) {
        const c = cells[i], s = c.size;
        if (!(s > 0)) continue;
        const seed = c.seed >>> 0, f = fracture(seed), rnd = mulberry32(seed ^ 0x51F15E), ti = TYPE_INDEX[c.type] | 0;
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
          let cx = 0, cy = 0;
          for (let v = 0; v < n; v++) { cx += poly[v * 2]; cy += poly[v * 2 + 1]; }
          cx /= n; cy /= n;
          // local vertices, stored in a frame rotated by -axis so the tumble (flip) axis differs per shard
          const axis = rnd() * TAU, ca = Math.cos(axis), sa = Math.sin(axis);
          const loc = new Float32Array(n * 2);
          let rad = 0;
          for (let v = 0; v < n; v++) {
            const lx = (poly[v * 2] - cx) * s, ly = (poly[v * 2 + 1] - cy) * s;
            loc[v * 2] = lx * ca + ly * sa; loc[v * 2 + 1] = -lx * sa + ly * ca;
            rad = Math.max(rad, Math.hypot(lx, ly));
          }
          let dx = cx - f.px, dy = cy - f.py;                     // fly away from the impact point
          const dl = Math.hypot(dx, dy) || 1;
          dx /= dl; dy /= dl;
          const sp = s * (0.0028 + rnd() * 0.0062) * power;
          // big bursts carry many more shards, so each one clears the playfield a little sooner
          const life = (290 + rnd() * 330 + rad / s * 240) * (rich ? 1 : 0.86);
          shards[ti].push({
            n: n, loc: loc, w: new Float32Array(n * 2), s: s, tone: 0, k: 1, neg: false, flash: false,
            x: c.x + cx * s, y: c.y + cy * s,
            vx: dx * sp + side * s * 0.0035 * power * rnd(),
            vy: dy * sp - s * (0.004 + rnd() * 0.009) * (1.15 + 0.07 * rows),  // fountain upwards
            a: axis, va: (rnd() - 0.5) * 0.016,
            ph: rnd() * Math.PI, vph: 0.004 + rnd() * 0.009,
            life: life, max: life,
          });
        }
        const nd = (fine ? 8 : rich ? 6 : 4) + (rnd() < 0.5 ? 1 : 0);   // glitter dust
        for (let j = 0; j < nd; j++) {
          const ang = rnd() * TAU, sp = s * (0.002 + rnd() * 0.011) * power, life = 340 + rnd() * 640;
          dust.push({
            x: c.x + rnd() * s, y: c.y + rnd() * s, s: s,
            vx: Math.cos(ang) * sp + side * s * 0.003, vy: Math.sin(ang) * sp - s * 0.004 * power,
            r: s * (0.05 + rnd() * 0.075), ph: rnd() * TAU, life: life, max: life,
          });
        }
        if (rnd() < 0.12 + 0.02 * rows) {                         // a few soft glints popping along the rows
          addStar(c.x + rnd() * s, c.y + rnd() * s, s * (0.26 + rnd() * 0.2 + 0.04 * rows), 220 + rnd() * 160, rnd() * 110);
        }
      }
    }

    // Subtle twinkle when a piece locks: a glint on each chunk's lit corner plus a few rising motes.
    function sparkle(cells) {
      if (!cells || !cells.length) return;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i], s = c.size;
        if (!(s > 0)) continue;
        const rnd = mulberry32((c.seed >>> 0) ^ 0x7A11CE);
        if (!(c.conn & 9)) addStar(c.x + s * GLINT.x, c.y + s * GLINT.y, s * 0.38, 320, 0);
        if (!(c.conn & 1)) {
          const life = 240 + rnd() * 220;
          dust.push({
            x: c.x + rnd() * s, y: c.y + s * 0.08, s: s, vx: (rnd() - 0.5) * s * 0.003, vy: -s * (0.002 + rnd() * 0.003),
            r: s * (0.05 + rnd() * 0.04), ph: rnd() * TAU, life: life, max: life,
          });
        }
      }
    }

    function age(list, dt) {                                      // advance lifetimes, drop the dead
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.delay > 0) { p.delay -= dt; list[n++] = p; continue; }
        p.life -= dt;
        if (p.life > 0) list[n++] = p;
      }
      list.length = n;
    }

    function update(dt) {
      dt = +dt;
      if (!(dt > 0)) return;
      const drag = Math.exp(-dt * 0.0021), dustDrag = Math.exp(-dt * 0.0042);
      for (let ti = 0; ti < 7; ti++) {
        const list = shards[ti];
        if (!list.length) continue;
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          p.vx *= drag; p.vy = p.vy * drag + GRAVITY * p.s * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt; p.ph += p.vph * dt;
        }
        age(list, dt);
      }
      for (let i = 0; i < dust.length; i++) {
        const p = dust[i];
        p.vx *= dustDrag; p.vy = p.vy * dustDrag + GRAVITY * 0.45 * p.s * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.ph += dt * 0.021;
      }
      age(dust, dt); age(stars, dt); age(flashes, dt);
    }

    // Append one shard to the current path. Mirrored shards are emitted in reverse so that every polygon
    // has the same winding (overlapping shards of one batch must not punch holes into each other).
    function traceShard(ctx, p) {
      const w = p.w, n = p.n, x = p.x, y = p.y;
      if (p.neg) {
        ctx.moveTo(x + w[n * 2 - 2], y + w[n * 2 - 1]);
        for (let v = n - 2; v >= 0; v--) ctx.lineTo(x + w[v * 2], y + w[v * 2 + 1]);
      } else {
        ctx.moveTo(x + w[0], y + w[1]);
        for (let v = 1; v < n; v++) ctx.lineTo(x + w[v * 2], y + w[v * 2 + 1]);
      }
      ctx.closePath();
    }

    function draw(ctx, opts) {
      if (!ctx || !(flashes.length || count() > 0)) return;
      const dpr = opts && opts.dpr > 0 ? opts.dpr : 1;
      ctx.save();
      // short soft flash of light along the cleared rows, narrowing to the row centre line
      if (flashes.length) {                      // (white light: plain alpha blending looks the same as adding)
        for (let i = 0; i < flashes.length; i++) {
          const fl = flashes[i], f = fl.life / fl.max, h = fl.h * (0.45 + 1.5 * f), y = fl.y + (fl.h - h) / 2;
          const a = Math.min(1, f * 1.25), bar = ctx.createLinearGradient(0, y, 0, y + h);
          bar.addColorStop(0, 'rgba(255,255,255,0)');
          bar.addColorStop(0.3, 'rgba(255,255,255,' + (a * 0.5).toFixed(3) + ')');
          bar.addColorStop(0.5, 'rgba(255,255,255,' + a.toFixed(3) + ')');
          bar.addColorStop(0.7, 'rgba(255,255,255,' + (a * 0.5).toFixed(3) + ')');
          bar.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = bar;
          ctx.fillRect(fl.x, y, fl.w, h);
        }
      }

      // shards: tumbling splinters of the stone - a translucent body in the colour of the block, a
      // lighter inner facet, thin bright edges, and a white flash whenever a face catches the light
      ctx.lineJoin = 'bevel';
      for (let ti = 0; ti < 7; ti++) {
        const list = shards[ti];
        if (!list.length) continue;
        const col = PALS[ti].shard;
        let nGlint = 0;
        for (let i = 0; i < list.length; i++) {
          const p = list[i], f = p.life / p.max;
          const flip = Math.cos(p.ph);
          const k = f > 0.4 ? 1 : Math.pow(f / 0.4, 0.75);        // shrink away at the end of life
          const fx = (flip < 0 ? -1 : 1) * Math.max(0.34, Math.abs(flip)) * k;
          const ca = Math.cos(p.a), sa = Math.sin(p.a), loc = p.loc, w = p.w;
          for (let v = 0; v < p.n; v++) {
            const lx = loc[v * 2] * fx, ly = loc[v * 2 + 1] * k;
            w[v * 2] = lx * ca - ly * sa; w[v * 2 + 1] = lx * sa + ly * ca;
          }
          p.k = k; p.neg = flip < 0;
          // 0 = specular flash (white-hot right after the impact, then twice per turn), 1 = lit face, 2 = averted face
          const g = (p.ph + 2.6) % Math.PI;
          p.tone = p.max - p.life < 20 || g < 0.4 ? 0 : flip > 0 ? 1 : 2;
          p.flash = g < 0.4 && k > 0.8 && p.n > 3;
          if (!p.tone) nGlint++;
        }
        ctx.lineWidth = 1 / dpr;                                   // hairline: the cheapest stroke there is
        ctx.strokeStyle = col[3];
        for (let tone = 2; tone >= 1; tone--) {
          ctx.beginPath();
          for (let i = 0; i < list.length; i++) if (list[i].tone === tone) traceShard(ctx, list[i]);
          ctx.fillStyle = col[tone - 1];
          ctx.fill();
          ctx.stroke();
        }
        ctx.beginPath();                                          // lit faces: a lighter facet over half of the shard, up to a ridge through its centre
        for (let i = 0; i < list.length; i++) {
          const p = list[i], w = p.w, m = (p.n + 1) >> 1;
          if (p.tone !== 1 || p.k < 0.6) continue;
          ctx.moveTo(p.x, p.y);
          for (let v = 0; v <= m; v++) ctx.lineTo(p.x + w[v * 2], p.y + w[v * 2 + 1]);
        }
        ctx.fillStyle = col[2];
        ctx.fill();
        if (nGlint) {                                             // faces that catch the light flash up
          ctx.beginPath();
          for (let i = 0; i < list.length; i++) if (!list[i].tone) traceShard(ctx, list[i]);
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.fill();
          const sp = glintSprite(), R = list[0].s * 0.42;
          for (let i = 0; i < list.length; i++) {
            const p = list[i];
            if (p.flash) ctx.drawImage(sp, p.x - R, p.y - R, R * 2, R * 2);
          }
        }
      }

      // fine sparkling dust (tiny points, the brightest with a hairline flare) and soft glints
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < dust.length; i++) {
        const p = dust[i], tw = 0.55 + 0.45 * Math.sin(p.ph), r = p.r * 0.4 * Math.min(1, p.life / p.max * 1.6) * tw;
        if (r < 0.15) continue;
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        if (tw > 0.9 && r > 0.45) {
          ctx.fillRect(p.x - r * 3.4, p.y - r * 0.28, r * 6.8, r * 0.56);
          ctx.fillRect(p.x - r * 0.28, p.y - r * 3.4, r * 0.56, r * 6.8);
        }
      }
      if (stars.length) {
        const sp = glintSprite();
        for (let i = 0; i < stars.length; i++) {
          const p = stars[i];
          if (p.delay > 0) continue;
          const e = Math.sin(Math.PI * p.life / p.max), R = p.R * (1.1 + 0.7 * e);
          ctx.globalAlpha = Math.pow(e, 0.6);
          ctx.drawImage(sp, p.x - R, p.y - R, R * 2, R * 2);
        }
      }
      ctx.restore();
    }

    function count() {
      let n = dust.length + stars.length;
      for (let ti = 0; ti < 7; ti++) n += shards[ti].length;
      return n;
    }

    return {
      shatter: shatter, sparkle: sparkle, update: update, draw: draw,
      get active() { return count() + flashes.length > 0; },
      get count() { return count(); },
      reset: function () { for (let ti = 0; ti < 7; ti++) shards[ti].length = 0; dust = []; stars = []; flashes = []; },
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
      sprites.clear(); spritePixels = 0; crackSprites.clear();
      layers.length = 0; seenSigs.fill(0); scratch = null; prismMask = null; prismTint = null;
    },
  };
})(globalThis.KF = globalThis.KF || {});
