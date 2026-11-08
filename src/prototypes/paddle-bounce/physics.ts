/**
 * World-space physics for Paddle Bounce. Everything is in metres and seconds in an
 * Earth frame (x, y horizontal, z up). The phone is a rigid paddle whose
 * orientation comes from the orientation sensor, and whose movement comes from
 * the accelerometer. The ball lives in the room, not on the screen.
 *
 * Position from an accelerometer drifts, so the phone's velocity and position are
 * leaky integrals: quick moves (swings, shifts under the ball) are tracked closely,
 * and slow drift fades back to zero over about a second.
 */

export type V3 = [number, number, number];
export type M3 = [number, number, number, number, number, number, number, number, number]; // row-major

// ---------- constants ----------
export const G = 9.81;
export const BALL_R = 0.02; // 40 mm, ping-pong size

export type BallName = 'real' | 'floaty';
export interface BallKind {
  label: string;
  /** Gravity on the ball (m/s²). */
  g: number;
  /** Quadratic air drag ½ρC_dA/m (1/m). */
  drag: number;
  /** Restitution off the paddle. */
  e: number;
  /** Fraction of sliding speed the rubber grips away on contact. */
  grip: number;
}
export const BALLS: Record<BallName, BallKind> = {
  // A 2.7 g ping-pong ball: real gravity, ≈ 8.4 m/s terminal speed.
  real: { label: 'Real', g: G, drag: 0.14, e: 0.82, grip: 0.3 },
  // Light and draggy, like a balloon: slow falls, and sideways drift dies away quickly.
  floaty: { label: 'Floaty', g: 2.2, drag: 0.4, e: 0.86, grip: 0.12 },
};
/** CSS pixels per metre on a phone (~158 CSS px per inch on iPhones). */
export const PX_PER_M = 6200;

const TAU_V = 0.5; // s: how long a velocity estimate is trusted
const TAU_P = 0.9; // s: how long a position estimate is trusted
const DEADBAND = 0.12; // m/s²: hand tremor and sensor noise (default, before calibration)
const TILT_TAU = 0.07; // s: smoothing on the paddle's tilt, so a wrist flick doesn't jerk it
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

// ---------- vector helpers ----------
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
/** Device → world. */
export const mul = (R: M3, v: V3): V3 => [
  R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
  R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
  R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
];
/** World → device. */
export const mulT = (R: M3, v: V3): V3 => [
  R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
  R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
  R[2] * v[0] + R[5] * v[1] + R[8] * v[2],
];
export const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** The W3C device-orientation rotation R = Rz(α)·Rx(β)·Ry(γ), mapping device axes to Earth axes. */
export function rotation(alphaDeg: number, betaDeg: number, gammaDeg: number): M3 {
  const d = Math.PI / 180;
  const ca = Math.cos(alphaDeg * d), sa = Math.sin(alphaDeg * d);
  const cb = Math.cos(betaDeg * d), sb = Math.sin(betaDeg * d);
  const cg = Math.cos(gammaDeg * d), sg = Math.sin(gammaDeg * d);
  return [
    ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg,
    sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg,
    -cb * sg, sb, cb * cg,
  ];
}

/**
 * Tracks the phone as a rigid body in the room: orientation R, angular velocity
 * ω (world), and leaky estimates of the centre's velocity and position.
 */
export class PaddleTracker {
  /** The paddle's orientation: tilt relative to your calibrated level, scaled by tiltGain and smoothed. */
  R: M3 = IDENTITY;
  /** The phone's true orientation, for turning acceleration into world axes. */
  Rtrue: M3 = IDENTITY;
  /** Calibrated level: the tilt you naturally hold as "flat" (degrees). */
  level = { beta: 0, gamma: 0 };
  /** How much of your tilt the paddle follows: 1 = real physics, 0 = always level. */
  tiltGain = 1;
  /** Calibrated accelerometer bias (world axes) and noise deadband. */
  bias: V3 = [0, 0, 0];
  deadband = DEADBAND;
  /** Latest raw readings, for calibration. */
  raw = { beta: 0, gamma: 0 };
  rawAccel: V3 = [0, 0, 0];
  private tilt: { beta: number; gamma: number } | null = null;
  omega: V3 = [0, 0, 0];
  vel: V3 = [0, 0, 0];
  pos: V3 = [0, 0, 0];
  /** performance.now() of the last position update, for extrapolating between sensor events. */
  t = 0;
  private lastOrientT = 0;
  private lastMotionT = 0;
  private signVote = 1; // some platforms report acceleration inverted; learned from gravity

  reset(now: number) {
    this.vel = [0, 0, 0];
    this.pos = [0, 0, 0];
    this.t = now;
  }

  /** Paddle centre at time `now`, extrapolated from the last sensor update. */
  posAt(now: number): V3 {
    const dt = Math.min(0.05, Math.max(0, (now - this.t) / 1000));
    return add(this.pos, scale(this.vel, dt));
  }

  normal(): V3 {
    return [this.R[2], this.R[5], this.R[8]];
  }

  /** Velocity of a point on the paddle (device-frame offset r from the centre), in the world. */
  pointVel(rDevice: V3): V3 {
    return add(this.vel, cross(this.omega, mul(this.R, rDevice)));
  }

