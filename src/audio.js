// HAIR FORCE — audio (Web Audio API). No dependencies.
// Music: 16-bar loop (32.152 s) cut from a licensed library track, crossfaded at the loop point.
// SFX: procedurally rendered files in assets/. Everything fails silently if audio is unavailable.

const BASE = 'assets/';
const FILES = {
  music: 'music.mp3',
  thrust: 'thrust.mp3',
  score: 'score.mp3',
  bonus: 'bonus.mp3',
  crash: 'crash.mp3',
  whoosh: 'whoosh.mp3',
};
const LOOP_SEC = 1417903 / 44100; // exact loop length in the music file (pad audio follows it)
const MUSIC_VOL = 0.5;
const SFX_GAIN = { thrust: 0.55, score: 0.7, bonus: 0.85, crash: 1.0, whoosh: 0.6 };
const MAX_VOICES = { thrust: 4, whoosh: 2, score: 3, bonus: 2, crash: 1 };
const PITCH_JITTER = 0.04;

export function createAudio() {
  const noop = () => {};
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return { unlock: noop, thrust: noop, score: noop, bonus: noop, crash: noop, whoosh: noop, music: noop };

  let ctx;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) {
    try { ctx = new AC(); } catch (e2) {
      return { unlock: noop, thrust: noop, score: noop, bonus: noop, crash: noop, whoosh: noop, music: noop };
    }
  }

  // Master chain: music + sfx buses -> glue compressor -> brickwall-ish limiter -> out
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -12; glue.knee.value = 6; glue.ratio.value = 3;
  glue.attack.value = 0.004; glue.release.value = 0.18;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.001; limiter.release.value = 0.08;
  const master = ctx.createGain(); master.gain.value = 0.9;
  glue.connect(limiter); limiter.connect(master); master.connect(ctx.destination);

  const musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(glue);
  const sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(glue);

  const buffers = {};
  const offsets = {}; // leading-silence offset (decoder/encoder padding) per buffer, seconds
  const voices = {};
  let unlocked = false;
  let wantMusic = false;
  let musicSrc = null;

  const firstSound = (buf, thr) => {
    try {
      const d = buf.getChannelData(0);
      const lim = Math.min(d.length, Math.floor(buf.sampleRate * 0.2));
      for (let i = 0; i < lim; i++) if (Math.abs(d[i]) > thr) return i / buf.sampleRate;
    } catch (e) { /* ignore */ }
    return 0;
  };

  const decode = (ab) => new Promise((res, rej) => {
    try {
      const p = ctx.decodeAudioData(ab, res, rej); // callback form for old Safari
      if (p && p.then) p.then(res, rej);
    } catch (e) { rej(e); }
  });

  Object.entries(FILES).forEach(([key, file]) => {
    fetch(BASE + file)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(file))))
      .then(decode)
      .then((buf) => {
        buffers[key] = buf;
        offsets[key] = firstSound(buf, key === 'music' ? 1e-3 : 1e-4);
        if (key === 'music' && wantMusic) startMusic();
      })
      .catch(() => { /* missing/undecodable file: that sound stays silent */ });
  });

  function startMusic() {
    if (musicSrc || !buffers.music || !unlocked) return;
    try {
      const buf = buffers.music;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const ls = offsets.music || 0;
      const le = ls + LOOP_SEC;
      if (le <= buf.duration) { src.loopStart = ls; src.loopEnd = le; }
      src.connect(musicBus);
      const now = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setValueAtTime(musicBus.gain.value, now);
      musicBus.gain.linearRampToValueAtTime(MUSIC_VOL, now + 0.6);
      src.start(now, ls);
      musicSrc = src;
    } catch (e) { musicSrc = null; }
  }

  function stopMusic() {
    if (!musicSrc) return;
    const src = musicSrc; musicSrc = null;
    try {
      const now = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setValueAtTime(musicBus.gain.value, now);
      musicBus.gain.linearRampToValueAtTime(0, now + 0.35);
      src.stop(now + 0.4);
    } catch (e) { /* ignore */ }
  }

  function play(key) {
    if (!unlocked) return;
    const buf = buffers[key];
    if (!buf || ctx.state === 'closed') return;
    try {
      const list = voices[key] || (voices[key] = []);
      while (list.length >= (MAX_VOICES[key] || 2)) {
        const old = list.shift();
        try { old.g.gain.setTargetAtTime(0, ctx.currentTime, 0.01); old.s.stop(ctx.currentTime + 0.05); } catch (e) { /* ignore */ }
      }
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = 1 + (Math.random() * 2 - 1) * PITCH_JITTER;
      const g = ctx.createGain();
      g.gain.value = (SFX_GAIN[key] || 0.7) * (0.92 + Math.random() * 0.08);
      s.connect(g); g.connect(sfxBus);
      const v = { s, g };
      list.push(v);
      s.onended = () => { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); try { g.disconnect(); } catch (e) { /* ignore */ } };
      s.start(0, offsets[key] || 0);
      if (key === 'crash' && musicSrc) duckMusic();
    } catch (e) { /* ignore */ }
  }

  function duckMusic() {
    const now = ctx.currentTime;
    const g = musicBus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(MUSIC_VOL * 0.3, now + 0.05);
    g.linearRampToValueAtTime(MUSIC_VOL * 0.3, now + 0.9);
    g.linearRampToValueAtTime(MUSIC_VOL, now + 2.0);
  }

  function unlock() {
    try {
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      if (!unlocked) {
        // iOS: play a silent 1-sample buffer inside the gesture
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
        unlocked = true;
        if (wantMusic) startMusic();
      }
    } catch (e) { /* ignore */ }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      try {
        if (document.hidden) ctx.suspend();
        else if (unlocked) ctx.resume();
      } catch (e) { /* ignore */ }
    });
  }

  return {
    unlock,
    thrust: () => play('thrust'),
    score: () => play('score'),
    bonus: () => play('bonus'),
    crash: () => play('crash'),
    whoosh: () => play('whoosh'),
    music(on) {
      wantMusic = !!on;
      try { if (wantMusic) startMusic(); else stopMusic(); } catch (e) { /* ignore */ }
    },
  };
}
