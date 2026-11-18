// Crystal Drop – realistic skin: raw mineral stones for buttons and dialogs, the carved-stone playfield frame
// and the metal title lettering. Loaded before game.js; game.js picks these overrides up through KF.Skin.
(function (KF) {
  'use strict';

  const FONT = "'Cinzel', 'Trajan Pro', 'Times New Roman', Georgia, serif";

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Tileable grey value noise (several octaves). Used as grain for stone, metal and gem surfaces.
  function noiseCanvas(size, cells, octaves, seed, contrast) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const img = g.createImageData(size, size), d = img.data;
    const rnd = mulberry32(seed), grids = [];
    for (let o = 0, n = cells; o < octaves; o++, n *= 2) {
      const a = new Float32Array(n * n);
      for (let i = 0; i < a.length; i++) a[i] = rnd();
      grids.push({ n, a });
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0, amp = 1, sum = 0;
        for (const gr of grids) {
          const fx = x / size * gr.n, fy = y / size * gr.n;
          const ix = Math.floor(fx), iy = Math.floor(fy);
          let tx = fx - ix, ty = fy - iy;
          tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
          const x1 = (ix + 1) % gr.n, y1 = (iy + 1) % gr.n;
          const a = gr.a[iy * gr.n + ix], b = gr.a[iy * gr.n + x1], c = gr.a[y1 * gr.n + ix], e = gr.a[y1 * gr.n + x1];
          v += (a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty) * amp;
          sum += amp; amp *= 0.55;
        }
        v = 0.5 + (v / sum - 0.5) * contrast;
        const k = Math.max(0, Math.min(255, Math.round(v * 255))), i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = k; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  // Tileable fractal noise as a float field (0..1), for building rock surfaces.
  function fbmField(size, cells, octaves, seed) {
    const out = new Float32Array(size * size), rnd = mulberry32(seed);
    const i0 = new Int32Array(size), i1 = new Int32Array(size), tw = new Float32Array(size);
    let amp = 1;
    for (let o = 0, n = cells; o < octaves; o++, n *= 2, amp *= 0.5) {
      const a = new Float32Array(n * n);
      for (let i = 0; i < a.length; i++) a[i] = rnd();
      for (let x = 0; x < size; x++) {
        const f = x / size * n, ix = Math.floor(f), t = f - ix;
        i0[x] = ix; i1[x] = (ix + 1) % n; tw[x] = t * t * (3 - 2 * t);
      }
      for (let y = 0; y < size; y++) {
        const r0 = i0[y] * n, r1 = i1[y] * n, ty = tw[y], base = y * size;
        for (let x = 0; x < size; x++) {
          const c0 = i0[x], c1 = i1[x], t = tw[x];
          const top = a[r0 + c0] + (a[r0 + c1] - a[r0 + c0]) * t, bot = a[r1 + c0] + (a[r1 + c1] - a[r1 + c0]) * t;
          out[base + x] += (top + (bot - top) * ty) * amp;
        }
      }
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < out.length; i++) { const v = out[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = Math.max(1e-6, hi - lo);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / span;
    return out;
  }

  let stone = null, fine = null;
  try {
    stone = noiseCanvas(160, 6, 5, 4107, 1.9);     // mottled rock (frame)
    fine = noiseCanvas(96, 12, 3, 991, 1.5);       // fine grain for metal
    const rootStyle = document.documentElement.style;
    const url = (cv) => 'url(' + cv.toDataURL('image/png') + ')';
    rootStyle.setProperty('--tex-stone', url(stone));
    rootStyle.setProperty('--tex-fine', url(fine));
  } catch (e) { stone = fine = null; }

  // ------------------------------------------------------------------ raw mineral stones (buttons, dialogs)
  // Every button is its own broken chunk of chrysocolla-like rock, drawn once per size onto a canvas and
  // handed to the stylesheet as a data URL (--st-face; the stylesheet shows it twice: as the top of the stone
  // and, darkened and shifted down, as its side).
  // All per-pixel work happens here, when a stone is first needed or its size changes - never per frame.

  const TS = 256, TM = TS - 1;
  let FLD = null;
  // Shared tileable fields: two fractal noises, a crackle (cell borders + cell values) and white grain.
  function stoneFields() {
    if (FLD) return FLD;
    const NA = fbmField(TS, 4, 5, 9001), NB = fbmField(TS, 3, 4, 9002);
    const CE = new Float32Array(TS * TS), CI = new Uint8Array(TS * TS), GR = new Uint8Array(TS * TS);
    const G = 16, cs = TS / G, rnd = mulberry32(7717);
    const px = new Float32Array(G * G), py = new Float32Array(G * G), pv = new Uint8Array(G * G);
    for (let i = 0; i < G * G; i++) {
      px[i] = (i % G + 0.08 + 0.84 * rnd()) * cs; py[i] = ((i / G | 0) + 0.08 + 0.84 * rnd()) * cs; pv[i] = rnd() * 256;
    }
    const qx = new Float32Array(9), qy = new Float32Array(9), qv = new Uint8Array(9);
    for (let cj = 0; cj < G; cj++) {
      for (let ci = 0; ci < G; ci++) {
        for (let dj = -1, q = 0; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++, q++) {
            const gi = ci + di, gj = cj + dj, wi = (gi + G) % G, wj = (gj + G) % G, k = wj * G + wi;
            qx[q] = px[k] + (gi - wi) * cs; qy[q] = py[k] + (gj - wj) * cs; qv[q] = pv[k];
          }
        }
        for (let y = cj * cs; y < (cj + 1) * cs; y++) {
          for (let x = ci * cs; x < (ci + 1) * cs; x++) {
            let d1 = 1e9, d2 = 1e9, n1 = 0, n2 = 0;
            for (let q = 0; q < 9; q++) {
              const dx = qx[q] - x, dy = qy[q] - y, dd = dx * dx + dy * dy;
              if (dd < d1) { d2 = d1; n2 = n1; d1 = dd; n1 = q; } else if (dd < d2) { d2 = dd; n2 = q; }
            }
            const ex = qx[n2] - qx[n1], ey = qy[n2] - qy[n1], i = y * TS + x;
            CE[i] = (d2 - d1) / (2 * Math.sqrt(ex * ex + ey * ey) + 1e-6);     // distance to the cell border
            CI[i] = qv[n1];
          }
        }
      }
    }
    for (let i = 0; i < GR.length; i++) GR[i] = rnd() * 256;
    return (FLD = { NA, NB, CE, CI, GR });
  }

  // Mineral families after the reference stones. c: dark, main, second, accent, pale rock, vein (RGB each);
  // t: thresholds dark|main|second, accent above, pale rock below; va: how pale the veins get;
  // bx: how strongly the accent gathers at one end of the stone.
  const pal = (c, t, va, bx) => ({ c: new Float32Array(c), t, va, bx });
  const PAL = {
    turq: pal([17, 70, 130, 24, 150, 182, 84, 206, 214, 16, 30, 58, 184, 176, 146, 186, 238, 232], [0.28, 0.72, 0.79, 0.07], 0.85, 0),
    deep: pal([14, 26, 54, 20, 82, 142, 32, 150, 182, 96, 50, 68, 188, 172, 148, 156, 204, 216], [0.38, 0.8, 0.66, 0.18], 0.8, 0),
    dark: pal([10, 18, 32, 18, 64, 84, 28, 132, 150, 58, 42, 66, 152, 152, 138, 150, 198, 192], [0.42, 0.8, 0.72, 0.15], 0.7, 0),
    mauve: pal([88, 52, 86, 172, 122, 148, 200, 152, 170, 52, 160, 150, 214, 194, 180, 240, 224, 228], [0.3, 0.74, 0.68, 0.2], 0.7, 0.34),
    beige: pal([106, 94, 100, 180, 162, 132, 204, 190, 160, 58, 150, 142, 142, 134, 130, 234, 226, 206], [0.3, 0.76, 0.66, 0.2], 0.6, 0.3),
    slab: pal([12, 32, 46, 17, 56, 74, 23, 92, 108, 52, 36, 56, 92, 98, 92, 120, 172, 170], [0.42, 0.8, 9, -9], 0.6, 0),
  };

  // The broken outline of a stone as a set of cuts (half-planes) through its box, each cut with its own
  // steepness: corners knocked off, edges slightly slanted. Plus shell-shaped chips bitten out of the rim.
  function stoneShape(w, h, rnd, panel, m, T) {
    const wide = w > h * 1.7;
    const a = [], b = [], c = [];
    const sl = () => (panel ? 0.62 + 0.64 * rnd() : 0.5 + 0.95 * rnd());
    const cut = (x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1, l = Math.sqrt(dx * dx + dy * dy) || 1, s = sl(), nx = -dy / l, ny = dx / l;
      a.push(nx * s); b.push(ny * s); c.push(-(nx * x1 + ny * y1) * s);
    };
    const corner = (k, cx, cy) => {
      if (k === 0) cut(0, cy, cx, 0); else if (k === 1) cut(w - cx, 0, w, cy);
      else if (k === 2) cut(w, h - cy, w - cx, h); else cut(cx, h, 0, h - cy);
    };
    const slant = (edge, t, dir, e) => {
      if (edge === 0) { if (dir > 0) cut(w * t, 0, w, e); else cut(0, e, w * t, 0); }
      else if (edge === 2) { if (dir > 0) cut(w * t, h, 0, h - e); else cut(w, h - e, w * t, h); }
      else if (edge === 1) { if (dir > 0) cut(w, h * t, w - e, h); else cut(w - e, 0, w, h * t); }
      else if (dir > 0) cut(0, h * t, e, 0); else cut(e, h, 0, h * t);
    };
    cut(0, 0, w, 0); cut(w, 0, w, h); cut(w, h, 0, h); cut(0, h, 0, 0);
    for (let k = 0; k < 4; k++) {
      let cx, cy;
      if (panel) { cx = 8 + 15 * rnd(); cy = 8 + 15 * rnd(); }
      else if (rnd() < (wide ? 0.6 : 0.4)) { cx = m * (0.24 + (wide ? 0.3 : 0.12) * rnd()); cy = m * (0.2 + (wide ? 0.26 : 0.14) * rnd()); }
      else { cx = m * (0.09 + 0.1 * rnd()); cy = m * (0.09 + 0.1 * rnd()); }
      corner(k, cx, cy);
      if (!panel && rnd() < 0.55) {                       // a second break makes the corner many-sided
        const f = wide ? 1.7 + rnd() : 1.4 + 0.5 * rnd(), g = 0.3 + 0.25 * rnd();
        if (rnd() < 0.5) corner(k, cx * f, cy * g); else corner(k, cx * g, cy * f);
      }
    }
    for (let edge = 0; edge < 4; edge++) {
      const len = edge % 2 ? h : w;
      if (panel) {
        const n = Math.max(1, Math.round(len / 130));
        for (let i = 0; i < n; i++) slant(edge, (i + 0.3 + 0.4 * rnd()) / n, i % 2 ? 1 : -1, 1.5 + 3 * rnd());
      } else if (edge % 2 === 0) {
        if (wide) { slant(edge, 0.22 + 0.25 * rnd(), -1, m * (0.04 + 0.09 * rnd())); slant(edge, 0.53 + 0.25 * rnd(), 1, m * (0.04 + 0.09 * rnd())); }
        else slant(edge, 0.3 + 0.4 * rnd(), rnd() < 0.5 ? 1 : -1, m * (0.04 + 0.08 * rnd()));
      } else if (rnd() < 0.6) slant(edge, 0.3 + 0.4 * rnd(), rnd() < 0.5 ? 1 : -1, m * (0.04 + 0.08 * rnd()));
    }
    const chips = [];
    const n = panel ? Math.round((w + h) / 70) : (wide ? 3 : 2) + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const side = !panel && wide && rnd() < 0.7 ? (rnd() < 0.5 ? 0 : 2) : rnd() * 4 | 0;
      const r = panel ? 7 + 9 * rnd() : m * (0.16 + 0.2 * rnd()), out = r * ((panel ? 0.4 : 0.25) + 0.45 * rnd());
      let cx, cy;
      if (side === 0) { cx = w * rnd(); cy = -out; } else if (side === 2) { cx = w * rnd(); cy = h + out; }
      else if (side === 1) { cx = w + out; cy = h * rnd(); } else { cx = -out; cy = h * rnd(); }
      chips.push(cx, cy, 1 / (r * r), T * (0.7 + 0.9 * rnd()), r);
    }
    return { a: new Float64Array(a), b: new Float64Array(b), c: new Float64Array(c), chips: new Float64Array(chips) };
  }

  const NO_CUTS = new Float64Array(0);
  const LX = 0.46, LY = 0.62, LZ = 0.64;                   // light from the top-left, like the frame

  // Draws one stone for a box of w x h CSS px at `s` device px per CSS px.
  //   o.pal: mineral family, o.seed, o.win: the part to draw [x0, y0, x1, y1] (default: the box plus 3px)
  //   o.panel: a dialog slab - its rim fades out towards the middle (which is a CSS tile); o.d: its thickness,
  //            shown as a dark side along the bottom, inside the box
  //   o.tile: the flat, calm surface of the slab as a repeatable tile
  // Returns the canvas.
  function renderStone(w, h, s, o) {
    const FL = stoneFields(), NA = FL.NA, NB = FL.NB, CE = FL.CE, CI = FL.CI, GR = FL.GR;
    const P = PAL[o.pal] || PAL.deep, col = P.c;
    const rnd = mulberry32(Math.imul(o.seed | 0, 40503) + 977);
    const panel = !!o.panel, tile = !!o.tile, flat = panel || tile, d = o.d || 0;
    const win = o.win || [-3, -3, w + 3, h + 3], x0 = win[0], y0 = win[1];
    const W = Math.max(3, Math.round((win[2] - x0) * s)), H = Math.max(3, Math.round((win[3] - y0) * s));
    const fh = panel ? h - d : h;
    const m = flat ? 52 : Math.min(w, h);
    const T = flat ? 4.2 : Math.max(3.4, Math.min(7, m * 0.1));
    const shp = tile ? null : stoneShape(w, fh, rnd, panel, m, T);
    const pa = shp ? shp.a : NO_CUTS, pb = shp ? shp.b : NO_CUTS, pc = shp ? shp.c : NO_CUTS, np = pa.length;
    const chips = shp ? shp.chips : NO_CUTS, nc = chips.length, rowB = new Float64Array(np + 1), act = new Int32Array(nc / 5 + 1);

    // the top: a lattice of tilted triangular fracture faces (flat for slabs)
    const th = 0.3 + rnd(), sp = m * (0.62 + 0.3 * rnd());
    const ua = Math.cos(th) / sp, ub = Math.sin(th) / sp, va = -Math.sin(th) / (sp * 0.72), vb = Math.cos(th) / (sp * 0.72);
    const NH = new Float32Array(1024), ND = new Uint8Array(1024);
    if (!flat) for (let i = 0; i < 1024; i++) { NH[i] = T * (0.45 + 2.1 * rnd()); ND[i] = rnd() < 0.5 ? 1 : 0; }

    // mineral pattern: where the fields are read (slabs read them 1:1 so that rim and tile match exactly)
    const ck = flat ? 2 : Math.max(1.3, Math.min(2, 2.1 - m / 110)), ka = flat ? 2 : 1.6;
    const rot = flat ? 0 : (rnd() - 0.5) * 1.6, rc = Math.cos(rot) * ck, rs = Math.sin(rot) * ck;
    const o1 = 2048 + (flat ? 0 : rnd() * 256 | 0), o2 = 2048 + (flat ? 0 : rnd() * 256 | 0);
    const kb = flat ? 1 : 0.37, o3 = flat ? 131 : rnd() * 256, o4 = flat ? 67 : rnd() * 256;
    const kn = flat ? 2 : 1.1, o5 = 1024 + (flat ? 40 : rnd() * 256 | 0), o6 = 1024 + (flat ? 90 : rnd() * 256 | 0);
    const o7 = 1024 + (flat ? 170 : rnd() * 256 | 0), o8 = 1024 + (flat ? 20 : rnd() * 256 | 0);
    const t0 = P.t[0], t1 = P.t[1], ta = P.t[2], tb = P.t[3], pva = P.va;
    const bx = P.bx * 2 / w * (rnd() < 0.5 ? -1 : 1), hw = w * 0.5;
    const mr = col[3] * 0.8, mg = col[4] * 0.8, mb = col[5] * 0.8;
    let cr = 0, cg = 0, cb = 0;
    // z: 0..1 inside the lettering zone (calmer, darker), v: 0..1 vividness (rim of a slab)
    const alb = (x, y, z, v) => {
      const ax = x * ka + o1, ay = y * ka + o2;
      const n1 = NA[((ay & TM) << 8) | (ax & TM)], n2 = NA[(((ay + 77) & TM) << 8) | ((ax + 131) & TM)];
      const wq = (n2 - 0.5) * 36;                                            // warps the big patches into ragged shapes
      const b1 = NB[(((y * kn + o6 + wq) & TM) << 8) | ((x * kn + o5 - wq) & TM)];
      const b2 = NB[(((x * kn + o8 - wq) & TM) << 8) | ((y * kn + o7 + wq) & TM)];
      const tu = x * rc - y * rs + o1, tv = x * rs + y * rc + o2;
      const ia = ((tv & TM) << 8) | (tu & TM), id = CI[ia] * 0.003921569;
      const q = b1 + (n1 - 0.5) * 0.55 + (id - 0.5) * 0.14, q2 = b2 + (n2 - 0.5) * 0.45 + (0.5 - id) * 0.1 + (x - hw) * bx;
      // dark rock -> main mineral -> its lighter form, with ragged but soft borders
      let f = (q - t0) * 14 + 0.5; f = f < 0 ? 0 : f > 1 ? 1 : f;
      let r = col[0] + (col[3] - col[0]) * f, g = col[1] + (col[4] - col[1]) * f, b = col[2] + (col[5] - col[2]) * f;
      f = (q - t1) * 5 + 0.5;
      if (f > 0) { if (f > 1) f = 1; r += (col[6] - r) * f; g += (col[7] - g) * f; b += (col[8] - b) * f; }
      f = (q2 - ta) * 16 + 0.5;                                              // accent mineral
      if (f > 0) { if (f > 1) f = 1; r += (col[9] - r) * f; g += (col[10] - g) * f; b += (col[11] - b) * f; }
      f = (tb - q2) * 16 + 0.5;                                              // pale host rock
      if (f > 0) { if (f > 1) f = 1; r += (col[12] - r) * f; g += (col[13] - g) * f; b += (col[14] - b) * f; }
      const n3 = NA[(((ay * 3 + 11) & TM) << 8) | ((ax * 3 + 53) & TM)];              // fine mottling and pits
      let tone = (0.62 + 0.36 * n1 + 0.3 * n3 + 0.12 * id) * (1 + 0.4 * v), vn = 0;
      if (n3 < 0.3) tone *= 0.88;
      const e = CE[ia];
      if (e < 0.9 && n2 > 0.56) tone *= 0.7 + 0.33 * e;                      // hairline cracks, here and there
      const ev = CE[(((tv * kb + o4) & TM) << 8) | ((tu * kb + o3) & TM)] / kb;
      if (ev < 1.3 && n1 > 0.47) { f = (n1 - 0.47) * 7; vn = (1 - ev / 1.3) * pva * (f > 1 ? 1 : f); }   // pale veins along the big fractures
      if (z > 0) { f = 0.42 * z; r += (mr - r) * f; g += (mg - g) * f; b += (mb - b) * f; vn *= 1 - 0.6 * z; tone *= 1 - 0.22 * z; }
      if (flat) vn *= 0.4 + 0.6 * v;
      cr = r * tone; cg = g * tone; cb = b * tone;
      if (vn > 0) { cr += (col[15] - cr) * vn; cg += (col[16] - cg) * vn; cb += (col[17] - cb) * vn; }
    };

    const n = W * H, hf = new Float32Array(n), al = new Float32Array(n), ft = new Uint8Array(n);
    const RA = 2.6, RB = 1.3, tLow = T * 0.45;
    // cuts that cannot reach below the top anywhere in a 16px block are skipped there
    const BS = 16, nbx = Math.ceil(W / BS), cap = flat ? T + 0.4 : T * 2.6, actP = new Uint8Array(nbx * (np + 1));
    for (let j = 0; j < H; j++) {
      const y = (j + 0.5) / s + y0;
      if (j % BS === 0) {
        const ya = j / s + y0, yb = Math.min(H, j + BS) / s + y0;
        for (let bi = 0; bi < nbx; bi++) {
          const xa = bi * BS / s + x0, xb = Math.min(W, bi * BS + BS) / s + x0, base = bi * (np + 1);
          let cnt = 0;
          for (let k = 0; k < np; k++) {
            const pax = pa[k] < 0 ? pa[k] * xb : pa[k] * xa, pby = pb[k] < 0 ? pb[k] * yb : pb[k] * ya;
            if (pax + pby + pc[k] < cap) actP[base + 1 + cnt++] = k;
          }
          actP[base] = cnt;
        }
      }
      for (let k = 0; k < np; k++) rowB[k] = pb[k] * y + pc[k];
      let na = 0;
      for (let k = 0; k < nc; k += 5) { const dy = y - chips[k + 1]; if (dy < chips[k + 4] && -dy < chips[k + 4]) act[na++] = k; }
      for (let i = 0; i < W; i++) {
        const x = (i + 0.5) / s + x0, base = (i >> 4) * (np + 1), cnt = actP[base];
        let hh = 1e9;
        for (let c = 1; c <= cnt; c++) { const k = actP[base + c], v = pa[k] * x + rowB[k]; if (v < hh) hh = v; }
        if (hh < -6) { hf[j * W + i] = hh; continue; }
        if (flat) { if (hh > T) { hh = T; ft[j * W + i] = 1; } }
        else if (hh > tLow) {
          const u = x * ua + y * ub + 16.37, v = x * va + y * vb + 16.71;
          const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
          const r0 = (iv & 31) << 5, r1 = ((iv + 1) & 31) << 5, c0 = iu & 31, c1 = (iu + 1) & 31;
          const h00 = NH[r0 | c0], h10 = NH[r0 | c1], h01 = NH[r1 | c0], h11 = NH[r1 | c1];
          let tt;
          if (ND[r0 | c0]) tt = fu > fv ? h00 + (h10 - h00) * fu + (h11 - h10) * fv : h00 + (h11 - h01) * fu + (h01 - h00) * fv;
          else tt = fu + fv < 1 ? h00 + (h10 - h00) * fu + (h01 - h00) * fv : h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv);
          if (tt < hh) { hh = tt; ft[j * W + i] = 1 + ((iu * 7 + iv * 13 + (fu > fv ? 3 : 0) + (fu + fv < 1 ? 5 : 0)) & 7); }
        }
        for (let c = 0; c < na; c++) {
          const k = act[c], dx = x - chips[k], dy = y - chips[k + 1], q = (dx * dx + dy * dy) * chips[k + 2];
          if (q < 1) hh -= chips[k + 3] * (1 - q);
        }
        const tx = x * 2 + 2048, ty = y * 2 + 2048;
        hh += RA * (NA[((ty & TM) << 8) | (tx & TM)] - 0.5) + RB * (NA[(((ty * 2 + 41) & TM) << 8) | ((tx * 2 + 97) & TM)] - 0.5);
        hf[j * W + i] = hh;
      }
    }

    const face = document.createElement('canvas');
    face.width = W; face.height = H;
    const fg = face.getContext('2d'), img = fg.createImageData(W, H), D = img.data, D32 = new Uint32Array(D.buffer);
    const zx = 1 / (w * 0.37), zy = 1 / (h * 0.36), hh2 = h * 0.5;
    for (let j = 1; j < H - 1; j++) {
      const y = (j + 0.5) / s + y0;
      for (let i = 1; i < W - 1; i++) {
        const x = (i + 0.5) / s + x0, k = j * W + i, hh = hf[k];
        if (hh < -4) continue;
        const hl = hf[k - 1], hr = hf[k + 1], hu = hf[k - W], hd = hf[k + W];
        const gx = (hr - hl) * s * 0.5, gy = (hd - hu) * s * 0.5, g2 = gx * gx + gy * gy;
        let a = 1;
        if (hh < 3 && !tile) {                                                        // the outline, anti-aliased
          a = 0.5 + hh * s / Math.sqrt(g2 > 0.09 ? g2 : 0.09);
          if (a <= 0) continue;
          if (a > 1) a = 1;
        }
        al[k] = a;
        const lam = (gx * LX + gy * LY + LZ) / Math.sqrt(g2 + 1);
        let lum = 0.27 + 1.0 * (lam > 0 ? lam : 0);
        let cv = (hl + hr + hu + hd - 4 * hh) * s * 0.55;                              // ridges catch light, cavities stay dark
        cv = cv < -0.3 ? -0.3 : cv > 0.3 ? 0.3 : cv;
        lum *= 1 - cv;
        const sheen = lam > 0.8 ? (lam - 0.8) * 110 : 0;
        if (!tile && hh < 1.2) lum *= 0.72 + 0.2333 * (hh > 0 ? hh : 0);            // the very edge falls into shade
        let z = 0, v = 0, fade = 1;
        if (panel) {
          let bd = x < y ? x : y; if (w - x < bd) bd = w - x; if (fh - y < bd) bd = fh - y;
          v = bd < 0 ? 1 : bd < 13 ? 1 - bd / 13 : 0;
          if (ft[k] && bd > 11.5) {                       // the flat top fades into the tile; rim faces stay solid
            if (bd >= 15) continue;
            fade = (15 - bd) / 3.5; fade = fade * fade * (3 - 2 * fade);
          }
        } else if (!tile) {
          const ex = (x - hw) * zx, ey = (y - hh2) * zy, e2 = ex * ex + ey * ey;
          if (e2 < 1.5) { z = e2 < 0.3 ? 1 : (1.5 - e2) / 1.2; z = z * z * (3 - 2 * z); }
          if (ft[k]) lum *= 0.9 + 0.03 * ft[k];        // every fracture face a shade of its own
        }
        alb(x, y, z, v);
        const gq = GR[(((y * 2 + 517) & TM) << 8) | ((x * 2 + 771) & TM)];
        lum *= 0.88 + 0.24 * gq * 0.003921569;
        if (gq < 12) lum *= 0.74;                                                    // dark specks
        const spk = gq > 253 && lam > 0.5 ? 46 + (gq - 253) * 26 : 0;                // a few glints
        const add = spk + sheen, r = cr * lum + add, g = cg * lum + add, b = cb * lum + add;
        D32[k] = ((a * fade * 255) << 24) | (((b > 255 ? 255 : b) & 252) << 16) | (((g > 255 ? 255 : g) & 252) << 8) | ((r > 255 ? 255 : r) & 252);   // 6-bit colour: the grain hides it, the picture gets smaller
      }
    }

    // slabs: the side shows below the top, swept down by the thickness
    if (panel && d > 0 && win[3] > fh) {
      const dp = Math.max(1, Math.round(d * s));
      for (let j = Math.max(2, Math.floor((fh - 9 - y0) * s)); j < H - 1; j++) {
        const y = (j + 0.5) / s + y0;
        for (let i = 1; i < W - 1; i++) {
          const k = j * W + i, a = al[k];
          if (a >= 1) continue;
          let mx = 0, q = 1;
          for (; q <= dp && q <= j; q++) { const v = al[k - q * W]; if (v > mx) { mx = v; if (v >= 1) break; } }
          if (mx <= 0) continue;
          const x = (i + 0.5) / s + x0;
          alb(x, y, 0, 1);
          const lum = 0.34 * (1 - 0.4 * q / dp) * (0.7 + 0.6 * NA[(((y * 0.7 + 300) & TM) << 8) | ((x * 5 + 300) & TM)]);
          const p = k * 4, fa = D[p + 3] / 255, oa = fa + mx * (1 - fa), f = oa > 0 ? fa / oa : 0;
          D[p] = D[p] * f + cr * lum * (1 - f); D[p + 1] = D[p + 1] * f + cg * lum * (1 - f); D[p + 2] = D[p + 2] * f + cb * lum * (1 - f); D[p + 3] = oa * 255;
        }
      }
    }
    fg.putImageData(img, 0, 0);
    return face;
  }

  // ---- which element gets which stone
  const STONE_OF = {
    'kf-btn-menu': ['beige', 11], 'kf-btn-main': ['turq', 23], 'kf-btn-soft': ['deep', 37], 'kf-btn-drop': ['turq', 43],
    'kf-btn-rot': ['deep', 53], 'kf-start': ['turq', 67], 'kf-title-menu': ['dark', 71], 'kf-resume': ['turq', 89],
    'kf-again': ['turq', 89], 'kf-menu-resume': ['turq', 101], 'kf-menu-new': ['deep', 113], 'kf-menu-help': ['deep', 127],
    'kf-menu-close': ['mauve', 131], 'kf-help-back': ['mauve', 131],
  };
  const dataUrl = (cv) => 'url(' + cv.toDataURL('image/png') + ')';
  let stoneScale = 0, slabScale = 0, stoneEls = null, stoneTimer = 0, warmTimer = 0, stoneCuts = {}, stoneView = '';

  function stoneSize(el) {
    let w = 0, h = 0, veiled = false;
    try { const cs = getComputedStyle(el); w = parseFloat(cs.width); h = parseFloat(cs.height); veiled = cs.visibility === 'hidden'; } catch (e) { /* measured below */ }
    if (!(w > 0) || !(h > 0)) { w = el.offsetWidth; h = el.offsetHeight; }
    if (!(w >= 12) || !(h >= 12)) return null;
    return { w, h, veiled, key: w.toFixed(1) + 'x' + h.toFixed(1) + '@' + stoneScale };
  }

  // The background value for an element of this size (cut once per kind and size, then shared).
  // only: 0..3 cuts just that strip of a dialog rim ahead of time (and returns nothing).
  function cutStone(el, sz, only) {
    const isPanel = el.classList.contains('kf-panel'), c = el.classList;
    const w = sz.w, h = sz.h, s = isPanel ? Math.min(stoneScale, 1.5) : stoneScale, px = (v) => (Math.round(v * 100) / 100) + 'px';
    const sp = isPanel ? ['slab', 200 + stoneEls.indexOf(el)]
      : STONE_OF[el.id] || [c.contains('kf-btn--gold') ? 'turq' : c.contains('kf-btn--rose') ? 'mauve' : c.contains('kf-btn--ghost') ? 'dark' : 'deep', 300 + stoneEls.indexOf(el)];
    const id = sp[0] + sp[1] + ':' + sz.key;
    if (stoneCuts[id]) return stoneCuts[id];
    let css;
    if (!isPanel && only >= 0) return '';
    if (isPanel) {
      // only the rim: four strips around the calm middle (they overlap a little, so no seam shows)
      const o = { pal: sp[0], seed: sp[1], panel: true, d: 6 }, B = 16, P = 2;
      const yb = Math.floor((h - 6 - B) * s) / s, xr = Math.floor((w - B) * s) / s, yt = B - 2, ye = Math.ceil((yb + 2) * s) / s;
      const wins = [[-P, -P, w + P, B], [-P, yb, w + P, h + P], [-P, yt, B, ye], [xr, yt, w + P, ye]];
      const part = (n) => stoneCuts[id + '#' + n] || (o.win = wins[n], stoneCuts[id + '#' + n] = dataUrl(renderStone(w, h, s, o)));
      if (only >= 0) { part(only); return ''; }
      const side = ' calc(100% - ' + px(yt + P + h + P - ye) + ') no-repeat';
      css = part(0) + ' 0 0 / 100% ' + px(B + P) + ' no-repeat, ' + part(1) + ' 0 100% / 100% ' + px(h + P - yb) + ' no-repeat, '
        + part(2) + ' 0 ' + px(yt + P) + ' / ' + px(B + P) + side + ', ' + part(3) + ' 100% ' + px(yt + P) + ' / ' + px(w + P - xr) + side;
      for (let n = 0; n < 4; n++) delete stoneCuts[id + '#' + n];
    } else css = dataUrl(renderStone(w, h, s, { pal: sp[0], seed: sp[1] })) + ' 0 0 / 100% 100% no-repeat';
    return (stoneCuts[id] = css);
  }

  // The calm surface of the dialog slabs (and the backing of the displays), as a repeating tile.
  function cutSlab() {
    const ps = Math.min(stoneScale, 1.5);                                  // dialogs are calm: 1.5x is plenty
    if (ps === slabScale) return;
    slabScale = ps;
    const t = renderStone(128, 128, ps, { pal: 'slab', seed: 1, tile: true, win: [-2, -2, 130, 130] });
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(128 * ps);
    cv.getContext('2d').drawImage(t, -2 * ps, -2 * ps);
    document.documentElement.style.setProperty('--rock-slab', dataUrl(cv));
  }

  function makeStone(el, sz) {
    if (el._kfStone === sz.key) return;
    if (el.classList.contains('kf-panel')) cutSlab();
    el.style.setProperty('--st-face', cutStone(el, sz));
    el._kfStone = sz.key;
    el.classList.add('kf-stone');
  }

  // Everything that has a size right now. New stones and stones that were hidden are set at once; a stone
  // that changes size while it is on screen is recut a moment later (its old picture is stretched
  // meanwhile, so dragging a window stays smooth). Stones nobody can see yet (the controls behind the
  // title screen) are left to the warm-up below.
  function sweepStones(all) {
    const jobs = [];
    let late = false;
    for (const el of stoneEls) {
      const sz = stoneSize(el), seen = el._kfSeen;
      el._kfSeen = !!sz;
      if (!sz || el._kfStone === sz.key || (sz.veiled && !all && !el._kfStone)) continue;
      if (all || !el._kfStone || !seen) jobs.push([el, sz]); else late = true;
    }
    for (const job of jobs) makeStone(job[0], job[1]);
    if (late) {
      clearTimeout(stoneTimer);
      stoneTimer = setTimeout(() => { try { sweepStones(true); } catch (e) { /* keep the old stones */ } }, 140);
    }
  }

  // Hidden dialogs have no size. Measure them once while nothing is painted and cut their stones ahead of
  // time, a small piece per tick, so that opening the menu never has to wait. Second round: the same with
  // the buttons that are hidden inside them shown (the menu during a game is taller) - those cuts only fill
  // the cache.
  function warmStones() {
    const jobs = [];
    const measure = (deep) => {
      const hid = [];
      try {
        for (const el of document.querySelectorAll('#kf-app [hidden]')) {
          if (el.querySelector('.kf-btn') || (deep && el.classList.contains('kf-btn'))) { el.hidden = false; el.style.visibility = 'hidden'; hid.push(el); }
        }
        for (const el of stoneEls) {
          const sz = stoneSize(el);
          if (!sz || (!deep && el._kfStone === sz.key)) continue;
          if (el.classList.contains('kf-panel')) for (let n = 0; n < 4; n++) jobs.push([el, sz, true, n]);
          jobs.push([el, sz, deep, -1]);
        }
      } catch (e) { /* nothing to warm */ }
      for (const el of hid) { el.style.visibility = ''; el.hidden = true; }
    };
    measure(false); measure(true);
    jobs.unshift(null);                                                    // first of all the slab tile
    const step = () => {
      if (!jobs.length) return;
      const job = jobs.shift();
      try { if (!job) cutSlab(); else if (job[2]) cutStone(job[0], job[1], job[3]); else makeStone(job[0], job[1]); } catch (e) { /* this one stays a plain slab */ }
      warmTimer = setTimeout(step, 30);
    };
    step();
  }

  function onLayout(view) {
    // the stones follow the screen, not the game's own (adaptive) canvas resolution: they are cut once
    const dpr = window.devicePixelRatio || (view && view.dpr) || 1, sc = dpr >= 1.75 ? 2 : dpr >= 1.25 ? 1.5 : 1;
    const vk = view ? view.colW + '/' + view.W + '/' + view.H : '';
    if (vk !== stoneView) { stoneView = vk; stoneCuts = {}; }             // other sizes from here on: drop the old cuts
    if (sc !== stoneScale) { stoneScale = sc; stoneCuts = {}; }
    if (!stoneEls) {
      stoneEls = Array.prototype.slice.call(document.querySelectorAll('.kf-btn, .kf-panel'));
      const again = () => { try { sweepStones(false); } catch (e) { /* a skin must not break the game */ } };
      if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(again);
        for (const el of stoneEls) ro.observe(el);
      } else if (typeof MutationObserver === 'function') {
        new MutationObserver(() => setTimeout(again, 0)).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
      }
      const app = document.getElementById('kf-app');                      // leaving the title screen unveils the controls
      if (app && typeof MutationObserver === 'function') new MutationObserver(again).observe(app, { attributes: true, attributeFilter: ['class'] });
    }
    sweepStones(false);
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => { try { warmStones(); } catch (e) { /* stones are then cut when first shown */ } }, 260);
  }

  // ------------------------------------------------------------------ playfield frame: weathered stone pillars

  function drawFrame(g, view, K) {
    const { W, H, dpr, cell, boardX, boardY, boardW, boardH } = view;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const f = Math.max(6, Math.round(cell * 0.3));
    const ey = boardY - K.ENTRY_ROWS * cell;
    const xl = boardX - f, xr = boardX + boardW, yb = boardY + boardH;

    // soft shadow the frame casts on the cave behind it
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.75)'; g.shadowBlur = f * 1.6; g.shadowOffsetY = f * 0.35;
    g.fillStyle = '#17150f';
    g.fillRect(xl, boardY, f, boardH + f);
    g.fillRect(xr, boardY, f, boardH + f);
    g.fillRect(xl, yb, boardW + f * 2, f);
    g.restore();

    const slab = (x, y, w, h, vertical) => {
      // body: cool grey rock, lit from the top-left
      const grd = vertical ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, '#8d8a80'); grd.addColorStop(0.18, '#5f5c54'); grd.addColorStop(0.7, '#3a3832'); grd.addColorStop(1, '#1c1b17');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      if (stone) {
        g.save();
        g.beginPath(); g.rect(x, y, w, h); g.clip();
        g.globalCompositeOperation = 'overlay';
        g.globalAlpha = 0.85;
        g.fillStyle = g.createPattern(stone, 'repeat');
        g.fillRect(x, y, w, h);
        g.restore();
      }
      // chiselled edges
      g.fillStyle = 'rgba(255,250,235,0.28)';
      if (vertical) g.fillRect(x, y, Math.max(1, w * 0.1), h); else g.fillRect(x, y, w, Math.max(1, h * 0.12));
      g.fillStyle = 'rgba(0,0,0,0.55)';
      if (vertical) g.fillRect(x + w - Math.max(1, w * 0.14), y, Math.max(1, w * 0.14), h); else g.fillRect(x, y + h - Math.max(1, h * 0.16), w, Math.max(1, h * 0.16));
    };
    slab(xl, ey, f, yb + f - ey, true);
    slab(xr, ey, f, yb + f - ey, true);
    slab(xl, yb, boardW + f * 2, f, false);
    g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 1;
    g.strokeRect(xl + 0.5, boardY + 0.5, f - 1, boardH + f - 1);
    g.strokeRect(xr + 0.5, boardY + 0.5, f - 1, boardH + f - 1);
    g.strokeRect(xl + 0.5, yb + 0.5, boardW + f * 2 - 1, f - 1);

    // a glowing amber crystal set into each lower corner
    for (const cx of [xl + f / 2, xr + f / 2]) {
      const cy = yb + f / 2, r = f * 0.36;
      const halo = g.createRadialGradient(cx, cy, 0, cx, cy, f * 1.6);
      halo.addColorStop(0, 'rgba(255,180,70,0.45)'); halo.addColorStop(1, 'rgba(255,180,70,0)');
      g.fillStyle = halo; g.fillRect(cx - f * 1.6, cy - f * 1.6, f * 3.2, f * 3.2);
      const gem = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      gem.addColorStop(0, '#fff3cf'); gem.addColorStop(0.35, '#ffb53d'); gem.addColorStop(1, '#6a3303');
      g.fillStyle = gem; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(20,10,0,0.9)'; g.lineWidth = 1; g.stroke();
    }

    // the pillars fade out upwards through the entry shaft
    g.globalCompositeOperation = 'destination-out';
    const fade = g.createLinearGradient(0, ey, 0, boardY);
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(xl - f * 2, ey - 1, boardW + f * 6, boardY - ey + 1);
    g.globalCompositeOperation = 'source-over';

    // entry shaft and field: smoked glass
    const a = K.FIELD_ALPHA;
    const shaft = g.createLinearGradient(0, ey, 0, boardY);
    shaft.addColorStop(0, 'rgba(3,5,8,0)'); shaft.addColorStop(1, 'rgba(3,5,8,' + (a * 0.8).toFixed(3) + ')');
    g.fillStyle = shaft; g.fillRect(boardX, ey, boardW, K.ENTRY_ROWS * cell);
    const field = g.createLinearGradient(0, boardY, 0, yb);
    field.addColorStop(0, 'rgba(4,6,10,' + a.toFixed(3) + ')'); field.addColorStop(1, 'rgba(2,3,6,' + Math.min(1, a + 0.1).toFixed(3) + ')');
    g.fillStyle = field; g.fillRect(boardX, boardY, boardW, boardH);
    // faint reflection on the glass
    const sheen = g.createLinearGradient(boardX, boardY, boardX + boardW, boardY + boardW * 1.6);
    sheen.addColorStop(0, 'rgba(255,255,255,0.05)'); sheen.addColorStop(0.3, 'rgba(255,255,255,0)'); sheen.addColorStop(0.62, 'rgba(255,255,255,0.028)'); sheen.addColorStop(0.75, 'rgba(255,255,255,0)');
    g.fillStyle = sheen; g.fillRect(boardX, boardY, boardW, boardH);
    // recess shadows along the inner edges
    const e = cell * 0.7;
    let sh = g.createLinearGradient(boardX, 0, boardX + e, 0); sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.fillRect(boardX, boardY, e, boardH);
    sh = g.createLinearGradient(xr, 0, xr - e, 0); sh.addColorStop(0, 'rgba(0,0,0,0.38)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.fillRect(xr - e, boardY, e, boardH);
    sh = g.createLinearGradient(0, yb, 0, yb - e); sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.fillRect(boardX, yb - e, boardW, e);

    // barely-there grid, a scored line where the field begins
    g.strokeStyle = 'rgba(255,255,255,0.045)'; g.lineWidth = 1;
    g.beginPath();
    for (let c = 1; c < K.COLS; c++) { g.moveTo(boardX + c * cell + 0.5, boardY); g.lineTo(boardX + c * cell + 0.5, yb); }
    for (let r = 1; r < K.ROWS; r++) { g.moveTo(boardX, boardY + r * cell + 0.5); g.lineTo(boardX + boardW, boardY + r * cell + 0.5); }
    g.stroke();
    g.strokeStyle = 'rgba(255,240,210,0.16)';
    g.beginPath(); g.moveTo(boardX, boardY + 0.5); g.lineTo(boardX + boardW, boardY + 0.5); g.stroke();

    // carved arrows mark the tap zones where there is room for them
    const zone = xl - view.colX;
    if (zone >= 12) {
      const s = Math.min(zone * 0.28, cell * 0.34), cy = boardY + boardH * 0.5;
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const side of [-1, 1]) {
        const cx = side < 0 ? view.colX + zone / 2 : view.colX + view.colW - zone / 2;
        for (const dy of [-cell * 3, 0, cell * 3]) {
          for (const pass of [0, 1]) {
            g.lineWidth = Math.max(1.5, s * 0.34);
            g.strokeStyle = pass ? 'rgba(255,238,205,0.5)' : 'rgba(0,0,0,0.7)';
            const o = pass ? 0 : 1.2;
            g.beginPath();
            g.moveTo(cx - side * s * 0.5 + o, cy + dy - s + o);
            g.lineTo(cx + side * s * 0.5 + o, cy + dy + o);
            g.lineTo(cx - side * s * 0.5 + o, cy + dy + s + o);
            g.stroke();
          }
        }
      }
      g.lineCap = 'butt'; g.lineJoin = 'miter';
    }
  }

  // ------------------------------------------------------------------ title: polished metal lettering

  const LOGO_FILL = [
    ['#f7fcff', '#c3ddf0', '#5c8fbb', '#e2f3ff', '#8dbbe0', '#2f5f93'],     // cut ice
    ['#fff6d2', '#f2c860', '#9a6412', '#ffe9a8', '#d59a2c', '#5e3905'],     // gold
  ];
  const LOGO_GLOW = ['rgba(120,190,255,0.55)', 'rgba(255,175,60,0.55)'];

  function drawLogo(cv, view, lines) {
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const wCss = Math.max(120, Math.min(view.colW - 28, 470));
    const font = (px) => '700 ' + px.toFixed(1) + 'px ' + FONT;
    const probe = cv.getContext('2d');
    const track = 0.05;
    const widthAt = (text, px) => {
      probe.font = font(px);
      let w = 0;
      for (const ch of text) w += probe.measureText(ch).width + px * track;
      return w - px * track;
    };
    const fit = (text, share, cap) => Math.min(cap, 100 * (wCss * share) / widthAt(text, 100));
    const sizes = [fit(lines[0], 0.9, wCss * 0.2), fit(lines[1], 0.78, wCss * 0.34)];
    const pad = sizes[1] * 0.35;
    const hCss = sizes[0] * 0.95 + sizes[1] * 0.98 + pad * 2;
    cv.style.width = wCss + 'px'; cv.style.height = hCss + 'px';
    cv.width = Math.round(wCss * ratio); cv.height = Math.round(hCss * ratio);
    const g = cv.getContext('2d');
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, wCss, hCss);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';

    let baseline = pad + sizes[0] * 0.74;
    lines.forEach((text, li) => {
      const px = sizes[li], stops = LOGO_FILL[li % LOGO_FILL.length];
      g.font = font(px);
      const glyphs = [];
      let x = (wCss - widthAt(text, px)) / 2;
      for (const ch of text) { const w = g.measureText(ch).width; glyphs.push([ch, x]); x += w + px * track; }
      const each = (fn) => { for (const gl of glyphs) fn(gl[0], gl[1]); };
      const top = baseline - px * 0.72, bottom = baseline + px * 0.02;

      // light bleeding into the dark behind the letters, then a soft drop shadow
      g.save();
      g.shadowColor = LOGO_GLOW[li % LOGO_GLOW.length]; g.shadowBlur = px * 0.5;
      g.fillStyle = 'rgba(0,0,0,0.01)';
      each((ch, gx) => { g.fillText(ch, gx, baseline); g.fillText(ch, gx, baseline); });
      g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = px * 0.14; g.shadowOffsetY = px * 0.07;
      g.fillStyle = '#0a0806';
      each((ch, gx) => g.fillText(ch, gx, baseline));
      g.restore();

      // dark edge, then the polished face with a horizon line (how curved metal mirrors a dark room)
      g.strokeStyle = 'rgba(8,6,3,0.95)'; g.lineWidth = px * 0.06;
      each((ch, gx) => g.strokeText(ch, gx, baseline));
      const grd = g.createLinearGradient(0, top, 0, bottom);
      grd.addColorStop(0, stops[0]); grd.addColorStop(0.3, stops[1]); grd.addColorStop(0.5, stops[2]);
      grd.addColorStop(0.53, stops[3]); grd.addColorStop(0.8, stops[4]); grd.addColorStop(1, stops[5]);
      g.fillStyle = grd;
      each((ch, gx) => g.fillText(ch, gx, baseline));
      // bevel: a hairline of light on the upper-left edge
      g.save();
      g.globalAlpha = 0.6; g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(0.6, px * 0.012);
      g.translate(-px * 0.008, -px * 0.008);
      each((ch, gx) => g.strokeText(ch, gx, baseline));
      g.restore();
      baseline += sizes[0] * 0.24 + sizes[1] * 0.82;
    });
  }

  KF.Skin = {
    name: 'real',
    font: FONT,
    fontLoad: "700 20px 'Cinzel'",
    fieldAlpha: 0.4,
    popup: { ink: 'rgba(6,4,2,0.92)', gold: '#ffd98a', ice: '#f3ecdc', weight: '700' },
    drawFrame,
    drawLogo,
    onLayout,
    stones: { render: renderStone, recut: () => { stoneCuts = {}; for (const el of stoneEls) el._kfStone = ''; sweepStones(true); }, list: () => stoneEls },   // for tests
  };
})(globalThis.KF = globalThis.KF || {});
