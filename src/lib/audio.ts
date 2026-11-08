/**
 * Web Audio helpers for prototypes. Create the context inside a tap handler so
 * iOS unlocks it, and close it on unmount.
 */

/** A playback-category AudioContext (so iOS plays it even with the silent switch on, where supported). */
export function createAudio(signal: AbortSignal): AudioContext {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = 'playback';
    } catch {
      /* older WebKit */
    }
  }
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  void ctx.resume();
  signal.addEventListener('abort', () => void ctx.close().catch(() => {}), { once: true });
  return ctx;
}

/** `seconds` of white noise, for clicks, whooshes and air. */
export function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
