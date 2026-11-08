/**
 * Phone motion sensors for prototypes (iOS + Android + desktop fallback).
 * Only import this from a prototype's index.ts (never from shared/eager code).
 *
 *   // inside a click handler (iOS needs a user gesture):
 *   const perm = await requestMotion();          // 'granted' | 'denied' | 'unsupported'
 *   const live = await waitForMotion(signal);    // true once real sensor data arrives
 */

export type MotionPermission = 'granted' | 'denied' | 'unsupported';

type PermissionCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Ask for motion + orientation access. On iOS this MUST be called straight from
 * a tap/click handler (before any other await) or Safari rejects it.
 */
export async function requestMotion(): Promise<MotionPermission> {
  if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
  const m = DeviceMotionEvent as unknown as PermissionCtor;
  const o = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : undefined) as unknown as
    | PermissionCtor
    | undefined;
  if (typeof m.requestPermission !== 'function') return 'granted'; // Android / desktop: no prompt
  try {
    // Both calls start synchronously, inside the same user gesture.
    const [a, b] = await Promise.all([m.requestPermission(), o?.requestPermission?.() ?? Promise.resolve('granted')]);
    return a === 'granted' && b === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Resolves true as soon as a devicemotion event carries real data, false after
 * `timeout` ms. Desktop browsers define DeviceMotionEvent but never fire it.
 */
export function waitForMotion(signal: AbortSignal, timeout = 900): Promise<boolean> {
  return new Promise((resolve) => {
    const ac = new AbortController();
    const done = (v: boolean) => {
      ac.abort();
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => done(false), timeout);
    signal.addEventListener('abort', () => done(false), { signal: ac.signal });
    addEventListener(
      'devicemotion',
      (e) => {
        const g = e.accelerationIncludingGravity;
        const r = e.rotationRate;
        if ((g && g.x != null) || (r && r.alpha != null)) done(true);
      },
      { signal: ac.signal },
    );
  });
}

/** Current screen rotation in degrees (0, 90, 180, 270). */
export function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

/** Rotate a device-frame 2D vector (x right, y down the screen in portrait) into the current screen frame. */
export function toScreen(dx: number, dy: number): [number, number] {
  const t = (screenAngle() * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [dx * c + dy * s, -dx * s + dy * c];
}

/**
 * Upward (against gravity) linear acceleration in m/s², whatever way the phone
 * is held. Sign-safe: some platforms report both vectors inverted, which cancels
 * out in the dot product.
 */
export function upAccel(e: DeviceMotionEvent): number | null {
  const a = e.acceleration;
  const g = e.accelerationIncludingGravity;
  if (!a || !g || a.x == null || g.x == null) return null;
  const ax = a.x ?? 0, ay = a.y ?? 0, az = a.z ?? 0;
  const ux = (g.x ?? 0) - ax, uy = (g.y ?? 0) - ay, uz = (g.z ?? 0) - az; // gravity-reaction vector ("up")
  const len = Math.hypot(ux, uy, uz);
  if (len < 1) return null;
  return (ax * ux + ay * uy + az * uz) / len;
}

/** Keep the screen awake while the signal is live (best effort; iOS 16.4+). */
export async function keepAwake(signal: AbortSignal): Promise<void> {
  const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } })
    .wakeLock;
  if (!wl) return;
  let sentinel: { release(): Promise<void> } | null = null;
  const acquire = async () => {
    try {
      if (!signal.aborted && document.visibilityState === 'visible') sentinel = await wl.request('screen');
    } catch {
      /* not allowed right now */
    }
  };
  document.addEventListener('visibilitychange', acquire, { signal }); // the lock drops when the tab hides
  signal.addEventListener('abort', () => void sentinel?.release().catch(() => {}), { once: true });
  await acquire();
}