  onOrientation(alpha: number, beta: number, gamma: number, now: number) {
    this.raw = { beta, gamma };
    this.Rtrue = rotation(alpha, beta, gamma);
    const dt = (now - this.lastOrientT) / 1000;
    const tb = wrap180(beta - this.level.beta) * this.tiltGain;
    const tg = wrap180(gamma - this.level.gamma) * this.tiltGain;
    if (!this.tilt || !(dt > 0 && dt < 0.15)) this.tilt = { beta: tb, gamma: tg };
    else {
      const k = 1 - Math.exp(-dt / TILT_TAU);
      this.tilt.beta += (tb - this.tilt.beta) * k;
      this.tilt.gamma += (tg - this.tilt.gamma) * k;
    }
    const R = rotation(alpha, this.tilt.beta, this.tilt.gamma);
    if (this.lastOrientT && dt > 0.004 && dt < 0.15) {
      // ω from the change in orientation: dR = R·Rprevᵀ ≈ I + [ω]× dt. Sign conventions can't bite.
      const P = this.R;
      const d = (i: number, j: number) => R[i * 3] * P[j * 3] + R[i * 3 + 1] * P[j * 3 + 1] + R[i * 3 + 2] * P[j * 3 + 2];
      const w: V3 = [(d(2, 1) - d(1, 2)) / (2 * dt), (d(0, 2) - d(2, 0)) / (2 * dt), (d(1, 0) - d(0, 1)) / (2 * dt)];
      const k = 1 - Math.exp(-dt / 0.03);
      this.omega = add(this.omega, scale(sub(w, this.omega), k));
    }
    this.R = R;
    this.lastOrientT = now;
  }

  onMotion(e: DeviceMotionEvent, now: number) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    const gi: V3 = [g.x ?? 0, g.y ?? 0, g.z ?? 0];
    const a0 = e.acceleration;
    const up = mulT(this.Rtrue, [0, 0, 1]); // world up, in device axes
    // Spec: a phone at rest reports +g along "up". Some platforms invert both vectors; vote on it.
    const react = a0 && a0.x != null ? sub(gi, [a0.x ?? 0, a0.y ?? 0, a0.z ?? 0]) : gi;
    if (len(react) > 5) this.signVote = this.signVote * 0.97 + Math.sign(dot(react, up)) * 0.03;
    const s = this.signVote >= 0 ? 1 : -1;
    // Linear acceleration in device axes, in the spec's sign convention.
    const lin: V3 =
      a0 && a0.x != null
        ? scale([a0.x ?? 0, a0.y ?? 0, a0.z ?? 0], s)
        : sub(scale(gi, s), scale(up, G)); // no separate linear acceleration: remove gravity ourselves
    this.rawAccel = mul(this.Rtrue, lin);
    let aw = sub(this.rawAccel, this.bias);
    const m = len(aw);
    aw = m < this.deadband ? [0, 0, 0] : scale(aw, 1 - this.deadband / m);

    const dt = Math.min(0.05, Math.max(0.001, (now - (this.lastMotionT || now - 16)) / 1000));
    this.lastMotionT = now;
    this.vel = scale(add(this.vel, scale(aw, dt)), Math.exp(-dt / TAU_V));
    this.pos = scale(add(this.pos, scale(this.vel, dt)), Math.exp(-dt / TAU_P));
    this.t = now;
  }

  /** Touch fallback: tilt from the pointer, an upward shove from a tap. */
  manual(betaDeg: number, gammaDeg: number, vz: number, now: number) {
    this.R = rotation(0, betaDeg * this.tiltGain, gammaDeg * this.tiltGain);
    this.Rtrue = this.R;
    this.omega = [0, 0, 0];
    const dt = Math.min(0.05, Math.max(0.001, (now - (this.t || now - 16)) / 1000));
    this.vel = [0, 0, vz];
    this.pos = scale(add(this.pos, scale(this.vel, dt)), Math.exp(-dt / 0.25));
    this.t = now;
  }
}

export interface Ball {
  p: V3;
  v: V3;
}

/** Gravity + quadratic drag, one explicit step. */
export function stepBall(b: Ball, dt: number, k: BallKind) {
  const sp = len(b.v);
  const drag = scale(b.v, -k.drag * sp);
  b.v = add(b.v, scale(add([0, 0, -k.g], drag), dt));
  b.p = add(b.p, scale(b.v, dt));
}

/**
 * Bounce off the paddle at a contact point (device-frame offset rDev from its centre).
 * Relative to the moving paddle: the normal component reverses and loses energy,
 * the sliding component loses some speed to grip. Returns the paddle's speed
 * along its normal at the contact (how hard you "hit" it) and the ball's
 * approach speed.
 */
export function bounce(b: Ball, paddle: PaddleTracker, rDev: V3, k: BallKind) {
  const n = paddle.normal();
  const vp = paddle.pointVel(rDev);
  const rel = sub(b.v, vp);
  const vn = dot(rel, n);
  if (vn >= 0) return null; // already separating
  const vt = sub(rel, scale(n, vn));
  const out = add(scale(vt, 1 - k.grip), scale(n, -k.e * vn));
  b.v = add(vp, out);
  return { push: dot(vp, n), approach: -vn };
}
