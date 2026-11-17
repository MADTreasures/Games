// Kristallfall - crystal renderer ("fused" look) and shatter effect.
//
// Every tetromino reads as ONE chunk of cartoon rock crystal. Cells of the same piece are fused: no inner
// outlines, a bold tinted outline around the silhouette, chipped corners, and a ridged-prism facet model
// whose ridges, hips and valleys run straight through the joints. Cleared rows crack along seeded shard
// polygons and then shatter into exactly those shards.
//
// Classic script, Canvas 2D only, no assets, no clocks, no Math.random.
// Public API: KF.Crystal = { id, palette, drawCells, createFx, invalidate }.
(function (KF) {
  'use strict';

  /* ------------------------------------------------------------------------------------------------ *
   * Palette - seven quartz varieties. Tones run from specular to outline; all types share the same
   * value structure so they read as one mineral family.
   * ------------------------------------------------------------------------------------------------ */
  const palette = {
    I: { name: 'Bergkristall', hi: '#ffffff', pale: '#f3faff', light: '#dcedfb', mid: '#bcd6ee', deep: '#93b5d9', shade: '#7094c2', line: '#3a5687' },
    O: { name: 'Rosenquarz',   hi: '#fff5f9', pale: '#ffe1ec', light: '#ffc2d8', mid: '#ff9bbf', deep: '#ec6c9d', shade: '#d04f87', line: '#8a2a5c' },
    T: { name: 'Citrin',       hi: '#fffbe6', pale: '#fff3ba', light: '#ffe57c', mid: '#ffcf3e', deep: '#f0a41c', shade: '#d6860f', line: '#87540a' },
    S: { name: 'Blauquarz',    hi: '#eef7ff', pale: '#c6e3ff', light: '#8fc5ff', mid: '#4f9cf5', deep: '#2e72dc', shade: '#2259bf', line: '#16347e' },
    Z: { name: 'Amethyst',     hi: '#f8f0ff', pale: '#ead8ff', light: '#d1abff', mid: '#b07af2', deep: '#894fdc', shade: '#6f3ec1', line: '#42207d' },
    J: { name: 'Prasiolith',   hi: '#f1fff8', pale: '#d2fbe7', light: '#9ff0cc', mid: '#60dba9', deep: '#2eb487', shade: '#1e9872', line: '#0e5d4a' },
    L: { name: 'Karneol',      hi: '#fff1e5', pale: '#ffd9bf', light: '#ffb180', mid: '#ff8746', deep: '#e45e23', shade: '#c64917', line: '#822b0d' },
  };
  const TYPE_INDEX = { I: 0, O: 1, T: 2, S: 3, Z: 4, J: 5, L: 6 };
  const PALS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map(function (k) {
    const p = palette[k];
    p.glow = mix(p.mid, p.light, 0.5);   // lit side facets, inner bounce light
    p.core = mix(p.mid, p.deep, 0.45);   // facets facing away from the light
    return p;
  });
  const O_INDEX = 1;

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
  const PAD = 2;             // transparent border around a sprite (device px): 1 px joint overlap + AA
  const SPRITE_BUDGET = 6e6; // sprite cache cap in pixels (~24 MB); the cache is dropped when it is exceeded
  const K = {                // fractions of the cell edge
    margin: 0.02,            // gap between silhouette and cell boundary on outer edges
    line: 0.07,              // outline width
    // Sawtooth nick the outline dips into at every joint (keeps the cells of a fused chunk countable):
    // depth, and the length of its slope at the start / end of an edge (clockwise).
    pinch: 0.045, pinchStart: 0.13, pinchEnd: 0.04,
    rim: 0.06,               // shade rim on bottom / right outer edges
    ridgeX: 0.40, ridgeY: 0.38,   // ridge position inside an arm (off-centre: lit facets are narrower)
    stripA: 0.30, stripB: 0.50,   // reflection streak crossing every joint (x + y between A and B) ...
    glintA: 0.56, glintB: 0.62,   // ... and its thinner companion
  };
  // Everything that touches an open edge (joint) must look identical in every sprite, whatever its
  // variant: outline inset, rim widths, ridge position and the reflection streaks are therefore constants;
  // seeded variation is confined to the inside of a cell and to its outer edges.

  const STAR = { x: 0.27, y: 0.25 };          // star sparkle position on a chunk's top-left corner cell
  function starRadius(variant) { return 0.15 + variant * 0.013; }
  function starPath(ctx, x, y, R) {            // four-pointed star, appended to the current path
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
      m: Math.round(S * K.margin), w: Math.max(1, Math.round(S * K.line)),
      pinch: S * K.pinch, pinchStart: S * K.pinchStart, pinchEnd: S * K.pinchEnd,
      // Two open edges meeting at a corner leave a concave notch - except in the O piece, the only
      // tetromino that contains a filled 2x2 (conn carries no diagonal information).
      concave: ti !== O_INDEX,
      ext: ghost ? 0 : 1,                    // overlap across joints so fused cells never show a seam
    };
  }

  // Chamfer legs after offsetting the silhouette inwards by `ins` (keeps the outline width constant).
  function chamfer(c, ins) {
    if (!ins) return c;
    const L = Math.hypot(c[0], c[1]);
    return [Math.max(0, c[0] + ins * (L - c[0]) / c[1] - ins), Math.max(0, c[1] + ins * (L - c[1]) / c[0] - ins)];
  }

  // Closed polygon of the cell silhouette, inset by `ins` on outer edges (0 = silhouette, w = body).
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
   * Sprite baking
   * ------------------------------------------------------------------------------------------------ */
  const sprites = new Map();
  let spritePixels = 0;

  // Cell sprite for type index / conn mask / facet variant, baked at px device pixels (plus PAD).
  function getSprite(ti, conn, variant, px, ghost) {
    const key = ((((px * 2 + (ghost ? 1 : 0)) * 7 + ti) * 16 + conn) * VARIANTS) + variant;
    let cv = sprites.get(key);
    if (!cv) {
      const side = px + PAD * 2;
      if (spritePixels + side * side > SPRITE_BUDGET && sprites.size > 64) { sprites.clear(); spritePixels = 0; }
      spritePixels += side * side;
      cv = document.createElement('canvas');
      cv.width = cv.height = side;
      const g = cv.getContext('2d');
      g.translate(PAD, PAD);
      const geo = makeGeo(ti, conn, variant, px, ghost);
      if (ghost) bakeGhost(g, geo, PALS[ti]); else bakeBody(g, geo, PALS[ti]);
      sprites.set(key, cv);
    }
    return cv;
  }

  function bakeBody(g, geo, pal) {
    const S = geo.S, cl = geo.closed, rnd = geo.rnd;
    const I = geo.m + geo.w;                       // depth where the body starts on an outer edge
    const J = I + geo.pinch;                       // ... and where it starts at a joint
    const X = geo.ext + 1;                         // generous overdraw; the clip trims it
    const hl = Math.max(1, Math.round(S * 0.035)); // crisp highlight line on lit edges
    const rimW = Math.max(1, S * K.rim);           // shade rim on bottom / right edges
    const cu = geo.center, C = [cu[0] * S, cu[1] * S];
    const depth = [C[1], S - C[0], S - C[1], C[0]];             // edge -> ridge distance per side
    // Tones per facet orientation (N, E, S, W); light comes from the top-left.
    const planeTone = [pal.light, pal.core, pal.mid, pal.glow];
    const stepTone = [pal.pale, pal.deep, pal.glow, pal.light];  // seeded secondary facets
    const rimTone = [pal.hi, pal.shade, pal.deep, pal.hi];
    const kiteTone = [pal.hi, pal.light, pal.shade, pal.deep];   // chipped corners NW, NE, SE, SW
    const poly = function (k, pts, color) {
      fillPoly(g, pts.map(function (p) { return mapPt(S, k, p[0], p[1]); }), color);
    };
    // Region u1 <= (x + y) / S <= u2: a plane running bottom-left to top-right.
    const strip = function (u1, u2, color) {
      const c1 = u1 * S, c2 = u2 * S, B = S * 2;
      fillPoly(g, [[c1 + B, -B], [c2 + B, -B], [-B, c2 + B], [-B, c1 + B]], color);
    };
    // 1) silhouette in the outline colour, then everything else clipped to the body
    fillPoly(g, ring(geo, 0), pal.line);
    g.save();
    tracePoly(g, ring(geo, geo.w));
    g.clip();

    // 2) Roof facets. The chunk is modelled as a ridged prism (the straight skeleton of the piece):
    //    every point belongs to the outer edge of the piece that reaches it first. Inside one cell all
    //    facet borders lie on a fan of eight triangles around the ridge junction C, so it is enough to
    //    classify those octants. An open edge contributes no plane of its own; at a concave corner the
    //    outer edges of the two neighbouring arms reach into the cell instead (the larger of the two
    //    distances wins there). That makes ridges, hips and valleys continue seamlessly across joints.
    const B = [[0, 0], [cu[0], 0], [1, 0], [1, cu[1]], [1, 1], [cu[0], 1], [0, 1], [0, cu[1]]];
    const plane = [];
    for (let i = 0; i < 8; i++) {
      const q = B[i], r = B[(i + 1) & 7];
      const x = (cu[0] + q[0] + r[0]) / 3, y = (cu[1] + q[1] + r[1]) / 3;
      const h = [y / cu[1], (1 - x) / (1 - cu[0]), (1 - y) / (1 - cu[1]), x / cu[0]];
      let best = 2, bh = Infinity;
      for (let k = 0; k < 4; k++) {
        const kp = (k + 3) & 3;
        let s = -1;
        if (cl[k]) s = k;
        else if (!cl[kp] && geo.concave) s = h[k] > h[kp] ? k : kp;   // reflex corner between kp and k
        if (s >= 0 && h[s] < bh) { bh = h[s]; best = s; }
      }
      plane.push(best);
    }
    const Bp = B.map(function (p) { return [C[0] + (p[0] * S - C[0]) * 1.2, C[1] + (p[1] * S - C[1]) * 1.2]; });
    // polygon of the run of equal-plane octants that contains octant `i`
    const runPoly = function (i) {
      let a = i, b = i, n = 1;
      while (n < 8 && plane[(a + 7) & 7] === plane[i]) { a = (a + 7) & 7; n++; }
      while (n < 8 && plane[(b + 1) & 7] === plane[i]) { b = (b + 1) & 7; n++; }
      if (n === 8) return [[-S, -S], [2 * S, -S], [2 * S, 2 * S], [-S, 2 * S]];
      const pts = [C];
      for (let j = 0; j <= n; j++) pts.push(Bp[(a + j) & 7]);
      return pts;
    };
    for (let i = 0; i < 8; i++) {
      if (plane[(i + 7) & 7] !== plane[i] || (i === 0 && plane.every(function (p) { return p === plane[0]; }))) {
        fillPoly(g, runPoly(i), planeTone[plane[i]]);
      }
    }

    // 3) outer edges: one seeded secondary facet per edge (wedge or slanted growth step) and the rim
    const edgeFacets = function (k) {
      const D = depth[k];
      g.save();
      tracePoly(g, runPoly(k * 2));
      g.clip();
      const p1 = S * (0.2 + rnd() * 0.2), p2 = S * (0.56 + rnd() * 0.24);
      if (rnd() < 0.5) {
        const q = p1 + (p2 - p1) * (0.25 + rnd() * 0.5);
        poly(k, [[p1, 0], [q, I + (D - I) * (0.5 + rnd() * 0.4)], [p2, 0]], stepTone[k]);
      } else {
        const s1 = S * (rnd() - 0.5) * 0.3, s2 = S * (rnd() - 0.5) * 0.3;
        poly(k, [[p1 + s1, 0], [p2 + s2, 0], [p2, D + 2], [p1, D + 2]], stepTone[k]);
      }
      // rim: stroke the body boundary of this edge; the outer half of the stroke falls outside the clip
      const kn = (k + 1) & 3, line = [];
      if (cl[(k + 3) & 3]) line.push([I + chamfer(geo.ch[k], geo.w)[0], I]);
      else line.push([-X, J], [0, J], [geo.pinchStart, I]);
      if (cl[kn]) line.push([S - I - chamfer(geo.ch[kn], geo.w)[1], I]);
      else line.push([S - geo.pinchEnd, I], [S, J], [S + X, J]);
      g.beginPath();
      line.forEach(function (p, n) { const q = mapPt(S, k, p[0], p[1]); if (n) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
      g.strokeStyle = rimTone[k];
      g.lineWidth = 2 * (k === 1 || k === 2 ? rimW : hl);
      g.stroke();
      g.restore();
    };
    [2, 1, 3, 0].forEach(function (k) { if (cl[k]) edgeFacets(k); });

    // 3b) Corner with two joints but no notch = the middle of a 2x2 block: the rectangle between C and
    //     that corner is this cell's quarter of the block's flat ridge facet.
    const tables = [null, null, null, null];
    for (let k = 0; k < 4; k++) {
      if (cl[k] || cl[(k + 3) & 3] || geo.concave) continue;
      const tx = k === 0 || k === 3 ? C[0] : S - C[0], ty = k < 2 ? C[1] : S - C[1];   // extent towards C
      const a = k & 1 ? ty : tx, d = k & 1 ? tx : ty;
      poly(k, [[-X, -X], [a, -X], [a, d], [-X, d]], pal.pale);
      tables[k] = [mapPt(S, k, a, -X), mapPt(S, k, a, d), mapPt(S, k, -X, d)];
    }

    // 4) reflection planes that bridge joints: they cross every open edge at the same height
    const upperLeft = !cl[3] || !cl[0], lowerRight = !cl[1] || !cl[2];
    g.globalAlpha = 0.33;
    if (upperLeft) { strip(K.stripA, K.stripB, '#ffffff'); strip(K.glintA, K.glintB, '#ffffff'); }
    if (lowerRight) { strip(1 + K.stripA, 1 + K.stripB, '#ffffff'); strip(1 + K.glintA, 1 + K.glintB, '#ffffff'); }
    g.globalAlpha = 1;

    // 5) ridge lines along facet borders
    g.strokeStyle = pal.pale;
    g.lineWidth = Math.max(1, S * 0.028);
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      if (!(i & 1) && tables[i >> 1]) continue;                  // no hip line across a table
      if (plane[(i + 7) & 7] !== plane[i]) { g.moveTo(C[0], C[1]); g.lineTo(Bp[i][0], Bp[i][1]); }
    }
    tables.forEach(function (t) {
      if (t) { g.moveTo(t[0][0], t[0][1]); g.lineTo(t[1][0], t[1][1]); g.lineTo(t[2][0], t[2][1]); }
    });
    g.stroke();

    // 6) corners: chipped termination facet on convex corners, rim turning the corner on concave ones
    for (let k = 0; k < 4; k++) {
      const kp = (k + 3) & 3;
      if (cl[kp] && cl[k]) {
        const c = chamfer(geo.ch[k], geo.w), corner = mapPt(S, k, 0, 0);
        const f1 = S * (0.04 + rnd() * 0.08), f2 = S * (0.04 + rnd() * 0.08);
        const lam = 0.1 + (geo.ch[k][0] + geo.ch[k][1]) / S * (0.9 + rnd() * 0.5);
        const Q = [corner[0] + (C[0] - corner[0]) * lam, corner[1] + (C[1] - corner[1]) * lam];
        const pA = mapPt(S, k, I, I + c[1] + f2), pB = mapPt(S, k, I + c[0] + f1, I);
        fillPoly(g, [pA, mapPt(S, k, -X, I + c[1] + f2), mapPt(S, k, -X, -X), mapPt(S, k, I + c[0] + f1, -X), pB, Q], kiteTone[k]);
        g.beginPath(); g.moveTo(pA[0], pA[1]); g.lineTo(Q[0], Q[1]); g.lineTo(pB[0], pB[1]); g.stroke();
      } else if (!cl[kp] && !cl[k] && geo.concave) {
        const wk = k === 1 || k === 2 ? rimW : hl, wp = kp === 1 || kp === 2 ? rimW : hl;
        poly(k, [[-X, J], [J, J], [J + wk, J + wk], [-X, J + wk]], rimTone[k]);
        poly(k, [[J, -X], [J, J], [J + wp, J + wp], [J + wp, -X]], rimTone[kp]);
      }
    }

    g.restore();

    // 7) one star sparkle per chunk, on its lit top-left corner (drawCells animates a twinkle on top)
    if (cl[3] && cl[0]) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      starPath(g, S * STAR.x, S * STAR.y, S * starRadius(geo.variant));
      g.fill();
    }
  }

  // Landing preview sprite: a white LIGHT MAP of the crystal (a soft body, slightly brighter on the lit
  // facets) inside a bright contour. drawShimmer() colours and animates these maps as shimmering light.
  function bakeGhost(g, geo, pal) {
    const S = geo.S, side = S + PAD * 2, wg = Math.max(1, Math.round(S * 0.05));
    bakeBody(g, geo, pal);
    const img = g.getImageData(0, 0, side, side), d = img.data;
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
      const k = l < 0.35 ? 0 : (l - 0.35) / 0.65;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(d[i + 3] * (0.2 + 0.2 * k * k));
    }
    g.putImageData(img, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.9;
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

  // Crack overlay of one pattern at growth step `level` (1..CRACK_LEVELS): white jagged lines with a
  // dark casing (so they also read on the pale crystals) and a small white impact chip.
  const crackSprites = new Map();

  function crackSprite(seed, level, px) {
    const id = (seed >>> 0) % FRACTURE_PATTERNS, key = (px * FRACTURE_PATTERNS + id) * 8 + level;
    let cv = crackSprites.get(key);
    if (cv) return cv;
    if (crackSprites.size >= 320) crackSprites.clear();
    cv = document.createElement('canvas');
    cv.width = cv.height = px + PAD * 2;
    const g = cv.getContext('2d'), f = fracture(id), grow = level / CRACK_LEVELS, S = px;
    g.translate(PAD, PAD);
    g.lineCap = g.lineJoin = 'round';
    const trace = function () {
      g.beginPath();
      for (let i = 0; i < f.rays.length; i++) {
        const r = f.rays[i], u = (grow - r.at) / 0.5;             // 0..1 along this crack
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
    trace(); g.strokeStyle = 'rgba(16,30,72,0.62)'; g.lineWidth = Math.max(2, S * 0.115); g.stroke();
    trace(); g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, S * 0.046); g.stroke();
    g.fillStyle = '#ffffff';                                      // impact chip between the crack roots
    g.beginPath();
    const chip = 0.12 + 0.2 * Math.min(1, grow * 1.5);
    for (let i = 0; i < f.rays.length; i++) {
      const r = f.rays[i], k = grow > r.at ? chip : chip * 0.35;
      g.lineTo((f.px + (r.kx - f.px) * k) * S, (f.py + (r.ky - f.py) * k) * S);
    }
    g.fill();
    crackSprites.set(key, cv);
    return cv;
  }

  /* ------------------------------------------------------------------------------------------------ *
   * drawCells
   * ------------------------------------------------------------------------------------------------ */
  // Big groups that hold still (the settled board) are flattened into one layer canvas, so a static
  // board costs a single blit per frame instead of one per cell. Cracks and twinkles stay per frame.
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
    const w = x1 - x0 + px + PAD * 2, hh = y1 - y0 + px + PAD * 2;
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
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const sp = getSprite(TYPE_INDEX[c.type] | 0, c.conn & 15, ((c.seed >>> 0) >>> 7) % VARIANTS, px, false);
      g.drawImage(sp, Math.round(c.x * dpr) - x0, Math.round(c.y * dpr) - y0);
    }
    L.x = x0 - PAD; L.y = y0 - PAD; L.w = w; L.h = hh;
    return L;
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Landing preview as shimmering light: the crystal's shape glows in drifting rainbow colours, bright
   * reflections sweep across it, the rim has a soft halo and small sparkles flicker inside. Everything is
   * additive light - it never looks like a solid block.
   * ------------------------------------------------------------------------------------------------ */
  const SPECTRUM_CSS = ['rgb(255,77,109)', 'rgb(255,159,67)', 'rgb(255,230,109)', 'rgb(92,255,157)', 'rgb(77,216,255)', 'rgb(91,124,255)', 'rgb(199,125,255)'];
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
      mg.drawImage(sp, Math.round(c.x * dpr) - x0 + m - PAD, Math.round(c.y * dpr) - y0 + m - PAD);
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

    // 3) shimmer: soft bright reflections sweeping diagonally through the light (only where there is light)
    tg.globalCompositeOperation = 'source-atop';
    const bw = px * 0.5, travel = w + h + bw * 4;
    const band = function (pos, width, a) {                     // the strip pos <= x + y <= pos + width
      tg.fillStyle = 'rgba(255,255,255,' + a + ')';
      tg.beginPath();
      tg.moveTo(pos, 0); tg.lineTo(pos + width, 0); tg.lineTo(pos + width - h, h); tg.lineTo(pos - h, h);
      tg.closePath();
      tg.fill();
    };
    for (let k = 0; k < 2; k++) {
      const pos = (((t / (1700 + k * 900)) + k * 0.47) % 1) * travel - bw * 2;
      band(pos - bw * 0.6, bw * 0.6, 0.18);
      band(pos, bw, 0.5);
      band(pos + bw, bw * 0.6, 0.18);
    }
    tg.globalCompositeOperation = 'source-over';

    // 4) put the light on the board: soft halo first, then the body, gently pulsing
    const dx = (x0 - m) * inv, dy = (y0 - m) * inv, dw = w * inv, dh = h * inv;
    const pulse = 0.8 + 0.2 * Math.sin(t / 300);
    ctx.globalCompositeOperation = 'lighter';
    const r = size * 0.075;
    ctx.globalAlpha = alpha * 0.1 * pulse;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.drawImage(prismTint, 0, 0, w, h, dx + Math.cos(a) * r, dy + Math.sin(a) * r, dw, dh);
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(prismTint, 0, 0, w, h, dx, dy, dw, dh);
    ctx.globalAlpha = alpha * 0.55 * pulse;
    ctx.drawImage(prismTint, 0, 0, w, h, dx, dy, dw, dh);

    // 5) sparkles flickering at changing spots inside the shape
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], seed = c.seed >>> 0;
      const per = 620 + seed % 560, tt = t + seed % per;
      const f = (tt % per) / per, spot = hash32(seed, Math.floor(tt / per));
      const R = size * (0.11 + ((spot >>> 16) & 7) * 0.012) * Math.sin(f * Math.PI);
      if (R < 0.5) continue;
      starPath(ctx, c.x + size * (0.18 + (spot & 255) / 255 * 0.64), c.y + size * (0.18 + ((spot >>> 8) & 255) / 255 * 0.64), R);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
    const pad = PAD * inv, dw = (px + PAD * 2) * inv;
    let cracked = null, twinkles = null;

    if (ghost) {                                   // landing preview: shimmering light, see drawShimmer
      const ga = alpha * ctx.globalAlpha;
      ctx.save();
      drawShimmer(ctx, cells, size, px, dpr, ga, t);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha *= alpha;
    const big = cells.length >= LAYER_MIN_CELLS, sheer = alpha < 1 && cells.length > 1;
    const layer = !ghost && (big || sheer) ? groupLayer(cells, px, dpr, big, sheer) : null;
    if (layer) ctx.drawImage(layer.cv, 0, 0, layer.w, layer.h, layer.x * inv, layer.y * inv, layer.w * inv, layer.h * inv);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], conn = c.conn & 15, seed = c.seed >>> 0;
      if (!layer) {
        const sp = getSprite(TYPE_INDEX[c.type] | 0, conn, (seed >>> 7) % VARIANTS, px, ghost);
        // snap to device pixels: crisp blit and gap-free joints
        ctx.drawImage(sp, Math.round(c.x * dpr) * inv - pad, Math.round(c.y * dpr) * inv - pad, dw, dw);
      }
      if (ghost) continue;
      if (c.crack > 0) (cracked || (cracked = [])).push(c);
      if (!(conn & 9)) {
        // the baked star of this chunk twinkles now and then, out of phase with the others (seed)
        const period = 2600 + seed % 1900, ph = ((t + (seed >>> 3) % period) % period) / 520;
        if (ph < 1) (twinkles || (twinkles = [])).push(c.x, c.y, starRadius((seed >>> 7) % VARIANTS) * (1 + 0.6 * Math.sin(ph * Math.PI)));
      }
    }
    if (cracked) drawCracks(ctx, cracked, size, px, dpr, alpha);
    if (twinkles) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      for (let i = 0; i < twinkles.length; i += 3) starPath(ctx, twinkles[i] + size * STAR.x, twinkles[i + 1] + size * STAR.y, twinkles[i + 2] * size);
      ctx.fill();
    }
    ctx.restore();
  }

  // Fracture overlay for cells with crack > 0: the blocks brighten and baked crack patterns grow step
  // by step; the fracture sweeps outwards from the middle of the cracking group.
  function drawCracks(ctx, list, size, px, dpr, alpha) {
    const inv = 1 / dpr, pad = PAD * inv, dw = (px + PAD * 2) * inv, n = list.length;
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
        const dx = Math.round(c.x * dpr) * inv - pad, dy = Math.round(c.y * dpr) * inv - pad;
        if (pass) ctx.drawImage(crackSprite(seed, Math.max(1, Math.ceil(k * CRACK_LEVELS)), px), dx, dy, dw, dw);
        else {
          ctx.globalAlpha = alpha * 0.26 * k;
          ctx.drawImage(getSprite(TYPE_INDEX[c.type] | 0, c.conn & 15, (seed >>> 7) % VARIANTS, px, false), dx, dy, dw, dw);
        }
      }
    }
  }

  /* ------------------------------------------------------------------------------------------------ *
   * Effects: shatter (shards, glitter dust, star glints, row flash) and lock sparkle
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
      // The polygon budget per burst is roughly constant: one row breaks into fine, outlined shards;
      // two rows keep the outline; three and four rows trade it for sheer numbers (four rows also
      // leave the small concentric splinters fused to their wedge).
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
            n: n, loc: loc, w: new Float32Array(n * 2), s: s, tone: 0, k: 1, rim: rich,
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
        if (rnd() < 0.12 + 0.02 * rows) {                         // a few star glints popping along the rows
          addStar(c.x + rnd() * s, c.y + rnd() * s, s * (0.26 + rnd() * 0.2 + 0.04 * rows), 220 + rnd() * 160, rnd() * 110);
        }
      }
    }

    // Subtle twinkle when a piece locks: a star on each chunk's lit corner plus a few rising motes.
    function sparkle(cells) {
      if (!cells || !cells.length) return;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i], s = c.size;
        if (!(s > 0)) continue;
        const rnd = mulberry32((c.seed >>> 0) ^ 0x7A11CE);
        if (!(c.conn & 9)) addStar(c.x + s * STAR.x, c.y + s * STAR.y, s * 0.38, 320, 0);
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

    // Fill one shard, scaled by q around its centre and nudged by `off` towards bottom-right (so the
    // bright edge left around the body is widest on the lit side).
    function fillShard(ctx, p, q, off) {
      const w = p.w, n = p.n, x = p.x + off, y = p.y + off;
      ctx.beginPath();
      ctx.moveTo(x + w[0] * q, y + w[1] * q);
      for (let v = 1; v < n; v++) ctx.lineTo(x + w[v * 2] * q, y + w[v * 2 + 1] * q);
      ctx.fill();
    }

    function draw(ctx /* , opts */) {
      if (!ctx || !(flashes.length || count() > 0)) return;
      ctx.save();
      // short white flash along the cleared rows, collapsing to a streak on the row centre line
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < flashes.length; i++) {
        const fl = flashes[i], f = fl.life / fl.max, h = fl.h * f * f;
        ctx.globalAlpha = 0.94;
        ctx.fillRect(fl.x, fl.y + (fl.h - h) / 2, fl.w, h);
      }
      ctx.globalAlpha = 1;

      // shards: tumbling polygons; the tone follows which way the facet currently faces
      for (let ti = 0; ti < 7; ti++) {
        const list = shards[ti];
        if (!list.length) continue;
        const pal = PALS[ti];
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
          p.k = k;
          // 0 = glint (white-hot right after the impact, then twice per turn), 1 = lit face, 2 = back face
          const g = (p.ph + 2.6) % Math.PI;
          p.tone = p.max - p.life < 20 || g < 0.4 ? 0 : flip > 0 ? 1 : 2;
        }
        const off = list[0].s * 0.028, body = [pal.pale, pal.mid, pal.deep];
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          let q = 1;
          if (p.rim) { ctx.fillStyle = pal.line; fillShard(ctx, p, 1.06, 0); q = 0.86; }   // cartoon outline
          if (p.tone === 0) { ctx.fillStyle = '#ffffff'; fillShard(ctx, p, q, 0); continue; }
          ctx.fillStyle = pal.pale; fillShard(ctx, p, q, 0);                            // bright edge
          if (p.k > 0.72) { ctx.fillStyle = body[p.tone]; fillShard(ctx, p, q * 0.68, off * p.k); }  // skip once it is a speck
        }
      }

      // glitter dust (twinkling diamonds, cheap rects) and star glints
      ctx.fillStyle = '#ffffff';
      ctx.save();
      ctx.rotate(Math.PI / 4);                                    // squares drawn in a 45 degree frame = diamonds
      for (let i = 0; i < dust.length; i++) {
        const p = dust[i], r = p.r * 0.62 * Math.min(1, p.life / p.max * 1.6) * (0.55 + 0.45 * Math.sin(p.ph));
        if (r > 0.15) ctx.fillRect((p.x + p.y) * Math.SQRT1_2 - r, (p.y - p.x) * Math.SQRT1_2 - r, r * 2, r * 2);
      }
      ctx.restore();
      ctx.beginPath();
      for (let i = 0; i < stars.length; i++) {
        const p = stars[i];
        if (!(p.delay > 0)) starPath(ctx, p.x, p.y, p.R * Math.pow(Math.sin(Math.PI * p.life / p.max), 0.6));
      }
      ctx.fill();
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
    id: 'fused',
    palette: palette,
    drawCells: drawCells,
    createFx: createFx,
    // Drop every cached canvas (call on resize / DPR change).
    invalidate: function () {
      sprites.clear(); spritePixels = 0; crackSprites.clear();
      layers.length = 0; seenSigs.fill(0); scratch = null; prismMask = null; prismTint = null;
    },
  };
})(globalThis.KF = globalThis.KF || {});
