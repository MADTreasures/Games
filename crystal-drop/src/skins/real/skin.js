// Crystal Drop – realistic skin: raw mineral stones for buttons, dialogs, displays and switches, the carved-stone playfield frame
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

  // ------------------------------------------------------------------ raw mineral stones (buttons, dialogs, displays)
  // Every button, display and switch is its own broken chunk of chrysocolla-like rock, drawn once per size
  // onto a canvas and handed to the stylesheet as a data URL (--st-face). The picture holds the top of the
  // stone, its dark side below and a soft shadow, so the stylesheet needs no filters.
  // All per-pixel work happens here, when a stone is first needed or its size changes - never per frame.

  const TS = 256, TM = TS - 1;
  let FLD = null;
  // Shared tileable fields: two fractal noises, a crackle (cell borders + cell values), white noise and a
  // clumpy grain (soft grains of about 1.5 and 4 CSS px, values spread evenly over 0..255).
  function stoneFields() {
    if (FLD) return FLD;
    const NA = fbmField(TS, 4, 5, 9001), NB = fbmField(TS, 3, 4, 9002);
    const CE = new Float32Array(TS * TS), CI = new Uint8Array(TS * TS), GR = new Uint8Array(TS * TS), GC = new Uint8Array(TS * TS);
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
    const g1 = fbmField(TS, 85, 1, 9003), g2 = fbmField(TS, 32, 1, 9004), hist = new Uint32Array(1026);
    for (let i = 0; i < g1.length; i++) { const v = (g1[i] * 0.6 + g2[i] * 0.4) * 1023 | 0; g1[i] = v; hist[v + 1]++; }
    for (let k = 1; k < 1026; k++) hist[k] += hist[k - 1];
    for (let i = 0; i < g1.length; i++) GC[i] = hist[g1[i]] * 255 / g1.length;
    return (FLD = { NA, NB, CE, CI, GR, GC });
  }

  // Mineral families after the reference stones: chalky, matte colours. c: dark, main, second, accent, pale
  // rock, vein (RGB each); t: thresholds dark|main|second, accent above, pale rock below; va: how pale the
  // veins get; bx: how strongly the accent gathers at one end of the stone; cr: pale dust on ridges.
  const pal = (c, t, va, bx, cr) => ({ c: new Float32Array(c), t, va, bx, cr });
  const PAL = {
    turq: pal([24, 66, 108, 46, 138, 160, 96, 200, 206, 26, 36, 56, 186, 178, 150, 196, 234, 226], [0.3, 0.8, 0.79, 0.09], 0.8, 0, 0.3),
    deep: pal([22, 32, 54, 24, 88, 120, 44, 150, 168, 74, 46, 56, 182, 170, 150, 166, 206, 212], [0.38, 0.8, 0.74, 0.16], 0.75, 0, 0.26),
    dark: pal([14, 22, 36, 22, 62, 80, 34, 124, 140, 58, 44, 60, 150, 150, 136, 150, 194, 190], [0.42, 0.8, 0.74, 0.14], 0.65, 0, 0.22),
    mauve: pal([74, 58, 68, 132, 111, 112, 156, 138, 132, 76, 120, 112, 170, 156, 144, 208, 198, 194], [0.3, 0.74, 0.76, 0.18], 0.65, 0.34, 0.3),
    beige: pal([106, 94, 100, 180, 162, 132, 204, 190, 160, 76, 148, 140, 142, 134, 130, 234, 226, 206], [0.3, 0.76, 0.68, 0.2], 0.6, 0.3, 0.3),
    slab: pal([22, 29, 40, 34, 49, 63, 34, 74, 84, 64, 54, 64, 96, 100, 94, 132, 170, 170], [0.42, 0.74, 0.76, -9], 0.5, 0, 0.3),
    stat: pal([34, 42, 54, 60, 76, 90, 86, 132, 140, 122, 102, 102, 172, 168, 150, 204, 222, 216], [0.3, 0.7, 0.76, 0.14], 0.7, 0, 0.36),
  };

  // The broken outline of a stone as a set of cuts (half-planes) through its box, each cut with its own
  // steepness: corners knocked off, edges slanted, long stones tapering at one end. Plus shell-shaped chips
  // bitten out of the rim. kind: 0 button, 1 dialog slab, 2 frame of a display or switch.
  function stoneShape(w, h, rnd, kind, m, T) {
    const panel = kind === 1, frame = kind === 2, wide = !panel && w > h * 1.7;
    const a = [], b = [], c = [], iv = [], reach = [0, 0], se = frame ? 0.5 : 1;
    const sl = () => (panel ? 0.45 + 0.55 * rnd() : frame ? 0.8 + 0.7 * rnd() : 0.5 + 0.95 * rnd());
    const cut = (x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1, l = Math.sqrt(dx * dx + dy * dy) || 1, s = sl(), nx = -dy / l, ny = dx / l;
      a.push(nx * s); b.push(ny * s); c.push(-(nx * x1 + ny * y1) * s); iv.push(1 / s);
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
      if (panel) {
        cx = PANEL_CUT[0] + PANEL_CUT[1] * rnd(); cy = PANEL_CUT[0] + PANEL_CUT[1] * rnd();
        // how far the rim (16px deep along the cut) reaches into the box beside the 24px side strips
        const r = cy * (1 + 16 * Math.sqrt(cx * cx + cy * cy) / (cx * cy) - 24 / cx), e = k === 0 || k === 1 ? 0 : 1;
        if (r > reach[e]) reach[e] = r;
      } else if (frame) { cx = m * (0.1 + 0.16 * rnd()); cy = m * (0.1 + 0.16 * rnd()); }
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
        for (let i = 0; i < n; i++) slant(edge, (i + 0.3 + 0.4 * rnd()) / n, i % 2 ? 1 : -1, 2 + 3.5 * rnd());
      } else if (edge % 2 === 0) {
        if (wide) { slant(edge, 0.22 + 0.25 * rnd(), -1, m * se * (0.04 + 0.09 * rnd())); slant(edge, 0.53 + 0.25 * rnd(), 1, m * se * (0.04 + 0.09 * rnd())); }
        else slant(edge, 0.3 + 0.4 * rnd(), rnd() < 0.5 ? 1 : -1, m * se * (0.04 + 0.08 * rnd()));
      } else if (rnd() < 0.6) slant(edge, 0.3 + 0.4 * rnd(), rnd() < 0.5 ? 1 : -1, m * se * (0.04 + 0.08 * rnd()));
    }
    const chips = [];
    const n = panel ? Math.round((w + h) / 70) : (wide ? 3 : 2) + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const side = !panel && wide && rnd() < 0.7 ? (rnd() < 0.5 ? 0 : 2) : rnd() * 4 | 0;
      const r = panel ? 7 + 9 * rnd() : m * (frame ? 0.12 + 0.12 * rnd() : 0.16 + 0.2 * rnd());
      let out = r * ((panel ? 0.4 : frame ? 0.55 : 0.25) + (frame ? 0.3 : 0.45) * rnd()), cx, cy;
      if (panel && out < r - 8) out = r - 8;
      if (side === 0) { cx = w * rnd(); cy = -out; } else if (side === 2) { cx = w * rnd(); cy = h + out; }
      else if (side === 1) { cx = w + out; cy = h * rnd(); } else { cx = -out; cy = h * rnd(); }
      chips.push(cx, cy, 1 / (r * r), T * (0.7 + 0.9 * rnd()), r);
    }
    if (panel) {
      // deeper bites that really break the silhouette (never deeper than the rim is wide)
      for (let edge = 0; edge < 4; edge++) {
        const len = edge % 2 ? h : w, cnt = len > 260 ? 3 : len > 150 ? 2 : 1;
        for (let i = 0; i < cnt; i++) {
          const r = 13 + 9 * rnd(), out = r - (4.5 + 3.5 * rnd()), p = (i + 0.2 + 0.6 * rnd()) / cnt * len;
          const cx = edge === 0 || edge === 2 ? p : edge === 1 ? w + out : -out, cy = edge === 0 ? -out : edge === 2 ? h + out : p;
          chips.push(cx, cy, 1 / (r * r), T * (1.5 + rnd()), r);
        }
      }
    } else if (wide && !frame) {
      // long stones: one end tapers, and each long edge gets one deep notch away from the lettering
      const end = rnd() < 0.5 ? 1 : -1, e1 = m * (0.12 + 0.1 * rnd()), e2 = m * (0.07 + 0.1 * rnd());
      const t1 = 0.6 + 0.14 * rnd(), t2 = 0.62 + 0.16 * rnd(), end2 = rnd() < 0.6 ? end : -end;
      if (end > 0) slant(0, t1, 1, e1); else slant(0, 1 - t1, -1, e1);
      if (end2 > 0) slant(2, t2, -1, e2); else slant(2, 1 - t2, 1, e2);
      for (let edge = 0; edge < 4; edge += 2) {
        const r = m * (0.3 + 0.15 * rnd()), bite = m * (0.1 + 0.08 * rnd());
        const cx = w * (rnd() < 0.5 ? 0.07 + 0.2 * rnd() : 0.73 + 0.2 * rnd());
        chips.push(cx, edge ? h + r - bite : bite - r, 1 / (r * r), T * 3, r);
      }
    }
    return { a: new Float64Array(a), b: new Float64Array(b), c: new Float64Array(c), iv: new Float64Array(iv), chips: new Float64Array(chips), reach };
  }

  const NO_CUTS = new Float64Array(0);
  const LX = 0.46, LY = 0.62, LZ = 0.64;                   // light from the top-left, like the frame
  const stoneRnd = (seed) => mulberry32(Math.imul(seed | 0, 40503) + 977);
  // deep corner breaks on dialogs need clip-path for the middle of the slab; without it the corners stay small
  let PANEL_CUT = [8, 15];
  try {
    if (typeof CSS !== 'undefined' && CSS.supports && (CSS.supports('clip-path', 'polygon(0 0, 1px 0, 0 1px)') || CSS.supports('-webkit-clip-path', 'polygon(0 0, 1px 0, 0 1px)'))) PANEL_CUT = [14, 26];
  } catch (e) { /* small corners */ }

  // Draws one stone for a box of w x h CSS px at `s` device px per CSS px.
  //   o.pal: mineral family, o.seed, o.win: the part to draw [x0, y0, x1, y1]
  //          (default: the box plus 3px, plus the side and the shadow below)
  //   o.d: thickness, shown as a dark side below the top (buttons: below the box; dialogs: inside the box)
  //   o.frame: a restrained outline (displays, switch tracks); o.well: [inset x, inset y, corner radius] a dark
  //          window carved into the top, o.wellCol its floor colour
  //   o.panel: a dialog slab - only its rim is drawn, the flat top fades out towards the middle
  //   o.mid: the middle of that slab as a coarse colour map (the stylesheet lays the grain tile over it)
  //   o.tile: that grain tile - the fine structure of the flat slab top in neutral grey
  //   o.plain: no calmer zone for lettering (knobs); o.noShadow; o.shape: the outline, if the caller has it already
  // Returns the canvas.
  function renderStone(w, h, s, o) {
    const FL = stoneFields(), NA = FL.NA, NB = FL.NB, CE = FL.CE, CI = FL.CI, GR = FL.GR, GC = FL.GC;
    const P = PAL[o.pal] || PAL.deep, col = P.c;
    const rnd = stoneRnd(o.seed);
    const panel = !!o.panel, tile = !!o.tile, mid = !!o.mid, slab = panel || mid, flat = slab || tile, frame = !!o.frame;
    const d = o.d || 0, mode = mid ? 1 : tile ? 2 : 0, shadow = !flat && !o.noShadow;
    const win = o.win || [-3, -3, w + 3, h + 3 + (flat ? 0 : d + (shadow ? 5 : 0))], x0 = win[0], y0 = win[1];
    const W = Math.max(3, Math.round((win[2] - x0) * s)), H = Math.max(3, Math.round((win[3] - y0) * s));
    const fh = slab ? h - d : h;
    const m = flat ? 52 : Math.min(w, h);
    const T = flat ? 4.2 : Math.max(3.4, Math.min(7, m * 0.1));
    const shp = tile ? null : o.shape || stoneShape(w, fh, rnd, slab ? 1 : frame ? 2 : 0, m, T);
    const pa = shp ? shp.a : NO_CUTS, pb = shp ? shp.b : NO_CUTS, pc = shp ? shp.c : NO_CUTS, pi = shp ? shp.iv : NO_CUTS, np = pa.length;
    const chips = shp ? shp.chips : NO_CUTS, nc = chips.length, rowB = new Float64Array(np + 1), act = new Int32Array(nc / 5 + 1);

    // the top: a lattice of tilted triangular fracture faces (flat for slabs)
    const th = 0.3 + rnd(), sp = m * (0.62 + 0.3 * rnd());
    const ua = Math.cos(th) / sp, ub = Math.sin(th) / sp, va = -Math.sin(th) / (sp * 0.72), vb = Math.cos(th) / (sp * 0.72);
    const NH = new Float32Array(1024), ND = new Uint8Array(1024);
    if (!flat) for (let i = 0; i < 1024; i++) { NH[i] = T * (0.45 + 2.1 * rnd()); ND[i] = rnd() < 0.5 ? 1 : 0; }

    // mineral pattern: where the fields are read (slabs read them 1:1 so that rim, middle and grain tile match)
    const ck = flat ? 2 : Math.max(1.3, Math.min(2, 2.1 - m / 110)), ka = flat ? 2 : 1.6;
    const rot = flat ? 0 : (rnd() - 0.5) * 1.6, rc = Math.cos(rot) * ck, rs = Math.sin(rot) * ck;
    const o1 = 2048 + (flat ? 0 : rnd() * 256 | 0), o2 = 2048 + (flat ? 0 : rnd() * 256 | 0);
    const kb = flat ? 1 : 0.37, o3 = flat ? 131 : rnd() * 256, o4 = flat ? 67 : rnd() * 256;
    const kn = flat ? 2 : 1.1, o5 = 1024 + (flat ? 40 : rnd() * 256 | 0), o6 = 1024 + (flat ? 90 : rnd() * 256 | 0);
    const o7 = 1024 + (flat ? 170 : rnd() * 256 | 0), o8 = 1024 + (flat ? 20 : rnd() * 256 | 0);
    const t0 = P.t[0], t1 = P.t[1], ta = P.t[2], tb = P.t[3], pva = P.va, crustK = P.cr * 4.2, veinK = 1 / (kb * ck);
    const bx = P.bx * 2 / w * (rnd() < 0.5 ? -1 : 1), hw = w * 0.5;
    const mr = col[3] * 0.8, mg = col[4] * 0.8, mb = col[5] * 0.8;
    // the outline wobbles a little (long stones more), so no edge is ruler-straight
    const wr2 = stoneRnd((o.seed | 0) + 7919), wo1 = 1024 + wr2() * 256, wo2 = 1024 + wr2() * 256;
    const wobA = tile ? 0 : slab ? 2 : m * (!frame && w > h * 1.7 ? 0.15 : 0.05), wobR = 0.3 * m;
    // bilinear lookup for the fields that are read magnified
    const bl = (F, u, v) => {
      const iu = u | 0, ivv = v | 0, fu = u - iu, fv = v - ivv, r0 = (ivv & TM) << 8, r1 = ((ivv + 1) & TM) << 8, c0 = iu & TM, c1 = (iu + 1) & TM;
      const p = F[r0 | c0], q = F[r1 | c0];
      return (p + (F[r0 | c1] - p) * fu) * (1 - fv) + (q + (F[r1 | c1] - q) * fu) * fv;
    };
    let cr = 0, cg = 0, cb = 0, fk = 0, gn = 0.5;
    // z: 0..1 inside the lettering zone (calmer, darker), v: 0..1 vividness (rim of a slab).
    // Sets cr/cg/cb and fk (how likely pale flecks are here); reads gn, the grain at this pixel.
    const alb = (x, y, z, v) => {
      const ax = x * ka + o1, ay = y * ka + o2;
      const n1 = NA[((ay & TM) << 8) | (ax & TM)], n2 = NA[(((ay + 77) & TM) << 8) | ((ax + 131) & TM)];
      const n3 = mode === 1 ? 0.5 : NA[(((ay * 3 + 11) & TM) << 8) | ((ax * 3 + 53) & TM)];        // fine mottling and pits
      const tu = x * rc - y * rs + o1, tv = x * rs + y * rc + o2, ia = ((tv & TM) << 8) | (tu & TM);
      let micro = 0.85 + 0.3 * n3;
      if (n3 < 0.3) micro *= 0.88;
      if (mode !== 1) { const e = CE[ia]; if (e < 0.9 && n2 > 0.56) micro *= 0.7 + 0.33 * e; }    // hairline cracks, here and there
      if (mode === 2) { cr = cg = cb = 128 * micro; fk = 0; return; }
      const id = CI[ia] * 0.003921569;
      const wq = (n2 - 0.5) * 36, dq = (n3 - 0.5) * 0.3 + (gn - 0.5) * 0.12;       // warps the patches into ragged shapes; dq dissolves their borders into speckles
      const b1 = bl(NB, x * kn + o5 - wq, y * kn + o6 + wq), b2 = bl(NB, y * kn + o7 + wq, x * kn + o8 - wq);
      const q = b1 + (n1 - 0.5) * 0.55 + (id - 0.5) * 0.08 + dq, q2 = b2 + (n2 - 0.5) * 0.45 + (0.5 - id) * 0.06 + (x - hw) * bx - dq;
      // dark rock -> main mineral -> its lighter form, finely intergrown
      let f = (q - t0) * 7 + 0.5; f = f < 0 ? 0 : f > 1 ? 1 : f;
      let r = col[0] + (col[3] - col[0]) * f, g = col[1] + (col[4] - col[1]) * f, b = col[2] + (col[5] - col[2]) * f;
      f = (q - t1) * 6 + 0.5;
      if (f > 0) { if (f > 1) f = 1; r += (col[6] - r) * f; g += (col[7] - g) * f; b += (col[8] - b) * f; }
      f = (q2 - ta) * 7 + 0.5;                                               // accent mineral
      if (f > 0) { if (f > 1) f = 1; r += (col[9] - r) * f; g += (col[10] - g) * f; b += (col[11] - b) * f; }
      let pf = (tb - q2) * 7 + 0.5;                                          // pale host rock
      if (pf > 0) { if (pf > 1) pf = 1; r += (col[12] - r) * pf; g += (col[13] - g) * pf; b += (col[14] - b) * pf; } else pf = 0;
      let tone = (0.75 + 0.36 * n1 + 0.06 * id) * micro * (1 + 0.3 * v), vn = 0;
      if (mode === 0 && n1 > 0.44) {
        // pale veins along bent fractures: soft-edged, of changing width, fading in and out
        const ev = bl(CE, (tu + (b2 - 0.5) * 30 + (n2 - 0.5) * 6) * kb + o3, (tv + (b1 - 0.5) * 30) * kb + o4) * veinK;
        const vw = 0.35 + 0.9 * n2 + 0.5 * (n3 - 0.5);
        if (ev < vw + 0.5) {
          f = (vw + 0.5 - ev) / (vw * 0.7 + 0.5); if (f > 1) f = 1;
          vn = (n1 - 0.44) * 6; vn = (vn > 1 ? 1 : vn) * f * f * (3 - 2 * f) * pva;
        }
      }
      if (z > 0) { f = 0.42 * z; r += (mr - r) * f; g += (mg - g) * f; b += (mb - b) * f; vn *= 1 - 0.6 * z; tone *= 1 - 0.22 * z; pf *= 1 - 0.6 * z; }
      if (flat) vn *= v > 0.4 ? (v - 0.4) * 1.667 : 0;
      cr = r * tone; cg = g * tone; cb = b * tone;
      if (vn > 0) { cr += (col[15] - cr) * vn; cg += (col[16] - cg) * vn; cb += (col[17] - cb) * vn; }
      fk = pf * 0.8 > vn ? pf * 0.8 : vn;
    };

    const n = W * H, hf = new Float32Array(n), al = new Float32Array(n), ft = new Uint8Array(n);
    const ds = slab ? new Float32Array(n) : null, wz = o.well ? new Uint8Array(n) : null;
    const RA = 2.6, RB = 1.3, tLow = T * 0.45;
    // a window carved into the top (displays, switch tracks)
    const well = o.well || null, wcx = w * 0.5, wcy = h * 0.5, wFloor = T * 0.2, wB = 2.2;
    const whx = well ? wcx - well[0] : 0, why = well ? wcy - well[1] : 0, wrd = well ? Math.min(well[2], whx, why) : 0;
    // cuts that cannot matter anywhere in a 16px block are skipped there
    const BS = 16, nbx = Math.ceil(W / BS), actP = new Uint8Array(nbx * (np + 1)), capK = new Float64Array(np + 1);
    for (let k = 0; k < np; k++) capK[k] = slab ? Math.max(T + 0.4, 24 / pi[k]) : T * 2.6 + wobA;
    const chipR = slab ? 16 : 0;
    for (let j = 0; j < H; j++) {
      const y = (j + 0.5) / s + y0;
      if (j % BS === 0) {
        const ya = j / s + y0, yb = Math.min(H, j + BS) / s + y0;
        for (let bi = 0; bi < nbx; bi++) {
          const xa = bi * BS / s + x0, xb = Math.min(W, bi * BS + BS) / s + x0, base = bi * (np + 1);
          let cnt = 0;
          for (let k = 0; k < np; k++) {
            const pax = pa[k] < 0 ? pa[k] * xb : pa[k] * xa, pby = pb[k] < 0 ? pb[k] * yb : pb[k] * ya;
            if (pax + pby + pc[k] < capK[k]) actP[base + 1 + cnt++] = k;
          }
          actP[base] = cnt;
        }
      }
      for (let k = 0; k < np; k++) rowB[k] = pb[k] * y + pc[k];
      let na = 0;
      for (let k = 0; k < nc; k += 5) { const dy = y - chips[k + 1], rr = chips[k + 4] + chipR; if (dy < rr && -dy < rr) act[na++] = k; }
      for (let i = 0; i < W; i++) {
        const x = (i + 0.5) / s + x0, base = (i >> 4) * (np + 1), cnt = actP[base], idx = j * W + i;
        let hh = 1e9, dist = 1e9;
        if (slab) for (let c = 1; c <= cnt; c++) { const k = actP[base + c]; let v = pa[k] * x + rowB[k]; if (v < hh) hh = v; v *= pi[k]; if (v < dist) dist = v; }
        else for (let c = 1; c <= cnt; c++) { const k = actP[base + c], v = pa[k] * x + rowB[k]; if (v < hh) hh = v; }
        if (hh < -6) { hf[idx] = hh; continue; }
        if (hh < wobR && wobA > 0) hh -= wobA * (bl(NA, x * 0.5 + wo1, y * 0.5 + wo2) - 0.15) * (1 - hh / wobR);
        if (flat) { if (hh > T) { hh = T; ft[idx] = 1; } }
        else if (hh > tLow) {
          const u = x * ua + y * ub + 16.37, v = x * va + y * vb + 16.71;
          const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
          const r0 = (iv & 31) << 5, r1 = ((iv + 1) & 31) << 5, c0 = iu & 31, c1 = (iu + 1) & 31;
          const h00 = NH[r0 | c0], h10 = NH[r0 | c1], h01 = NH[r1 | c0], h11 = NH[r1 | c1];
          let tt;
          if (ND[r0 | c0]) tt = fu > fv ? h00 + (h10 - h00) * fu + (h11 - h10) * fv : h00 + (h11 - h01) * fu + (h01 - h00) * fv;
          else tt = fu + fv < 1 ? h00 + (h10 - h00) * fu + (h01 - h00) * fv : h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv);
          if (tt < hh) { hh = tt; ft[idx] = 1 + ((iu * 7 + iv * 13 + (fu > fv ? 3 : 0) + (fu + fv < 1 ? 5 : 0)) & 7); }
        }
        for (let c = 0; c < na; c++) {
          const k = act[c], dx = x - chips[k], dy = y - chips[k + 1], q = (dx * dx + dy * dy) * chips[k + 2];
          if (q < 1) hh -= chips[k + 3] * (1 - q);
          if (slab) { const dc = (Math.sqrt(q) - 1) * chips[k + 4]; if (dc < dist) dist = dc; }
        }
        if (slab) ds[idx] = dist;
        let calm = 1;
        if (well) {
          const ax = Math.abs(x - wcx) - whx + wrd, ay = Math.abs(y - wcy) - why + wrd;
          const od = wrd - (ax > 0 ? (ay > 0 ? Math.sqrt(ax * ax + ay * ay) : ax) : ay > 0 ? ay : ax > ay ? ax : ay)
            + (NA[(((y * 3 + 900) & TM) << 8) | ((x * 3 + 700) & TM)] - 0.5) * 1.5;   // > 0 inside the window, its edge a little ragged
          if (od > 0 && hh > 0) {
            let e = od >= wB ? 1 : od / wB; e = e * e * (3 - 2 * e);
            if (hh > wFloor) hh += (wFloor - hh) * e; calm = 1 - 0.7 * e; wz[idx] = e * 255;
          }
        }
        const tx = x * 2 + 2048, ty = y * 2 + 2048;
        hh += calm * (RA * (NA[((ty & TM) << 8) | (tx & TM)] - 0.5) + RB * (NA[(((ty * 2 + 41) & TM) << 8) | ((tx * 2 + 97) & TM)] - 0.5));
        hf[idx] = hh;
      }
    }

    const face = document.createElement('canvas');
    face.width = W; face.height = H;
    const fg = face.getContext('2d'), img = fg.createImageData(W, H), D = img.data, D32 = new Uint32Array(D.buffer);
    if (mid) {
      // coarse colour map of the slab top; hidden under the rim near the outline
      for (let j = 0; j < H; j++) {
        const y = (j + 0.5) / s + y0;
        for (let i = 0; i < W; i++) {
          const k = j * W + i, dist = ds[k];
          if (dist < 7) continue;
          alb((i + 0.5) / s + x0, y, 0, dist < 22 ? 1 - dist / 22 : 0);
          const r = cr * 0.91, g = cg * 0.91, b = cb * 0.91;
          D32[k] = 0xff000000 | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
        }
      }
      fg.putImageData(img, 0, 0);
      return face;
    }
    const zx = 1 / (w * 0.37), zy = 1 / (h * 0.36), hh2 = h * 0.5, wc = o.wellCol || [8, 14, 21];
    const wx0 = wcx - whx, wy0 = wcy - why, lumK = tile ? 1 / 0.91 : 1;
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
        let lum = (0.27 + 1.0 * (lam > 0 ? lam : 0)) * lumK;
        let cv = (hl + hr + hu + hd - 4 * hh) * s * 0.55;                              // ridges catch light, cavities stay dark
        cv = cv < -0.3 ? -0.3 : cv > 0.3 ? 0.3 : cv;
        lum *= 1 - cv;
        let sheen = lam > 0.8 ? (lam - 0.8) * (flat ? 60 : 110) : 0;
        if (!tile && hh < 1.2) lum *= 0.72 + 0.2333 * (hh > 0 ? hh : 0);            // the very edge falls into shade
        let z = 0, v = 0, fade = 1, we = 0;
        if (panel) {
          const dist = ds[k];
          v = dist < 0 ? 1 : dist < 22 ? 1 - dist / 22 : 0;
          if (ft[k] && dist > 11.5) {                     // the flat top fades into the middle; rim faces stay solid
            if (dist >= 15) continue;
            fade = (15 - dist) / 3.5; fade = fade * fade * (3 - 2 * fade);
          }
        } else if (!tile) {
          if (wz) we = wz[k] * 0.003921569;
          else if (!frame && !o.plain) {
            const ex = (x - hw) * zx, ey = (y - hh2) * zy, e2 = ex * ex + ey * ey;
            if (e2 < 1.5) { z = e2 < 0.3 ? 1 : (1.5 - e2) / 1.2; z = z * z * (3 - 2 * z); }
          }
          if (ft[k]) lum *= 0.9 + 0.03 * ft[k];        // every fracture face a shade of its own
        }
        const gq = GC[(((y * 2 + 517) & TM) << 8) | ((x * 2 + 771) & TM)];
        gn = gq * 0.003921569;
        alb(x, y, z, v);
        if (cv < -0.06 && mode === 0) {                                               // chalky dust on ridges and crests
          let f = (-cv - 0.06) * crustK * (0.4 + gn) * (1 - 0.7 * z) * (1 - we);
          if (f > 0.6) f = 0.6;
          cr += (col[15] - cr) * f; cg += (col[16] - cg) * f; cb += (col[17] - cb) * f;
        }
        lum *= 0.88 + 0.24 * gn;
        if (gq < 30) lum *= 0.84;                                                    // dark grains, in clumps
        let spk = 0;
        if (fk > 0.15 && lam > 0.75 && gq > 96 && !flat) {                            // white flecks: only on pale crust and veins, on lit faces
          const g1 = GR[(((y * 2 + 91) & TM) << 8) | ((x * 2 + 37) & TM)], cutv = 252 - 10 * fk;
          if (g1 > cutv) spk = (36 + (g1 - cutv) * 7) * (1 - 0.7 * z);
        }
        if (we > 0) {                                                                // the floor of the window: dark, in the shade of its upper and left wall
          const tone = 0.8 + 0.4 * gn, dx = x - wx0, dy = y - wy0, sd = dx < dy ? dx : dy;
          cr += (wc[0] * tone - cr) * we; cg += (wc[1] * tone - cg) * we; cb += (wc[2] * tone - cb) * we;
          if (sd < 6) lum *= 1 - we * 0.45 * (1 - (sd > 0 ? sd : 0) / 6);
          spk *= 1 - we; sheen *= 1 - we;
        }
        const add = spk + sheen, r = cr * lum + add, g = cg * lum + add, b = cb * lum + add;
        D32[k] = ((a * fade * 255) << 24) | (((b > 255 ? 255 : b) & 252) << 16) | (((g > 255 ? 255 : g) & 252) << 8) | ((r > 255 ? 255 : r) & 252);   // 6-bit colour: the grain hides it, the picture gets smaller
      }
    }

    // the side: below every lower edge of the top, swept down by the thickness - dark rock with upright
    // streaks, no veins, no highlights
    if (d > 0 && !tile && win[3] > fh) {
      const dp = Math.max(1, Math.round(d * s)), j0 = panel ? Math.max(2, Math.floor((fh - 9 - y0) * s)) : 2;
      const sr = col[0] * 0.7 + col[3] * 0.3, sg = col[1] * 0.7 + col[4] * 0.3, sb = col[2] * 0.7 + col[5] * 0.3;
      for (let j = j0; j < H - 1; j++) {
        const y = (j + 0.5) / s + y0;
        for (let i = 1; i < W - 1; i++) {
          const k = j * W + i, a = al[k];
          if (a >= 1) continue;
          let mx = 0, q = 1;
          for (; q <= dp && q <= j; q++) { const v = al[k - q * W]; if (v > mx) { mx = v; if (v >= 1) break; } }
          if (mx <= 0) continue;
          const x = (i + 0.5) / s + x0;
          const lum = 0.5 * (1 - 0.5 * q / dp) * (0.55 + 0.6 * NA[(((y * 0.7 + 300) & TM) << 8) | ((x * 4 + 300) & TM)] + 0.3 * NA[(((y * 2 + 80) & TM) << 8) | ((x * 0.6 + 500) & TM)]);
          const p = k * 4, fa = D[p + 3] / 255, oa = fa + mx * (1 - fa), f = oa > 0 ? fa / oa : 0;
          D[p] = D[p] * f + sr * lum * (1 - f); D[p + 1] = D[p + 1] * f + sg * lum * (1 - f); D[p + 2] = D[p + 2] * f + sb * lum * (1 - f); D[p + 3] = oa * 255;
        }
      }
    }
    // a soft shadow on the ground, a little below the stone (two box blurs of its silhouette)
    if (shadow) {
      const r = Math.max(1, Math.round(2.2 * s)), off = Math.round(2.5 * s), k1 = 1 / (2 * r + 1), A = new Float32Array(n), B = new Float32Array(n);
      for (let j = 0; j < H; j++) {
        const row = j * W;
        let sum = 0;
        for (let i = 0; i < W + r; i++) {
          if (i < W) sum += D[(row + i) * 4 + 3];
          if (i - 2 * r - 1 >= 0) sum -= D[(row + i - 2 * r - 1) * 4 + 3];
          if (i >= r) A[row + i - r] = sum * k1;
        }
      }
      for (let i = 0; i < W; i++) {
        let sum = 0;
        for (let j = 0; j < H + r; j++) {
          if (j < H) sum += A[j * W + i];
          if (j - 2 * r - 1 >= 0) sum -= A[(j - 2 * r - 1) * W + i];
          if (j >= r) B[(j - r) * W + i] = sum * k1;
        }
      }
      for (let j = off; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const k = j * W + i, p = k * 4, fa = D[p + 3] / 255;
          if (fa >= 1) continue;
          const sh = B[k - off * W] * 0.0031;                                         // up to 0.8
          if (sh < 0.01) continue;
          const oa = fa + sh * (1 - fa), f = fa / oa;
          D[p] *= f; D[p + 1] *= f; D[p + 2] *= f; D[p + 3] = oa * 255;
        }
      }
    }
    fg.putImageData(img, 0, 0);
    return face;
  }

  // The outline of a dialog slab, drawn in by `ins` px, as a CSS polygon (the chips are left out: none of them
  // bites deeper than the rim that covers this edge).
  function insetPolygon(shp, ins, w, h) {
    let pts = [-9, -9, w + 9, -9, w + 9, h + 9, -9, h + 9];
    for (let k = 0; k < shp.a.length; k++) {
      const A = shp.a[k] * shp.iv[k], B = shp.b[k] * shp.iv[k], C = shp.c[k] * shp.iv[k] - ins, out = [];
      for (let i = 0; i < pts.length; i += 2) {
        const x1 = pts[i], y1 = pts[i + 1], j = (i + 2) % pts.length, x2 = pts[j], y2 = pts[j + 1];
        const v1 = A * x1 + B * y1 + C, v2 = A * x2 + B * y2 + C;
        if (v1 >= 0) out.push(x1, y1);
        if ((v1 >= 0) !== (v2 >= 0)) { const t = v1 / (v1 - v2); out.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); }
      }
      pts = out;
      if (pts.length < 6) return '';
    }
    let css = '';
    for (let i = 0; i < pts.length; i += 2) css += (i ? ', ' : '') + pts[i].toFixed(1) + 'px ' + pts[i + 1].toFixed(1) + 'px';
    return 'polygon(' + css + ')';
  }

  // ---- which element gets which stone
  const STONE_OF = {
    'kf-btn-menu': ['beige', 11], 'kf-btn-main': ['turq', 23], 'kf-btn-soft': ['deep', 37], 'kf-btn-drop': ['turq', 43],
    'kf-btn-rot': ['deep', 53], 'kf-start': ['turq', 67], 'kf-title-menu': ['dark', 71], 'kf-resume': ['turq', 89],
    'kf-again': ['turq', 89], 'kf-menu-resume': ['turq', 101], 'kf-menu-new': ['deep', 113], 'kf-menu-help': ['deep', 127],
    'kf-menu-close': ['mauve', 131], 'kf-help-back': ['mauve', 131],
  };
  const dataUrl = (cv) => 'url(' + cv.toDataURL('image/png') + ')';
  let stoneScale = 0, smallScale = 0, stoneEls = null, stoneTimer = 0, warmTimer = 0, stoneCuts = {}, stoneView = '';

  function stoneSize(el) {
    let w = 0, h = 0, d = 0, veiled = false;
    try {
      const cs = getComputedStyle(el);
      w = parseFloat(cs.width); h = parseFloat(cs.height); veiled = cs.visibility === 'hidden'; d = parseFloat(cs.getPropertyValue('--d')) || 0;
    } catch (e) { /* measured below */ }
    if (!(w > 0) || !(h > 0)) { w = el.offsetWidth; h = el.offsetHeight; }
    if (!(w >= 12) || !(h >= 12)) return null;
    return { w, h, d, veiled, key: w.toFixed(1) + 'x' + h.toFixed(1) + '/' + d + '@' + stoneScale };
  }

  // The pictures for an element of this size (cut once per kind and size, then shared): a background value,
  // for dialogs an object { face, mid, clip }.
  // only: 0..4 cuts just that piece of a dialog ahead of time (and returns nothing).
  function cutStone(el, sz, only) {
    const c = el.classList, isPanel = c.contains('kf-panel'), isStat = c.contains('kf-stat');
    const w = sz.w, h = sz.h, s = isPanel ? Math.min(stoneScale, 1.5) : stoneScale, px = (v) => (Math.round(v * 100) / 100) + 'px';
    const sp = isPanel ? ['slab', 200 + stoneEls.indexOf(el)] : isStat ? ['stat', 400 + stoneEls.indexOf(el)]
      : STONE_OF[el.id] || [c.contains('kf-btn--gold') ? 'turq' : c.contains('kf-btn--rose') ? 'mauve' : c.contains('kf-btn--ghost') ? 'dark' : 'deep', 300 + stoneEls.indexOf(el)];
    const id = sp[0] + sp[1] + ':' + sz.key;
    if (stoneCuts[id]) return stoneCuts[id];
    let css;
    if (!isPanel && only >= 0) return '';
    if (isPanel) {
      // the rim: four strips around the calm middle (they overlap a little, so no seam shows); the middle:
      // a coarse colour map of the same rock, clipped to the outline by the stylesheet
      const TH = 6, B = 24, P = 2, fh = h - TH, shp = stoneShape(w, fh, stoneRnd(sp[1]), 1, 52, 4.2);
      const o = { pal: sp[0], seed: sp[1], panel: true, d: TH, shape: shp };
      const bt = Math.max(B, 2 * Math.ceil(shp.reach[0] / 2 + 0.5)), bb = Math.max(B, 2 * Math.ceil(shp.reach[1] / 2 + 0.5));
      const yb = Math.floor((fh - bb) * s) / s, xr = Math.floor((w - B) * s) / s, yt = bt - 2, ye = Math.ceil((yb + 2) * s) / s;
      const wins = [[-P, -P, w + P, bt], [-P, yb, w + P, h + P], [-P, yt, B, ye], [xr, yt, w + P, ye], [0, 0, w, h]];
      const part = (n) => stoneCuts[id + '#' + n] || (stoneCuts[id + '#' + n] = dataUrl(n < 4
        ? (o.win = wins[n], renderStone(w, h, s, o))
        : renderStone(w, h, 0.5, { pal: sp[0], seed: sp[1], mid: true, d: TH, shape: shp, win: wins[4] })));
      if (only >= 0) { part(only); return ''; }
      const side = ' calc(100% - ' + px(yt + P + h + P - ye) + ') no-repeat';
      css = {
        face: part(0) + ' 0 0 / 100% ' + px(bt + P) + ' no-repeat, ' + part(1) + ' 0 100% / 100% ' + px(h + P - yb) + ' no-repeat, '
          + part(2) + ' 0 ' + px(yt + P) + ' / ' + px(B + P) + side + ', ' + part(3) + ' 100% ' + px(yt + P) + ' / ' + px(w + P - xr) + side,
        mid: part(4), clip: insetPolygon(shp, 9.5, w, h),
      };
      for (let n = 0; n < 5; n++) delete stoneCuts[id + '#' + n];
    } else if (isStat) {
      // a display: a small frame of rock around a dark window, 5px larger than its box all round
      css = dataUrl(renderStone(w + 10, h + 10, s, { pal: sp[0], seed: sp[1], frame: true, d: 3, well: [6.5, 6.5, 5] })) + ' 0 0 / 100% 100% no-repeat';
    } else css = dataUrl(renderStone(w, h, s, { pal: sp[0], seed: sp[1], d: sz.d })) + ' 0 0 / 100% 100% no-repeat';
    return (stoneCuts[id] = css);
  }

  // Small things every dialog shares: the grain tile of the slabs, and the switches (a groove carved into a
  // piece of rock, off and on; a pebble as knob, pale when off and turquoise when on).
  function cutSmall() {
    if (stoneScale === smallScale) return;
    smallScale = stoneScale;
    const ps = Math.min(stoneScale, 1.5), rs = document.documentElement.style;         // dialogs are calm: 1.5x is plenty
    const t = renderStone(128, 128, ps, { pal: 'slab', seed: 1, tile: true, win: [-2, -2, 130, 130] });
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(128 * ps);
    cv.getContext('2d').drawImage(t, -2 * ps, -2 * ps);
    rs.setProperty('--rock-grain', dataUrl(cv));
    const track = (seed, colr) => dataUrl(renderStone(62, 34, stoneScale, { pal: 'stat', seed, frame: true, well: [3.5, 3.5, 14], wellCol: colr, noShadow: true, win: [0, 0, 62, 34] }));
    rs.setProperty('--track-off', track(5, [7, 11, 16]));
    rs.setProperty('--track-on', track(5, [13, 74, 88]));
    rs.setProperty('--knob-off', dataUrl(renderStone(26, 26, stoneScale, { pal: 'beige', seed: 9, d: 3, plain: true })));
    rs.setProperty('--knob-on', dataUrl(renderStone(26, 26, stoneScale, { pal: 'turq', seed: 14, d: 3, plain: true })));
    document.documentElement.classList.add('kf-stones');
  }

  function makeStone(el, sz) {
    if (el._kfStone === sz.key) return;
    const isPanel = el.classList.contains('kf-panel');
    if (isPanel) cutSmall();
    const cut = cutStone(el, sz);
    if (isPanel) {
      el.style.setProperty('--st-face', cut.face);
      el.style.setProperty('--st-mid', cut.mid);
      if (cut.clip) el.style.setProperty('--st-clip', cut.clip); else el.style.removeProperty('--st-clip');
    } else el.style.setProperty('--st-face', cut);
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
          if (el.classList.contains('kf-panel')) for (let n = 0; n < 5; n++) jobs.push([el, sz, true, n]);
          jobs.push([el, sz, deep, -1]);
        }
      } catch (e) { /* nothing to warm */ }
      for (const el of hid) { el.style.visibility = ''; el.hidden = true; }
    };
    measure(false); measure(true);
    jobs.unshift(null);                                                    // first of all the grain tile and the switches
    const step = () => {
      if (!jobs.length) return;
      // never cut stones while a game is in play: every cut costs a frame or two
      const app = KF.App, g = app && app.game;
      if (g && g.gameRunning && !g.paused) { warmTimer = setTimeout(step, 500); return; }
      const job = jobs.shift();
      try {
        if (!job) cutSmall();
        else if (job[2]) cutStone(job[0], job[1], job[3]);
        else {
          // the size was measured when the warm-up began: do not put a stone of that size on an element
          // that is on screen with another size by now (an open menu that grew a button)
          const now = stoneSize(job[0]);
          if (!now || now.key === job[1].key) makeStone(job[0], job[1]);
        }
      } catch (e) { /* this one stays a plain slab */ }
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
      stoneEls = Array.prototype.slice.call(document.querySelectorAll('.kf-btn, .kf-panel, .kf-stat'));
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
    dprCap: 2,              // crystals are shaded per pixel: beyond 2x that costs far more than it shows
    popup: { ink: 'rgba(6,4,2,0.92)', gold: '#ffd98a', ice: '#f3ecdc', weight: '700' },
    drawFrame,
    drawLogo,
    onLayout,
    stones: { render: renderStone, recut: () => { stoneCuts = {}; smallScale = 0; cutSmall(); for (const el of stoneEls) el._kfStone = ''; sweepStones(true); }, list: () => stoneEls },   // for tests
  };
})(globalThis.KF = globalThis.KF || {});
