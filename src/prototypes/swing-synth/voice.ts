import { createAudio, noiseBuffer } from '../../lib/audio';

export type VoiceName = 'plasma' | 'crystal' | 'rumble';

/** Optional layers on top of the core hum. */
export type LayerName = 'wind' | 'shimmer' | 'harmony' | 'crackle' | 'boom' | 'echo';
export const LAYER_DEFAULTS: Record<LayerName, boolean> = {
  wind: false,
  shimmer: true,
  harmony: true,
  crackle: true,
  boom: true,
  echo: true,
};

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
  /** Interval of the trailing harmony voice (1.5 = a fifth above). */
  harmony: number;
  color: string;
}

export const VOICES: Record<VoiceName, VoiceDef> = {
  plasma: { label: 'Plasma', wave: 'sawtooth', root: 73.42, cutoff: 420, cutoffSwing: 3400, grit: 2.4, trem: [9, 34], whoosh: [380, 2600], sub: 0.5, harmony: 1.5, color: '#5ad1ff' },
  crystal: { label: 'Crystal', wave: 'triangle', root: 146.83, cutoff: 1300, cutoffSwing: 5200, grit: 1.3, trem: [6, 22], whoosh: [900, 5200], sub: 0.15, harmony: 1.25, color: '#d9a8ff' },
  rumble: { label: 'Rumble', wave: 'square', root: 41.2, cutoff: 260, cutoffSwing: 1700, grit: 4.5, trem: [14, 46], whoosh: [220, 1500], sub: 0.85, harmony: 2, color: '#ff7a45' },
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
 * The beam. A core hum (detuned oscillators → grit → lowpass → tremolo) plus
 * layers that each answer the swing differently. `drive` (0–1, how hard you're
 * swinging) opens the filter, speeds the tremolo into a buzz, widens the detune and
 * adds a touch of doppler, so the sound peaks where the swing does.
 *
 *   wind     band of filtered noise: the air rushing past
 *   shimmer  octave + twelfth overtones that bloom and wobble at speed
 *   harmony  a second voice an interval up that glides behind your notes
 *   crackle  random electric sparks, denser the harder you swing
 *   boom     a low thump at the peak of each swing (call `peak()`)
 *   echo     a filtered feedback delay so swings leave a tail
 */
export function createVoice(signal: AbortSignal) {
  const ctx = createAudio(signal);
  const now = () => ctx.currentTime;
  const noise = noiseBuffer(ctx, 2);

  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  master.connect(comp).connect(ctx.destination);
  const pan = ctx.createStereoPanner();
  const bus = ctx.createGain(); // everything that pans with the swing
  bus.connect(pan).connect(master);

  // Each optional layer passes through a gate so it can be switched off smoothly.
  const gates = {} as Record<LayerName, GainNode>;
  const layers = { ...LAYER_DEFAULTS };
  for (const name of Object.keys(LAYER_DEFAULTS) as LayerName[]) {
    gates[name] = ctx.createGain();
    gates[name].gain.value = layers[name] ? 1 : 0;
  }

  // --- core hum ---
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
  mix.connect(shaper).connect(lp).connect(am).connect(hum).connect(bus);

  // --- wind ---
  const windSrc = ctx.createBufferSource();
  windSrc.buffer = noise;
  windSrc.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.3;
  const air = ctx.createGain();
  air.gain.value = 0;
  windSrc.connect(bp).connect(air).connect(gates.wind).connect(bus);

  // --- shimmer: overtones with a vibrato that widens at speed ---
  const sh1 = ctx.createOscillator();
  sh1.type = 'sine';
  const sh2 = ctx.createOscillator();
  sh2.type = 'triangle';
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.5;
  const vibDepth = ctx.createGain();
  vibDepth.gain.value = 0;
  vib.connect(vibDepth);
  vibDepth.connect(sh1.detune);
  vibDepth.connect(sh2.detune);
  const sh2Gain = ctx.createGain();
  sh2Gain.gain.value = 0.45;
  const shimmer = ctx.createGain();
  shimmer.gain.value = 0;
  sh1.connect(shimmer);
  sh2.connect(sh2Gain).connect(shimmer);
  shimmer.connect(gates.shimmer).connect(bus);

  // --- harmony: a second voice that lags behind the melody ---
  const harm = ctx.createOscillator();
  const harm2 = ctx.createOscillator();
  harm2.detune.value = -7;
  const harmLp = ctx.createBiquadFilter();
  harmLp.type = 'lowpass';
  harmLp.Q.value = 1.5;
  const harmony = ctx.createGain();
  harmony.gain.value = 0;
  harm.connect(harmLp);
  harm2.connect(harmLp);
  harmLp.connect(harmony).connect(gates.harmony).connect(bus);

  // --- crackle + boom go straight to their gates (grains pan themselves) ---
  gates.crackle.connect(master);
  gates.boom.connect(master);

  // --- echo: filtered feedback delay fed from the bus ---
  const send = ctx.createGain();
  send.gain.value = 0;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.27;
  const fb = ctx.createGain();
  fb.gain.value = 0.38;
  const echoLp = ctx.createBiquadFilter();
  echoLp.type = 'lowpass';
  echoLp.frequency.value = 2200;
  pan.connect(send).connect(gates.echo).connect(delay);
  delay.connect(echoLp).connect(fb).connect(delay);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  echoLp.connect(wet).connect(master);

  for (const o of [oscA, oscB, sub, lfo, sh1, sh2, vib, harm, harm2]) o.start();
  windSrc.start();

  let voice = VOICES.plasma;
  let on = false;
  let lastFreq = voice.root;
  let lastCrackle = 0;

  const setVoice = (name: VoiceName) => {
    voice = VOICES[name];
    oscA.type = voice.wave;
    oscB.type = voice.wave;
    harm.type = voice.wave === 'square' ? 'sawtooth' : voice.wave;
    harm2.type = 'triangle';
    shaper.curve = shaperCurve(voice.grit);
    subGain.gain.setTargetAtTime(voice.sub * 0.5, now(), 0.05);
  };
  setVoice('plasma');

  const setLayer = (name: LayerName, enabled: boolean) => {
    layers[name] = enabled;
    gates[name].gain.setTargetAtTime(enabled ? 1 : 0, now(), 0.04);
  };

  /** One electric spark: a few ms of bright noise, panned at random. */
  const spark = (t: number, d: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 2500 + Math.random() * 5000;
    hp.Q.value = 2 + Math.random() * 4;
    const g = ctx.createGain();
    const len = 0.004 + Math.random() * 0.014;
    const peak = (0.25 + Math.random() * 0.45) * (0.4 + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    src.connect(hp).connect(g).connect(p).connect(gates.crackle);
    src.start(t, Math.random() * 1.8);
    src.stop(t + len + 0.01);
  };

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

    // shimmer: overtones bloom at speed
    sh1.frequency.setTargetAtTime(f * 2, t, 0.03);
    sh2.frequency.setTargetAtTime(f * 3, t, 0.03);
    vibDepth.gain.setTargetAtTime(4 + d * 22, t, 0.05);
    vib.frequency.setTargetAtTime(5 + d * 3, t, 0.1);
    shimmer.gain.setTargetAtTime(0.006 + d ** 2 * 0.09, t, 0.03);

    // harmony: slow glide so it trails behind the melody
    harm.frequency.setTargetAtTime(freq * voice.harmony, t, 0.16);
    harm2.frequency.setTargetAtTime(freq * voice.harmony, t, 0.2);
    harmLp.frequency.setTargetAtTime(500 + d * 2600, t, 0.04);
    harmony.gain.setTargetAtTime(0.025 + d * 0.07, t, 0.05);

    // crackle: spark density climbs with the swing
    const dt = Math.min(0.05, t - lastCrackle);
    lastCrackle = t;
    if (layers.crackle) {
      const rate = 1.5 + d ** 2 * 70; // sparks per second
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < Math.min(1, n)) spark(t + Math.random() * dt, d);
        n -= 1;
      }
    }

    // echo: more of the swing goes into the delay as it speeds up
    send.gain.setTargetAtTime(0.12 + d * 0.5, t, 0.05);
  };

  /** A low thump at the peak of a swing. strength 0–1. */
  const peak = (strength: number) => {
    if (!on) return;
    const t = now() + 0.005;
    const s = Math.max(0.3, Math.min(1, strength));
    const o = ctx.createOscillator();
    o.type = 'sine';
    const base = Math.max(38, Math.min(70, lastFreq / 2));
    o.frequency.setValueAtTime(base * 2.6, t);
    o.frequency.exponentialRampToValueAtTime(base, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * s, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(gates.boom);
    o.start(t);
    o.stop(t + 0.5);
    // a breath of low noise on top so it feels like air being pushed
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.35 * s, t + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(f).connect(ng).connect(gates.boom);
    src.start(t, Math.random());
    src.stop(t + 0.25);
  };

  /** Power-up sweep: pitch rises from far below, the filter blooms, a burst of sparks. */
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
    shimmer.gain.cancelScheduledValues(t);
    shimmer.gain.setValueAtTime(0.0001, t);
    shimmer.gain.exponentialRampToValueAtTime(0.06, t + 0.25);
    shimmer.gain.exponentialRampToValueAtTime(0.006, t + 0.7);
    if (layers.crackle) for (let i = 0; i < 14; i++) spark(t + Math.random() * 0.35, 0.8);
  };

  /** Power-down: pitch and filter fall away, every layer fades. */
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
    for (const g of [air, shimmer, harmony, send]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.08);
    }
  };

  return { ctx, setVoice, setLayer, update, peak, ignite, powerDown };
}

export type Voice = ReturnType<typeof createVoice>;
