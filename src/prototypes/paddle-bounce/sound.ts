import { createAudio, noiseBuffer } from '../../lib/audio';

/** Synthesised ping-pong sounds: a bright rubber "tok" with a hollow ball ring and a wooden body. */
export function createSound(signal: AbortSignal) {
  const ctx = createAudio(signal);
  const noise = noiseBuffer(ctx, 1);
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);

  const env = (g: GainNode, t: number, peak: number, decay: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  };

  const burst = (t: number, freq: number, q: number, peak: number, decay: number, type: BiquadFilterType = 'bandpass') => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, peak, decay);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  };

  const tone = (t: number, type: OscillatorType, f0: number, f1: number, peak: number, decay: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.8);
    const g = ctx.createGain();
    env(g, t, peak, decay);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + decay + 0.02);
  };

  /** One contact. strength 0–1; `dead` = the paddle wasn't moving (dull, quieter). */
  const tok = (strength: number, opts: { dead?: boolean; sweet?: boolean; streak?: number; at?: number } = {}) => {
    const t = (opts.at ?? ctx.currentTime) + 0.005;
    const s = Math.max(0.15, Math.min(1, strength));
    const v = opts.dead ? 0.45 : 0.6 + s * 0.4;
    const pitch = opts.dead ? 0.85 : 1 + s * 0.12 + (opts.sweet ? 0.08 : 0);
    burst(t, 3400 * pitch, 6, 0.55 * v, 0.045); // hollow celluloid ring
    burst(t, 6000, 0.7, 0.35 * v, 0.012, 'highpass'); // the click of contact
    tone(t, 'sine', 1450 * pitch, 1050 * pitch, 0.5 * v, 0.07); // rubber "tok"
    tone(t, 'triangle', 240 * pitch, 130, 0.35 * v * (opts.dead ? 0.6 : 1), 0.09); // wooden blade body
    if (opts.sweet && !opts.dead) {
      // A soft chime that climbs a pentatonic scale with the streak.
      const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const n = steps[Math.min(steps.length - 1, opts.streak ?? 0)];
      const f = 880 * 2 ** (n / 12);
      tone(t + 0.01, 'sine', f, f, 0.12, 0.45);
      tone(t + 0.01, 'sine', f * 2, f * 2, 0.04, 0.25);
    }
  };

  /** The ball skittering away on the floor after a miss. */
  const drop = () => {
    const t = ctx.currentTime + 0.25;
    let dt = 0.32;
    let at = t;
    for (let i = 0; i < 6; i++) {
      tok(0.5 - i * 0.07, { dead: true, at });
      at += dt;
      dt *= 0.68;
    }
    tone(t - 0.2, 'sine', 420, 180, 0.12, 0.35);
  };

  const setMuted = (m: boolean) => master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);

  return { ctx, tok, drop, setMuted };
}

export type Sound = ReturnType<typeof createSound>;
