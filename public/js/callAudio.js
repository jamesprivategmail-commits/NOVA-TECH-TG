// callAudio.js - Real-time synthesized call tones and ringers using Web Audio API
// Provides crisp, reliable dial tones and ringers without external audio files.

let audioCtx = null;
let activeToneInterval = null;
let activeNodes = [];

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function stopAllTones() {
  if (activeToneInterval) {
    clearInterval(activeToneInterval);
    activeToneInterval = null;
  }
  for (const node of activeNodes) {
    try {
      if (node.stop) node.stop();
      if (node.disconnect) node.disconnect();
    } catch {
      // ignore
    }
  }
  activeNodes = [];
}

/**
 * Realistic outgoing ringing tone (440Hz + 480Hz modulated tone)
 * 1.5s on, 2.5s off repeating
 */
export function startOutgoingTone() {
  stopAllTones();
  const ctx = getAudioContext();
  if (!ctx) return;

  const playBurst = () => {
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
      gain.gain.setValueAtTime(0.12, now + 1.4);
      gain.gain.linearRampToValueAtTime(0, now + 1.5);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.5);
      osc2.stop(now + 1.5);

      activeNodes.push(osc1, osc2, gain);
    } catch {
      // AudioContext may be restricted by user agent until interaction
    }
  };

  playBurst();
  activeToneInterval = setInterval(playBurst, 4000);
}

/**
 * Pleasant modern incoming ringtone chime sequence
 */
export function startIncomingRingtone() {
  stopAllTones();
  const ctx = getAudioContext();
  if (!ctx) return;

  const notes = [
    { freq: 523.25, time: 0, dur: 0.16 },    // C5
    { freq: 659.25, time: 0.18, dur: 0.16 }, // E5
    { freq: 783.99, time: 0.36, dur: 0.22 }, // G5
    { freq: 1046.50, time: 0.60, dur: 0.35 },// C6
    { freq: 783.99, time: 1.05, dur: 0.18 }, // G5
    { freq: 1046.50, time: 1.25, dur: 0.40 } // C6
  ];

  const playSequence = () => {
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      for (const note of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(note.freq, now + note.time);

        gain.gain.setValueAtTime(0, now + note.time);
        gain.gain.linearRampToValueAtTime(0.25, now + note.time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + note.time + note.dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + note.time);
        osc.stop(now + note.time + note.dur);
        activeNodes.push(osc, gain);
      }
    } catch {
      // ignore
    }
  };

  playSequence();
  activeToneInterval = setInterval(playSequence, 2800);
}

/**
 * Crisp connect chime
 */
export function playConnectChime() {
  stopAllTones();
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  } catch {
    // ignore
  }
}

/**
 * Descending end tone / busy tone
 */
export function playEndTone() {
  stopAllTones();
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.linearRampToValueAtTime(320, now + 0.25);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.linearRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
  } catch {
    // ignore
  }
}
