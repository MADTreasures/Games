/*
 * Crystal Drop - animated cartoon cave backdrop (KF.Cave)
 *
 * Every level theme is a small procedural cave: three overlapping cel-shaded rock "rings"
 * (near, middle, far) around a dim back chamber, quartz clusters growing out of the rock,
 * plus one or two theme features (icicles, lava, lake ...).
 *
 * The static picture of a theme is baked once into an offscreen canvas. draw() only blits it
 * and adds cheap overlays (breathing glows, twinkles, light shafts, particles, fog, drips).
 * Everything is seeded per theme and driven by update(dt): no Math.random, no clocks.
 *
 * Adding a theme = adding one entry to THEMES (see NOTES.md).
 */
(function (KF) {
  'use strict';

  const TAU = Math.PI * 2;
  const FADE_MS = 1500;               // crossfade between two themes
  const MAX_BAKE_PIXELS = 6e6;        // huge canvases are baked at a reduced scale and stretched
  const BAKE_STEPS_PER_UPDATE = 99;   // lower it to spread the bake of a new theme over several frames
  const LIGHT_X = -0.64, LIGHT_Y = -0.77;   // unit vector pointing to the light (top-left)
  const WHITE = [255, 255, 255];

  // Rock rings from near to far: wall thickness as a fraction of width / height,
  // haze (how far the colours sink into the theme's deep colour) and feature scale.
  const LAYERS = [
    { side: 0.07, top: 0.072, bottom: 0.088, haze: 0, scale: 1 },
    { side: 0.185, top: 0.15, bottom: 0.158, haze: 0.42, scale: 0.72 },
    { side: 0.30, top: 0.245, bottom: 0.238, haze: 0.7, scale: 0.5 },
  ];

  /*
   * THEMES - theme of a level = THEMES[(level - 1) % THEMES.length]. Colours are [hue, sat %, light %].
   *   rock / deep / light  near rock colour, colour of the deepest darkness, colour of light and glow
   *   crystals             1-3 quartz colours (the first one dominates)
   *   density, crystalSize how many clusters and how big (1 = normal)
   *   spikes, chunk, round stalactite frequency, roughness of the rock lips, roundness of the openings
   *   features             names from FEATURES; particles: kind from PARTICLE_KINDS, count, colour
   */
  const THEMES = [
    { key: 'ice', name: 'Bergkristall', seed: 11, rock: [207, 34, 33], deep: [222, 58, 8], light: [194, 85, 86],
      crystals: [[202, 62, 74], [188, 55, 84], [216, 64, 66]], density: 1, crystalSize: 1, spikes: 1.35, chunk: 1, round: 0.15,
      features: ['icicles', 'drips'], particles: { kind: 'snow', count: 26, color: [198, 80, 92] } },
    { key: 'amethyst', name: 'Amethyst', seed: 23, rock: [274, 30, 27], deep: [266, 55, 7], light: [286, 80, 82],
      crystals: [[272, 62, 64], [292, 55, 68], [256, 60, 70]], density: 1.25, crystalSize: 0.9, spikes: 0.45, chunk: 0.8, round: 0.3,
      features: ['studs'], particles: { kind: 'dust', count: 22, color: [285, 80, 86] } },
    { key: 'moss', name: 'Prasiolith', seed: 37, rock: [128, 20, 23], deep: [156, 48, 6], light: [100, 70, 76],
      crystals: [[142, 46, 60], [122, 42, 68], [160, 48, 56]], density: 0.9, crystalSize: 1, spikes: 0.9, chunk: 1.15, round: 0.2,
      features: ['moss', 'drips'], particles: { kind: 'spore', count: 20, color: [88, 90, 74] } },
    { key: 'citrine', name: 'Citrin', seed: 41, rock: [26, 34, 27], deep: [18, 52, 7], light: [46, 95, 76],
      crystals: [[44, 86, 58], [36, 88, 62], [52, 82, 68]], density: 1, crystalSize: 1.05, spikes: 0.8, chunk: 1.25, round: 0.12,
      features: ['veins'], particles: { kind: 'dust', count: 24, color: [46, 95, 78] } },
    { key: 'rose', name: 'Rosenquarz', seed: 53, rock: [334, 24, 31], deep: [318, 42, 9], light: [342, 90, 88],
      crystals: [[340, 70, 76], [352, 66, 80], [324, 54, 74]], density: 0.8, crystalSize: 1.2, spikes: 0.6, chunk: 0.75, round: 0.26,
      features: ['mist'], particles: { kind: 'dust', count: 18, color: [345, 90, 90] } },
    { key: 'carnelian', name: 'Karneol', seed: 67, rock: [10, 30, 21], deep: [6, 62, 6], light: [26, 100, 62],
      crystals: [[18, 86, 56], [8, 80, 52], [30, 92, 60]], density: 0.9, crystalSize: 1, spikes: 1.2, chunk: 1.3, round: 0.1,
      features: ['lava'], particles: { kind: 'ember', count: 28, color: [30, 100, 62] } },
    { key: 'lake', name: 'Blauquarz', seed: 79, rock: [224, 34, 21], deep: [228, 62, 6], light: [182, 72, 72],
      crystals: [[218, 72, 60], [204, 78, 64], [234, 60, 68]], density: 1, crystalSize: 1, spikes: 1, chunk: 0.95, round: 0.22,
      features: ['lake', 'drips'], particles: { kind: 'bubble', count: 16, color: [185, 70, 80] } },
    { key: 'smoky', name: 'Rauchquarz', seed: 97, rock: [28, 9, 23], deep: [258, 14, 5], light: [40, 32, 82],
      crystals: [[32, 22, 66], [24, 16, 76], [42, 14, 54]], density: 0.7, crystalSize: 1.35, spikes: 0.75, chunk: 1.4, round: 0.16,
      features: ['fog'], particles: { kind: 'dust', count: 16, color: [40, 30, 85] } },
  ];

  // Particle behaviours. Speeds in screen units (1/100 of the short side) per second,
  // zone = vertical band (fractions of the height) the particles live in.
  const PARTICLE_KINDS = {
    dust: { vx: 0.45, vy: -0.25, wobble: 2.2, size: [0.3, 0.6], zone: [0, 1], pulse: 0.6 },
    snow: { vx: 0.25, vy: 2.1, wobble: 1.4, size: [0.25, 0.5], zone: [0, 1], pulse: 0.5 },
    ember: { vx: 0.3, vy: -3.2, wobble: 1.8, size: [0.3, 0.6], zone: [0.3, 1], pulse: 0.35, fadeTop: true },
    spore: { vx: 0.5, vy: -0.6, wobble: 3.5, size: [0.4, 0.75], zone: [0.1, 0.95], pulse: 0.9 },
    bubble: { vx: 0, vy: -1.6, wobble: 0.8, size: [0.35, 0.7], zone: [0.62, 0.98], pulse: 0.2, fadeTop: true, ring: true },
  };

  // ------------------------------------------------------------------ small helpers
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function mod(v, m) { return ((v % m) + m) % m; }

  // Seeded generator (mulberry32) with a few conveniences.
  function makeRng(seed) {
    let a = seed >>> 0;
    const R = function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    R.range = (lo, hi) => lo + (hi - lo) * R();
    R.int = n => Math.floor(R() * n);
    R.chance = p => R() < p;
    return R;
  }

  // [h 0..360, s 0..100, l 0..100] -> [r, g, b] 0..255
  function hsl(c) {
    const h = mod(c[0], 360) / 60, s = clamp(c[1], 0, 100) / 100, l = clamp(c[2], 0, 100) / 100;
    const ch = (1 - Math.abs(2 * l - 1)) * s, x = ch * (1 - Math.abs(h % 2 - 1)), m = l - ch / 2, i = Math.floor(h) % 6;
    return [([ch, x, 0, 0, x, ch][i] + m) * 255, ([x, ch, ch, x, 0, 0][i] + m) * 255, ([0, 0, x, ch, ch, x][i] + m) * 255];
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function css(c, alpha) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (alpha === undefined ? 1 : alpha) + ')';
  }

  // All colours of a theme: rock tones per haze level, crystal tones per colour index.
  function makePalette(T) {
    const deep = hsl(T.deep), light = hsl(T.light), r = T.rock, n = T.crystals.length, cache = {};
    return {
      deep, light,
      rock(haze) {
        const f = (c, k) => css(mix(hsl(c), deep, haze * (k || 1)));
        return {
          base: f(r), lit: f([r[0], r[1] * 0.95, r[2] + 8]), lit2: f([r[0] - 4, r[1] * 0.8, r[2] + 17]),
          shade: f([r[0] + 6, r[1] * 1.05, r[2] * 0.66]), ink: f([r[0] + 8, r[1] * 1.1, r[2] * 0.25], 0.7),
        };
      },
      crystal(i, haze) {
        const key = mod(i, n) + ':' + haze;
        if (cache[key]) return cache[key];
        const c = T.crystals[mod(i, n)], mid = hsl(c), f = x => css(mix(x, deep, haze * 0.8));
        return (cache[key] = {
          tip: f(mix(mid, WHITE, 0.9)), pale: f(mix(mid, WHITE, 0.68)), light: f(mix(mid, WHITE, 0.32)), mid: f(mid),
          dark: f(hsl([c[0] + 8, c[1], c[2] * 0.68])), darker: f(hsl([c[0] + 12, c[1], c[2] * 0.5])),
          ink: f(hsl([c[0] + 8, Math.min(75, c[1] + 8), Math.max(7, c[2] * 0.2)])), glint: f(WHITE),
        });
      },
      glow(i) { return mix(hsl(T.crystals[mod(i, n)]), light, 0.25); },
    };
  }

  // ------------------------------------------------------------------ sprites (baked once, reused every frame)
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function makeGlowSprite(rgb) {
    const c = makeCanvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, css(rgb, 0.85)); gr.addColorStop(0.35, css(rgb, 0.38)); gr.addColorStop(0.7, css(rgb, 0.1)); gr.addColorStop(1, css(rgb, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  }
  function makeDotSprite(rgb, ring) {
    const c = makeCanvas(16, 16), g = c.getContext('2d');
    if (ring) { g.strokeStyle = css(rgb, 0.9); g.lineWidth = 1.6; g.beginPath(); g.arc(8, 8, 5.5, 0, TAU); g.stroke(); return c; }
    const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    gr.addColorStop(0, css(mix(rgb, WHITE, 0.5), 1)); gr.addColorStop(0.35, css(rgb, 0.75)); gr.addColorStop(1, css(rgb, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
    return c;
  }
  let starSprite = null;
  function getStarSprite() {            // four-pointed twinkle
    if (starSprite) return starSprite;
    const c = makeCanvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 20);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#fff'; g.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8, r = i % 2 ? 4.2 : (i % 4 ? 22 : 30); g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    g.closePath(); g.fill();
    return (starSprite = c);
  }
  function makeShaftSprite(rgb) {       // slanted light beam: two hard-edged trapezoids fading downwards
    const c = makeCanvas(64, 128), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, css(rgb, 0)); gr.addColorStop(0.1, css(rgb, 0.5)); gr.addColorStop(1, css(rgb, 0));
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(22, 0); g.lineTo(42, 0); g.lineTo(64, 128); g.lineTo(0, 128); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(28, 0); g.lineTo(37, 0); g.lineTo(46, 128); g.lineTo(16, 128); g.closePath(); g.fill();
    return c;
  }
  function makeFogSprite(rgb) {         // a bank of overlapping soft puffs
    const c = makeCanvas(160, 64), g = c.getContext('2d'), R = makeRng(4711);
    for (let i = 0; i < 10; i++) {
      const x = 26 + R() * 108, y = 24 + R() * 16, r = 14 + R() * 10, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, css(rgb, 0.5)); gr.addColorStop(1, css(rgb, 0));
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return c;
  }

  // ------------------------------------------------------------------ drawing primitives (bake time only)
  function poly(g, pts, dx, dy) {
    dx = dx || 0; dy = dy || 0;
    g.moveTo(pts[0][0] + dx, pts[0][1] + dy);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + dx, pts[i][1] + dy);
    g.closePath();
  }
  // Irregular n-gon around (x, y).
  function blob(R, x, y, rx, ry, n, jitter) {
    const pts = [], a0 = R() * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i + R.range(-0.25, 0.25)) / n * TAU, f = 1 + R.range(-jitter, jitter);
      pts.push([x + Math.cos(a) * rx * f, y + Math.sin(a) * ry * f]);
    }
    return pts;
  }
  // Flat cel shading of any shape, lit from the top-left: a bright rim and a lit band where the
  // shape faces the light, a shade band on the opposite rim, base tone in between.
  // trace(dx, dy) must add the shape's path shifted by (dx, dy).
  function celShape(B, trace, rule, tones, d) {
    const g = B.g, ox = d * 0.75, oy = d;
    g.save();
    g.beginPath(); trace(0, 0); g.clip(rule); g.fillStyle = tones.lit2; g.fillRect(0, 0, B.W, B.H);
    g.beginPath(); trace(ox * 0.28, oy * 0.28); g.clip(rule); g.fillStyle = tones.lit; g.fillRect(0, 0, B.W, B.H);
    g.beginPath(); trace(ox, oy); g.clip(rule); g.fillStyle = tones.shade; g.fillRect(0, 0, B.W, B.H);
    g.beginPath(); trace(-ox * 0.9, -oy * 0.9); g.fillStyle = tones.base; g.fill(rule);
    g.restore();
  }
  function star(g, x, y, r, fill) {
    g.fillStyle = fill; g.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8, q = i % 2 ? r * 0.26 : r; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
    g.closePath(); g.fill();
  }
  function softGlow(g, x, y, r, rgb, alpha) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, css(rgb, alpha)); gr.addColorStop(0.45, css(rgb, alpha * 0.4)); gr.addColorStop(1, css(rgb, 0));
    g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
  }

  // One quartz point: hexagonal prism seen from the side (three flat faces) with a three-facet tip.
  // c = crystal tones, the face turned to the light is the near-white one.
  function drawPoint(g, bx, by, ang, len, w, c, lw) {
    const ax = Math.cos(ang), ay = Math.sin(ang);
    let px = -ay, py = ax;
    if (px * LIGHT_X + py * LIGHT_Y > 0) { px = -px; py = -py; }      // local -x is the lit side
    const hw = w / 2, tl = Math.min(len * 0.45, w * 1.05), sh = len - tl, e = -w * 0.3;
    const x1 = -hw + w * 0.36, x2 = hw - w * 0.24, apex = w * 0.05;
    const s1 = sh + tl * 0.14, s2 = sh + tl * 0.08, s3 = sh - tl * 0.08;
    const face = (fill, q) => {
      g.beginPath();
      for (let i = 0; i < q.length; i += 2) {
        const X = bx + ax * q[i + 1] + px * q[i], Y = by + ay * q[i + 1] + py * q[i];
        if (i) g.lineTo(X, Y); else g.moveTo(X, Y);
      }
      g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
    };
    const outline = [-hw, e, -hw, sh, apex, len, hw, s3, hw, e];
    face(c.mid, outline);
    face(c.pale, [-hw, e, x1, e, x1, s1, -hw, sh]);
    face(c.dark, [x2, e, hw, e, hw, s3, x2, s2]);
    face(c.tip, [-hw, sh, x1, s1, apex, len]);
    face(c.light, [x1, s1, x2, s2, apex, len]);
    face(c.darker, [x2, s2, hw, s3, apex, len]);
    if (w > 7) { g.globalAlpha = 0.3; face(c.glint, [x1, sh * 0.36, x2, sh * 0.5, x2, sh * 0.64, x1, sh * 0.5]); g.globalAlpha = 1; }
    face(null, outline); g.strokeStyle = c.ink; g.lineWidth = lw; g.stroke();
    if (w > 5) star(g, bx + ax * sh * 0.84 + px * -hw * 0.3, by + ay * sh * 0.84 + py * -hw * 0.3, w * 0.42, c.glint);
  }

  // A cluster: a fan of 1-7 points around the direction c.ang, the longest near the middle.
  function drawCluster(B, c) {
    const g = B.g, R = B.R, haze = LAYERS[c.k].haze;
    const n = c.count || (c.cls >= 3 ? 6 + R.int(2) : c.cls === 2 ? 5 : c.cls === 1 ? 4 : 3);
    const tx = -Math.sin(c.ang), ty = Math.cos(c.ang), peak = R.range(-0.25, 0.25), pts = [];
    for (let i = 0; i < n; i++) {
      const o = n === 1 ? 0 : (i / (n - 1)) * 2 - 1 + R.range(-0.1, 0.1);
      const len = c.size * Math.max(0.3, 1 - 0.62 * Math.pow(Math.abs(o - peak), 1.25)) * R.range(0.85, 1.05);
      pts.push({ o, len, w: Math.max(len * R.range(0.2, 0.27), c.size * 0.11), ang: c.ang + o * 0.8 + R.range(-0.08, 0.08), col: R.chance(0.72) ? c.col : c.col + 1 });
    }
    pts.sort((p, q) => q.len - p.len);                                  // longest first = at the back
    const lw = clamp(c.size * 0.034, 1, 3);
    for (const p of pts) drawPoint(g, c.x + tx * p.o * c.size * 0.2, c.y + ty * p.o * c.size * 0.2, p.ang, p.len, p.w, B.pal.crystal(p.col, haze), lw);
    const m = pts[0];
    c.tipX = c.x + tx * m.o * c.size * 0.2 + Math.cos(m.ang) * m.len * 0.86;
    c.tipY = c.y + ty * m.o * c.size * 0.2 + Math.sin(m.ang) * m.len * 0.86;
    if (c.face) {                                                       // rubble hiding the roots of clusters that sit on a rock face
      const t = B.pal.rock(haze);
      for (let i = -1; i <= 1; i++) {
        const rad = c.size * R.range(0.13, 0.2), x = c.x + tx * i * c.size * 0.22, y = c.y + ty * i * c.size * 0.22;
        const b = blob(R, x, y, rad, rad * 0.8, 7, 0.2);
        g.beginPath(); poly(g, b); g.fillStyle = t.base; g.fill(); g.strokeStyle = t.ink; g.lineWidth = lw; g.stroke();
        g.beginPath(); poly(g, b.map(p => [x - rad * 0.2 + (p[0] - x) * 0.55, y - rad * 0.22 + (p[1] - y) * 0.55])); g.fillStyle = t.lit; g.fill();
      }
    }
  }
  function clusterGlow(B, c, strength) {
    const haze = LAYERS[c.k].haze, r = c.size * 1.2 + 3 * B.S;
    softGlow(B.g, c.x + Math.cos(c.ang) * c.size * 0.4, c.y + Math.sin(c.ang) * c.size * 0.4, r, B.pal.glow(c.col), 0.32 * strength * (1 - haze * 0.7));
  }

  // ------------------------------------------------------------------ scene generation
  // A ring is a rock frame around a jagged opening. The opening is one closed polygon walked
  // clockwise: ceiling (with stalactites), right wall, floor (with stalagmites), left wall.
  // Each point also stores the outward direction (into the rock) of its side.
  function buildRing(B, k) {
    const R = B.R, W = B.W, H = B.H, T = B.T, L = LAYERS[k], u = B.S * L.scale;
    const chunk = T.chunk || 1, spikes = T.spikes === undefined ? 1 : T.spikes, dens = T.density || 1, csize = T.crystalSize || 1;
    const l = W * L.side * R.range(0.85, 1.15), r = W - W * L.side * R.range(0.85, 1.15);
    const t = H * L.top * R.range(0.9, 1.12), b = H - H * L.bottom * R.range(0.9, 1.12);
    const cut = Math.min(r - l, b - t) * (T.round || 0.15), cx = (l + r) / 2, cy = (t + b) / 2;
    const ring = { k, unit: u, box: { l, r, t, b }, pts: [], clusters: [], tips: [], floorRange: [0, 0], ceilRange: [0, 0] };
    const sides = [
      { a: [l + cut, t], b: [r - cut, t], kind: 'ceil' }, { a: [r, t + cut], b: [r, b - cut], kind: 'wall' },
      { a: [r - cut, b], b: [l + cut, b], kind: 'floor' }, { a: [l, b - cut], b: [l, t + cut], kind: 'wall' },
    ];
    const CFG = {   // step / amp / spike sizes in ring units; gap = distance between crystal sites
      ceil: { step: 5.5, amp: 1.3, spike: 0.42 * spikes, len: [4, 15], width: 4.2, ledge: 0.15, arch: (b - t) * 0.03, gap: 17 },
      floor: { step: 6, amp: 1.1, spike: 0.24 * spikes, len: [3, 9], width: 5, ledge: 0.2, arch: (b - t) * 0.012, gap: 17 },
      wall: { step: 7, amp: 1.7, spike: 0.06, len: [2, 5], width: 4, ledge: 0.4, arch: (r - l) * 0.02, gap: 21 },
    };
    const SIZE = [[4.5, 7.5], [8.5, 12.5], [14, 18], [21, 27]];        // cluster size classes: small, medium, big, hero
    sides.forEach((sd, si) => {
      const cfg = CFG[sd.kind], dx = sd.b[0] - sd.a[0], dy = sd.b[1] - sd.a[1], len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, amp = cfg.amp * u * chunk, step = cfg.step * u;
      // point at distance s along the side, v units into the opening (the side itself is slightly arched)
      const at = (s, v) => { const o = v - cfg.arch * Math.sin(Math.PI * clamp(s / len, 0, 1)); return [sd.a[0] + ux * s + nx * o, sd.a[1] + uy * s + ny * o]; };
      // --- crystal sites are planned first so the profile can keep them free of stalactites
      const n = Math.max(k === 2 ? 1 : 2, Math.round(len / (u * cfg.gap) * dens * (k === 2 ? 0.7 : 1)));
      const quiet = [], bigAt = sd.kind === 'wall' ? R.int(n) : -1;
      for (let j = 0; j < n; j++) {
        const s = len * (j + 0.5 + R.range(-0.28, 0.28)) / n;
        let cls = R.chance(0.35) ? 1 : 0;
        if (sd.kind !== 'wall' && k < 2 && (j === 0 || j === n - 1)) {
          // corners of ceiling and floor: hero clusters on one diagonal, big ones on the other
          const left = (sd.kind === 'ceil') === (j === 0), top = sd.kind === 'ceil';
          cls = ((left === top) === (B.heroDiag === 0)) ? 3 - k : 2 - k;
        } else if (j === bigAt && k < 2) cls = 2 - k;
        const size = u * csize * R.range(SIZE[cls][0], SIZE[cls][1]), p = at(s, -amp * 0.8);
        // growth direction: surface normal blended with the direction to the middle of the cave
        const ang = Math.atan2(ny * 0.8 + (cy - p[1]) / (b - t), nx * 0.8 + (cx - p[0]) / (r - l)) + R.range(-0.22, 0.22);
        ring.clusters.push({ x: p[0], y: p[1], ang, size, k, cls, col: R.chance(0.6) ? 0 : 1 + R.int(2) });
        quiet.push([s - size * 0.2, s + size * 0.2]);
      }
      // --- jagged profile
      const start = ring.pts.length;
      const push = (s, v) => { const p = at(s, v); ring.pts.push([p[0], p[1], -nx, -ny]); return p; };
      let s = step * R.range(0.4, 0.9), v = 0;
      push(0, 0);
      while (s < len - step * 0.6) {
        const calm = quiet.some(q => s > q[0] && s < q[1]);
        const sl = u * (cfg.len[0] + (cfg.len[1] - cfg.len[0]) * Math.pow(R(), 1.7));
        const sw = Math.min(u * cfg.width * R.range(0.75, 1.25) * (0.55 + 0.45 * sl / (u * cfg.len[1])), len - step * 0.4 - s);
        if (!calm && sw > u * 1.5 && R.chance(cfg.spike)) {             // stalactite / stalagmite with a slight belly
          push(s, v); push(s + sw * 0.16, v + sl * 0.5);
          const tip = push(s + sw * R.range(0.4, 0.6), v + sl);
          push(s + sw * 0.84, v + sl * 0.45);
          v = R.range(-amp, amp); s += sw; push(s, v);
          ring.tips.push({ x: tip[0], y: tip[1], len: sl, kind: sd.kind });
        } else if (R.chance(cfg.ledge)) {                               // blocky step
          push(s, v); v = calm ? -amp * 0.6 : R.range(-amp, amp); push(s + step * 0.1, v);
        } else { v = calm ? -amp * 0.6 : R.range(-amp, amp); push(s, v); }
        s += step * R.range(0.6, 1.45);
      }
      push(len, 0);
      if (sd.kind === 'floor') ring.floorRange = [start, ring.pts.length];
      if (sd.kind === 'ceil') ring.ceilRange = [start, ring.pts.length];
      // chunky corner vertex between this side and the next one
      const nxt = sides[(si + 1) % 4].a, mx = (sd.b[0] + nxt[0]) / 2, my = (sd.b[1] + nxt[1]) / 2, out = R.range(0.05, 0.35) * cut;
      const ox = Math.sign(mx - cx) * 0.7, oy = Math.sign(my - cy) * 0.7;
      ring.pts.push([mx + ox * out, my + oy * out, ox, oy]);
    });
    // --- small clusters sitting on the rock face of this ring's band (drawn over the rock)
    const bandX = W * (L.side - (k ? LAYERS[k - 1].side : 0)), bandY = H * (L.top - (k ? LAYERS[k - 1].top : 0));
    const area = 2 * (b - t) * bandX + 2 * (r - l) * bandY, nFace = Math.min(12, Math.round(area / (u * u * 900) * dens));
    for (let j = 0; j < nFace; j++) {
      const onWall = R.chance((b - t) * bandX * 2 / area), far = R.range(0.25, 0.85), f = R.range(0.04, 0.96), flip = R.chance(0.5);
      const x = onWall ? (flip ? l - bandX * far : r + bandX * far) : l + (r - l) * f;
      const y = onWall ? t + (b - t) * f : (flip ? t - bandY * far : b + bandY * far);
      const ang = Math.atan2((cy - y) / (b - t) * 0.7 - 0.45, (cx - x) / (r - l) * 0.7) + R.range(-0.5, 0.5);
      ring.clusters.push({ x, y, ang, size: u * csize * R.range(4, 8.5), k, cls: R.chance(0.3) ? 1 : 0, col: R.int(3), face: true });
    }
    return ring;
  }

  // Cracks, raised plates and strata strokes on the rock (drawn while clipped to the ring).
  function rockDetails(B, ring, t) {
    const g = B.g, R = B.R, u = ring.unit, pts = ring.pts, n = pts.length;
    for (let i = 0, m = Math.round(n / 3.5); i < m; i++) {              // raised stone plates
      const p = pts[R.int(n)], d = u * R.range(5, 12), e = u * 0.45;
      const b = blob(R, p[0] + p[2] * d, p[1] + p[3] * d, u * R.range(2.2, 4.8), u * R.range(1.6, 3.2), 6, 0.22);
      g.fillStyle = t.lit; g.beginPath(); poly(g, b, -e * 0.8, -e); g.fill();
      g.fillStyle = t.shade; g.beginPath(); poly(g, b, e * 0.8, e); g.fill();
      g.fillStyle = t.base; g.beginPath(); poly(g, b); g.fill();
    }
    g.strokeStyle = t.ink; g.lineWidth = Math.max(1, u * 0.3); g.beginPath();   // cracks running in from the lip
    for (let i = 0, m = Math.round(n / 4); i < m; i++) {
      const p = pts[R.int(n)];
      let x = p[0], y = p[1], a = Math.atan2(p[3], p[2]);
      g.moveTo(x, y);
      for (let s = 0; s < 3; s++) { a += R.range(-0.7, 0.7); const d = u * R.range(1.5, 3.2); x += Math.cos(a) * d; y += Math.sin(a) * d; g.lineTo(x, y); }
    }
    g.stroke();
    g.strokeStyle = t.shade; g.lineWidth = Math.max(1, u * 0.4); g.beginPath();   // strata strokes parallel to the lip
    for (let i = 0; i < n; i++) {
      if (!R.chance(0.3)) continue;
      const a = pts[i], b = pts[(i + 1) % n], d = u * R.range(3, 7.5), ox = (a[2] + b[2]) / 2 * d, oy = (a[3] + b[3]) / 2 * d;
      g.moveTo(a[0] + (b[0] - a[0]) * 0.15 + ox, a[1] + (b[1] - a[1]) * 0.15 + oy);
      g.lineTo(a[0] + (b[0] - a[0]) * 0.85 + ox, a[1] + (b[1] - a[1]) * 0.85 + oy);
    }
    g.stroke();
  }

  function boulders(B, ring, t) {
    const g = B.g, R = B.R, u = ring.unit, bx = ring.box, n = Math.round((bx.r - bx.l) / (u * 30)) + R.int(2);
    for (let i = 0; i < n; i++) {
      const rx = u * R.range(3, 6.5), ry = rx * R.range(0.6, 0.85), x = R.range(bx.l + rx, bx.r - rx), y = bx.b + ry * 0.2;
      const pts = blob(R, x, y, rx, ry, 8, 0.16);
      celShape(B, (dx, dy) => poly(g, pts, dx, dy), 'nonzero', t, u * 1.1);
      g.beginPath(); poly(g, pts); g.strokeStyle = t.ink; g.lineWidth = clamp(u * 0.55, 1.1, 4); g.stroke();
    }
  }

  // Rock column from ceiling to floor (wide screens only, between the far and the middle ring).
  function column(B, x) {
    const g = B.g, R = B.R, H = B.H, u = B.S * 0.62, t = B.pal.rock(0.56), base = u * R.range(3.2, 5), left = [], right = [];
    for (let y = -3 * u; y < H + 9 * u; y += u * R.range(5, 9)) {
      const flare = 1 + 1.7 * Math.pow(Math.abs(y / H - 0.48) * 2, 2.4);
      left.push([x - base * flare * R.range(0.8, 1.2), y]); right.push([x + base * flare * R.range(0.8, 1.2), y + u * R.range(-2, 2)]);
    }
    const pts = left.concat(right.reverse());
    celShape(B, (dx, dy) => poly(g, pts, dx, dy), 'nonzero', t, u * 1.8);
    g.beginPath(); poly(g, pts); g.strokeStyle = t.ink; g.lineWidth = clamp(u * 0.6, 1.1, 4); g.stroke();
  }

  // Deepest layer: dark wall with a far chamber lit by nested hard-edged light shapes.
  function paintBack(B) {
    const g = B.g, R = B.R, W = B.W, H = B.H, pal = B.pal, far = LAYERS[2];
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, css(mix(pal.deep, pal.light, 0.04))); gr.addColorStop(0.45, css(mix(pal.deep, pal.light, 0.08))); gr.addColorStop(1, css(pal.deep));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const cx = W * R.range(0.44, 0.56), cy = H * R.range(0.36, 0.46), rx = W * (0.5 - far.side), ry = H * (1 - far.top - far.bottom) * 0.5;
    [[1, 0.07], [0.72, 0.13], [0.45, 0.2]].forEach(q => {
      g.fillStyle = css(mix(pal.deep, pal.light, q[1])); g.beginPath(); poly(g, blob(R, cx, cy, rx * q[0], ry * q[0], 12, 0.14)); g.fill();
    });
  }

  // One rock ring with everything that belongs to it.
  function paintLayer(B, k) {
    const g = B.g, W = B.W, H = B.H, ring = B.rings[k], haze = LAYERS[k].haze, tones = B.pal.rock(haze), u = ring.unit, M = 60 * B.S;
    const trace = (dx, dy) => { g.rect(-M, -M, W + 2 * M, H + 2 * M); poly(g, ring.pts, dx, dy); };
    const lip = ring.clusters.filter(c => !c.face), face = ring.clusters.filter(c => c.face);
    if (k === 1 && W > H * 1.2) { column(B, W * B.R.range(0.23, 0.27)); column(B, W * B.R.range(0.73, 0.77)); }
    // crystals growing out from behind the rock lip; their glow lights the layers behind
    for (const c of lip) clusterGlow(B, c, 1);
    for (const c of lip) drawCluster(B, c);
    B.hook('behind', ring);
    // the rock: cel-shaded frame, surface detail, glow of its crystals on the stone, ink outline
    celShape(B, trace, 'evenodd', tones, u * 2.1);
    g.save(); g.beginPath(); trace(0, 0); g.clip('evenodd');
    rockDetails(B, ring, tones);
    B.hook('inRock', ring);
    for (const c of lip) clusterGlow(B, c, 0.55);
    g.restore();
    g.beginPath(); poly(g, ring.pts); g.strokeStyle = tones.ink; g.lineWidth = clamp(u * 0.62, 1.2, 4.5); g.stroke();
    if (k < 2) boulders(B, ring, tones);
    for (const c of face) { clusterGlow(B, c, 0.8); drawCluster(B, c); }
    B.hook('onRing', ring);
  }

  // ------------------------------------------------------------------ theme features
  // Hooks: behind(B, ring) before a ring's rock, inRock(B, ring) clipped to the rock,
  // onRing(B, ring) after the ring is complete, finish(B) once at the end.
  function veins(B, ring, cols, floorOnly, every) {     // branching mineral veins / glowing cracks
    const g = B.g, R = B.R, u = ring.unit, pts = ring.pts, i0 = floorOnly ? ring.floorRange[0] : 0, i1 = floorOnly ? ring.floorRange[1] : pts.length;
    for (let j = 0, n = Math.round((i1 - i0) / every); j < n; j++) {
      const p = pts[i0 + R.int(i1 - i0)], path = [];
      let x = p[0] + p[2] * u * 0.5, y = p[1] + p[3] * u * 0.5, a = Math.atan2(p[3], p[2]) + R.range(-0.5, 0.5);
      for (let s = 0, m = 4 + R.int(3); s < m; s++) { path.push([x, y]); a += R.range(-0.8, 0.8); const d = u * R.range(2.2, 4.5); x += Math.cos(a) * d; y += Math.sin(a) * d; }
      [[cols.ink, 1.5, 0], [cols.mid, 0.8, 0], [cols.hi, 0.28, -0.14]].forEach(q => {
        g.strokeStyle = q[0]; g.lineWidth = Math.max(0.8, u * q[1]); g.beginPath();
        path.forEach((v, i) => (i ? g.lineTo(v[0] + q[2] * u, v[1] + q[2] * u) : g.moveTo(v[0] + q[2] * u, v[1] + q[2] * u)));
        g.stroke();
      });
      if (ring.k === 0 && B.scene.glints.length < 6) B.scene.glints.push({ x: path[1][0], y: path[1][1], r: u * 1.6, period: R.range(4, 8), off: R() });
    }
  }
  // Flat cartoon liquid from y0 to the bottom (hidden by nearer rings where they cover it).
  function pool(B, y0, cols) {
    const g = B.g, R = B.R, W = B.W, H = B.H, S = B.S;
    g.fillStyle = cols.base; g.fillRect(0, y0, W, H - y0);
    for (let i = 0, n = Math.round(W / (S * 6)) + 8; i < n; i++) {      // hard-edged streaks, thinner towards the far shore
      const f = Math.pow(R(), 1.5), y = y0 + S * 0.9 + f * (H - y0) * 0.55, len = S * R.range(4, 13) * (0.5 + f), th = S * (0.25 + 0.7 * f), x = R.range(-0.05, 1.05) * W;
      g.fillStyle = R.chance(0.3) ? cols.hi : cols.band; g.beginPath();
      g.moveTo(x - len / 2, y); g.lineTo(x - len * 0.2, y - th / 2); g.lineTo(x + len * 0.3, y - th / 2); g.lineTo(x + len / 2, y); g.lineTo(x + len * 0.2, y + th / 2); g.lineTo(x - len * 0.3, y + th / 2);
      g.closePath(); g.fill();
    }
    g.fillStyle = cols.hi; g.fillRect(0, y0 - S * 0.1, W, S * 0.28);
    B.scene.shimmerColor = cols.hi;
    for (let i = 0; i < 7; i++) B.scene.shimmers.push({ x: W * R.range(0.2, 0.8), y: y0 + S * 1.2 + (H - y0) * 0.5 * Math.pow(R(), 1.4), w: S * R.range(4, 9), h: Math.max(1, S * 0.3), speed: R.range(0.5, 0.9), phase: R() * TAU });
  }
  function poolLevel(B) { const bx = B.rings[2].box; return bx.b - (bx.b - bx.t) * 0.15; }
  function addFog(B, rgb, alpha, y0, y1, n) {
    const g = B.g, R = B.R, W = B.W, H = B.H, S = B.S, gr = g.createLinearGradient(0, H * y0, 0, H * y1);
    gr.addColorStop(0, css(rgb, 0)); gr.addColorStop(0.55, css(rgb, alpha * 0.45)); gr.addColorStop(1, css(rgb, 0));
    g.fillStyle = gr; g.fillRect(0, H * y0, W, H * (y1 - y0));               // a resting veil, baked
    B.scene.fogSprite = makeFogSprite(rgb);
    for (let i = 0; i < n; i++) {                                           // drifting banks, animated
      const w = Math.max(W * 0.9, 70 * S) * R.range(0.8, 1.1), h = H * R.range(0.16, 0.22);
      B.scene.fogs.push({ y: H * (y0 + (y1 - y0) * (i + 0.5) / n) - h / 2, w, h, speed: S * R.range(0.5, 1) * (i % 2 ? -1 : 1), a: alpha * R.range(0.8, 1.1), off: R(), phase: R() * TAU });
    }
  }

  const FEATURES = {
    // Bergkristall: icicles hanging from the ceiling lips
    icicles: {
      behind(B, ring) {
        if (ring.k > 1) return;
        const g = B.g, R = B.R, u = ring.unit, c = B.pal.crystal(1, LAYERS[ring.k].haze);
        for (let i = ring.ceilRange[0] + 1; i < ring.ceilRange[1] - 1; i++) {
          if (!R.chance(0.6)) continue;
          const p = ring.pts[i], len = u * R.range(3, 9), w = u * R.range(0.8, 1.5), x = p[0] + R.range(-1, 1) * u, y = p[1] - u * 1.5, tx = x + w * 0.15, ty = p[1] + len;
          g.fillStyle = c.pale; g.beginPath(); g.moveTo(x - w, y); g.lineTo(x, y); g.lineTo(tx, ty); g.closePath(); g.fill();
          g.fillStyle = c.mid; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(tx, ty); g.closePath(); g.fill();
          g.strokeStyle = c.ink; g.lineWidth = clamp(u * 0.36, 1, 2.4); g.beginPath(); g.moveTo(x - w, y); g.lineTo(tx, ty); g.lineTo(x + w, y); g.stroke();
        }
      },
    },
    // Amethyst: geode - banded lips and rock faces studded with small crystals
    studs: {
      inRock(B, ring) {
        const g = B.g, u = ring.unit, haze = LAYERS[ring.k].haze, c = hsl(B.T.crystals[0]);
        g.beginPath(); poly(g, ring.pts); g.strokeStyle = css(mix(c, B.pal.deep, haze), 0.4); g.lineWidth = u * 5.4; g.stroke();
        g.strokeStyle = css(mix(mix(c, WHITE, 0.6), B.pal.deep, haze), 0.5); g.lineWidth = u * 2.2; g.stroke();
      },
      onRing(B, ring) {
        const R = B.R, u = ring.unit, pts = ring.pts, n = Math.min(ring.k === 2 ? 30 : 64, Math.round(pts.length * 0.9));
        for (let j = 0; j < n; j++) {
          const p = pts[R.int(pts.length)], d = u * R.range(2, 10);
          drawCluster(B, { x: p[0] + p[2] * d, y: p[1] + p[3] * d, ang: Math.atan2(-p[3], -p[2]) + R.range(-1, 1), size: u * R.range(2.2, 4.6), k: ring.k, col: R.int(3), count: 1 + R.int(3) });
        }
      },
    },
    // Prasiolith: moss cushions, hanging vines and glowing mushrooms
    moss: {
      onRing(B, ring) {
        if (ring.k > 1) return;
        const g = B.g, R = B.R, u = ring.unit, pts = ring.pts, deep = B.pal.deep, haze = LAYERS[ring.k].haze;
        const col = c => css(mix(hsl(c), deep, haze)), ink = col([140, 45, 7]), green = col([104, 46, 34]), hi = col([88, 58, 50]);
        const i0 = ring.floorRange[0], i1 = ring.floorRange[1];
        [[ink, 2.4, 0, 0.5], [green, 1.7, 0, 0.5], [hi, 0.55, -0.1, 0.05]].forEach(q => {      // cushions on the flat parts of the floor
          g.strokeStyle = q[0]; g.lineWidth = u * q[1]; g.beginPath();
          for (let i = i0; i < i1 - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            if (Math.abs(b[1] - a[1]) < Math.abs(b[0] - a[0]) * 0.8) { g.moveTo(a[0] + q[2] * u, a[1] + q[3] * u); g.lineTo(b[0] + q[2] * u, b[1] + q[3] * u); }
          }
          g.stroke();
        });
        const c0 = ring.ceilRange[0], c1 = ring.ceilRange[1];
        for (let j = 0, n = Math.round((c1 - c0) / 4) + 1; j < n; j++) {                      // vines with leaves
          const p = pts[c0 + R.int(c1 - c0)], len = u * R.range(7, 22), sway = u * R.range(-3, 3), x0 = p[0], y0 = p[1] - u, mx = x0 + sway * 1.6, my = y0 + len * 0.5, x1 = x0 + sway, y1 = y0 + len;
          [[ink, 1], [col([96, 36, 26]), 0.5]].forEach(q => { g.strokeStyle = q[0]; g.lineWidth = u * q[1]; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.stroke(); });
          for (let i = 1, m = Math.round(len / (u * 2.6)); i <= m; i++) {
            const f = i / m, e = 1 - f, x = e * e * x0 + 2 * e * f * mx + f * f * x1, y = e * e * y0 + 2 * e * f * my + f * f * y1, sd = i % 2 ? 1 : -1;
            g.fillStyle = i % 3 ? green : hi; g.beginPath(); g.ellipse(x + sd * u * 0.75, y + u * 0.2, u * 0.85, u * 0.42, sd * 0.6, 0, TAU); g.fill();
          }
        }
        const capRgb = mix(hsl([164, 78, 62]), deep, haze * 0.7), cap = css(capRgb), capHi = css(mix(capRgb, WHITE, 0.55)), stem = col([70, 30, 78]);
        for (let j = 0, n = Math.max(2, Math.round((i1 - i0) / 6)); j < n; j++) {             // mushroom groups
          const p = pts[i0 + 1 + R.int(Math.max(1, i1 - i0 - 2))];
          softGlow(g, p[0], p[1] - u * 2, u * 9, capRgb, 0.3);
          if (ring.k === 0 && B.scene.glows.length < 3) B.scene.glows.push({ sprite: makeGlowSprite(capRgb), x: p[0], y: p[1] - u * 2, r: u * 9, a: 0.22, speed: TAU / R.range(4, 7), phase: R() * TAU });
          for (let m = 0, mm = 2 + R.int(2); m < mm; m++) {
            const h = u * R.range(2, 4.4), cw = h * R.range(0.5, 0.7), x = p[0] + (m - 1) * u * R.range(1.8, 2.8), y = p[1] + u * 0.8;
            g.lineWidth = clamp(u * 0.35, 1, 2.2); g.strokeStyle = ink;
            g.fillStyle = stem; g.beginPath(); g.rect(x - h * 0.11, y - h, h * 0.22, h); g.fill(); g.stroke();
            g.fillStyle = cap; g.beginPath(); g.ellipse(x, y - h, cw, cw * 0.75, 0, Math.PI, TAU); g.closePath(); g.fill(); g.stroke();
            g.fillStyle = capHi; g.beginPath(); g.ellipse(x - cw * 0.35, y - h - cw * 0.38, cw * 0.28, cw * 0.14, -0.5, 0, TAU); g.fill();
          }
        }
      },
    },
    // Citrin: golden veins in the rock
    veins: {
      inRock(B, ring) {
        const d = B.pal.deep, h = LAYERS[ring.k].haze, c = x => css(mix(hsl(x), d, h));
        veins(B, ring, { ink: c([24, 60, 9]), mid: c([42, 92, 52]), hi: c([50, 100, 80]) }, false, 4.5);
      },
    },
    // Rosenquarz: soft mist over the floor / Rauchquarz: fog banks drifting through the cave
    mist: { finish(B) { addFog(B, hsl([338, 75, 88]), 0.22, 0.6, 0.92, 2); } },
    fog: { finish(B) { addFog(B, hsl([36, 14, 74]), 0.2, 0.22, 0.82, 3); } },
    // Karneol: lava lake at the back, glowing cracks in the floor, heat from below
    lava: {
      inRock(B, ring) {
        if (ring.k < 2) veins(B, ring, { ink: css(mix(hsl([8, 80, 10]), B.pal.deep, LAYERS[ring.k].haze)), mid: css(hsl([24, 100, 54])), hi: css(hsl([46, 100, 72])) }, true, 3);
      },
      onRing(B, ring) {
        if (ring.k !== 2) return;
        const c = x => css(mix(hsl(x), B.pal.deep, 0.22));
        pool(B, poolLevel(B), { base: c([18, 96, 46]), band: c([32, 100, 56]), hi: c([46, 100, 68]) });
      },
      finish(B) {
        const g = B.g, W = B.W, H = B.H, S = B.S, R = B.R, rgb = hsl([20, 100, 52]), gr = g.createLinearGradient(0, H, 0, H * 0.45);
        gr.addColorStop(0, css(rgb, 0.34)); gr.addColorStop(0.5, css(rgb, 0.1)); gr.addColorStop(1, css(rgb, 0));
        g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(0, H * 0.45, W, H * 0.55); g.globalCompositeOperation = 'source-over';
        const sprite = makeGlowSprite(rgb);
        for (let i = 0; i < 2; i++) B.scene.glows.push({ sprite, x: W * (0.25 + 0.5 * i), y: H + S * 4, r: Math.min(W * 0.45, S * 40), a: 0.2, speed: TAU / R.range(5, 8), phase: R() * TAU });
      },
    },
    // Blauquarz: underground lake with ripples
    lake: {
      onRing(B, ring) {
        if (ring.k !== 2) return;
        const R = B.R, S = B.S, y0 = poolLevel(B), c = x => css(mix(hsl(x), B.pal.deep, 0.25));
        pool(B, y0, { base: c([212, 62, 26]), band: c([200, 62, 38]), hi: c([186, 70, 62]) });
        B.scene.rippleColor = c([186, 70, 70]);
        for (let i = 0; i < 3; i++) B.scene.ripples.push({ x: B.W * R.range(0.3, 0.7), y: y0 + S * R.range(3, 12), r: S * R.range(5, 9), period: R.range(4.5, 7.5), off: R() });
      },
    },
    // water dripping from the longest stalactites
    drips: {
      finish(B) {
        const R = B.R;
        B.scene.dripColor = css(mix(B.pal.light, WHITE, 0.3));
        for (let k = 0; k < 2; k++) {
          const ring = B.rings[k], tips = ring.tips.filter(t => t.kind === 'ceil').sort((a, b) => b.len - a.len).slice(0, k ? 1 : 2);
          for (const t of tips) B.scene.drips.push({ x: t.x, y0: t.y, y1: ring.box.b - ring.unit, r: Math.max(1.2, ring.unit * 0.42), period: R.range(5, 9), off: R() });
        }
      },
    },
  };

  // Animated extras every theme gets, and the final grading of the baked picture.
  function finishScene(B) {
    const g = B.g, R = B.R, W = B.W, H = B.H, S = B.S, T = B.T, pal = B.pal, scene = B.scene, wide = W > H;
    // breathing glows and twinkles for the most prominent clusters
    const all = [], weight = c => c.size * (1 - LAYERS[c.k].haze * 0.8), sprites = {};
    for (const ring of B.rings) for (const c of ring.clusters) all.push(c);
    all.sort((a, b) => weight(b) - weight(a));
    for (let i = 0, n = Math.min(all.length, wide ? 11 : 8); i < n; i++) {
      const c = all[i], key = mod(c.col, T.crystals.length);
      sprites[key] = sprites[key] || makeGlowSprite(pal.glow(c.col));
      scene.glows.push({ sprite: sprites[key], x: c.x + Math.cos(c.ang) * c.size * 0.45, y: c.y + Math.sin(c.ang) * c.size * 0.45, r: c.size * 0.95 + 2 * S, a: 0.24 * (1 - LAYERS[c.k].haze * 0.6), speed: TAU / R.range(4, 7.5), phase: R() * TAU });
    }
    for (let i = 0, n = Math.min(all.length, 16); i < n; i++) {
      const c = all[i];
      scene.glints.push({ x: c.tipX, y: c.tipY, r: clamp(c.size * 0.2, 5, 22), period: R.range(3.5, 7), off: R() });
    }
    // light shafts falling in from the ceiling
    scene.shaftSprite = makeShaftSprite(pal.light);
    for (let i = 0, n = wide ? 4 : 2; i < n; i++) {
      const x = W * ((wide ? [0.14, 0.34, 0.66, 0.87][i] : [0.3, 0.7][i]) + R.range(-0.06, 0.06));
      scene.shafts.push({ x, y: -2 * S, w: S * R.range(14, 22), h: H * R.range(0.55, 0.8), shear: R.range(-0.26, 0.26), a: R.range(0.1, 0.16), speed: R.range(0.25, 0.4), phase: R() * TAU });
    }
    // drifting particles
    const P = T.particles;
    if (P) {
      const K = PARTICLE_KINDS[P.kind] || PARTICLE_KINDS.dust;
      scene.dotKind = K; scene.dotSprite = makeDotSprite(hsl(P.color), K.ring);
      for (let i = 0, n = Math.round((P.count || 20) * clamp(W * H / 330000, 0.6, 2.2)); i < n; i++) {
        const f = R.range(0.6, 1.4);
        scene.dots.push({ x0: R(), y0: R(), vx: K.vx * S * f * (R.chance(0.5) ? 1 : -1), vy: K.vy * S * f, wa: K.wobble * S * R.range(0.5, 1.2), wf: R.range(0.25, 0.6), wp: R() * TAU, r: S * R.range(K.size[0], K.size[1]) + 0.8, a: R.range(0.45, 0.9), pf: R.range(0.5, 1.3), pp: R() * TAU });
      }
    }
    // keep the middle (behind the playfield) calmer: a wide, soft veil in the deep colour
    if (B.focus) {
      const f = B.focus, ry = f.h * 0.62, gr = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      gr.addColorStop(0, css(pal.deep, 0.4)); gr.addColorStop(0.6, css(pal.deep, 0.28)); gr.addColorStop(1, css(pal.deep, 0));
      g.save(); g.translate(f.x + f.w / 2, f.y + f.h / 2); g.scale(clamp(f.w / f.h, 0.2, 5), 1);
      g.fillStyle = gr; g.fillRect(-ry, -ry, ry * 2, ry * 2); g.restore();
    }
  }

  // The bake of one theme as a list of steps, so it can be spread over several frames.
  function createBakeJob(T, W, H, scale, focus) {
    const pw = Math.max(1, Math.ceil(W * scale - 1e-4)), ph = Math.max(1, Math.ceil(H * scale - 1e-4));
    const canvas = makeCanvas(pw, ph), g = canvas.getContext('2d', { alpha: false });
    g.setTransform(scale, 0, 0, scale, 0, 0); g.lineJoin = 'round'; g.lineCap = 'round';
    const scene = { theme: T, canvas, w: pw / scale, h: ph / scale, glows: [], glints: [], shafts: [], dots: [], fogs: [], drips: [], ripples: [], shimmers: [] };
    const feats = (T.features || []).map(n => FEATURES[n]).filter(Boolean);
    const B = { g, R: makeRng(T.seed * 7919 + 17), W, H, S: Math.min(W, H) / 100, T, pal: makePalette(T), scene, rings: [], focus };
    B.hook = (name, ring) => { for (const f of feats) if (f[name]) f[name](B, ring); };
    B.heroDiag = B.R.int(2);
    const steps = [
      () => { paintBack(B); for (let k = 0; k < 3; k++) B.rings[k] = buildRing(B, k); },
      () => paintLayer(B, 2), () => paintLayer(B, 1), () => paintLayer(B, 0),
      () => { B.hook('finish'); finishScene(B); },
    ];
    let i = 0;
    return { scene, step() { if (i < steps.length) steps[i++](); return i >= steps.length; } };
  }

  // ------------------------------------------------------------------ per-frame overlays (cheap sprite blits only)
  function drawOverlays(ctx, sc, t, wgt, W, H) {
    let i, o, a, p, q, x, y;
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < sc.shafts.length; i++) {            // swaying light shafts
      o = sc.shafts[i]; q = o.shear + Math.sin(t * o.speed + o.phase) * 0.035;
      ctx.globalAlpha = wgt * o.a * (0.72 + 0.28 * Math.sin(t * o.speed * 1.7 + o.phase * 2));
      ctx.transform(1, 0, q, 1, 0, 0); ctx.drawImage(sc.shaftSprite, o.x - o.w / 2 - q * o.y, o.y, o.w, o.h); ctx.transform(1, 0, -q, 1, 0, 0);
    }
    for (i = 0; i < sc.glows.length; i++) {             // cluster glows breathing out of phase
      o = sc.glows[i];
      ctx.globalAlpha = wgt * o.a * (0.55 + 0.45 * Math.sin(t * o.speed + o.phase));
      ctx.drawImage(o.sprite, o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
    }
    if (sc.dots.length) {                               // dust, snow, embers, spores, bubbles
      const K = sc.dotKind, m = 12, sw = W + 2 * m, z0 = K.zone[0] * H - m, sh = (K.zone[1] - K.zone[0]) * H + 2 * m;
      for (i = 0; i < sc.dots.length; i++) {
        o = sc.dots[i];
        q = mod(o.y0 * sh + o.vy * t, sh) / sh;         // 0 = top of the zone, 1 = bottom
        x = mod(o.x0 * sw + o.vx * t + Math.sin(t * o.wf + o.wp) * o.wa, sw) - m; y = z0 + q * sh;
        a = o.a * (1 - K.pulse + K.pulse * (0.5 + 0.5 * Math.sin(t * o.pf + o.pp))) * clamp(Math.min(q, 1 - q) * 7, 0, 1);
        if (K.fadeTop) a *= clamp(q * 1.5, 0, 1);
        ctx.globalAlpha = wgt * a; ctx.drawImage(sc.dotSprite, x - o.r, y - o.r, o.r * 2, o.r * 2);
      }
    }
    const starImg = getStarSprite();
    for (i = 0; i < sc.glints.length; i++) {            // twinkles on crystal tips: a short flash, then a long pause
      o = sc.glints[i]; p = mod(t / o.period + o.off, 1);
      if (p > 0.24) continue;
      a = Math.sin(p / 0.24 * Math.PI); a *= a; q = o.r * (0.55 + 0.45 * a);
      ctx.globalAlpha = wgt * a * 0.9; ctx.drawImage(starImg, o.x - q, o.y - q, q * 2, q * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (i = 0; i < sc.fogs.length; i++) {              // fog banks drifting sideways
      o = sc.fogs[i];
      ctx.globalAlpha = wgt * o.a * (0.75 + 0.25 * Math.sin(t * 0.21 + o.phase));
      ctx.drawImage(sc.fogSprite, mod(o.off * (W + o.w) + o.speed * t, W + o.w) - o.w, o.y, o.w, o.h);
    }
    if (sc.shimmers.length) {                           // highlights gliding over lava / water
      ctx.fillStyle = sc.shimmerColor;
      for (i = 0; i < sc.shimmers.length; i++) {
        o = sc.shimmers[i]; a = 0.5 + 0.5 * Math.sin(t * o.speed + o.phase);
        ctx.globalAlpha = wgt * 0.55 * a * a; ctx.fillRect(o.x + Math.sin(t * o.speed * 0.5 + o.phase) * o.w * 0.4, o.y, o.w, o.h);
      }
    }
    if (sc.ripples.length) {                            // slow rings on the lake
      ctx.strokeStyle = sc.rippleColor; ctx.lineWidth = 1.2;
      for (i = 0; i < sc.ripples.length; i++) {
        o = sc.ripples[i]; p = mod(t / o.period + o.off, 1);
        ctx.globalAlpha = wgt * 0.5 * (1 - p) * clamp(p * 6, 0, 1);
        ctx.beginPath(); ctx.ellipse(o.x, o.y, o.r * (0.15 + p), o.r * (0.15 + p) * 0.28, 0, 0, TAU); ctx.stroke();
      }
    }
    if (sc.drips.length) {                              // drop grows, falls, splashes
      ctx.fillStyle = ctx.strokeStyle = sc.dripColor; ctx.lineWidth = 1.2;
      for (i = 0; i < sc.drips.length; i++) {
        o = sc.drips[i]; p = mod(t / o.period + o.off, 1);
        if (p < 0.55) { q = o.r * (0.35 + 0.65 * p / 0.55); ctx.globalAlpha = wgt * 0.8; ctx.beginPath(); ctx.arc(o.x, o.y0 + q * 0.6, q, 0, TAU); ctx.fill(); }
        else if (p < 0.75) { q = (p - 0.55) / 0.2; ctx.globalAlpha = wgt * 0.8; ctx.beginPath(); ctx.ellipse(o.x, o.y0 + (o.y1 - o.y0) * q * q, o.r * 0.8, o.r * 1.5, 0, 0, TAU); ctx.fill(); }
        else { q = (p - 0.75) / 0.25; ctx.globalAlpha = wgt * 0.6 * (1 - q); ctx.beginPath(); ctx.ellipse(o.x, o.y1, o.r * (1 + 5 * q), o.r * (0.4 + 1.4 * q), 0, 0, TAU); ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ public object
  function create() {
    let W = 360, H = 640, ratio = 1, focus = null, stamp = 0;    // stamp changes whenever size or focus change
    let level = 1, themeIdx = 0;                                 // requested level and its theme
    let cur = null, prev = null, job = null, fade = 1, time = 0; // baked scenes (at most two), pending bake, crossfade 0..1
    let failed = -1;

    function newJob(idx) {
      const j = createBakeJob(THEMES[idx], W, H, Math.min(ratio, Math.sqrt(MAX_BAKE_PIXELS / (W * H))), focus);
      j.scene.idx = idx; j.scene.stamp = stamp;
      return j;
    }
    // Make sure a scene of the right size exists; start baking the requested theme if it differs.
    function ensure() {
      if (!cur || cur.stamp !== stamp) {
        if (failed === stamp) return;
        prev = null; job = null; fade = 1;
        try { const j = newJob(themeIdx); while (!j.step()) { /* bake everything now */ } cur = j.scene; }
        catch (e) { cur = null; failed = stamp; }
      } else if (cur.idx === themeIdx) job = null;
      else if (!job || job.scene.idx !== themeIdx) { try { job = newJob(themeIdx); } catch (e) { job = null; } }
    }

    return {
      // CSS px size of the target canvas and its pixel ratio; layers are re-baked lazily on the next frame.
      resize(width, height, pixelRatio) {
        const w = clamp(Math.round(+width) || 1, 1, 8192), h = clamp(Math.round(+height) || 1, 1, 8192), pr = clamp(+pixelRatio || 1, 0.5, 3);
        if (w === W && h === H && pr === ratio) return;
        W = w; H = h; ratio = pr; stamp++;
      },
      // Playfield rect in CSS px: the art is kept calmer behind it.
      setFocus(x, y, w, h) {
        if (!(w > 0 && h > 0)) { if (focus) { focus = null; stamp++; } return; }
        if (focus && Math.abs(focus.x - x) + Math.abs(focus.y - y) + Math.abs(focus.w - w) + Math.abs(focus.h - h) < 1) return;
        focus = { x: +x || 0, y: +y || 0, w: +w, h: +h }; stamp++;
      },
      // Switch to the theme of a level; crossfades unless immediate.
      setLevel(lv, immediate) {
        level = Math.max(1, Math.floor(+lv) || 1);
        themeIdx = (level - 1) % THEMES.length;
        if (immediate && (prev || !cur || cur.idx !== themeIdx)) {
          prev = null; job = null; fade = 1;
          if (cur && cur.idx !== themeIdx) cur = null;           // baked on the next update / draw
        }
      },
      update(dtMs) {
        const dt = clamp(+dtMs || 0, 0, 1000);
        time += dt / 1000;
        ensure();
        if (job) {
          try {
            for (let i = 0; i < BAKE_STEPS_PER_UPDATE; i++) if (job.step()) { prev = cur; cur = job.scene; fade = 0; job = null; break; }
          } catch (e) { job = null; themeIdx = cur ? cur.idx : themeIdx; }
        } else if (prev) { fade += dt / FADE_MS; if (fade >= 1) { fade = 1; prev = null; } }
      },
      // ctx is pre-scaled to CSS px. Paints the whole width x height opaquely.
      draw(ctx) {
        ensure();
        if (!cur) { ctx.fillStyle = '#0a0f1c'; ctx.fillRect(0, 0, W, H); return; }
        if (prev) {
          const a = fade * fade * (3 - 2 * fade);
          ctx.drawImage(prev.canvas, 0, 0, prev.w, prev.h); drawOverlays(ctx, prev, time, 1, W, H);
          ctx.globalAlpha = a; ctx.drawImage(cur.canvas, 0, 0, cur.w, cur.h); ctx.globalAlpha = 1;
          drawOverlays(ctx, cur, time, a, W, H);
        } else { ctx.drawImage(cur.canvas, 0, 0, cur.w, cur.h); drawOverlays(ctx, cur, time, 1, W, H); }
      },
      get level() { return level; },
    };
  }

  KF.Cave = { THEMES, create };
})(globalThis.KF = globalThis.KF || {});
