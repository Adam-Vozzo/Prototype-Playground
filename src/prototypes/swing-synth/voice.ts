import { createAudio, noiseBuffer } from '../../lib/audio';

export type VoiceName = 'plasma' | 'crystal' | 'rumble';

export interface VoiceDef {
  label: string;
  wave: OscillatorType;
  /** Lowest note (Hz) at the bottom of the sweep. */
  root: number;
  cutoff: number;
  cutoffSwing: number;
  /** Wave-shaper drive: grit. */
  grit: number;
  /** Tremolo rate (Hz) at rest → at full swing: the "vibration" in the whoosh. */
  trem: [number, number];
  whoosh: [number, number];
  sub: number;
  color: string;
}

export const VOICES: Record<VoiceName, VoiceDef> = {
  plasma: { label: 'Plasma', wave: 'sawtooth', root: 73.42, cutoff: 420, cutoffSwing: 3400, grit: 2.4, trem: [9, 34], whoosh: [380, 2600], sub: 0.5, color: '#5ad1ff' },
  crystal: { label: 'Crystal', wave: 'triangle', root: 146.83, cutoff: 1300, cutoffSwing: 5200, grit: 1.3, trem: [6, 22], whoosh: [900, 5200], sub: 0.15, color: '#d9a8ff' },
  rumble: { label: 'Rumble', wave: 'square', root: 41.2, cutoff: 260, cutoffSwing: 1700, grit: 4.5, trem: [14, 46], whoosh: [220, 1500], sub: 0.85, color: '#ff7a45' },
};

const IDLE = 0.07; // hum level at rest
const SWING = 0.3; // extra hum level at full swing

function shaperCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  const k = Math.max(0.01, amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

/**
 * The beam: a detuned, gritty hum through a lowpass and a tremolo, plus a band of
 * filtered noise for air. `drive` (0–1, how hard you're swinging) opens the filter,
 * speeds the tremolo into a buzz, widens the detune, raises the pitch a touch
 * (doppler) and brings up the whoosh — so the sound peaks where the swing does.
 */
export function createVoice(signal: AbortSignal) {
  const ctx = createAudio(signal);
  const now = () => ctx.currentTime;

  const master = ctx.createGain();
  master.gain.value = 1;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  const pan = ctx.createStereoPanner();
  pan.connect(master).connect(comp).connect(ctx.destination);

  // --- hum ---
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  const mix = ctx.createGain();
  mix.gain.value = 0.5;
  const subGain = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '2x';
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 3;
  const am = ctx.createGain();
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0;
  lfo.connect(lfoDepth).connect(am.gain);
  const hum = ctx.createGain();
  hum.gain.value = 0;
  oscA.connect(mix);
  oscB.connect(mix);
  sub.connect(subGain).connect(lp);
  mix.connect(shaper).connect(lp).connect(am).connect(hum).connect(pan);

  // --- air ---
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 2);
  noise.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.3;
  const air = ctx.createGain();
  air.gain.value = 0;
  noise.connect(bp).connect(air).connect(pan);

  for (const o of [oscA, oscB, sub, lfo]) o.start();
  noise.start();

  let voice = VOICES.plasma;
  let on = false;
  let lastFreq = voice.root;

  const setVoice = (name: VoiceName) => {
    voice = VOICES[name];
    oscA.type = voice.wave;
    oscB.type = voice.wave;
    shaper.curve = shaperCurve(voice.grit);
    subGain.gain.setTargetAtTime(voice.sub * 0.5, now(), 0.05);
  };
  setVoice('plasma');

  /** Called every frame while on. freq in Hz, drive 0–1, pan −1…1. */
  const update = (freq: number, drive: number, p: number) => {
    if (!on) return;
    const t = now();
    const d = Math.max(0, Math.min(1, drive));
    const f = freq * (1 + d * 0.06);
    lastFreq = freq;
    oscA.frequency.setTargetAtTime(f, t, 0.03);
    oscB.frequency.setTargetAtTime(f, t, 0.03);
    oscB.detune.setTargetAtTime(9 + d * 38, t, 0.03);
    sub.frequency.setTargetAtTime(f / 2, t, 0.03);
    lp.frequency.setTargetAtTime(voice.cutoff + d * d * voice.cutoffSwing, t, 0.02);
    lfo.frequency.setTargetAtTime(voice.trem[0] + d * (voice.trem[1] - voice.trem[0]), t, 0.03);
    // Tremolo depth grows with the swing: the "vibrational" buzz at the peak.
    am.gain.setTargetAtTime(1 - d * 0.35, t, 0.02);
    lfoDepth.gain.setTargetAtTime(0.08 + d * 0.35, t, 0.02);
    hum.gain.setTargetAtTime(IDLE + d * d * SWING, t, 0.015);
    bp.frequency.setTargetAtTime(voice.whoosh[0] + d * (voice.whoosh[1] - voice.whoosh[0]), t, 0.02);
    air.gain.setTargetAtTime(d ** 1.8 * 0.55, t, 0.015);
    pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)) * 0.7, t, 0.05);
  };

  /** Power-up sweep: pitch rises from far below, the filter blooms, a crackle of air. */
  const ignite = (freq: number) => {
    void ctx.resume();
    on = true;
    const t = now();
    lastFreq = freq;
    for (const o of [oscA, oscB]) {
      o.frequency.cancelScheduledValues(t);
      o.frequency.setValueAtTime(freq * 0.25, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.42);
    }
    sub.frequency.cancelScheduledValues(t);
    sub.frequency.setValueAtTime(freq * 0.125, t);
    sub.frequency.exponentialRampToValueAtTime(freq / 2, t + 0.42);
    lp.frequency.cancelScheduledValues(t);
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(voice.cutoff + voice.cutoffSwing * 0.6, t + 0.2);
    lp.frequency.exponentialRampToValueAtTime(voice.cutoff, t + 0.6);
    hum.gain.cancelScheduledValues(t);
    hum.gain.setValueAtTime(0.0001, t);
    hum.gain.exponentialRampToValueAtTime(IDLE + SWING * 0.6, t + 0.18);
    hum.gain.exponentialRampToValueAtTime(IDLE, t + 0.6);
    air.gain.cancelScheduledValues(t);
    air.gain.setValueAtTime(0.0001, t);
    air.gain.exponentialRampToValueAtTime(0.35, t + 0.05);
    air.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    bp.frequency.setValueAtTime(voice.whoosh[1], t);
    bp.frequency.exponentialRampToValueAtTime(voice.whoosh[0], t + 0.5);
  };

  /** Power-down: pitch and filter fall away. */
  const powerDown = () => {
    on = false;
    const t = now();
    for (const o of [oscA, oscB]) {
      o.frequency.cancelScheduledValues(t);
      o.frequency.setValueAtTime(lastFreq, t);
      o.frequency.exponentialRampToValueAtTime(lastFreq * 0.3, t + 0.38);
    }
    lp.frequency.cancelScheduledValues(t);
    lp.frequency.setValueAtTime(voice.cutoff + 600, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.38);
    hum.gain.cancelScheduledValues(t);
    hum.gain.setValueAtTime(IDLE + 0.08, t);
    hum.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    air.gain.cancelScheduledValues(t);
    air.gain.setTargetAtTime(0, t, 0.05);
  };

  return { ctx, setVoice, update, ignite, powerDown };
}

export type Voice = ReturnType<typeof createVoice>;
