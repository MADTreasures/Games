/*
 * Crystal Drop - realistic cave backdrop (KF.Cave)
 *
 * Every level theme is a small procedural cave chamber: four overlapping rock walls (near .. far)
 * around a misty back wall, quartz clusters growing out of the rock, plus theme features
 * (icicles, geode, moss and fungi, gold veins, mist, lava, lake, fog).
 *
 * The rock is not drawn, it is LIT: per wall a height field (bevelled silhouette + layered noise +
 * strata + cracks) is shaded per pixel at reduced resolution - bump lighting from the crystal
 * clusters (the light sources), a dim key light, wet speculars - then scaled up, cut out with the
 * crisp vector silhouette and given a fine grain. Crystals are vector prisms with gradients on top.
 * Haze veils between the walls give atmospheric depth.
 *
 * The static picture of a theme is baked once (as a list of small steps: all at once for the
 * first picture, a few per update() on a level change, so no frame stalls). draw() only blits it
 * and adds cheap sprite overlays (breathing glows, dust, fog, a light shaft, drips, glints).
 * Everything is seeded per theme and driven by update(dt): no random numbers from the browser,
 * no clocks.   Adding a theme = adding one entry to THEMES (see NOTES.md).
 */
(function (KF) {
  'use strict';

  const TAU = Math.PI * 2;
  const FADE_MS = 1500;                       // crossfade between two themes
  const MAX_BAKE_PIXELS = 2e6;                // huge canvases are baked at a reduced scale and stretched
  const LOW_MIN = 120000, LOW_MAX = 250000;   // pixel budget of the lit rock maps (phone .. desktop)
  const BAND_PIXELS = 30000;                  // rock-map pixels shaded per bake step
  const STEPS_PER_UPDATE = 1;                 // bake steps per update() while a level change is pending
  const NL = 4;                               // rock walls; layer NL is the back wall, NL + 1 the lava surface

  // Rock walls from near to far. side / top / bot: wall thickness as a fraction of width / height,
  // amp: waviness of the opening, blur: bevel radius, scale: size of spikes, bumps and crystals
  // (amp, blur in S = 1/100 of the short side), gain: light the rock takes, veil: haze laid over
  // this wall and everything behind it, clusters / spikes: how many.
  const LAYERS = [
    { side: 0.062, top: 0.066, bot: 0.058, amp: 3.2, blur: 2.6, scale: 1.5, gain: 0.6, veil: 0, clusters: 2, spikes: 5 },
    { side: 0.165, top: 0.132, bot: 0.112, amp: 3.0, blur: 2.0, scale: 1.1, gain: 1, veil: 0.14, clusters: 4, spikes: 7 },
    { side: 0.262, top: 0.192, bot: 0.162, amp: 2.6, blur: 1.5, scale: 0.8, gain: 1, veil: 0.24, clusters: 4, spikes: 8 },
    { side: 0.352, top: 0.248, bot: 0.208, amp: 2.2, blur: 1.1, scale: 0.58, gain: 0.95, veil: 0.32, clusters: 3, spikes: 8 },
    { blur: 1, scale: 0.62, gain: 0.9, veil: 0.36 },
    { blur: 1, scale: 0.8, gain: 1, veil: 0 },
  ];

  // Colours are [h, s, l]. rock / stain: the two albedo tones of the rock, deep: darkest tone, haze: colour of the
  // air, light: colour of the ambient glow, crystals: three quartz tones. wet: gloss of the rock, chamber: brightness
  // of the far chamber, opening: [x, y, strength] of daylight falling in (fractions), bend: sideways drift of the
  // far walls. Materials (0..1): frost, moss, vein, geode. Details: icicles, fungi, druse, drips, fog, liquid.
  const THEMES = [
    { key: 'ice', name: 'Bergkristall', seed: 11, rock: [212, 14, 31], stain: [204, 20, 39], deep: [218, 44, 5], haze: [210, 34, 16], light: [198, 60, 78],
      crystals: [[204, 32, 78], [192, 28, 84], [214, 38, 72]], density: 1, crystalSize: 1.05, spikes: 1.2, wet: 0.9, glow: 1, chamber: 0.5, bend: 0.04,
      opening: [0.4, 0.3, 0.7], frost: 1, icicles: 1, drips: 3, fog: [[0.86, 0.5, 2]], particles: { kind: 'snow', count: 22 } },
    { key: 'amethyst', name: 'Amethyst', seed: 23, rock: [268, 10, 25], stain: [300, 14, 33], deep: [266, 40, 5], haze: [270, 30, 13], light: [280, 62, 74],
      crystals: [[272, 50, 62], [288, 44, 66], [258, 48, 68]], density: 1.15, crystalSize: 0.95, spikes: 0.6, wet: 0.5, glow: 1.05, chamber: 0.4, bend: -0.02,
      geode: 1, druse: 1, particles: { kind: 'dust', count: 20 } },
    { key: 'moss', name: 'Prasiolith', seed: 37, rock: [100, 8, 23], stain: [40, 14, 30], deep: [150, 40, 4], haze: [140, 26, 12], light: [112, 48, 72],
      crystals: [[140, 38, 60], [122, 34, 66], [158, 40, 56]], density: 0.9, crystalSize: 1, spikes: 0.9, wet: 1, glow: 0.9, chamber: 0.45, bend: -0.05,
      opening: [0.62, 0.3, 0.6], moss: 1, fungi: 1, drips: 3, particles: { kind: 'spore', count: 20 } },
    { key: 'citrine', name: 'Citrin', seed: 41, rock: [26, 16, 25], stain: [34, 34, 32], deep: [18, 44, 5], haze: [26, 34, 12], light: [42, 80, 70],
      crystals: [[44, 72, 58], [36, 76, 60], [50, 68, 66]], density: 1, crystalSize: 1.05, spikes: 0.8, wet: 0.4, glow: 1, chamber: 0.4, bend: 0.05,
      vein: 1, particles: { kind: 'dust', count: 22 } },
    { key: 'rose', name: 'Rosenquarz', seed: 53, rock: [338, 9, 29], stain: [18, 16, 38], deep: [320, 34, 6], haze: [326, 24, 15], light: [344, 66, 82],
      crystals: [[340, 54, 76], [352, 50, 80], [326, 44, 74]], density: 0.85, crystalSize: 1.15, spikes: 0.6, wet: 0.45, glow: 1, chamber: 0.5, bend: 0.03,
      fog: [[0.8, 0.8, 3], [0.9, 0.9, 2]], particles: { kind: 'dust', count: 18 } },
    { key: 'carnelian', name: 'Karneol', seed: 67, rock: [14, 12, 17], stain: [22, 26, 22], deep: [6, 50, 4], haze: [10, 44, 10], light: [22, 96, 58],
      crystals: [[18, 80, 54], [8, 74, 50], [30, 86, 58]], density: 0.9, crystalSize: 1, spikes: 1.1, wet: 0.3, glow: 0.95, chamber: 0.25, bend: -0.04,
      liquid: 'lava', particles: { kind: 'ember', count: 26 } },
    { key: 'lake', name: 'Blauquarz', seed: 79, rock: [222, 14, 22], stain: [186, 20, 30], deep: [226, 50, 5], haze: [220, 40, 13], light: [192, 58, 72],
      crystals: [[216, 60, 62], [204, 64, 64], [232, 50, 68]], density: 1, crystalSize: 1, spikes: 1, wet: 1, glow: 1, chamber: 0.45, bend: 0.03,
      opening: [0.57, 0.3, 0.55], liquid: 'lake', drips: 4, fog: [[0.74, 0.35, 2]], particles: { kind: 'dust', count: 16 } },
    { key: 'smoky', name: 'Rauchquarz', seed: 97, rock: [30, 5, 24], stain: [34, 9, 36], deep: [250, 12, 4], haze: [232, 8, 15], light: [38, 24, 80],
      crystals: [[32, 18, 68], [24, 12, 78], [42, 12, 56]], density: 0.75, crystalSize: 1.3, spikes: 0.75, wet: 0.35, glow: 0.9, chamber: 0.45, bend: -0.03,
      fog: [[0.42, 0.55, 2], [0.66, 0.7, 2], [0.88, 0.8, 2]], particles: { kind: 'dust', count: 16 } },
  ];

  // Particle behaviours. Speeds and radii in S per second / S, zone = vertical band (fractions of the height).
  const PARTICLE_KINDS = {
    dust:  { vx: [-0.5, 0.5], vy: [-0.45, 0.15], r: [0.2, 0.46], a: [0.18, 0.5], wob: 1.4, pulse: 0.6, zone: [0.04, 0.96] },
    snow:  { vx: [-0.5, 0.1], vy: [0.8, 2], r: [0.18, 0.42], a: [0.22, 0.55], wob: 1.2, pulse: 0.3, zone: [0, 1] },
    spore: { vx: [-0.3, 0.3], vy: [-1, -0.3], r: [0.22, 0.46], a: [0.22, 0.55], wob: 1.8, pulse: 0.7, zone: [0.1, 1] },
    ember: { vx: [-0.5, 0.5], vy: [-4.5, -1.8], r: [0.18, 0.38], a: [0.4, 0.85], wob: 1.6, pulse: 0.5, zone: [0.22, 0.86], fadeTop: true },
  };

  // ------------------------------------------------------------------ small helpers
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function mod(v, m) { return ((v % m) + m) % m; }
  function makeRng(seed) {                       // mulberry32
    let a = seed >>> 0;
    const R = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    R.range = (lo, hi) => lo + (hi - lo) * R();
    R.int = n => Math.floor(R() * n);
    return R;
  }
  function hsl(c) {                              // [h, s, l] -> [r, g, b] 0..255
    const h = mod(c[0], 360) / 60, s = clamp(c[1], 0, 100) / 100, l = clamp(c[2], 0, 100) / 100;
    const k = (1 - Math.abs(2 * l - 1)) * s, x = k * (1 - Math.abs(h % 2 - 1)), m = l - k / 2;
    const v = h < 1 ? [k, x, 0] : h < 2 ? [x, k, 0] : h < 3 ? [0, k, x] : h < 4 ? [0, x, k] : h < 5 ? [x, 0, k] : [k, 0, x];
    return [(v[0] + m) * 255, (v[1] + m) * 255, (v[2] + m) * 255];
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function mul(a, f) { return [a[0] * f, a[1] * f, a[2] * f]; }
  function css(c, alpha) { return 'rgba(' + clamp(Math.round(c[0]), 0, 255) + ',' + clamp(Math.round(c[1]), 0, 255) + ',' + clamp(Math.round(c[2]), 0, 255) + ',' + clamp(alpha, 0, 1).toFixed(3) + ')'; }
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  const WHITE = [255, 255, 255];
  const SIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) SIN[i] = Math.sin(i / 256 * TAU);

  function makePalette(T) {
    const unit = c => mul(hsl(c), 1 / 255), light = hsl(T.light);
    return {
      rock: unit(T.rock), stain: unit(T.stain), deep: hsl(T.deep), haze: hsl(T.haze), light, lightU: mul(light, 1 / 255),
      crystals: T.crystals.map(c => ({ deep: hsl([c[0], c[1] * 0.95, c[2] * 0.24]), body: hsl([c[0], c[1] * 0.85, c[2] * 0.78]), pale: hsl([c[0], c[1] * 0.5, 93]),
        glow: mix(hsl([c[0], Math.min(100, c[1] * 1.1), 66]), light, 0.35) })),
    };
  }

  // ------------------------------------------------------------------ shared textures (made once)
  // Three canvases of white noise, one per colour channel: scaled up smoothly and added together
  // they give value-noise octaves in the R, G and B channel of a rock map without any per-pixel code.
  let NOISE_SRC = null, GRAIN = null, WARM = false;
  function noiseSources() {
    if (NOISE_SRC) return NOISE_SRC;
    const n = 256, all = makeCanvas(n, n), ag = all.getContext('2d'), im = ag.createImageData(n, n), d = im.data;
    let v = 0x9E3779B9 | 0;
    for (let i = 0, m = n * n * 4; i < m; i += 4) { v ^= v << 13; v ^= v >>> 17; v ^= v << 5; d[i] = v & 255; d[i + 1] = (v >>> 8) & 255; d[i + 2] = (v >>> 16) & 255; d[i + 3] = 255; }
    ag.putImageData(im, 0, 0);
    NOISE_SRC = ['#f00', '#0f0', '#00f'].map((col, ch) => {
      const c = makeCanvas(n, n), g = c.getContext('2d');
      g.drawImage(all, 0, 0); g.globalCompositeOperation = 'multiply';
      if (g.globalCompositeOperation === 'multiply') { g.fillStyle = col; g.fillRect(0, 0, n, n); }
      else { const o = g.createImageData(n, n), e = o.data; for (let i = 0, m = n * n * 4; i < m; i += 4) { e[i + ch] = d[i + ch]; e[i + 3] = 255; } g.putImageData(o, 0, 0); }
      return c;
    });
    return NOISE_SRC;
  }
  // Tileable embossed grain as translucent black: laid over the lit rock at full resolution it multiplies
  // crisp pits and micro shadows into the soft rock map.
  function grainTile() {
    if (GRAIN) return GRAIN;
    const n = 128, c = makeCanvas(n, n), g = c.getContext('2d'), im = g.createImageData(n, n), d = im.data, r = makeRng(4242);
    const a = new Float32Array(n * n), b = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) a[i] = r();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)     // a softer 3 px octave
      b[y * n + x] = (a[y * n + x] + a[y * n + (x + 1) % n] + a[((y + 1) % n) * n + x] + a[((y + 2) % n) * n + (x + 2) % n] + a[((y + 1) % n) * n + (x + 2) % n]) / 5;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, j = ((y + n - 1) % n) * n + (x + n - 1) % n, j2 = ((y + n - 2) % n) * n + (x + n - 2) % n;
      let v = 24 + (a[j] - a[i]) * 56 + (b[j2] - b[i]) * 170;
      d[i * 4 + 3] = v;
    }
    g.putImageData(im, 0, 0);
    return (GRAIN = c);
  }

  // Low-resolution work buffers of one cave instance (reused by all its bakes).
  function preparePool(P, lw, lh) {
    if (P.lw === lw && P.lh === lh) return;
    const mk = (w, h) => { const c = makeCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); return { c, g, w: c.width, h: c.height }; };
    P.lw = lw; P.lh = lh;
    P.noise = mk(lw, lh); P.mask = mk(lw, lh); P.lit = mk(lw, lh);
    P.pyr = [mk(lw / 2, lh / 2), mk(lw / 4, lh / 4), mk(lw / 8, lh / 8), mk(lw / 16, lh / 16)];
    P.out = P.lit.g.createImageData(lw, lh);
    P.H = new Float32Array(lw * lh);
    const vig = (n, mid, amt) => { const t = new Float32Array(n); for (let i = 0; i < n; i++) { let u = (Math.abs(i / n - mid) * 2 - 0.45) / 0.55; u = clamp(u, 0, 1); t[i] = 1 - amt * u * u * (3 - 2 * u); } return t; };
    P.VX = vig(lw, 0.5, 0.14); P.VY = vig(lh, 0.48, 0.4);              // vignette, multiplied into the rock light
  }

  // ------------------------------------------------------------------ geometry
  function ringNoise(R, n) {                     // smooth periodic noise over an angle, -1..1
    const v = []; for (let i = 0; i < n; i++) v.push(R.range(-1, 1));
    return a => { const p = mod(a / TAU, 1) * n, i = Math.floor(p) % n, f = p - Math.floor(p), s = f * f * (3 - 2 * f); return v[i] + (v[(i + 1) % n] - v[i]) * s; };
  }
  function tracePts(g, p) {                      // closed smooth curve through the midpoints of a polygon
    const n = p.length; g.moveTo((p[n - 1][0] + p[0][0]) / 2, (p[n - 1][1] + p[0][1]) / 2);
    for (let i = 0; i < n; i++) { const q = p[i], r = p[(i + 1) % n]; g.quadraticCurveTo(q[0], q[1], (q[0] + r[0]) / 2, (q[1] + r[1]) / 2); }
    g.closePath();
  }
  function wind(p, positive) {                   // force the winding of a polygon (non-zero fill: rock adds, the opening cuts)
    let s = 0; for (let i = 0, n = p.length; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
    if ((s > 0) !== positive) p.reverse();
    return p;
  }
  // Tapered, slightly bent spike (stalactite, stalagmite) from (bx, by) along (dx, dy).
  function spike(R, bx, by, dx, dy, len, w, tipR) {
    const px = -dy, py = dx, bend = R.range(-0.13, 0.13) * len, n = 7, A = [], C = [];
    for (let i = -1; i < n; i++) {
      const t = i / n, tt = Math.max(0, t), hw = i < 0 ? w * 0.9 : w * 0.5 * Math.pow(1 - tt, 1.5) + tipR * (1 - tt * tt * tt);
      const qx = bx + dx * len * t + px * bend * tt * tt, qy = by + dy * len * t + py * bend * tt * tt;
      A.push([qx + px * hw, qy + py * hw]); C.push([qx - px * hw, qy - py * hw]);
    }
    const tip = [bx + dx * len + px * bend, by + dy * len + py * bend];
    return { pts: A.concat([tip], C.reverse()), tip };
  }
  function blob(R, x, y, rx, ry, n, jit) {
    const p = [], a0 = R() * TAU;
    for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU, r = 1 + R.range(-jit, jit); p.push([x + Math.cos(a) * rx * r, y + Math.sin(a) * ry * r]); }
    return p;
  }

  // One rock wall: everything outside a wavy rounded opening, plus stalactites, stalagmites,
  // rubble and (wide screens) columns. rim(t) = point on the opening + unit vector into it.
  function buildLayer(B, k) {
    const D = LAYERS[k], T = B.T, R = B.R, W = B.W, H = B.H, S = B.S;
    const noFloor = !!(B.liquid && k >= B.liquid.after), j = () => R.range(0.86, 1.2), jx = () => R.range(0.7, 1.32);
    const x0 = D.side * W * jx(), x1 = W - D.side * W * jx(), y0 = D.top * H * j(), y1 = noFloor ? H * 1.4 : H - D.bot * H * j();
    const cx = (x0 + x1) / 2 + (T.bend || 0) * W * (k / 3) + (k ? R.range(-0.025, 0.025) * W : 0), cy = (y0 + y1) / 2, a = (x1 - x0) / 2, b = (y1 - y0) / 2;
    const n = R.range(2.8, 4.6), e = 2 / n, ampX = W * 0.085 * D.amp / 3, ampY = H * 0.05 * D.amp / 3;
    const N1 = ringNoise(R, 4 + R.int(3)), N2 = ringNoise(R, 9 + R.int(5)), N3 = ringNoise(R, 27), N4 = ringNoise(R, 67);
    const rim = t => {
      const c = Math.cos(t), s = Math.sin(t), ac = Math.abs(c), as = Math.abs(s), sc = c < 0 ? -1 : 1, ss = s < 0 ? -1 : 1;
      let ox = sc * Math.pow(ac, e * (n - 1)) / a, oy = ss * Math.pow(as, e * (n - 1)) / b;
      const il = 1 / (Math.hypot(ox, oy) || 1); ox *= il; oy *= il;
      const d = (N1(t) * 0.46 + (Math.abs(N2(t)) * 2 - 0.9) * 0.28 + N3(t) * 0.18 + N4(t) * 0.08) * (Math.abs(ox) * ampX + Math.abs(oy) * ampY);   // lumps, sharp nooks, small teeth
      return { x: cx + a * sc * Math.pow(ac, e) - ox * d, y: cy + b * ss * Math.pow(as, e) - oy * d, ix: -ox, iy: -oy };
    };
    const hole = [], shapes = [], tips = [], M = 200;
    for (let i = 0; i < M; i++) { const p = rim(i / M * TAU); hole.push([p.x, p.y]); }
    const wideMul = B.wide ? 1.7 : 1, nSp = Math.round(D.spikes * T.spikes * wideMul * 1.3);
    for (let i = 0; i < nSp; i++) {                                           // stalactites
      const p = rim(R.range(Math.PI + 0.3, TAU - 0.3)); if (p.iy < 0.35) continue;
      const len = S * D.scale * R.range(3, 12) * (R() < 0.22 ? 1.5 : 1), w = len * R.range(0.2, 0.34) + S * 0.8 * D.scale;
      const s = spike(R, p.x, p.y - len * 0.1, R.range(-0.06, 0.06), 1, len, w, S * 0.22 * D.scale);
      shapes.push(s.pts); tips.push({ x: s.tip[0], y: s.tip[1] });
    }
    if (!noFloor) {
      for (let i = 0; i < Math.round(nSp * 0.7); i++) {                       // stalagmites
        const p = rim(R.range(0.3, Math.PI - 0.3)); if (p.iy > -0.35) continue;
        const len = S * D.scale * R.range(2, 7.5), w = len * R.range(0.34, 0.6) + S * D.scale;
        shapes.push(spike(R, p.x, p.y + len * 0.12, R.range(-0.08, 0.08), -1, len, w, S * 0.3 * D.scale).pts);
      }
      for (let i = 0, m = Math.round((3 + R.int(4)) * wideMul); i < m; i++) { // rubble
        const p = rim(R.range(0.2, Math.PI - 0.2)), r = S * D.scale * R.range(1.4, 4.6);
        shapes.push(blob(R, p.x, p.y + r * 0.25, r * R.range(1, 1.6), r * 0.8, 9, 0.2));
      }
    }
    if (B.wide && (k === 1 || k === 2)) {                                     // a column near one side of the opening
      const left = (k === 1) === (T.seed % 2 === 0), x = left ? x0 + W * R.range(0.03, 0.07) : x1 - W * R.range(0.03, 0.07), w = S * D.scale * R.range(3.5, 5.5), col = [];
      const prof = v => w * (0.42 + 0.58 * Math.pow(Math.abs(2 * v - 1), 1.6)) * (1 + 0.12 * N2(v * 9));
      for (let i = 0; i <= 12; i++) col.push([x - prof(i / 12), -S + (H + 2 * S) * i / 12]);
      for (let i = 12; i >= 0; i--) col.push([x + prof(i / 12) * R.range(0.9, 1.1), -S + (H + 2 * S) * i / 12]);
      shapes.push(col);
    }
    wind(hole, true); for (const s of shapes) wind(s, false);
    const m = S * 6, hb = [1e9, 1e9, -1e9, -1e9];                               // bounding box of the opening
    for (const p of hole) { hb[0] = Math.min(hb[0], p[0]); hb[1] = Math.min(hb[1], p[1]); hb[2] = Math.max(hb[2], p[0]); hb[3] = Math.max(hb[3], p[1]); }
    const L = makeLayer(k, D);
    L.rim = rim; L.tips = tips; L.hb = hb;
    L.trace = g => {
      g.beginPath(); g.moveTo(-m, -m); g.lineTo(-m, H + m); g.lineTo(W + m, H + m); g.lineTo(W + m, -m); g.closePath();
      g.moveTo(hole[0][0], hole[0][1]); for (let i = 1; i < M; i++) g.lineTo(hole[i][0], hole[i][1]); g.closePath();   // angular rock edge
      for (const s of shapes) tracePts(g, s);
    };
    return L;
  }

  // Quartz clusters grow from the rim of the openings into them.
  function placeClusters(B) {
    const { R, T, S, W, H } = B, all = [], f = B.focus;
    for (let k = 0; k < NL; k++) {
      const L = B.layers[k], D = LAYERS[k];
      let want = Math.round(D.clusters * T.density * (B.wide ? 1.5 : 1)), tries = 120;
      while (want > 0 && tries-- > 0) {
        const p = L.rim(R() * TAU);
        if (p.x < S || p.x > W - S || p.y < S || p.y > H - S) continue;
        if (B.liquid && k >= B.liquid.after && p.y > B.liquid.y - S * 4) continue;
        if (f && k < 2 && tries > 40 && p.x > f.x - S && p.x < f.x + f.w + S && p.y > f.y - S && p.y < f.y + f.h + S) continue;
        let size = S * D.scale * T.crystalSize * R.range(4.6, 10), glow = 1, ok = true;
        const P = B.P, mi = clamp(Math.round((p.y + p.iy * size * 0.4) * B.sy), 0, P.lh - 1) * P.lw + clamp(Math.round((p.x + p.ix * size * 0.4) * B.sx), 0, P.lw - 1);
        for (let q = 0; q < k; q++) if (B.layers[q].Bm[mi << 2] > 100) ok = false;        // behind a nearer wall
        for (const c of all) if (Math.hypot(c.x - p.x, c.y - p.y) < (c.size + size) * 1.1 + S * 4) { ok = false; break; }
        if (!ok) continue;
        if (f && p.x > f.x + f.w * 0.12 && p.x < f.x + f.w * 0.88 && p.y > f.y + f.h * 0.06 && p.y < f.y + f.h * 0.94) { size *= 0.78; glow = 0.7; }
        const ang = Math.atan2(p.iy, p.ix) + R.range(-0.4, 0.4), col = R.int(3);
        const c = { k, x: p.x - p.ix * size * 0.1, y: p.y - p.iy * size * 0.1, ang, size, glow: glow * T.glow, col, seed: R.int(1e9) };
        c.gx = c.x + Math.cos(ang) * size * 0.42; c.gy = c.y + Math.sin(ang) * size * 0.42;
        all.push(c); want--;
      }
    }
    return all;
  }

  // ------------------------------------------------------------------ rock maps (per-pixel, low resolution, bake only)
  // Blurred coverage of a wall: its silhouette filled white, blurred by halving / doubling.
  // Sets L.Bm (bevel) and, with shadowPx, L.Sm (wide blur: the shadow this wall casts on the next one).
  function rasterMask(B, L, shadowPx) {
    const P = B.P, lw = P.lw, lh = P.lh, g = P.mask.g;
    L.Sm = null;
    if (L.full) { L.Bm = new Uint8ClampedArray(lw * lh * 4).fill(255); return; }
    const blur = px => {
      const levels = clamp(Math.round(Math.log(px / 1.3) / Math.LN2), 1, 4);
      let src = P.mask;
      for (let i = 0; i < levels; i++) { const d = P.pyr[i]; d.g.drawImage(src.c, 0, 0, src.w, src.h, 0, 0, d.w, d.h); src = d; }
      for (let i = levels - 2; i >= 0; i--) { const d = P.pyr[i]; d.g.drawImage(src.c, 0, 0, src.w, src.h, 0, 0, d.w, d.h); src = d; }
      P.noise.g.drawImage(src.c, 0, 0, src.w, src.h, 0, 0, lw, lh);
      return P.noise.g.getImageData(0, 0, lw, lh).data;         // RGBA: read with index << 2
    };
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, lw, lh);
    g.setTransform(B.sx, 0, 0, B.sy, 0, 0); g.fillStyle = '#fff'; L.trace(g); g.fill(); g.setTransform(1, 0, 0, 1, 0, 0);
    L.Bm = blur(L.blurPx);
    if (shadowPx) L.Sm = blur(shadowPx);
  }
  // octaves: [channel, cell size in px, weight, horizontal stretch]. Each octave is turned by its own angle.
  function rasterNoise(P, R, octaves, L) {
    const g = P.noise.g, lw = P.lw, lh = P.lh, src = noiseSources(), dia = Math.hypot(lw, lh);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.save(); g.beginPath(); g.rect(L.bx0, L.by0, L.bx1 - L.bx0, L.by1 - L.by0); g.clip();
    g.fillStyle = '#000'; g.fillRect(0, 0, lw, lh);
    g.globalCompositeOperation = 'lighter';
    for (const o of octaves) {
      const cell = Math.max(o[1], dia / 230), n = dia / cell, st = o[3] || 1;
      g.save(); g.translate(lw / 2, lh / 2); if (st === 1) g.rotate(R.range(0.2, 1.3)); g.globalAlpha = o[2];
      g.drawImage(src[o[0]], R.range(0, 255 - n / st), R.range(0, 255 - n), n / st, n, -dia / 2, -dia / 2, dia, dia);
      g.restore();
    }
    g.restore(); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    return g.getImageData(0, 0, lw, lh).data;
  }

  // All walls and materials share one object layout (keeps the per-pixel loops monomorphic for the JIT).
  function makeLayer(k, D) {
    return { k, D, full: false, lava: false, rim: null, tips: [], hb: null, trace: null, blurPx: 1.5, cov: null, bx0: 0, bx1: 0, by0: 0, by1: 0, Bm: null, Sm: null, shadow: null,
      nd: null, nl: 0, LX: null, LY: null, LZ: null, LQ: null, LK: null, LR: null, LG: null, LB: null, mat: null };
  }
  const F = a => new Float64Array(a);
  function makeMat() {
    return { alb: null, stain: null, amb: null, key: null, keyC: null, fill: null, fillC: null, fA: 0.5, fB: 0.5, mA: 0.5, mx: 0.5, my: 0.5, mq: 0.5, mistC: null,
      wet: 0.5, moss: 0.5, frost: 0.5, vein: 0.5, geode: 0.5, emis: 0.5, mossC: F(mul(hsl([96, 44, 26]), 1 / 255)), frostC: F(mul(hsl([204, 26, 64]), 1 / 255)), veinC: F([0.95, 0.66, 0.2]), geoC: null };
  }
  function setLights(L, ls, sx, sy) {              // ls: [x, y, z, radius, intensity, rgb 0..255, core size] in CSS px
    const n = L.nl = ls.length, f32 = () => new Float32Array(n);
    L.LX = f32(); L.LY = f32(); L.LZ = f32(); L.LQ = f32(); L.LK = f32(); L.LR = f32(); L.LG = f32(); L.LB = f32();
    ls.forEach((l, i) => {
      L.LX[i] = l[0] * sx; L.LY[i] = l[1] * sy; L.LZ[i] = l[2] * sx; L.LQ[i] = l[3] * l[3] * sx * sx; L.LK[i] = 1 / (l[6] * l[6] * sx * sx);
      L.LR[i] = l[5][0] / 255 * l[4]; L.LG[i] = l[5][1] / 255 * l[4]; L.LB[i] = l[5][2] / 255 * l[4];
    });
  }
  // Height field of a wall inside its box: bevelled silhouette + lumps with sharp creases + fine bumps + strata - cracks.
  function heights(P, L, bevH, A1, A2, A3, A4, sf, tilt) {
    const lw = P.lw, Hh = P.H, nd = L.nd, Bm = L.Bm, K = 1 / 255, bx0 = L.bx0, bx1 = L.bx1;
    for (let y = L.by0; y < L.by1; y++) for (let x = bx0, i = y * lw + x; x < bx1; x++, i++) {
      const o = i << 2, n1 = nd[o] * K - 0.5, n2 = nd[o + 1] * K - 0.5, n3 = nd[o + 2] * K - 0.5;
      let h = Bm[o] * K * bevH + (n1 * 0.4 + Math.abs(n1) * 1.7 - 0.42) * A1 + n2 * A2 + SIN[((y * sf + x * tilt + n1 * 1.3) * 256) & 255] * A4;
      const ck = 1 - Math.abs(n3 + n2 * 0.25) * 16; if (ck > 0) h -= ck * A3;       // cracks along the stain borders
      Hh[i] = h;
    }
  }
  // Runs both per-pixel loops once on a small patch with every material switched on. The JIT then compiles them
  // in the background while the bake goes on with canvas work, and no theme hits an unseen code path later.
  function warmUp(P) {
    const n = P.lw * P.lh, L = makeLayer(1, LAYERS[1]), m = L.mat = makeMat(), d = new Uint8ClampedArray(n * 4);
    let v = 0x1234567;
    for (let i = 0; i < n * 4; i++) { v ^= v << 13; v ^= v >>> 17; v ^= v << 5; d[i] = v & 255; }
    L.nd = d; L.Bm = d; L.shadow = d; L.cov = new Uint8Array(n); L.bx1 = Math.min(P.lw, 72); L.by1 = Math.min(P.lh, 40);
    setLights(L, [[20, 20, 9, 90, 1, WHITE, 20], [70, 30, 4, 60, 1, WHITE, 9], [300, 300, 2, 30, 1, WHITE, 9]], 1, 1);
    m.alb = F([0.3, 0.3, 0.3]); m.stain = F([0.4, 0.3, 0.3]); m.amb = F([0.1, 0.1, 0.1]); m.key = F([-0.42, -0.62, 0.66]); m.keyC = F([0.2, 0.2, 0.2]); m.fill = F([0, 0.9, 0.44]); m.fillC = F([1, 0.4, 0.1]);
    m.mx = 30; m.my = 30; m.mq = 0.001; m.mistC = F([0.5, 0.5, 0.5]); m.geoC = F([0.5, 0.3, 0.6]);
    heights(P, L, 3, 4, 1, 1, 0.3, 0.1, 0.01); litBand(P, L, 0, L.by1);
    L.shadow = null; m.fA = 0; m.fB = 0; m.mA = 0; m.wet = 0; m.moss = 0; m.frost = 0; m.vein = 0; m.geode = 0; m.emis = 0; litBand(P, L, 0, 8);
  }

  // Noise, height field, material and light list of one wall.
  function prepLayer(B, k) {
    const P = B.P, L = B.layers[k], D = L.D, T = B.T, pal = B.pal, lh = P.lh, u = B.S * B.sx * D.scale;
    const R = makeRng(T.seed * 131 + k * 977 + 5), lava = L.lava, back = k === NL;
    const c1 = 11 * u, c2 = 2.5 * u, c3 = 15 * u, rough = T.rough || 1;
    L.nd = rasterNoise(P, R, lava
      ? [[0, c1 * 0.5, 0.6, 3.2], [0, c1 * 0.2, 0.4, 2.6], [1, c2, 0.6, 2.4], [1, Math.max(1.5, c2 * 0.45), 0.4, 2], [2, c3, 1, 3]]
      : [[0, c1, 0.6], [0, c1 * 0.42, 0.4], [1, c2, 0.6], [1, Math.max(1.5, c2 * 0.42), 0.4], [2, c3, 0.6], [2, c3 * 0.35, 0.4]], L);
    const sf = 1 / (5.5 * u);
    if (lava) heights(P, L, 0, 0, c2 * 0.15, 0, 0, sf, 0);
    else heights(P, L, L.blurPx * 2, c1 * 0.36 * rough, c2 * 0.42 * rough, 0.9 * u, 0.12 * u * (T.strata === undefined ? 1 : T.strata), sf, R.range(-0.2, 0.2) * sf);
    P.out.data.fill(0);

    // lights: this wall's own clusters graze it, nearer ones shine onto it, farther ones rim it; plus the far chamber
    const ls = [];
    for (const c of B.clusters) {
      const dk = (lava ? 3 : k) - c.k; let I, z;
      if (dk === 0) { I = 2.5; z = 0.3; } else if (dk > 0 && dk <= 2) { I = 1.4 / dk; z = 0.45 + 0.5 * dk; } else if (dk === -1) { I = 0.7; z = 0.1; } else continue;
      ls.push([c.gx, c.gy, c.size * z, c.size * (5 + dk), I * c.glow * D.gain, pal.crystals[c.col].glow, c.size]);
    }
    for (const e of B.extra) if (Math.abs(e.k - k) <= 1) ls.push([e.x, e.y, e.r * 0.3, e.r, e.I * D.gain, e.col, e.r * 0.3]);
    const ch = T.chamber * (back ? 1.15 : 2.2) * D.gain, big = Math.max(B.W, B.H);
    ls.push([B.open.x, B.open.y, back ? big * 0.2 : B.S * 2.5, big * (back ? 0.85 : 1.3), ch, pal.light, big * (back ? 0.3 : 0.6)]);
    setLights(L, ls, B.sx, B.sy);

    const hazeU = mul(pal.haze, 1 / 255), left = B.open.x < B.W / 2, m = L.mat = makeMat();
    m.alb = F(lava ? [0.07, 0.045, 0.04] : pal.rock); m.stain = F(lava ? [0.1, 0.06, 0.05] : pal.stain);
    m.amb = F(mul(mix(hazeU, [0.5, 0.5, 0.5], 0.3), (back ? 0.45 : 0.27) * D.gain));
    m.key = F([left ? -0.42 : 0.42, -0.62, 0.66]); m.keyC = F(mul(mix(pal.lightU, [1, 1, 1], 0.45), 0.19 * D.gain));
    m.fill = F([0, 0, 1]); m.fillC = F([0, 0, 0]); m.fA = 0; m.fB = 0;
    if (T.liquid === 'lava') { const yl = B.liquid.y * B.sy, rg = 0.8 * lh; m.fill = F([0, 0.9, 0.44]); m.fillC = F(mul([1, 0.4, 0.1], 2.5 * D.gain)); m.fA = 1 - yl / rg; m.fB = 1 / rg; }
    else if (B.open.a > 0) { m.fill = F([left ? -0.34 : 0.34, -0.8, 0.5]); m.fillC = F(mul(mix(pal.lightU, [1, 1, 1], 0.3), 0.42 * B.open.a * D.gain)); m.fA = 1.05; m.fB = -1 / (0.78 * lh); }
    m.mA = back ? 1.6 * (0.09 + 0.15 * T.chamber) : 0; m.mx = B.open.x * B.sx; m.my = B.open.y * B.sy; m.mq = 1 / Math.pow(big * 0.2 * B.sx, 2); m.mistC = F(pal.lightU);
    m.wet = T.wet * (lava ? 0.5 : 1); m.moss = T.moss || 0; m.frost = T.frost || 0; m.vein = lava ? 0 : (T.vein || 0); m.geode = k >= 1 && !lava ? (T.geode || 0) : 0; m.emis = lava ? 1 : 0;
    m.geoC = F(mul(pal.crystals[0].body, 1 / 255));
  }

  // Shade rows y0..y1 of a wall into P.out.
  function litBand(P, L, y0, y1) {
    const lw = P.lw, lh = P.lh, Bm = L.Bm, cov = L.cov, sh = L.shadow, Hh = P.H, nd = L.nd, out = P.out.data, m = L.mat, K = 1 / 255;
    const aR = m.alb[0], aG = m.alb[1], aB = m.alb[2], sR = m.stain[0], sG = m.stain[1], sB = m.stain[2];
    const amR = m.amb[0], amG = m.amb[1], amB = m.amb[2], kx = m.key[0], ky = m.key[1], kz = m.key[2], kR = m.keyC[0], kG = m.keyC[1], kB = m.keyC[2];
    const fx = m.fill[0], fy = m.fill[1], fz = m.fill[2], fR = m.fillC[0], fG = m.fillC[1], fB = m.fillC[2], fA = m.fA, fBv = m.fB;
    const wet = m.wet, moss = m.moss, frost = m.frost, vein = m.vein, geode = m.geode, emis = m.emis, moC = m.mossC, fC = m.frostC, vC = m.veinC, gC = m.geoC;
    const nl = L.nl, LX = L.LX, LY = L.LY, LZ = L.LZ, LQ = L.LQ, LK = L.LK, LR = L.LR, LG = L.LG, LB = L.LB;
    const bx0 = L.bx0, bx1 = L.bx1, VX = P.VX, VY = P.VY, mA = m.mA, mx = m.mx, my = m.my, mq = m.mq, mC = m.mistC;
    if (y0 < L.by0) y0 = L.by0; if (y1 > L.by1) y1 = L.by1;
    for (let y = y0; y < y1; y++) {
      const up = y > 0 ? lw : 0, dn = y < lh - 1 ? lw : 0;
      let fa = fA + y * fBv; fa = fa < 0 ? 0 : fa > 1 ? 1 : fa; fa *= fa;
      const vy = VY[y];
      for (let x = bx0, i = y * lw + x; x < bx1; x++, i++) {
        const o = i << 2, b = Bm[o];
        if (b < 2 || cov[i]) continue;
        const hx = Hh[x > 0 ? i - 1 : i] - Hh[x < lw - 1 ? i + 1 : i], hy = Hh[i - up] - Hh[i + dn];
        let inv = 1 / Math.sqrt(hx * hx + hy * hy + 4), nx = hx * inv, ny = hy * inv, nz = 2 * inv;
        const n1 = nd[o] * K - 0.5, n2 = nd[o + 1] * K - 0.5, n3 = nd[o + 2] * K - 0.5;
        let st = 0.5 + n3 * 2.6; st = st < 0 ? 0 : st > 1 ? 1 : st;
        let ar = aR + (sR - aR) * st, ag = aG + (sG - aG) * st, ab = aB + (sB - aB) * st;
        let shade = (1 + n2 * 1.1 + n1 * 0.5) * vy * VX[x];
        const ck = 1 - Math.abs(n3 + n2 * 0.25) * 16; if (ck > 0) shade *= 1 - 0.75 * ck;
        let ao = 0.8 + n2 * 2.4; ao = ao < 0.1 ? 0.1 : ao > 1.15 ? 1.15 : ao;                 // pits and crevices go dark
        let q = Math.abs(n1) * 8; if (q < 1) ao *= 0.3 + 0.7 * q;
        if (sh) { q = sh[o] * K * 1.8; shade *= q > 1 ? 0.15 : 1 - 0.85 * q; }                 // in the shadow of the nearer wall
        let gl = wet * (0.6 + n1 * 1.8); if (gl < 0) gl = 0;                                   // wet patches
        let er = 0, eg = 0, eb = 0;
        if (moss > 0) { q = (moss - 0.6 - ny * 1.1 + n3 * 2.4 + n1) * 3; if (q > 0) { if (q > 1) q = 1; const v = 1 + n2 * 1.6; ar += (moC[0] * v - ar) * q; ag += (moC[1] * v - ag) * q; ab += (moC[2] * v - ab) * q; gl *= 1 - 0.8 * q; } }
        if (frost > 0) { q = (frost - 1.25 - ny * 1.8 + n1 * 1.3) * 2; if (q > 0) { if (q > 0.75) q = 0.75; ar += (fC[0] - ar) * q; ag += (fC[1] - ag) * q; ab += (fC[2] - ab) * q; gl += q * 0.4; } }
        if (vein > 0) { q = 1 - Math.abs(Math.abs(n3 - n1 * 0.35) - 0.15) * 42; if (q > 0 && n1 > 0.02) { q *= q * vein * (n1 > 0.1 ? 1 : (n1 - 0.02) * 12.5); ar += (vC[0] - ar) * q; ag += (vC[1] - ag) * q; ab += (vC[2] - ab) * q; gl += q * 2.2; shade += (1.15 - shade) * q; er = vC[0] * q * 0.1; eg = vC[1] * q * 0.1; eb = vC[2] * q * 0.1; } }
        if (geode > 0) {                           // band of fine sparkling crystals just inside the rim
          q = 0.9 - Math.abs(b - 165) * 0.02 + n3 * 6; if (q > 0) {
            if (q > 1) q = 1; q *= geode;
            const hh = Math.imul(Math.imul(x, 73856093) ^ Math.imul(y, 19349663), 0x9E3779B1) >>> 8;
            nx += ((hh & 255) * K - 0.5) * 1.5 * q; ny += (((hh >>> 8) & 255) * K - 0.5) * 1.5 * q;
            inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz); nx *= inv; ny *= inv; nz *= inv;
            ar += (gC[0] - ar) * q; ag += (gC[1] - ag) * q; ab += (gC[2] - ab) * q; gl += q * 1.6; ao += (1 - ao) * q * 0.6;
          }
        }
        if (emis > 0) { q = 1 - Math.abs(n1 + n2 * 0.4) * 9.5; if (q < 0) q = 0; let q2 = 1 - Math.abs(n3) * 13; if (q2 < 0) q2 = 0; const c = q * q; er = 0.085 + q * 1.05 + c * 0.45 + q2 * 0.45; eg = 0.012 + c * 0.6 + q * 0.1 + q2 * q2 * 0.14; eb = c * c * 0.18; }
        let lr = amR * ao, lg = amG * ao, lb = amB * ao, sr = 0, sg = 0, sb = 0;
        let d = nx * kx + ny * ky + nz * kz; if (d > 0) { lr += kR * d; lg += kG * d; lb += kB * d; }
        if (fa > 0) { d = nx * fx + ny * fy + nz * fz; if (d > 0) { d *= fa; lr += fR * d; lg += fG * d; lb += fB * d; if (gl > 0) { let s = d * d; s *= s * gl * 0.6; sr += fR * s; sg += fG * s; sb += fB * s; } } }
        for (let j = 0; j < nl; j++) {
          const dx = LX[j] - x, dy = LY[j] - y, d2 = dx * dx + dy * dy, r2 = LQ[j];
          if (d2 >= r2) continue;
          const dz = LZ[j], il = 1 / Math.sqrt(d2 + dz * dz), ndl = (nx * dx + ny * dy + nz * dz) * il;
          if (ndl <= 0) continue;
          let f = 1 - d2 / r2; f = f * f / (1 + d2 * LK[j]);
          const df = ndl * f;
          lr += LR[j] * df; lg += LG[j] * df; lb += LB[j] * df;
          if (gl > 0) { let s = (ndl + nz) / Math.sqrt(2 + 2 * dz * il); s *= s; s *= s; s *= s; s *= s * f * gl; sr += LR[j] * s; sg += LG[j] * s; sb += LB[j] * s; }
        }
        if (shade < 0.12) shade = 0.12;
        if (mA > 0) { const dx = mx - x, dy = my - y; let f = 1 / (1 + (dx * dx + dy * dy) * mq); f *= f * mA; er += mC[0] * f; eg += mC[1] * f; eb += mC[2] * f; }   // lit mist in front of the back wall
        let r = ar * shade * lr + sr * 0.55 + er, gg = ag * shade * lg + sg * 0.55 + eg, bb = ab * shade * lb + sb * 0.55 + eb;
        if (r > 0.6) r = 0.6 + (r - 0.6) / (1 + (r - 0.6) * 1.6); if (gg > 0.6) gg = 0.6 + (gg - 0.6) / (1 + (gg - 0.6) * 1.6); if (bb > 0.6) bb = 0.6 + (bb - 0.6) / (1 + (bb - 0.6) * 1.6);
        out[o] = r * 255; out[o + 1] = gg * 255; out[o + 2] = bb * 255; out[o + 3] = 255;
      }
    }
  }

  // ------------------------------------------------------------------ full-resolution drawing (bake only)
  function glowAt(g, x, y, r, rgb, a) {            // additive soft halo
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, css(rgb, a)); gr.addColorStop(0.3, css(rgb, a * 0.45)); gr.addColorStop(0.65, css(rgb, a * 0.12)); gr.addColorStop(1, css(rgb, 0));
    g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); g.globalCompositeOperation = 'source-over';
  }

  // The lit rock map of a wall, scaled up, cut out along its crisp silhouette, with fine grain.
  function composeRock(B, k) {
    const g = B.g, L = B.layers[k], P = B.P;
    const bw = L.bx1 - L.bx0, bh = L.by1 - L.by0, X = L.bx0 / B.sx, Y = L.by0 / B.sy, Wd = bw / B.sx, Hd = bh / B.sy;
    if (bw < 1 || bh < 1) return;
    P.lit.g.putImageData(P.out, 0, 0, L.bx0, L.by0, bw, bh);
    g.save();
    if (!L.full) { L.trace(g); g.clip(); }
    g.drawImage(P.lit.c, L.bx0, L.by0, bw, bh, X, Y, Wd, Hd);
    if (!L.lava) {
      const gs = (0.6 + 0.4 * L.D.scale) * Math.max(1, B.S / 7) / B.scale;
      g.scale(gs, gs); g.fillStyle = B.grain; g.fillRect(X / gs, Y / gs, Wd / gs, Hd / gs);
    }
    g.restore();
  }

  // One quartz point: a hexagonal prism seen from the side with a pyramid tip. No outlines: smooth
  // gradient from the dark root to the pale tip, a lit and a shaded face, bright edges, inner glow.
  function drawPoint(g, R, x, y, ang, len, w, C, fine) {
    g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2);                    // local: root at 0, tip at (ax, -len)
    const hw = w / 2, th = Math.min(len * 0.4, w * R.range(0.8, 1.3)), yb = -(len - th), lit = R() < 0.5 ? 0 : 2;
    const f1 = -hw + w * R.range(0.24, 0.38), f2 = hw - w * R.range(0.18, 0.3), ax = R.range(-0.2, 0.2) * w, xs = [-hw, f1, f2, hw];
    const face = i => { g.beginPath(); g.moveTo(xs[i], w * 0.2); g.lineTo(xs[i + 1], w * 0.2); g.lineTo(xs[i + 1], yb); g.lineTo(ax, -len); g.lineTo(xs[i], yb); g.closePath(); };
    const body = () => { g.beginPath(); g.moveTo(-hw, w * 0.2); g.lineTo(hw, w * 0.2); g.lineTo(hw, yb); g.lineTo(ax, -len); g.lineTo(-hw, yb); g.closePath(); };
    let gr = g.createLinearGradient(0, 0, 0, -len);
    gr.addColorStop(0, css(mul(C.deep, 0.4), 0)); gr.addColorStop(0.1, css(mul(C.deep, 0.45), 0.95)); gr.addColorStop(0.3, css(C.deep, 0.9)); gr.addColorStop(0.72, css(mix(C.deep, C.body, 0.8), 0.74)); gr.addColorStop(1, css(mix(C.body, C.pale, 0.45), 0.72));
    g.fillStyle = gr; body(); g.fill();
    const wg = g.createLinearGradient(0, 0, 0, -len);                            // white, fading in towards the tip
    wg.addColorStop(0, 'rgba(255,255,255,0)'); wg.addColorStop(0.35, 'rgba(255,255,255,0.3)'); wg.addColorStop(1, 'rgba(255,255,255,0.95)');
    g.globalAlpha = 0.34; g.fillStyle = wg; face(lit); g.fill();                 // lit face
    g.globalAlpha = 0.5; g.fillStyle = css(mul(C.deep, 0.5), 1); face(2 - lit); g.fill();   // shaded face
    g.globalAlpha = 0.3; g.fillStyle = css(C.pale, 1); g.beginPath(); g.moveTo(xs[lit], yb); g.lineTo(xs[lit + 1], yb); g.lineTo(ax, -len); g.closePath(); g.fill();   // lit tip facet
    g.globalAlpha = 0.14; g.beginPath(); g.moveTo(f1, yb); g.lineTo(f2, yb); g.lineTo(ax, -len); g.closePath(); g.fill();
    g.globalCompositeOperation = 'lighter';                                      // light gathered inside
    gr = g.createLinearGradient(0, 0, 0, -len);
    gr.addColorStop(0, css(C.glow, 0)); gr.addColorStop(0.5, css(C.glow, 0.2)); gr.addColorStop(1, css(mix(C.glow, C.pale, 0.5), 0.42));
    g.globalAlpha = 1; g.fillStyle = gr; body(); g.fill();
    if (fine) {
      g.strokeStyle = wg; g.lineCap = 'round'; g.lineWidth = clamp(w * 0.045, 0.5, 1.5);
      g.globalAlpha = 0.6; g.beginPath(); g.moveTo(f1, 0); g.lineTo(f1, yb); g.lineTo(ax, -len); g.moveTo(f2, 0); g.lineTo(f2, yb); g.lineTo(ax, -len); g.stroke();   // edges between the faces
      g.globalAlpha = 0.4; g.beginPath(); g.moveTo(xs[lit ? 3 : 0], 0); g.lineTo(xs[lit ? 3 : 0], yb); g.lineTo(ax, -len); g.stroke();                               // rim on the lit side
      const e = lit ? f2 : f1, s = lit ? 1 : -1;
      g.globalAlpha = 0.5; g.fillStyle = wg; g.beginPath(); g.moveTo(e + s * w * 0.05, yb * 0.3); g.lineTo(e + s * w * 0.13, yb * 0.3); g.lineTo(e + s * w * 0.13, yb * 0.92); g.lineTo(e + s * w * 0.05, yb * 0.97); g.closePath(); g.fill();   // specular streak
      g.globalAlpha = 0.16; g.lineWidth = clamp(w * 0.03, 0.4, 1); g.beginPath(); g.moveTo(f1 + w * 0.04, yb * R.range(0.3, 0.5)); g.lineTo(f2 - w * 0.03, yb * R.range(0.55, 0.8)); g.stroke();   // inner veil
      g.globalAlpha = 0.95; g.fillStyle = '#fff'; g.beginPath(); g.arc(e, yb, clamp(w * 0.07, 0.5, 1.6), 0, TAU); g.fill();   // sharp specular
    }
    g.restore();
  }

  // A cluster: a fan of points around the direction c.ang (the longest in the middle) rooted in a
  // crust of rock matrix, with a bloom halo. It also registers its breathing glow and glints.
  function drawCluster(B, c) {
    const g = B.g, R = makeRng(c.seed), S = B.S, C = B.pal.crystals[c.col], sc = B.scene;
    const dx = Math.cos(c.ang), dy = Math.sin(c.ang), px = -dy, py = dx, n = 3 + R.int(3), pts = [];
    glowAt(g, c.gx, c.gy, c.size * 2, C.glow, 0.32 * c.glow);
    for (let i = 0; i < n + 3; i++) {
      const small = i >= n, off = small ? R.range(-1.1, 1.1) : (n > 1 ? i / (n - 1) * 2 - 1 : 0) * 0.9 + R.range(-0.14, 0.14);
      const len = c.size * (small ? R.range(0.22, 0.4) : (1 - 0.5 * Math.abs(off)) * R.range(0.72, 1));
      pts.push({ a: c.ang + off * R.range(0.28, 0.55) + R.range(-0.08, 0.08), len, w: Math.max(len * R.range(0.2, 0.3), c.size * 0.07), x: c.x + px * off * c.size * 0.36, y: c.y + py * off * c.size * 0.36 });
    }
    pts.sort((p, q) => q.len - p.len);
    for (const p of pts) drawPoint(g, R, p.x, p.y, p.a, p.len, p.w, C, p.len > S * 2.2);
    glowAt(g, c.gx, c.gy, c.size * 0.9, mix(C.glow, WHITE, 0.25), 0.2 * c.glow);
    if (c.k < 3) sc.glows.push(place(glowSprite(C.glow, c.size * 1.3 * B.scale), c.gx, c.gy, B.scale, { a: 0.3 * c.glow, speed: R.range(0.35, 0.7), phase: R() * TAU }));
    const p = pts[0];
    if (c.k < 3 && R() < 0.8) sc.glints.push({ x: p.x + Math.cos(p.a) * p.len * 0.8, y: p.y + Math.sin(p.a) * p.len * 0.8, r: clamp(c.size * 0.12, S * 0.5, S * 1.4), period: R.range(5, 11), off: R() });
  }

  function icicles(B, k) {                         // glassy icicles under the ceiling of a wall
    const g = B.g, R = B.R, S = B.S, L = B.layers[k], D = L.D, ice = hsl([200, 40, 78]), pale = hsl([196, 50, 92]);
    for (let n = Math.round((B.wide ? 7 : 5) * (1.2 - k * 0.15)); n > 0; n--) {
      const t0 = R.range(Math.PI + 0.25, TAU - 0.25);
      for (let i = 0, m = 2 + R.int(4); i < m; i++) {
        const p = L.rim(t0 + i * 0.025 * R.range(0.7, 1.3)); if (p.iy < 0.45) continue;
        const len = S * D.scale * R.range(2.2, 8.5), w = len * R.range(0.08, 0.13) + S * 0.3, x = p.x, y = p.y - S * 0.6, bend = R.range(-0.05, 0.05) * len;
        g.beginPath(); g.moveTo(x - w / 2, y); g.quadraticCurveTo(x - w * 0.16, y + len * 0.55, x + bend, y + len); g.quadraticCurveTo(x + w * 0.2, y + len * 0.5, x + w / 2, y); g.closePath();
        const gr = g.createLinearGradient(0, y, 0, y + len); gr.addColorStop(0, css(ice, 0.12)); gr.addColorStop(0.55, css(ice, 0.26)); gr.addColorStop(1, css(pale, 0.75));
        g.fillStyle = gr; g.fill();
        g.strokeStyle = css(B.pal.deep, 0.3); g.lineWidth = Math.max(0.5, w * 0.16); g.lineCap = 'round';
        g.beginPath(); g.moveTo(x + w * 0.3, y + len * 0.06); g.quadraticCurveTo(x + w * 0.14, y + len * 0.5, x + bend, y + len * 0.9); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = Math.max(0.5, w * 0.12);
        g.beginPath(); g.moveTo(x - w * 0.2, y + len * 0.1); g.quadraticCurveTo(x - w * 0.08, y + len * 0.5, x + bend * 0.9, y + len * 0.94); g.stroke();
        if (k >= 1 && R() < 0.25) L.tips.push({ x: x + bend, y: y + len });
      }
    }
  }
  function druse(B, k) {                           // geode lining: a dense fringe of tiny points along the rim
    const g = B.g, R = B.R, S = B.S, L = B.layers[k], D = L.D, cs = B.pal.crystals;
    const arcs = [0, 1, 2, 3].map(() => [R() * TAU, R.range(0.2, 0.5)]);
    for (let n = Math.round((B.wide ? 150 : 90) * (1.1 - k * 0.12)); n > 0; n--) {
      const arc = arcs[n % 4], p = L.rim(arc[0] + (R() + R() - 1) * arc[1]), C = cs[R.int(3)], len = S * D.scale * R.range(0.8, 2.6), a = Math.atan2(p.iy, p.ix) + R.range(-0.7, 0.7), w = len * R.range(0.28, 0.42);
      const dx = Math.cos(a), dy = Math.sin(a), px = -dy * w / 2, py = dx * w / 2, x = p.x - p.ix * len * 0.25, y = p.y - p.iy * len * 0.25, mx = x + dx * len * 0.62, my = y + dy * len * 0.62, tx = x + dx * len, ty = y + dy * len;
      g.fillStyle = css(mix(C.deep, C.body, 0.55), 0.9); g.beginPath(); g.moveTo(x + px, y + py); g.lineTo(mx + px, my + py); g.lineTo(tx, ty); g.lineTo(mx - px, my - py); g.lineTo(x - px, y - py); g.closePath(); g.fill();
      g.fillStyle = css(C.pale, 0.4); g.beginPath(); g.moveTo(x + px, y + py); g.lineTo(mx + px, my + py); g.lineTo(tx, ty); g.lineTo(x + px * 0.2, y + py * 0.2); g.closePath(); g.fill();
    }
  }
  function fungi(B, k) {                           // bioluminescent caps on the rock (their light is in B.extra)
    const g = B.g, R = makeRng(B.T.seed + k * 31);
    for (const e of B.extra) if (e.k === k) {
      glowAt(g, e.x, e.y, e.r * 0.5, e.col, 0.3);
      for (let i = 0; i < 6; i++) {
        const x = e.x + R.range(-1, 1) * e.r * 0.16, y = e.y + R.range(-1, 1) * e.r * 0.12, r = e.r * R.range(0.018, 0.04);
        g.fillStyle = css(mix(e.col, WHITE, 0.55), 0.95); g.beginPath(); g.ellipse(x, y, r * 1.5, r, 0, Math.PI, TAU); g.fill();
        g.fillStyle = css(e.col, 0.5); g.fillRect(x - r * 0.2, y, r * 0.4, r * 1.6);
      }
      B.scene.glows.push(place(glowSprite(e.col, e.r * 0.4 * B.scale), e.x, e.y, B.scale, { a: 0.4, speed: R.range(0.25, 0.5), phase: R() * TAU }));
    }
  }

  // Still water: everything standing above the water line, mirrored in thin strips that wobble sideways.
  function lakeReflect(B) {
    const g = B.g, W = B.W, H = B.H, S = B.S, y0 = B.liquid.y, hgt = H - y0, sc = B.scale, pal = B.pal, R = makeRng(B.T.seed + 99);
    const take = Math.min(y0, hgt * 1.25), tmp = makeCanvas(B.canvas.width, hgt * sc), tg = tmp.getContext('2d');
    tg.translate(0, tmp.height); tg.scale(1, -1); tg.drawImage(B.canvas, 0, (y0 - take) * sc, B.canvas.width, take * sc, 0, 0, tmp.width, tmp.height);
    g.save(); g.beginPath(); g.rect(0, y0, W, hgt); g.clip();
    g.fillStyle = css(pal.deep, 1); g.fillRect(0, y0, W, hgt);
    const strip = Math.max(1.5, S * 0.45), ph = R() * TAU;
    for (let y = 0; y < hgt; y += strip) {
      const q = y / hgt;
      g.globalAlpha = 0.95 - 0.3 * q;
      g.drawImage(tmp, 0, y * sc, tmp.width, strip * sc, Math.sin(y / S * 1.9 + ph + Math.sin(y / S * 0.7) * 2) * S * (0.1 + 0.55 * q), y0 + y, W, strip + 0.6);
    }
    g.globalAlpha = 1;
    let gr = g.createLinearGradient(0, y0, 0, H); gr.addColorStop(0, css(mix(pal.deep, pal.haze, 0.5), 0.1)); gr.addColorStop(1, css(pal.deep, 0.6));
    g.fillStyle = gr; g.fillRect(0, y0, W, hgt);
    gr = g.createLinearGradient(0, y0 - S * 0.4, 0, y0 + S * 1.6); gr.addColorStop(0, css(pal.light, 0)); gr.addColorStop(0.3, css(pal.light, 0.3)); gr.addColorStop(1, css(pal.light, 0));
    g.restore(); g.fillStyle = gr; g.fillRect(0, y0 - S * 0.4, W, S * 2);       // mist on the far shore line
    for (let i = 0; i < 12; i++) B.scene.shimmers.push({ x: W * R.range(0.28, 0.72), y: y0 + hgt * R.range(0.03, 0.4), w: S * R.range(3, 9), h: Math.max(1, S * 0.14), speed: R.range(0.3, 0.8), phase: R() * TAU });
    B.scene.shimmerColor = css(mix(pal.light, WHITE, 0.4), 1);
  }

  // Everything that sits on a wall once its rock is there, then the haze veil in front of it.
  function composeDetail(B, k) {
    const g = B.g, T = B.T, W = B.W, H = B.H, S = B.S, pal = B.pal, L = B.layers[k];
    if (k === NL) {                                // far chamber: soft glow, daylight if the theme has an opening
      if (B.open.a > 0) glowAt(g, B.open.x, B.open.y - S * 6, S * 26, mix(pal.light, WHITE, 0.5), 0.34 * B.open.a);
    } else if (L.lava) {                           // heat glow over the lava
      const y = B.liquid.y, gr = g.createLinearGradient(0, y - S * 22, 0, y + S * 4);
      gr.addColorStop(0, 'rgba(255,90,20,0)'); gr.addColorStop(0.8, 'rgba(255,96,24,0.26)'); gr.addColorStop(1, 'rgba(255,120,40,0.1)');
      g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(0, y - S * 22, W, S * 26); g.globalCompositeOperation = 'source-over';
    } else {
      if (T.fungi) fungi(B, k);
      if (T.druse && k >= 1) druse(B, k);
      for (const c of B.clusters) if (c.k === k) drawCluster(B, c);
      if (T.icicles && k <= 2) icicles(B, k);
    }
    const v = L.D.veil;
    if (v > 0) { g.globalAlpha = v; g.fillStyle = B.hazeGrad; g.fillRect(L.bx0 / B.sx, L.by0 / B.sy, (L.bx1 - L.bx0) / B.sx, (L.by1 - L.by0) / B.sy); g.globalAlpha = 1; }
  }

  // ------------------------------------------------------------------ sprites for the animated overlays
  function radialSprite(n, stops) {
    const c = makeCanvas(n, n), g = c.getContext('2d'), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    for (const s of stops) gr.addColorStop(s[0], css(s[1], s[2]));
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
    return c;
  }
  function glowSprite(rgb, r) { return radialSprite(Math.max(4, Math.round(r * 2)), [[0, rgb, 0.8], [0.25, rgb, 0.38], [0.6, rgb, 0.1], [1, rgb, 0]]); }
  // Big overlays are rendered at the resolution of the baked picture and blitted 1:1 on whole pixels with plain
  // source-over: several times cheaper than filtered or additive blits. (x, y) = centre in CSS px.
  function place(img, x, y, scale, o) {
    o.img = img; o.w = img.width / scale; o.h = img.height / scale; o.x = Math.round((x - o.w / 2) * scale) / scale; o.y = Math.round((y - o.h / 2) * scale) / scale;
    return o;
  }
  function shaftSprite(rgb, w, h, lean) {          // slanted soft beam, bright at the top, gone at the bottom
    const c = makeCanvas(w + Math.abs(lean), h), g = c.getContext('2d'), x0 = lean < 0 ? -lean : 0;
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, css(rgb, 0)); gr.addColorStop(0.16, css(rgb, 0.105)); gr.addColorStop(0.6, css(rgb, 0.05)); gr.addColorStop(1, css(rgb, 0));
    g.fillStyle = gr;
    for (let i = 0; i < 10; i++) { const q = i / 10; g.beginPath(); g.moveTo(x0 + w * (0.26 + 0.16 * q), 0); g.lineTo(x0 + w * (0.6 - 0.16 * q), 0); g.lineTo(x0 + lean + w * (1 - 0.46 * q), h); g.lineTo(x0 + lean + w * 0.46 * q, h); g.closePath(); g.fill(); }
    return c;
  }
  function fogSprite(R, rgb, w, h) {               // a bank of overlapping soft puffs
    const c = makeCanvas(w, h), g = c.getContext('2d');
    for (let i = 0; i < 12; i++) {
      const r = h * R.range(0.2, 0.5), st = R.range(1.6, 3.2), x = R.range(r * st, w - r * st), y = R.range(r, h - r);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, css(rgb, 0.13)); gr.addColorStop(0.5, css(rgb, 0.05)); gr.addColorStop(1, css(rgb, 0));
      g.save(); g.translate(x, y); g.scale(st, 1); g.fillStyle = gr; g.fillRect(-r, -r, 2 * r, 2 * r); g.restore();
    }
    return c;
  }

  // Daylight shafts painted into the picture behind the two nearest walls.
  function paintShafts(B) {
    const { g, W, H, S, T, scale } = B, R = makeRng(T.seed * 53 + 7);
    if (!(B.open.a > 0)) return;
    const left = B.open.x < W / 2, h = H * 0.7, col = mix(B.pal.light, WHITE, 0.35);
    const w = S * R.range(18, 28), lean = (left ? 1 : -1) * S * R.range(9, 15);
    const o = place(shaftSprite(col, w * scale, h * scale, lean * scale), B.open.x + S * R.range(-8, 6) + lean * 0.3, H * 0.05 + h / 2, scale, { a: B.open.a * 0.5, speed: R.range(0.12, 0.25), phase: R() * TAU });
    for (let i = 0; i < 3; i++) { g.globalAlpha = o.a * R.range(0.8, 1.2); g.drawImage(o.img, o.x + S * R.range(-11, 11), o.y, o.w * R.range(0.7, 1.2), o.h * R.range(0.85, 1)); }
    g.globalAlpha = 1;
    B.scene.shafts.push(o);                        // the same beam breathes on top of everything
  }
  // Focus dimming, particles, drips, lava flicker.
  function finishScene(B) {
    const { g, W, H, S, T, scene: sc, pal } = B, R = makeRng(T.seed * 59 + 3);
    if (B.focus) { const f = B.focus; g.fillStyle = css(pal.deep, 0.16); g.fillRect(f.x, f.y, f.w, f.h); }
    const lightCol = mix(pal.light, WHITE, 0.35);
    sc.glintSprite = radialSprite(32, [[0, WHITE, 1], [0.18, WHITE, 0.75], [0.4, mix(pal.light, WHITE, 0.5), 0.2], [1, pal.light, 0]]);
    const P = T.particles, K = P && PARTICLE_KINDS[P.kind];
    if (K) {
      sc.dotKind = K; sc.dotSprite = radialSprite(24, [[0, mix(lightCol, WHITE, 0.5), 1], [0.35, lightCol, 0.5], [1, lightCol, 0]]);
      for (let i = 0, n = Math.round(P.count * (B.wide ? 1.8 : 1)); i < n; i++) {
        sc.dots.push({ x0: R(), y0: R(), vx: S * R.range(K.vx[0], K.vx[1]), vy: S * R.range(K.vy[0], K.vy[1]), r: S * R.range(K.r[0], K.r[1]) * 1.6, a: R.range(K.a[0], K.a[1]),
          wa: S * K.wob * R.range(0.4, 1), wf: R.range(0.2, 0.6), wp: R() * TAU, pf: R.range(0.4, 1.1), pp: R() * TAU });
      }
    }
    if (T.drips) {                                 // drops fall from the tips of the far stalactites
      const tips = B.layers[2].tips.concat(B.layers[3].tips, B.layers[1].tips).filter(t => t.x > W * 0.12 && t.x < W * 0.88);
      for (let i = 0; i < T.drips && tips.length; i++) {
        const t = tips.splice(R.int(tips.length), 1)[0], y1 = B.liquid ? B.liquid.y + S * R.range(1.5, 7) : H * R.range(0.82, 0.9);
        sc.drips.push({ x: t.x, y0: t.y, y1, r: S * 0.32, period: R.range(5, 9), off: R(), ring: B.liquid ? S * 5 : S * 2 });
      }
      sc.dripColor = css(mix(pal.light, WHITE, 0.6), 1);
    }
    if (T.liquid === 'lava') {                     // flicker of the lava glow
      const scale = B.scale, hb = B.layers[2].hb, x0 = Math.max(0, hb[0] - S * 8), x1 = Math.min(W, hb[2] + S * 8), hh = S * 20;
      const c = makeCanvas((x1 - x0) * scale, hh * scale), cg = c.getContext('2d');
      let gr = cg.createLinearGradient(0, 0, 0, c.height);
      gr.addColorStop(0, 'rgba(255,90,20,0)'); gr.addColorStop(0.7, 'rgba(255,110,30,0.5)'); gr.addColorStop(0.85, 'rgba(255,150,60,0.55)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
      cg.fillStyle = gr; cg.fillRect(0, 0, c.width, c.height);
      gr = cg.createLinearGradient(0, 0, c.width, 0);                                // fades out towards the walls
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.3, '#000'); gr.addColorStop(0.7, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      cg.globalCompositeOperation = 'destination-in'; cg.fillStyle = gr; cg.fillRect(0, 0, c.width, c.height);
      sc.flicker = place(c, (x0 + x1) / 2, B.liquid.y - hh * 0.3, scale, {});
    }
  }
  // One drifting fog bank: f = [height (fraction), strength, banks].
  function addFog(B, f, i) {
    const { W, H, S, pal, scale } = B, R = makeRng(B.T.seed * 61 + i * 7 + Math.round(f[0] * 100));
    const w = Math.max(W * 0.85, S * 80) * R.range(0.8, 1.1), h = S * R.range(13, 19);
    B.scene.fogs.push(place(fogSprite(R, mix(pal.haze, mix(pal.light, WHITE, 0.35), 0.42), w * scale, h * scale), 0, H * f[0] + S * R.range(-2, 2), scale, { a: f[1], off: R(), speed: S * R.range(0.5, 1.4) * (i % 2 ? -1 : 1), phase: R() * TAU }));
  }

  // The bake of one theme as a list of small steps, so it can be spread over many frames.
  function createBakeJob(T, W, H, scale, focus, P) {
    const pw = Math.max(1, Math.ceil(W * scale - 1e-4)), ph = Math.max(1, Math.ceil(H * scale - 1e-4));
    const canvas = makeCanvas(pw, ph), g = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    g.setTransform(scale, 0, 0, scale, 0, 0);
    const ls = Math.min(1, Math.sqrt(clamp(W * H * 0.33, LOW_MIN, LOW_MAX) / (W * H)));
    const lw = Math.max(16, Math.round(W * ls)), lh = Math.max(16, Math.round(H * ls));
    const scene = { theme: T, canvas, scale, w: pw / scale, h: ph / scale, glows: [], glints: [], shafts: [], dots: [], fogs: [], drips: [], shimmers: [], flicker: null };
    const B = { g, canvas, scale, W, H, S: Math.min(W, H) / 100, T, R: makeRng(T.seed * 7919 + 17), pal: makePalette(T), scene, focus, P, sx: lw / W, sy: lh / H, wide: W > H * 1.15, layers: [], clusters: [], extra: [], liquid: null };
    const order = T.liquid === 'lava' ? [NL, 3, NL + 1, 2, 1, 0] : [NL, 3, 2, 1, 0], rows = Math.max(8, Math.ceil(BAND_PIXELS / lw));
    const steps = [], add = (w, fn) => { fn.w = w; steps.push(fn); };   // w = rough cost of a step in ms on a desktop
    add(9, () => {
      preparePool(P, lw, lh);
      if (!WARM) { WARM = true; warmUp(P); }
      const S = B.S, R = B.R, pal = B.pal;
      g.fillStyle = css(pal.deep, 1); g.fillRect(0, 0, W, H);
      B.grain = g.createPattern(grainTile(), 'repeat');
      const hz = g.createLinearGradient(0, 0, 0, H);
      const hc = mul(pal.haze, 1.3);
      hz.addColorStop(0, css(mix(hc, pal.deep, 0.35), 1)); hz.addColorStop(0.5, css(hc, 1)); hz.addColorStop(1, css(mix(hc, T.liquid === 'lava' ? [170, 50, 14] : pal.light, 0.16), 1));
      B.hazeGrad = hz;
      if (T.liquid) B.liquid = { kind: T.liquid, y: H * (B.wide ? 0.72 : 0.69), after: 3 };
      B.open = T.opening ? { x: T.opening[0] * W, y: T.opening[1] * H, a: T.opening[2] } : { x: W * (0.5 + (T.bend || 0)), y: H * 0.42, a: 0 };
      for (let k = 0; k < NL; k++) B.layers[k] = buildLayer(B, k);
      B.layers[NL] = makeLayer(NL, LAYERS[NL]); B.layers[NL].full = true;
      if (T.liquid === 'lava') { const y = B.liquid.y, lv = B.layers[NL + 1] = makeLayer(NL + 1, LAYERS[NL + 1]); lv.lava = true; lv.trace = c => { c.beginPath(); c.rect(-9, y, W + 18, H - y + 9); }; }
      B.acc = new Uint8Array(lw * lh);             // pixels hidden deep inside nearer walls: never shaded
    });
    for (let k = 0; k <= NL + 1; k++) add(k < NL || (k > NL && T.liquid === 'lava') ? 5 : 0.5, () => {    // blurred silhouettes: bevel, shadow, cover
      const L = B.layers[k]; if (!L) return;
      L.blurPx = L.lava ? 2 : L.D.blur * B.S * B.sx; L.cov = L.lava ? B.layers[3].cov : B.acc;
      const hb = L.lava ? B.layers[2].hb : k ? B.layers[k - 1].hb : [0, 0, W, H], mg = 3;
      L.bx0 = clamp(Math.floor(hb[0] * B.sx) - mg, 0, lw); L.bx1 = clamp(Math.ceil(hb[2] * B.sx) + mg, 0, lw); L.by0 = clamp(Math.floor(hb[1] * B.sy) - mg, 0, lh); L.by1 = clamp(Math.ceil(hb[3] * B.sy) + mg, 0, lh);
      rasterMask(B, L, L.full || L.lava ? 0 : 3.4 * B.S * B.sx); L.shadow = L.lava ? B.layers[2].Sm : k ? B.layers[k - 1].Sm : null;
      if (k < NL) { const acc = B.acc = B.acc.slice(), m = L.Bm; for (let i = 0, n = acc.length; i < n; i++) if (m[i << 2] > 236) acc[i] = 1; }
    });
    add(1, () => {
      const S = B.S, R = B.R;
      B.clusters = placeClusters(B);
      if (T.fungi) for (let k = 1; k <= 2; k++) for (let i = 0; i < (B.wide ? 5 : 3); i++) {
        const L = B.layers[k], p = L.rim(R() * TAU), d = S * LAYERS[k].scale * R.range(1.5, 5);
        B.extra.push({ k, x: p.x - p.ix * d, y: p.y - p.iy * d, r: S * LAYERS[k].scale * R.range(9, 14), I: 0.9, col: hsl([R.range(140, 176), 80, 62]) });
      }
    });
    for (const k of order) {
      add(7, () => prepLayer(B, k));
      for (let y = 0; y < lh; y += rows) { const a = y, b = Math.min(lh, y + rows); add(2.5, () => litBand(P, B.layers[k], a, b)); }
      add(6.5, () => composeRock(B, k));
      add(8, () => composeDetail(B, k));
      if (k === 3 && T.liquid === 'lake') add(9, () => lakeReflect(B));
      if (k === 2 && T.opening) add(4, () => paintShafts(B));
    }
    (T.fog || []).forEach(f => { for (let i = 0; i < f[2]; i++) add(1, () => addFog(B, f, i)); });
    add(7, () => {
      finishScene(B); B.layers = B.clusters = B.acc = null;
      const out = makeCanvas(pw, ph); out.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0); scene.canvas = out;   // see NOTES: plain canvas for the per-frame blit
    });
    let i = 0;
    // step(): one step. step(true): about 9 ms worth of steps, then their drawing is rasterised right away
    // (1 px read-back), so the work really is spread over the frames instead of piling up in the canvas.
    return { scene, step(spread) {
      let w = 0;
      while (i < steps.length && (w === 0 || (spread && w + steps[i].w <= 9))) { w += steps[i].w || 0.01; steps[i++](); }
      if (spread && w > 0) g.getImageData(0, 0, 1, 1);
      return i >= steps.length;
    } };
  }

  // ------------------------------------------------------------------ per-frame overlays (cheap sprite blits only)
  function drawOverlays(ctx, sc, t, wgt, W, H) {
    let i, o, a, p, q, x, y;
    const px = sc.scale;
    for (i = 0; i < sc.shafts.length; i++) {            // one daylight shaft breathing over the painted ones
      o = sc.shafts[i];
      ctx.globalAlpha = wgt * o.a * (0.5 + 0.5 * Math.sin(t * o.speed * 1.7 + o.phase));
      ctx.drawImage(o.img, o.x, o.y, o.w, o.h);
    }
    if (sc.flicker) {                                   // lava glow: three slow sines out of step
      o = sc.flicker;
      ctx.globalAlpha = wgt * (0.34 + 0.14 * Math.sin(t * 1.9) + 0.1 * Math.sin(t * 3.1 + 1.3) + 0.07 * Math.sin(t * 5.3 + 4));
      ctx.drawImage(o.img, o.x, o.y, o.w, o.h);
    }
    for (i = 0; i < sc.glows.length; i++) {             // crystal glows breathing out of phase
      o = sc.glows[i];
      ctx.globalAlpha = wgt * o.a * (0.5 + 0.5 * Math.sin(t * o.speed + o.phase));
      ctx.drawImage(o.img, o.x, o.y, o.w, o.h);
    }
    for (i = 0; i < sc.fogs.length; i++) {              // fog banks drifting sideways
      o = sc.fogs[i];
      ctx.globalAlpha = wgt * o.a * (0.72 + 0.28 * Math.sin(t * 0.19 + o.phase));
      ctx.drawImage(o.img, Math.round((mod(o.off * (W + o.w) + o.speed * t, W + o.w) - o.w) * px) / px, o.y, o.w, o.h);
    }
    ctx.globalCompositeOperation = 'lighter';
    if (sc.dots.length) {                               // dust, ice dust, embers, spores
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
    for (i = 0; i < sc.glints.length; i++) {            // glints on crystal faces: a soft flash, then a long pause
      o = sc.glints[i]; p = mod(t / o.period + o.off, 1);
      if (p > 0.3) continue;
      a = Math.sin(p / 0.3 * Math.PI); a *= a; q = o.r * (0.6 + 0.4 * a);
      ctx.globalAlpha = wgt * a * 0.85; ctx.drawImage(sc.glintSprite, o.x - q, o.y - q, q * 2, q * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (sc.shimmers.length) {                           // highlights gliding over the water
      ctx.fillStyle = sc.shimmerColor;
      for (i = 0; i < sc.shimmers.length; i++) {
        o = sc.shimmers[i]; a = 0.5 + 0.5 * Math.sin(t * o.speed + o.phase);
        ctx.globalAlpha = wgt * 0.22 * a * a; ctx.fillRect(o.x + Math.sin(t * o.speed * 0.5 + o.phase) * o.w * 0.4, o.y, o.w, o.h);
      }
    }
    if (sc.drips.length) {                              // a drop swells, falls, and leaves rings
      ctx.fillStyle = ctx.strokeStyle = sc.dripColor; ctx.lineWidth = 1;
      for (i = 0; i < sc.drips.length; i++) {
        o = sc.drips[i]; p = mod(t / o.period + o.off, 1);
        if (p < 0.5) { q = o.r * (0.3 + 0.7 * p / 0.5); ctx.globalAlpha = wgt * 0.7; ctx.beginPath(); ctx.arc(o.x, o.y0 + q * 0.6, q, 0, TAU); ctx.fill(); }
        else if (p < 0.62) { q = (p - 0.5) / 0.12; ctx.globalAlpha = wgt * 0.7; ctx.beginPath(); ctx.ellipse(o.x, o.y0 + (o.y1 - o.y0) * q * q, o.r * 0.7, o.r * 1.6, 0, 0, TAU); ctx.fill(); }
        else {
          q = (p - 0.62) / 0.38; ctx.globalAlpha = wgt * 0.45 * (1 - q) * (1 - q);
          ctx.beginPath(); ctx.ellipse(o.x, o.y1, o.ring * (0.1 + q), o.ring * (0.1 + q) * 0.26, 0, 0, TAU); ctx.stroke();
          if (q > 0.25) { ctx.beginPath(); ctx.ellipse(o.x, o.y1, o.ring * (q - 0.2), o.ring * (q - 0.2) * 0.26, 0, 0, TAU); ctx.stroke(); }
        }
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
    const pool = {};                                             // low-resolution work buffers

    function newJob(idx) {
      const j = createBakeJob(THEMES[idx], W, H, Math.min(ratio, Math.sqrt(MAX_BAKE_PIXELS / (W * H))), focus, pool);
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
      else if (!job || job.scene.idx !== themeIdx) {
        prev = null; fade = 1;                                   // never more than two themes in memory
        try { job = newJob(themeIdx); } catch (e) { job = null; }
      }
    }

    return {
      // CSS px size of the target canvas and its pixel ratio; the scene is re-baked lazily on the next frame.
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
            for (let i = 0; i < STEPS_PER_UPDATE; i++) if (job.step(true)) { prev = cur; cur = job.scene; fade = 0; job = null; break; }
          } catch (e) { job = null; themeIdx = cur ? cur.idx : themeIdx; }
        } else if (prev) { fade += dt / FADE_MS; if (fade >= 1) { fade = 1; prev = null; } }
      },
      // ctx is pre-scaled to CSS px. Paints the whole width x height opaquely.
      draw(ctx) {
        try { ensure(); } catch (e) { cur = null; }
        if (!cur) { ctx.fillStyle = '#06080d'; ctx.fillRect(0, 0, W, H); return; }
        if (prev) {
          const a = fade * fade * (3 - 2 * fade);
          ctx.drawImage(prev.canvas, 0, 0, prev.w, prev.h); drawOverlays(ctx, prev, time, 1 - a, W, H);
          ctx.globalAlpha = a; ctx.drawImage(cur.canvas, 0, 0, cur.w, cur.h); ctx.globalAlpha = 1;
          drawOverlays(ctx, cur, time, a, W, H);
        } else { ctx.drawImage(cur.canvas, 0, 0, cur.w, cur.h); drawOverlays(ctx, cur, time, 1, W, H); }
      },
      get level() { return level; },
    };
  }

  KF.Cave = { THEMES, create };
})(globalThis.KF = globalThis.KF || {});
