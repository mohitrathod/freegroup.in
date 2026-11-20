/*
 * sfx.js - tiny shared Web Audio sound helper for the mini-games collection.
 * No external files: all sounds are synthesized. Safe to include from any game
 * via <script src="sfx.js"></script>. Degrades silently when audio is blocked.
 */
(function (global) {
  'use strict';

  let ctx = null;
  let muted = false;

  function ac() {
    if (ctx) return ctx;
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  // Unlock audio on the first user gesture (browsers require it).
  function unlock() {
    const c = ac();
    if (c && c.state === 'suspended') { c.resume().catch(function () {}); }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    global.addEventListener(ev, unlock, { once: false, passive: true });
  });

  // Core: play a single oscillator tone with an envelope.
  function tone(opts) {
    if (muted) return;
    const c = ac();
    if (!c) return;
    try {
      const now = c.currentTime;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = opts.type || 'sine';
      const f0 = opts.freq || 440;
      o.frequency.setValueAtTime(f0, now);
      if (opts.freqTo) {
        o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqTo), now + (opts.dur || 0.15));
      }
      const vol = opts.vol == null ? 0.2 : opts.vol;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + (opts.dur || 0.15));
      o.connect(g);
      g.connect(c.destination);
      o.start(now);
      o.stop(now + (opts.dur || 0.15) + 0.02);
    } catch (e) { /* ignore */ }
  }

  // Short burst of filtered noise for explosions / breaks.
  function noise(opts) {
    if (muted) return;
    const c = ac();
    if (!c) return;
    try {
      const now = c.currentTime;
      const dur = opts.dur || 0.25;
      const buffer = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const src = c.createBufferSource();
      src.buffer = buffer;
      const filter = c.createBiquadFilter();
      filter.type = opts.filter || 'lowpass';
      filter.frequency.value = opts.cutoff || 1200;
      const g = c.createGain();
      g.gain.setValueAtTime(opts.vol == null ? 0.25 : opts.vol, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(c.destination);
      src.start(now);
      src.stop(now + dur);
    } catch (e) { /* ignore */ }
  }

  const SFX = {
    unlock: unlock,
    setMuted: function (v) { muted = !!v; },
    isMuted: function () { return muted; },
    toggleMute: function () { muted = !muted; return muted; },
    tone: tone,
    noise: noise,
    click: function () { tone({ type: 'square', freq: 420, dur: 0.06, vol: 0.12 }); },
    move: function () { tone({ type: 'triangle', freq: 300, dur: 0.05, vol: 0.08 }); },
    pickup: function () { tone({ type: 'triangle', freq: 660, freqTo: 990, dur: 0.14, vol: 0.18 }); },
    hit: function () { tone({ type: 'square', freq: 220, freqTo: 130, dur: 0.09, vol: 0.16 }); },
    blip: function (f) { tone({ type: 'sine', freq: f || 520, dur: 0.08, vol: 0.15 }); },
    rotate: function () { tone({ type: 'square', freq: 300, freqTo: 460, dur: 0.06, vol: 0.1 }); },
    drop: function () { tone({ type: 'sine', freq: 180, freqTo: 90, dur: 0.12, vol: 0.16 }); },
    explosion: function () { noise({ dur: 0.3, cutoff: 900, vol: 0.3 }); },
    lose: function () {
      tone({ type: 'sawtooth', freq: 300, freqTo: 90, dur: 0.5, vol: 0.2 });
    },
    win: function () {
      [523, 659, 784, 1046].forEach(function (f, i) {
        setTimeout(function () { tone({ type: 'triangle', freq: f, dur: 0.18, vol: 0.18 }); }, i * 110);
      });
    },
    levelup: function () {
      [440, 660, 880].forEach(function (f, i) {
        setTimeout(function () { tone({ type: 'square', freq: f, dur: 0.12, vol: 0.15 }); }, i * 80);
      });
    }
  };

  global.SFX = SFX;
})(window);
