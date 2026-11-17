/*
 * Kristallfall - audio module (KF.Audio)
 *
 * Every sound is synthesised with the Web Audio API; there are no audio assets.
 * A sound is a plain function (ctx, dest, t, opts, rnd) that schedules a small
 * node graph at context time `t`. The live path (AudioContext, Math.random) and
 * the test path (OfflineAudioContext, seeded PRNG) run exactly the same code.
 *
 * Signal flow:  sound nodes -> per-sound gain -> master gain -> limiter -> destination
 *
 * Usage:  KF.Audio.unlock()                      inside every pointer / key handler (cheap)
 *         KF.Audio.play('shatter', { rows: 3 })  anywhere; never throws, may silently do nothing
 */
(function (KF) {
  'use strict';

  var root = globalThis;
  var AC = root.AudioContext || root.webkitAudioContext || null;
  var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext || null;

  var MIN_ATTACK = 0.002;   // s  - no envelope rises faster than this (click-free)
  var LOOKAHEAD = 0.005;    // s  - live sounds are scheduled this far ahead
  var WARMUP = 0.03;        // s  - a new context's limiter fades in; nothing is scheduled before this
  var SOFT_VOICES = 8;      // more sounding voices than this: minor sounds are dropped
  var MAX_VOICES = 14;      // hard cap for everything
  var RESUME_GRACE = 250;   // ms - a sound waiting for ctx.resume() is dropped after this
  var OFFLINE_MAX = 2.5;    // s  - upper bound of an offline render (trimmed afterwards)

  var ctx = null;           // live AudioContext, created inside unlock()
  var master = null;        // live master gain
  var unlocked = false;
  var hidden = false;       // page hidden: suspend() was called
  var muted = false;
  var volume = 1;
  var voices = [];          // end times (context clock) of the voices still sounding
  var lastPlayed = {};      // name -> ms timestamp, for rate limiting
  var tally = null;         // { end, last } of the sound currently being built

  // ---------------------------------------------------------------- utilities

  function noop() {}
  function nowMs() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rowsOf(opts) { return clamp(Math.round((opts && +opts.rows) || 1), 1, 4); }
  function between(rnd, lo, hi) { return lo + rnd() * (hi - lo); }
  function vary(rnd, amount) { return 1 + (rnd() * 2 - 1) * amount; }   // 1 +- amount

  /** Seeded PRNG (mulberry32), returns floats in [0, 1). */
  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------- shared buffers (per context)

  // Pre-rendered "glass ping" recipes. One buffer source per ping makes the shard
  // rain of a shatter very cheap. Each recipe covers one frequency band and is
  // re-pitched by at most +-33 %, so its baked-in 3 ms attack never drops below 2 ms.
  // parts: [frequency ratio, amplitude, decay factor]
  var SHARD_RECIPES = [
    { f: 2400, t60: 0.190, parts: [[1, 0.7, 1]] },                                    // 1.8 - 3.2 kHz
    { f: 2400, t60: 0.120, parts: [[1, 0.6, 1], [3, 0.07, 0.8], [2.756, 0.3, 0.5]] }, // triangle-ish + bar partial
    { f: 4200, t60: 0.130, parts: [[1, 1.0, 1]] },                                    // 3.2 - 5.6 kHz
    { f: 4200, t60: 0.085, parts: [[1, 0.8, 1], [1.83, 0.3, 0.6]] },
    { f: 7000, t60: 0.080, parts: [[1, 0.9, 1]] },                                    // 5.6 - 9 kHz
    { f: 7000, t60: 0.052, parts: [[1, 0.75, 1], [1.47, 0.28, 0.7]] }
  ];

  function makeNoise(c) {
    var n = Math.floor(c.sampleRate), buf = c.createBuffer(1, n, c.sampleRate);
    var data = buf.getChannelData(0), r = prng(0x4b46);
    for (var i = 0; i < n; i++) data[i] = r() * 2 - 1;
    return buf;
  }

  function makeShard(c, recipe) {
    var sr = c.sampleRate, attack = 0.003, fade = 0.002;
    var n = Math.ceil((attack + recipe.t60) * sr), buf = c.createBuffer(1, n, sr), data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) {
      var t = i / sr, v = 0;
      for (var p = 0; p < recipe.parts.length; p++) {
        var part = recipe.parts[p];   // exp(-6.91) = -60 dB after t60
        v += part[1] * Math.sin(2 * Math.PI * recipe.f * part[0] * t) * Math.exp(-6.91 * t / (recipe.t60 * part[2]));
      }
      data[i] = v * Math.min(1, t / attack) * Math.min(1, (n - 1 - i) / (fade * sr));
    }
    return { f: recipe.f, buffer: buf };
  }

  /** Noise + shard buffers, created once per context and then reused. */
  function buffers(c) {
    if (!c._kfBuffers) {
      c._kfBuffers = { noise: makeNoise(c), shards: SHARD_RECIPES.map(function (r) { return makeShard(c, r); }) };
    }
    return c._kfBuffers;
  }

  // ------------------------------------------------------ synthesis primitives

  /** Starts a source, stops it after its tail and remembers the one that ends last. */
  function run(src, t, stopAt, offset) {
    if (offset == null) src.start(t); else src.start(t, offset);
    src.stop(stopAt);
    if (tally && stopAt > tally.end) { tally.end = stopAt; tally.last = src; }
  }

  /** Click-free percussive envelope: linear attack, exponential decay to -60 dB, 3 ms fade to zero. */
  function env(param, t, peak, attack, decay) {
    attack = Math.max(attack, MIN_ATTACK);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(peak * 0.001, t + attack + decay);
    param.linearRampToValueAtTime(0, t + attack + decay + 0.003);
    return t + attack + decay + 0.003;
  }

  /** One oscillator partial with envelope; optionally glides from f0 to f1 within `glide` s. 2 nodes. */
  function tone(c, dest, t, type, f0, peak, attack, decay, f1, glide) {
    var osc = c.createOscillator(), g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + (glide || decay));
    var end = env(g.gain, t, peak, attack, decay);
    osc.connect(g);
    g.connect(dest);
    run(osc, t, end + 0.005);
  }

  /** Filtered noise burst with envelope; the filter optionally sweeps from f0 to f1. 3 nodes. */
  function burst(c, dest, t, rnd, type, f0, q, peak, attack, decay, f1) {
    var src = c.createBufferSource(), flt = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buffers(c).noise;
    src.loop = true;
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    var end = env(g.gain, t, peak, attack, decay);
    src.connect(flt);
    flt.connect(g);
    g.connect(dest);
    run(src, t, end + 0.005, rnd() * 0.9);
  }

  /** One pre-rendered glass ping at `freq` (1.8 - 9 kHz). 1 node; the level is set by `dest`. */
  function shard(c, dest, t, freq, rnd) {
    var bank = buffers(c).shards;
    var item = bank[(freq < 3200 ? 0 : freq < 5600 ? 2 : 4) + (rnd() < 0.5 ? 0 : 1)];
    var src = c.createBufferSource(), rate = freq / item.f;
    src.buffer = item.buffer;
    src.playbackRate.value = rate;
    src.connect(dest);
    run(src, t, t + item.buffer.duration / rate + 0.005);
  }

  /** Glockenspiel-like note: fundamental plus the faster-fading inharmonic partials of a free bar. */
  function bell(c, dest, t, f, peak, decay, bend) {
    tone(c, dest, t, 'sine', f, peak, 0.003, decay, bend ? f * bend : 0);
    tone(c, dest, t, 'sine', f * 2.756, peak * 0.3, MIN_ATTACK, decay * 0.45);
    if (f * 5.404 < 12000) tone(c, dest, t, 'sine', f * 5.404, peak * 0.12, MIN_ATTACK, decay * 0.2);
  }

  // -------------------------------------------------------------------- sounds

  function sndMove(c, dest, t, opts, rnd) {            // tiny soft glassy tick
    var f = 2450 * vary(rnd, 0.05);
    tone(c, dest, t, 'sine', f, 0.11, MIN_ATTACK, 0.024);
    tone(c, dest, t, 'sine', f * 1.71, 0.035, MIN_ATTACK, 0.014);
  }

  function sndRotate(c, dest, t, opts, rnd) {          // bright 'tink' with an upward pitch flick
    var f = 1800 * vary(rnd, 0.04);
    tone(c, dest, t, 'sine', f, 0.2, MIN_ATTACK, 0.075, f * 1.32, 0.04);
    tone(c, dest, t, 'sine', f * 2.7, 0.06, MIN_ATTACK, 0.04, f * 3.4, 0.03);
  }

  function sndSoftDrop(c, dest, t, opts, rnd) {        // very quiet low tick
    var f = 430 * vary(rnd, 0.05);
    tone(c, dest, t, 'triangle', f, 0.1, 0.003, 0.028, f * 0.75, 0.03);
  }

  function sndHardDrop(c, dest, t, opts, rnd) {        // whoosh -> thud + clink
    var hit = t + 0.055, f = 2050 * vary(rnd, 0.06);
    burst(c, dest, t, rnd, 'bandpass', 5200, 1.3, 0.45, 0.045, 0.02, 520);   // swelling, falling whoosh
    tone(c, dest, hit, 'sine', 210, 0.6, 0.003, 0.19, 50, 0.08);             // solid thud
    burst(c, dest, hit, rnd, 'lowpass', 900, 0.7, 0.35, MIN_ATTACK, 0.055);  // impact body
    tone(c, dest, hit, 'sine', f, 0.22, MIN_ATTACK, 0.12);                   // crystalline clink
    tone(c, dest, hit, 'sine', f * 1.66, 0.15, MIN_ATTACK, 0.09);
    tone(c, dest, hit, 'sine', f * 2.62, 0.09, MIN_ATTACK, 0.055);
  }

  function sndLock(c, dest, t, opts, rnd) {            // two quartz pieces touching
    var f = 1480 * vary(rnd, 0.06);
    burst(c, dest, t, rnd, 'highpass', 3800, 0.7, 0.07, MIN_ATTACK, 0.009);  // contact tick
    tone(c, dest, t, 'sine', f, 0.2, MIN_ATTACK, 0.135);
    tone(c, dest, t + between(rnd, 0, 0.004), 'sine', f * 1.59 * vary(rnd, 0.02), 0.14, MIN_ATTACK, 0.1);
    tone(c, dest, t, 'sine', f * 2.25, 0.085, MIN_ATTACK, 0.065);
  }

  /** Dry fracturing: 4-10 irregular clicks that get denser and louder over ~150 ms. 5 nodes. */
  function sndCrack(c, dest, t, opts, rnd) {
    var rows = rowsOf(opts), n = 2 + 2 * rows, span = 0.15, at = [], i;
    var src = c.createBufferSource(), body = c.createBiquadFilter(), air = c.createBiquadFilter();
    var airGain = c.createGain(), gate = c.createGain();
    src.buffer = buffers(c).noise;
    src.loop = true;
    body.type = 'bandpass';
    body.Q.value = 2.2;
    air.type = 'highpass';
    air.frequency.value = 6000;
    airGain.gain.value = 0.16;
    src.connect(body); body.connect(gate);
    src.connect(air); air.connect(airGain); airGain.connect(gate);
    gate.connect(dest);
    gate.gain.setValueAtTime(0, t);
    // onsets: the spacing shrinks towards the end, i.e. the density rises
    for (i = 0; i < n; i++) at.push(span * Math.pow(i / (n - 1), 0.6) + (i ? between(rnd, -0.0015, 0.0015) : 0));
    for (i = 0; i < n; i++) {
      var a = t + at[i], gap = i < n - 1 ? at[i + 1] - at[i] : 0.03;
      var decay = Math.min(between(rnd, 0.005, 0.012), gap - MIN_ATTACK - 0.002);  // done before the next click
      var peak = (0.7 + 0.075 * rows) * (0.4 + 0.6 * i / (n - 1)) * between(rnd, 0.7, 1);
      body.frequency.setValueAtTime(between(rnd, 1300, 4200), a);   // gate is closed here: no zipper noise
      gate.gain.setValueAtTime(0, a);
      gate.gain.linearRampToValueAtTime(peak, a + MIN_ATTACK);
      gate.gain.exponentialRampToValueAtTime(peak * 0.01, a + MIN_ATTACK + decay);
      gate.gain.linearRampToValueAtTime(0, a + MIN_ATTACK + decay + 0.001);
    }
    run(src, t, t + at[n - 1] + 0.04, rnd() * 0.9);
  }

  var SHIMMER = [2349, 2637, 3136, 3520, 4186, 4699, 5274, 6272];   // D7 .. G8, major pentatonic

  /** Hero sound: bright snap, band-passed crash and a rain of shard pings. At most ~39 nodes. */
  function sndShatter(c, dest, t, opts, rnd) {
    var rows = rowsOf(opts), k = (rows - 1) / 3;          // intensity 0..1
    var count = [9, 12, 15, 16][rows - 1];                // random shard pings
    var spread = 0.3 + 0.2 * k;                           // s - window the shards rain down in
    var level = 0.5 + 0.35 * k, pans = [-0.6, 0, 0.6], bus = [], i;

    // impact: very short bright snap plus the crash body (about 3 - 10 kHz, settling slightly)
    burst(c, dest, t, rnd, 'highpass', 6500, 0.7, 0.4 * level, MIN_ATTACK, 0.022);
    burst(c, dest, t, rnd, 'bandpass', 6200 * vary(rnd, 0.08), 1, 0.75 * level, 0.003, 0.2 + 0.1 * k, 4600);

    // shard bus: left / centre / right groups that fade over time, so later pings are quieter
    for (i = 0; i < 3; i++) {
      var g = c.createGain(), lvl = level * between(rnd, 0.36, 0.46);
      g.gain.setValueAtTime(lvl, t);
      g.gain.exponentialRampToValueAtTime(lvl * 0.22, t + spread + 0.1);
      if (pans[i] && c.createStereoPanner) {
        var pan = c.createStereoPanner();
        pan.pan.value = pans[i];
        g.connect(pan);
        pan.connect(dest);
      } else {
        g.connect(dest);
      }
      bus.push(g);
    }
    for (i = 0; i < count; i++) {
      var delay = i < 2 ? 0 : spread * Math.pow(rnd(), 1.6);   // two on the impact, the rest thinning out
      shard(c, bus[i % 3], t + delay, 1800 * Math.pow(5, Math.pow(rnd(), 0.75)), rnd);   // 1.8 - 9 kHz, leaning high
    }

    if (rows === 4) {   // jackpot: sub thump and a short rising shimmer of pings
      tone(c, dest, t, 'triangle', 150, 0.34, 0.008, 0.17, 50, 0.12);
      var sh = c.createGain();
      sh.gain.value = 0.2;
      sh.connect(dest);
      for (i = 0; i < SHIMMER.length; i++) {
        shard(c, sh, t + 0.07 + i * 0.03 + between(rnd, 0, 0.006), SHIMMER[i] * vary(rnd, 0.004), rnd);
      }
    }
  }

  var ARPEGGIO = [1046.5, 1318.5, 1568, 1760, 2093];   // C6 E6 G6 A6 C7
  function sndLevelUp(c, dest, t, opts, rnd) {         // crystal glockenspiel run, ~600 ms
    for (var i = 0; i < ARPEGGIO.length; i++) {
      var top = i === ARPEGGIO.length - 1;
      bell(c, dest, t + i * 0.085 + between(rnd, 0, 0.004), ARPEGGIO[i] * vary(rnd, 0.002), top ? 0.26 : 0.2, top ? 0.3 : 0.2);
    }
  }

  var LAMENT = [1318.5, 1046.5, 880, 698.5, 587.3];    // E6 C6 A5 F5 D5
  function sndGameOver(c, dest, t, opts, rnd) {        // sagging glass tones, then a soft thump, ~1.2 s
    for (var i = 0; i < LAMENT.length; i++) {
      bell(c, dest, t + i * 0.165 + between(rnd, 0, 0.006), LAMENT[i] * vary(rnd, 0.002), 0.22, 0.34, 0.97);
    }
    tone(c, dest, t + 0.86, 'triangle', 140, 0.5, 0.012, 0.32, 52, 0.2);
  }

  function sndStart(c, dest, t, opts, rnd) {           // bright two-note chime (G6 -> C7)
    var tune = vary(rnd, 0.003);
    bell(c, dest, t, 1568 * tune, 0.22, 0.2);
    bell(c, dest, t + 0.095, 2093 * tune, 0.26, 0.28);
  }

  function blips(c, dest, t, rnd, f1, f2) {
    var tune = vary(rnd, 0.01);
    tone(c, dest, t, 'triangle', f1 * tune, 0.2, 0.003, 0.07);
    tone(c, dest, t + 0.08, 'triangle', f2 * tune, 0.2, 0.003, 0.09);
  }
  function sndPause(c, dest, t, opts, rnd) { blips(c, dest, t, rnd, 1318.5, 987.8); }    // E6 -> B5
  function sndResume(c, dest, t, opts, rnd) { blips(c, dest, t, rnd, 987.8, 1318.5); }   // B5 -> E6

  function sndUiTap(c, dest, t, opts, rnd) {           // neutral soft tick
    var f = 1000 * vary(rnd, 0.02);
    tone(c, dest, t, 'sine', f, 0.13, MIN_ATTACK, 0.035);
    tone(c, dest, t, 'sine', f * 2, 0.03, MIN_ATTACK, 0.018);
  }

  // make: synth function, gain: per-sound level, gap: minimum ms between two plays,
  // vip: still played when the soft voice limit is reached
  var SOUNDS = {
    move:     { make: sndMove,     gain: 0.6,  gap: 25 },
    rotate:   { make: sndRotate,   gain: 0.55, gap: 25 },
    softDrop: { make: sndSoftDrop, gain: 0.6,  gap: 25 },
    hardDrop: { make: sndHardDrop, gain: 0.6,  vip: true },
    lock:     { make: sndLock,     gain: 0.42, gap: 20 },
    crack:    { make: sndCrack,    gain: 1,    vip: true },
    shatter:  { make: sndShatter,  gain: 1,    vip: true },
    levelUp:  { make: sndLevelUp,  gain: 0.5,  vip: true },
    gameOver: { make: sndGameOver, gain: 0.65, vip: true },
    start:    { make: sndStart,    gain: 0.5,  vip: true },
    pause:    { make: sndPause,    gain: 0.85 },
    resume:   { make: sndResume,   gain: 0.85 },
    uiTap:    { make: sndUiTap,    gain: 0.85, gap: 25 }
  };
  var NAMES = Object.keys(SOUNDS);

  function known(name) { return Object.prototype.hasOwnProperty.call(SOUNDS, name); }

  // -------------------------------------------------------------------- engine

  /** master gain -> compressor used as limiter -> destination. Returns the master gain. */
  function makeMaster(c, gainValue) {
    var gain = c.createGain(), tail = gain;
    gain.gain.value = gainValue;
    if (c.createDynamicsCompressor) {
      var limiter = c.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 6;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      // Chromium adds about +4.4 dB of make-up gain with these settings; the per-sound levels allow for it.
      // A fresh limiter fades in over one release time; make that 1 ms until WARMUP has passed.
      limiter.release.setValueAtTime(0.001, 0);
      limiter.release.setValueAtTime(0.12, WARMUP);
      gain.connect(limiter);
      tail = limiter;
    }
    tail.connect(c.destination);
    return gain;
  }

  /** Builds one sound behind its own gain node; returns the context time at which it has ended. */
  function build(c, masterNode, name, t, opts, rnd) {
    var def = SOUNDS[name], out = c.createGain(), mine = { end: t, last: null };
    out.gain.value = def.gain;
    out.connect(masterNode);
    tally = mine;
    try { def.make(c, out, t, opts || {}, rnd); } finally { tally = null; }
    // free the whole voice as soon as its longest-running source has stopped
    if (mine.last) mine.last.onended = function () { try { out.disconnect(); } catch (e) { /* already gone */ } };
    return mine.end;
  }

  function masterLevel() { return muted ? 0 : volume * volume; }   // quadratic taper feels linear to the ear

  function applyLevel() {
    if (!ctx || !master) return;
    try { master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.015); } catch (e) { master.gain.value = masterLevel(); }
  }

  /** Asks a suspended / interrupted context to run again; returns the promise if there is one. */
  function wake() {
    if (!ctx || ctx.state === 'running' || !ctx.resume) return null;
    var p = ctx.resume();
    if (p && p.catch) p.catch(noop);
    return p;
  }

  function fire(name, opts) {
    var def = SOUNDS[name], stamp = nowMs(), t = ctx.currentTime;
    if (def.gap && stamp - lastPlayed[name] < def.gap) return;
    voices = voices.filter(function (end) { return end > t; });
    if (voices.length >= (def.vip ? MAX_VOICES : SOFT_VOICES)) return;
    lastPlayed[name] = stamp;
    voices.push(build(ctx, master, name, Math.max(t + LOOKAHEAD, WARMUP), opts, Math.random));
  }

  function unlock() {
    try {
      if (!AC) return;
      if (ctx && ctx.state === 'closed') { ctx = null; master = null; voices = []; }
      if (!ctx) {
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        master = makeMaster(ctx, masterLevel());
        buffers(ctx);   // build the noise / shard buffers now, not during the first line clear
      }
      if (!unlocked || ctx.state !== 'running') {
        var blip = ctx.createBufferSource();   // a silent sample from inside the gesture opens the output on mobile
        blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        blip.connect(ctx.destination);
        blip.start(0);
      }
      unlocked = true;
      hidden = false;   // a user gesture proves the page is visible, even if resume() was never called
      wake();
    } catch (e) { /* audio is optional */ }
  }

  function play(name, opts) {
    try {
      if (muted || hidden || !unlocked || !ctx || !known(name)) return;
      if (ctx.state === 'running') { fire(name, opts); return; }
      // suspended / interrupted (or still starting up): resume, and play only if that happens promptly
      var asked = nowMs(), p = wake();
      if (p && p.then) {
        p.then(function () {
          try {
            if (!muted && !hidden && ctx && ctx.state === 'running' && nowMs() - asked < RESUME_GRACE) fire(name, opts);
          } catch (e) { /* ignore */ }
        }, noop);
      }
    } catch (e) { /* never let audio break the game */ }
  }

  function suspend() {
    hidden = true;
    try {
      if (ctx && ctx.suspend && ctx.state === 'running') {
        var p = ctx.suspend();
        if (p && p.catch) p.catch(noop);
      }
    } catch (e) { /* ignore */ }
  }

  function resume() {
    hidden = false;
    try { if (unlocked) wake(); } catch (e) { /* ignore */ }
  }

  /** Copies the span from..to (seconds) of a rendered buffer into a new, tight buffer. */
  function trim(c, buf, from, to) {
    var a = Math.round(from * buf.sampleRate), b = clamp(Math.ceil(to * buf.sampleRate), a + 1, buf.length);
    var out = c.createBuffer(buf.numberOfChannels, b - a, buf.sampleRate);
    for (var ch = 0; ch < buf.numberOfChannels; ch++) out.getChannelData(ch).set(buf.getChannelData(ch).subarray(a, b));
    return out;
  }

  /**
   * Test hook: renders one sound through the same graph (including the master chain at
   * full volume) in an OfflineAudioContext. Deterministic for a given seed.
   * Resolves with a stereo AudioBuffer; rejects if unsupported or the name is unknown.
   */
  function renderOffline(name, opts, config) {
    var cfg = config || {}, sampleRate = cfg.sampleRate || 44100, seed = cfg.seed == null ? 1 : cfg.seed;
    if (typeof Promise === 'undefined') return null;
    return new Promise(function (resolve, reject) {
      if (!OAC) { reject(new Error('OfflineAudioContext is not available')); return; }
      if (!known(name)) { reject(new Error('Unknown sound: ' + name)); return; }
      var c = new OAC(2, Math.ceil((WARMUP + OFFLINE_MAX) * sampleRate), sampleRate);
      // like the live path: the sound starts once the limiter has settled; the lead-in is cut off again
      var end = build(c, makeMaster(c, 1), name, WARMUP, opts, prng(seed));
      var done = function (buf) { resolve(trim(c, buf, WARMUP, end + 0.03)); };   // + limiter look-ahead
      c.oncomplete = function (e) { done(e.renderedBuffer); };            // callback form (old WebKit)
      var p = c.startRendering();
      if (p && p.then) { c.oncomplete = null; p.then(done, reject); }
    });
  }

  KF.Audio = {
    unlock: unlock,
    play: play,
    setMuted: function (flag) { muted = !!flag; applyLevel(); },
    get muted() { return muted; },
    setVolume: function (v) { v = +v; volume = v >= 0 ? Math.min(v, 1) : 0; applyLevel(); },
    get volume() { return volume; },
    suspend: suspend,
    resume: resume,
    NAMES: NAMES,
    renderOffline: renderOffline
  };
})(globalThis.KF = globalThis.KF || {});
