// Crystal Drop – realistic skin: material textures for the UI, the carved-stone playfield frame and the
// metal title lettering. Loaded before game.js; game.js picks these overrides up through KF.Skin.
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
    const out = new Float32Array(size * size), rnd = mulberry32(seed), grids = [];
    for (let o = 0, n = cells; o < octaves; o++, n *= 2) {
      const a = new Float32Array(n * n);
      for (let i = 0; i < a.length; i++) a[i] = rnd();
      grids.push({ n, a });
    }
    let lo = 1, hi = 0;
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
          sum += amp; amp *= 0.5;
        }
        v /= sum;
        out[y * size + x] = v;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
    }
    const span = Math.max(1e-6, hi - lo);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / span;
    return out;
  }

  const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

  // A tile of natural rock: rough, lit from the top-left, speckled with mineral grains and fine cracks,
  // with coloured crystal inclusions (veins and pockets) grown into it.
  //   rock: base colour [r,g,b]; inc: inclusion colour [r,g,b]; amount: 0..1 how much vein shows;
  //   pockets: 0..1 size of the crystal nests (0 = veins only)
  function rockTexture(size, seed, rock, inc, amount, pockets) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const img = g.createImageData(size, size), d = img.data;
    const H = fbmField(size, 5, 6, seed);            // relief
    const B = fbmField(size, 3, 3, seed + 11);       // broad colour blotches
    const V = fbmField(size, 4, 4, seed + 23);       // veins
    const P = fbmField(size, 6, 3, seed + 37);       // pockets
    const K = fbmField(size, 7, 4, seed + 51);       // cracks
    const grain = mulberry32(seed + 77);
    const at = (F, x, y) => F[((y + size) % size) * size + ((x + size) % size)];
    const L = [-0.52, -0.62, 0.59];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const h = at(H, x, y);
        // surface normal from the relief, then diffuse light with a little gloss on the high spots
        const nx = (at(H, x - 1, y) - at(H, x + 1, y)) * 7, ny = (at(H, x, y - 1) - at(H, x, y + 1)) * 7;
        const nl = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        const diff = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) * nl);
        let lum = (0.5 + 0.55 * h) * (0.42 + 0.95 * diff) * (0.84 + 0.32 * at(B, x, y));
        const gr = grain();
        if (gr > 0.93) lum *= 1.32; else if (gr < 0.1) lum *= 0.66;      // feldspar and mica grains
        const crack = Math.abs(at(K, x, y) - 0.5);
        if (crack < 0.012) lum *= 0.45 + crack * 30;                        // hairline cracks
        let r = rock[0] * lum, gg = rock[1] * lum, b = rock[2] * lum;

        // inclusions: thin winding veins plus a few crystal nests. Inside they are crystalline: small
        // facets catch the light differently, the middle is deep and saturated, the seam to the rock dark.
        const vein = smooth(0.955 - 0.03 * amount, 0.992, 1 - Math.abs(at(V, x, y) * 2 - 1));
        const pocket = pockets > 0 ? smooth(0.9 - 0.14 * pockets, 0.95 - 0.1 * pockets, at(P, x, y)) : 0;
        const m = Math.max(vein, pocket);
        if (m > 0.01) {
          const f1 = at(H, (x * 4) % size, (y * 4) % size), f2 = at(B, (x * 7 + 31) % size, (y * 7 + 17) % size);
          const facet = 0.45 + 1.1 * Math.abs(f1 - f2);                       // angular light/dark patches
          const depth = 0.55 + 0.6 * m;                                       // deeper colour towards the middle
          const spec = Math.pow(diff, 6) * 150 * m + (grain() > 0.975 ? 120 : 0);   // gloss and tiny glints
          const cr = Math.min(255, inc[0] * facet * depth + spec);
          const cg = Math.min(255, inc[1] * facet * depth + spec);
          const cb = Math.min(255, inc[2] * facet * depth + spec);
          const seam = m < 0.35 ? 0.5 + m : 1;                                // dark seam where crystal meets rock
          const k = Math.min(1, m * 1.3);
          r = (r * (1 - k) + cr * k) * seam; gg = (gg * (1 - k) + cg * k) * seam; b = (b * (1 - k) + cb * k) * seam;
        }
        const i = (y * size + x) * 4;
        d[i] = Math.min(255, r); d[i + 1] = Math.min(255, gg); d[i + 2] = Math.min(255, b); d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  let stone = null, fine = null;
  try {
    stone = noiseCanvas(160, 6, 5, 4107, 1.9);     // mottled rock (frame)
    fine = noiseCanvas(96, 12, 3, 991, 1.5);       // fine grain for metal
    const rootStyle = document.documentElement.style;
    const url = (cv) => 'url(' + cv.toDataURL('image/png') + ')';
    rootStyle.setProperty('--tex-stone', url(stone));
    rootStyle.setProperty('--tex-fine', url(fine));
    // rock with coloured inclusions, one tile per button kind (and a plain slab for the dialogs)
    rootStyle.setProperty('--rock-blue', url(rockTexture(192, 301, [128, 132, 140], [60, 150, 250], 0.8, 0.55)));
    rootStyle.setProperty('--rock-gold', url(rockTexture(192, 512, [136, 124, 108], [255, 170, 40], 0.9, 0.5)));
    rootStyle.setProperty('--rock-rose', url(rockTexture(192, 733, [132, 118, 118], [250, 95, 140], 0.8, 0.5)));
    rootStyle.setProperty('--rock-ghost', url(rockTexture(192, 944, [100, 100, 104], [205, 214, 230], 0.4, 0.3)));
    rootStyle.setProperty('--rock-slab', url(rockTexture(224, 1175, [104, 100, 95], [190, 195, 205], 0.1, 0)));
  } catch (e) { stone = fine = null; }

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
  };
})(globalThis.KF = globalThis.KF || {});
