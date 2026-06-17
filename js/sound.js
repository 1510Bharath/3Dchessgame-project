// sound.js
// Minimal synthesized sound effects via WebAudio — no audio files to ship.

let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function tone(freq, duration, { type = 'sine', gain = 0.08, delay = 0 } = {}) {
  const ac = getCtx();
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(env).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export const Sound = {
  enabled: true,
  resume() { try { getCtx().resume(); } catch (_) {} },
  move() { if (this.enabled) tone(360, 0.09, { type: 'triangle', gain: 0.07 }); },
  capture() {
    if (!this.enabled) return;
    tone(230, 0.12, { type: 'sawtooth', gain: 0.06 });
    tone(160, 0.14, { type: 'sawtooth', gain: 0.05, delay: 0.03 });
  },
  check() { if (this.enabled) tone(520, 0.16, { type: 'square', gain: 0.05 }); },
  gameEnd() {
    if (!this.enabled) return;
    [392, 330, 262].forEach((f, i) => tone(f, 0.26, { type: 'triangle', gain: 0.06, delay: i * 0.12 }));
  },
  notify() { if (this.enabled) tone(620, 0.1, { type: 'sine', gain: 0.05 }); },
};
