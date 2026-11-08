import { Check, Crosshair, Hand, Pause, Play, RotateCcw, Smartphone, Trophy, Volume2 } from 'lucide';
import { h, useStyles } from '../../lib/dom';
import { setBusy } from '../../lib/feedback';
import { hapticTick } from '../../lib/haptics';
import { icon } from '../../lib/icon';
import { keepAwake, requestMotion, toScreen, waitForMotion } from '../../lib/sensors';
import type { MountFn } from '../../types';
import {
  add,
  BALL_R,
  BALLS,
  bounce,
  dot,
  mulT,
  PaddleTracker,
  PX_PER_M,
  scale,
  stepBall,
  sub,
  type Ball,
  type BallName,
  type V3,
} from './physics';
import { createSound, type Sound } from './sound';
import css from './style.css?inline';

// Real-world scale: the canvas is the paddle at its true physical size (see physics.ts).
const SWEET_R = 0.015; // centre ring, double points
const EDGE = 0.002; // contact still counts this far past the screen edge
const DEAD_APEX = 0.02; // a bounce lower than this means the ball has died
const PUSH = 0.12; // m/s of paddle speed at contact that counts as a push
const EYE = 0.45; // m from your eye to the screen, for perspective
const SPAWN_H = 0.3; // m above the paddle where each ball starts
const TAP_TILT = 12; // degrees of tilt in the touch fallback

type State = 'intro' | 'playing' | 'paused' | 'falling' | 'over';
type Input = 'motion' | 'touch';

interface Settings {
  ball: BallName;
  /** Tilt effect, 0–100 (%): how much of your tilt the paddle follows. */
  tilt: number;
  /** Calibrated level (degrees) and accelerometer bias / noise. */
  level: { beta: number; gamma: number };
  bias: V3;
  deadband: number;
  calibrated: boolean;
}
const DEFAULTS: Settings = { ball: 'real', tilt: 50, level: { beta: 0, gamma: 0 }, bias: [0, 0, 0], deadband: 0.12, calibrated: false };
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export const mount: MountFn = (root, { slug, signal }) => {
  useStyles(css, signal);
  const bestKey = `${slug}:best`;
  let best = Number(localStorage.getItem(bestKey)) || 0;
  const settingsKey = `${slug}:settings`;
  const settings: Settings = structuredClone(DEFAULTS);
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(settingsKey) || '{}'));
  } catch {
    /* defaults */
  }
  if (!(settings.ball in BALLS)) settings.ball = 'real';
  const saveSettings = () => localStorage.setItem(settingsKey, JSON.stringify(settings));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- DOM ----------
  const canvas = h('canvas', { class: 'pb-canvas', 'aria-label': 'Paddle and ball' });
  const scoreEl = h('output', { class: 'pb-score', 'aria-label': 'Score' }, '0');
  const bestEl = h('span', { class: 'pb-best' }, icon(Trophy, 16), h('span', {}, `Best ${best}`));
  const status = h('p', { class: 'pb-status', role: 'status' });
  const modeChip = h('span', { class: 'pb-chip' });

  const restartBtn = h(
    'button',
    { class: 'pb-btn', type: 'button' },
    icon(RotateCcw),
    h('span', {}, 'Restart'),
  ) as HTMLButtonElement;
  const pauseBtn = h('button', { class: 'pb-btn', type: 'button' }, icon(Pause), h('span', {}, 'Pause')) as HTMLButtonElement;
  const calibBtn = h('button', { class: 'pb-btn', type: 'button' }, icon(Crosshair), h('span', {}, 'Calibrate')) as HTMLButtonElement;

  const cardTitle = h('h2', { class: 'pb-card-title' });
  const cardBody = h('div', { class: 'pb-card-body' });
  const primaryBtn = h('button', { class: 'pb-btn pb-primary', type: 'button' }, icon(Play, 20), h('span', {}, 'Start'));
  const tapBtn = h('button', { class: 'pb-btn', type: 'button' }, icon(Hand), h('span', {}, 'Play with taps instead'));
  const cardCalibBtn = h('button', { class: 'pb-btn', type: 'button' }, icon(Crosshair), h('span', {}, 'Calibrate'));
  const card = h(
    'div',
    { class: 'pb-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'pb-card-title' },
    cardTitle,
    cardBody,
    h('div', { class: 'pb-card-actions' }, primaryBtn, cardCalibBtn, tapBtn),
  );
  cardTitle.id = 'pb-card-title';

  // ---------- calibration & settings panel ----------
  const levelCanvas = h('canvas', { class: 'pb-level', 'aria-hidden': 'true' });
  const levelRead = h('output', { class: 'pb-level-read' });
  const calibMsg = h('p', { class: 'pb-note pb-calib-msg', role: 'status' });
  const setLevelBtn = h('button', { class: 'pb-btn pb-primary', type: 'button' }, icon(Crosshair, 20), h('span', {}, 'Set level')) as HTMLButtonElement;
  const resetLevelBtn = h('button', { class: 'pb-btn', type: 'button' }, icon(RotateCcw), h('span', {}, 'Use true level')) as HTMLButtonElement;
  const ballSeg = h('fieldset', { class: 'pb-seg' }, h('legend', {}, 'Ball'));
  const ballRow = h('div', { class: 'pb-seg-row' });
  const ballHint = h('p', { class: 'pb-hint' });
  const ballHints: Record<BallName, string> = {
    real: 'A ping-pong ball under real gravity.',
    floaty: 'Light and slow, like a balloon. Falls gently and drifts less.',
  };
  for (const name of Object.keys(BALLS) as BallName[]) {
    const input = h('input', { type: 'radio', name: `${slug}-ball`, value: name }) as HTMLInputElement;
    input.checked = settings.ball === name;
    input.addEventListener(
      'change',
      () => {
        if (!input.checked) return;
        settings.ball = name;
        saveSettings();
        ballHint.textContent = ballHints[name];
        calibMsg.textContent = `${BALLS[name].label} ball`;
      },
      { signal },
    );
    ballRow.append(h('label', { class: 'pb-seg-opt' }, input, h('span', {}, BALLS[name].label)));
  }
  ballHint.textContent = ballHints[settings.ball];
  ballSeg.append(ballRow, ballHint);
  const tiltInput = h('input', { type: 'range', min: 0, max: 100, step: 5, value: settings.tilt, id: `${slug}-tilt` }) as HTMLInputElement;
  const tiltOut = h('output', { class: 'pb-range-val', for: `${slug}-tilt` }, `${settings.tilt}%`);
  const tiltRow = h(
    'div',
    { class: 'pb-range' },
    h('label', { for: `${slug}-tilt` }, 'Tilt effect'),
    tiltInput,
    tiltOut,
  );
  const tiltHint = h('p', { class: 'pb-hint' }, 'How much tilting steers the ball. 100% is real physics; lower is steadier.');
  const soundBtn = h(
    'button',
    { class: 'pb-btn pb-toggle', type: 'button', 'aria-pressed': 'true' },
    icon(Volume2),
    h('span', {}, 'Sound'),
  ) as HTMLButtonElement;
  const doneBtn = h('button', { class: 'pb-btn', type: 'button' }, icon(Check), h('span', {}, 'Done')) as HTMLButtonElement;
  const calib = h(
    'div',
    { class: 'pb-card pb-calib', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'pb-calib-title' },
    h('h2', { class: 'pb-card-title', id: 'pb-calib-title' }, 'Calibrate'),
    h('div', { class: 'pb-level-wrap' }, levelCanvas, levelRead),
    h('p', { class: 'pb-note' }, 'Hold the phone the way you’ll play: screen up, as flat as feels natural, gripped firmly. Tap Set level and keep still for 2 seconds.'),
    calibMsg,
    h('div', { class: 'pb-card-actions' }, setLevelBtn, resetLevelBtn),
    h('hr', { class: 'pb-rule' }),
    ballSeg,
    tiltRow,
    tiltHint,
    h('div', { class: 'pb-card-actions' }, soundBtn, doneBtn),
  );
  calib.hidden = true;
  const overlay = h('div', { class: 'pb-overlay' }, card, calib);

  const wrap = h(
    'div',
    { class: 'pb' },
    canvas,
    h('div', { class: 'pb-hud' }, h('div', { class: 'pb-hud-row' }, bestEl, modeChip), scoreEl, status),
    h('div', { class: 'pb-bar', role: 'group', 'aria-label': 'Game controls' }, pauseBtn, restartBtn, calibBtn),
    overlay,
  );
  root.append(wrap);
  const ctx2d = canvas.getContext('2d')!;

  // ---------- state ----------
  let state: State = 'intro';
  let input: Input = 'motion';
  let sensorsLive = false;
  let sound: Sound | null = null;
  let muted = false;
  let score = 0;
  let streak = 0;
  let overReason = '';
  let overAt = 0; // performance.now() when the game-over card should appear
  let lostBelow = false; // the ball went past the paddle (draw nothing)
  const tracker = new PaddleTracker();
  const applySettings = () => {
    tracker.tiltGain = settings.tilt / 100;
    tracker.level = { ...settings.level };
    tracker.bias = [...settings.bias] as V3;
    tracker.deadband = settings.deadband;
  };
  applySettings();
  const kind = () => BALLS[settings.ball];
  const ball: Ball = { p: [0, 0, SPAWN_H], v: [0, 0, 0] };
  let lastRelZ = SPAWN_H;
  let rel: V3 = [0, 0, SPAWN_H]; // ball centre in the paddle's frame (x right, y up the screen, z out of it)

  // touch fallback
  let tapT = -1e9;
  let tapTiltX = 0; // degrees
  let tapTiltY = 0;

  // effects, in paddle coordinates (metres)
  type Pop = { text: string; x: number; y: number; t0: number; tone: 'good' | 'sweet' | 'dead' };
  const pops: Pop[] = [];
  const ripples: { x: number; y: number; t0: number; s: number }[] = [];
  let flashT = -1e9;

  const setStatus = (s: string) => {
    if (status.textContent !== s) status.textContent = s;
  };

  // ---------- sensors ----------
  addEventListener(
    'deviceorientation',
    (e) => {
      if (input !== 'motion' || e.beta == null || e.gamma == null) return;
      tracker.onOrientation(e.alpha ?? 0, e.beta, e.gamma, performance.now());
    },
    { signal },
  );
  addEventListener(
    'devicemotion',
    (e) => {
      if (input === 'motion') tracker.onMotion(e, performance.now());
    },
    { signal },
  );

  // Touch / mouse fallback: tap = push up; the pointer tilts the paddle away from it,
  // so tapping on the ball sends it back toward the middle.
  const pointerTilt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    tapTiltX = -nx * TAP_TILT;
    tapTiltY = -ny * TAP_TILT;
  };
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (input === 'touch' && e.pointerType === 'mouse') pointerTilt(e);
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (input !== 'touch' || state !== 'playing') return;
      pointerTilt(e);
      tapT = performance.now();
    },
    { signal },
  );
  addEventListener(
    'keydown',
    (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      if (e.code === 'Space' && state === 'playing') {
        e.preventDefault();
        if (input === 'touch') tapT = performance.now();
      }
    },
    { signal },
  );

  // ---------- game flow ----------
  const resetBall = () => {
    const now = performance.now();
    tracker.reset(now);
    const jitter = () => (Math.random() - 0.5) * 0.008;
    ball.p = add(tracker.posAt(now), [jitter(), jitter(), SPAWN_H]);
    ball.v = [0, 0, 0];
    lastRelZ = SPAWN_H;
    lostBelow = false;
  };

  const startGame = () => {
    score = 0;
    streak = 0;
    scoreEl.textContent = '0';
    pops.length = ripples.length = 0;
    resetBall();
    state = 'playing';
    overlay.hidden = true;
    modeChip.hidden = false;
    pauseBtn.disabled = false;
    setStatus(input === 'motion' ? 'Keep it over the screen and push up as it lands' : 'Tap on the ball as it lands');
  };

  const showCard = (title: string, body: (Node | string)[], primary: string, primaryIcon = Play, showTap = false) => {
    cardCalibBtn.hidden = true;
    calib.hidden = true;
    card.hidden = false;
    cardTitle.textContent = title;
    cardBody.replaceChildren(...body);
    primaryBtn.replaceChildren(icon(primaryIcon, 20), h('span', {}, primary));
    tapBtn.hidden = !showTap;
    overlay.hidden = false;
    primaryBtn.focus({ preventScroll: true });
  };

  const intro = () => {
    state = 'intro';
    pauseBtn.disabled = true;
    showCard(
      'Paddle Bounce',
      [
        h(
          'ol',
          { class: 'pb-steps' },
          h('li', {}, icon(Smartphone, 16), h('span', {}, 'Your phone is the paddle: the whole screen, at real size. Hold it flat, screen up, and grip it firmly.')),
          h('li', {}, h('span', { class: 'pb-dot' }), h('span', {}, 'The ball hangs in the room above it. Move the phone under it and the ball moves on screen just as it would in real life. Off the edge, an arrow shows where it went.')),
          h('li', {}, icon(Hand, 16), h('span', {}, 'Push up gently as it lands to keep it bouncing. Tilt to send it back to the middle. Bounces in the centre ring score double.')),
        ),
        h(
          'p',
          { class: 'pb-note' },
          settings.calibrated
            ? 'Turn on Portrait Orientation Lock so the screen doesn’t rotate. Unfold your phone for a bigger paddle.'
            : 'First time? Calibrate sets the tilt you naturally hold as level, and lets you pick a slower, floatier ball. Turn on Portrait Orientation Lock too.',
        ),
      ],
      'Start',
      Play,
      true,
    );
    cardCalibBtn.hidden = false;
    setStatus('');
  };

  const gameOver = (reason: string) => {
    state = 'over';
    pauseBtn.disabled = true;
    const isBest = score > best;
    if (isBest) {
      best = score;
      localStorage.setItem(bestKey, String(best));
      bestEl.lastElementChild!.textContent = `Best ${best}`;
    }
    showCard(
      reason,
      [
        h('p', { class: 'pb-final' }, h('span', { class: 'pb-final-num' }, String(score)), h('span', {}, score === 1 ? 'point' : 'points')),
        h('p', { class: 'pb-note' }, isBest && score > 0 ? 'New best!' : `Best ${best}`),
      ],
      'Play again',
      RotateCcw,
    );
    cardCalibBtn.hidden = false;
    setStatus(`${reason}. ${score} points.`);
  };

  const pause = () => {
    if (state !== 'playing') return;
    state = 'paused';
    pauseBtn.disabled = true;
    showPaused();
  };
  const showPaused = () => {
    showCard('Paused', [h('p', { class: 'pb-note' }, `Score ${score}`)], 'Resume');
    cardCalibBtn.hidden = false;
    setStatus('Paused');
  };

  /** Ask for motion access (must run inside a tap) and check that data arrives. */
  const ensureSensors = async (btn: HTMLButtonElement) => {
    if (sensorsLive) return { ok: true, perm: 'granted' as const };
    setBusy(btn, true);
    setStatus('Asking for motion access…');
    const perm = await requestMotion();
    if (perm === 'granted' && !signal.aborted) {
      setStatus('Waiting for motion sensors…');
      sensorsLive = await waitForMotion(signal);
    }
    setBusy(btn, false);
    setStatus('');
    return { ok: sensorsLive, perm };
  };

  const begin = async (mode: Input) => {
    // Audio must be created inside the tap so iOS unlocks it.
    if (!sound) {
      sound = createSound(signal);
      sound.setMuted(muted);
    } else void sound.ctx.resume();
    hapticTick();
    if (mode === 'touch' || sensorsLive) {
      input = sensorsLive && mode === 'motion' ? 'motion' : 'touch';
      updateChip();
      startGame();
      return;
    }
    const { perm } = await ensureSensors(primaryBtn as HTMLButtonElement);
    if (signal.aborted) return;
    if (!sensorsLive) {
      input = 'touch';
      updateChip();
      showCard(
        perm === 'denied' ? 'Motion access was blocked' : 'No motion sensors found',
        [
          h(
            'p',
            { class: 'pb-note' },
            perm === 'denied'
              ? 'You can still play by tapping. To swing for real, reload and allow motion access when asked.'
              : 'This device isn’t sending motion data, so tap (or press Space) to swing. Move the pointer to tilt.',
          ),
        ],
        'Play with taps',
        Hand,
      );
      setStatus(perm === 'denied' ? 'Motion access blocked' : 'No motion sensors');
      primaryOverride = 'touch';
      return;
    }
    input = 'motion';
    updateChip();
    void keepAwake(signal);
    startGame();
  };
  let primaryOverride: Input | null = null;

  // ---------- calibration ----------
  let calibReturn: () => void = () => intro();
  let capturing = false;
  const openCalib = async (btn: HTMLButtonElement) => {
    if (state === 'playing') {
      state = 'paused';
      pauseBtn.disabled = true;
    }
    calibReturn = state === 'over' ? () => gameOver(overReason) : state === 'paused' ? showPaused : intro;
    if (!sensorsLive && input === 'motion') await ensureSensors(btn);
    if (signal.aborted) return;
    card.hidden = true;
    calib.hidden = false;
    overlay.hidden = false;
    calibMsg.textContent = sensorsLive
      ? settings.calibrated
        ? 'Calibrated. Set level again any time.'
        : 'Not calibrated yet: using true level.'
      : 'No motion sensors, so there’s no level to set. Ball and tilt settings still apply to tap mode.';
    setLevelBtn.disabled = resetLevelBtn.disabled = !sensorsLive;
    setLevelBtn.focus({ preventScroll: true });
    setStatus('Calibrating');
  };
  const closeCalib = () => {
    if (capturing) return;
    calib.hidden = true;
    card.hidden = false;
    calibReturn();
  };

  /** Hold still for 2 s: the average tilt becomes "level", and the accelerometer's bias and noise are measured. */
  const captureLevel = async () => {
    capturing = true;
    setBusy(setLevelBtn, true);
    resetLevelBtn.disabled = doneBtn.disabled = true;
    const samples: { b: number; g: number; a: V3 }[] = [];
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const id = setInterval(() => {
        samples.push({ b: tracker.raw.beta, g: tracker.raw.gamma, a: tracker.rawAccel });
        const left = 2 - (performance.now() - t0) / 1000;
        calibMsg.textContent = `Hold still… ${Math.max(1, Math.ceil(left))}`;
        if (left <= 0) {
          clearInterval(id);
          resolve();
        }
      }, 40);
      signal.addEventListener('abort', () => (clearInterval(id), resolve()), { once: true });
    });
    capturing = false;
    setBusy(setLevelBtn, false);
    resetLevelBtn.disabled = doneBtn.disabled = false;
    if (signal.aborted || samples.length < 10) {
      calibMsg.textContent = 'No sensor data came in. Try again.';
      return;
    }
    const b0 = samples[0].b;
    const g0 = samples[0].g;
    const mb = b0 + samples.reduce((t, x) => t + wrap180(x.b - b0), 0) / samples.length;
    const mg = g0 + samples.reduce((t, x) => t + wrap180(x.g - g0), 0) / samples.length;
    const ma = scale(samples.reduce((t, x) => add(t, x.a), [0, 0, 0] as V3), 1 / samples.length);
    const noise = Math.sqrt(samples.reduce((t, x) => t + dot(sub(x.a, ma), sub(x.a, ma)), 0) / samples.length);
    if (noise > 0.6) {
      calibMsg.textContent = 'Too much movement to read the level. Brace your elbow and try again.';
      hapticTick();
      return;
    }
    Object.assign(settings, {
      level: { beta: wrap180(mb), gamma: wrap180(mg) },
      bias: ma,
      deadband: Math.max(0.06, Math.min(0.3, noise * 3)),
      calibrated: true,
    });
    saveSettings();
    applySettings();
    hapticTick();
    const tilt = Math.hypot(settings.level.beta, settings.level.gamma);
    calibMsg.textContent = `Level set (${tilt.toFixed(1)}° from true flat). Sensor noise ${noise < 0.05 ? 'low' : noise < 0.15 ? 'medium' : 'high'}.`;
  };

  calibBtn.addEventListener('click', () => void openCalib(calibBtn), { signal });
  cardCalibBtn.addEventListener('click', () => void openCalib(cardCalibBtn as HTMLButtonElement), { signal });
  setLevelBtn.addEventListener('click', () => void captureLevel(), { signal });
  resetLevelBtn.addEventListener(
    'click',
    () => {
      Object.assign(settings, { level: DEFAULTS.level, bias: DEFAULTS.bias, deadband: DEFAULTS.deadband, calibrated: false });
      saveSettings();
      applySettings();
      calibMsg.textContent = 'Using true level. Calibration cleared.';
    },
    { signal },
  );
  tiltInput.addEventListener(
    'input',
    () => {
      settings.tilt = Number(tiltInput.value);
      tiltOut.textContent = `${settings.tilt}%`;
      saveSettings();
      applySettings();
    },
    { signal },
  );
  doneBtn.addEventListener('click', closeCalib, { signal });
  calib.addEventListener('keydown', (e) => e.key === 'Escape' && closeCalib(), { signal });

  primaryBtn.addEventListener(
    'click',
    () => {
      if (state === 'paused') {
        state = 'playing';
        overlay.hidden = true;
        pauseBtn.disabled = false;
        void sound?.ctx.resume();
        setStatus('');
        return;
      }
      if (state === 'over') {
        hapticTick();
        void sound?.ctx.resume();
        startGame();
        return;
      }
      void begin(primaryOverride ?? 'motion');
    },
    { signal },
  );
  tapBtn.addEventListener('click', () => void begin('touch'), { signal });
  pauseBtn.addEventListener('click', pause, { signal });
  restartBtn.addEventListener(
    'click',
    () => {
      if (state === 'intro') return void begin(primaryOverride ?? 'motion');
      hapticTick();
      startGame();
    },
    { signal },
  );
  soundBtn.addEventListener(
    'click',
    () => {
      muted = !muted;
      soundBtn.setAttribute('aria-pressed', String(!muted));
      sound?.setMuted(muted);
      setStatus(muted ? 'Sound off' : 'Sound on');
    },
    { signal },
  );
  document.addEventListener('visibilitychange', () => document.hidden && pause(), { signal });

  const updateChip = () => {
    modeChip.replaceChildren(
      icon(input === 'motion' ? Smartphone : Hand, 16),
      h('span', {}, input === 'motion' ? 'Motion' : 'Taps'),
    );
  };
  updateChip();

  // ---------- physics ----------
  let W = 0, H = 0, dpr = 1;
  const halfW = () => W / 2 / PX_PER_M;
  const halfH = () => H / 2 / PX_PER_M;
  /** Paddle-frame point → screen-frame metres (x right, y down), handling screen rotation. */
  const toScr = (x: number, y: number) => toScreen(x, -y);

  const endSoon = (reason: string, below: boolean, delay = 900) => {
    state = 'falling';
    overReason = reason;
    lostBelow = below;
    overAt = performance.now() + delay;
    streak = 0;
  };

  const contact = (now: number) => {
    const rDev: V3 = [rel[0], rel[1], 0];
    const n = tracker.normal();
    // Rest the ball on the surface, then bounce it off the moving paddle.
    ball.p = add(ball.p, scale(n, BALL_R - rel[2]));
    const res = bounce(ball, tracker, rDev, kind());
    if (!res) return;
    const vOut = dot(sub(ball.v, tracker.pointVel(rDev)), n);
    const apex = (vOut * vOut) / (2 * kind().g * Math.max(0.3, n[2]));
    const dist = Math.hypot(rel[0], rel[1]);
    const pushed = res.push > PUSH;
    const strength = Math.min(1, res.approach / 3 + Math.max(0, res.push) / 1.5);
    ripples.push({ x: rel[0], y: rel[1], t0: now, s: 0.4 + strength });
    if (apex < DEAD_APEX) {
      sound?.tok(0.2, { dead: true });
      endSoon('The ball died out', false, 700);
      setStatus('It stopped bouncing. Push up a little as it lands');
      return;
    }
    const sweet = dist < SWEET_R;
    const pts = sweet ? 2 : 1;
    score += pts;
    streak = sweet ? streak + 1 : 0;
    scoreEl.textContent = String(score);
    scoreEl.classList.remove('is-pop');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('is-pop');
    sound?.tok(strength, { dead: !pushed && res.approach < 1.2, sweet, streak });
    hapticTick();
    flashT = now;
    pops.push({ text: sweet ? '+2 Sweet' : '+1', x: rel[0], y: rel[1], t0: now, tone: sweet ? 'sweet' : pushed ? 'good' : 'dead' });
    if (sweet) setStatus(`Centre ring × ${streak}`);
    else if (!pushed && apex < 0.08) setStatus('Getting low. Push up as it lands');
    else setStatus(pushed ? 'Nice push' : 'Bounce');
  };

  const step = (dt: number, now: number) => {
    if (state !== 'playing' && state !== 'falling') return;
    stepBall(ball, dt, kind());
    rel = mulT(tracker.R, sub(ball.p, tracker.posAt(now)));
    if (state !== 'playing') return;
    const [sx, sy] = toScr(rel[0], rel[1]);
    const inside = Math.abs(sx) <= halfW() + EDGE && Math.abs(sy) <= halfH() + EDGE;
    if (inside && rel[2] < BALL_R && lastRelZ > -BALL_R * 0.5) contact(now);
    else if (rel[2] < -BALL_R) {
      endSoon('Missed the paddle', true);
      sound?.drop();
      setStatus('It fell past the edge');
    }
    rel = mulT(tracker.R, sub(ball.p, tracker.posAt(now)));
    lastRelZ = rel[2];
  };

  /** Seconds until the ball reaches the paddle plane (rough: ignores drag and paddle motion). */
  const timeToContact = () => {
    const n = tracker.normal();
    const vn = dot(sub(ball.v, tracker.vel), n);
    const an = -kind().g * n[2];
    const gap = rel[2] - BALL_R;
    // gap + vn t + ½ an t² = 0
    const d = vn * vn - 2 * an * gap;
    if (d < 0 || an >= 0) return Infinity;
    return (-vn - Math.sqrt(d)) / an;
  };

  // ---------- rendering ----------
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // Pimpled rubber texture, built once.
  const tex = document.createElement('canvas');
  tex.width = tex.height = 14;
  {
    const t = tex.getContext('2d')!;
    t.fillStyle = 'rgba(0,0,0,0.12)';
    t.beginPath();
    t.arc(7, 7, 2.2, 0, Math.PI * 2);
    t.fill();
    t.fillStyle = 'rgba(255,255,255,0.06)';
    t.beginPath();
    t.arc(6.2, 6.2, 1, 0, Math.PI * 2);
    t.fill();
  }
  const pattern = ctx2d.createPattern(tex, 'repeat');

  const draw = (now: number) => {
    const c = ctx2d;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = W / 2;
    const cy = H / 2;
    const P = PX_PER_M;
    const project = (x: number, y: number, z: number): [number, number, number] => {
      // True perspective would make a high ball fill the screen; cap the growth so the paddle stays readable.
      const f = EYE / (EYE - Math.max(-0.05, Math.min(0.1, z)));
      const [sx, sy] = toScr(x * f, y * f);
      return [cx + sx * P, cy + sy * P, f];
    };

    // The paddle: the whole canvas. Lit from above, brighter on the side that's tilted up.
    const up = mulT(tracker.R, [0, 0, 1]);
    const [hx, hy] = toScr(up[0], up[1]);
    const lx = cx + hx * W * 1.2;
    const ly = cy + hy * H * 1.2;
    const lit = c.createRadialGradient(lx, ly, 0, cx, cy, Math.hypot(W, H) * 0.8);
    lit.addColorStop(0, '#f2544a');
    lit.addColorStop(0.6, '#c92a24');
    lit.addColorStop(1, '#7d1310');
    c.fillStyle = lit;
    c.fillRect(0, 0, W, H);
    if (pattern) {
      c.fillStyle = pattern;
      c.fillRect(0, 0, W, H);
    }
    c.strokeStyle = 'rgba(214,160,100,0.85)'; // the edge of the paddle is the edge of the screen
    c.lineWidth = 4;
    c.strokeRect(2, 2, W - 4, H - 4);

    // centre ring (double points)
    const [ox, oy] = project(0, 0, 0);
    c.beginPath();
    c.arc(ox, oy, SWEET_R * P, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.setLineDash([5, 7]);
    c.lineWidth = 2;
    c.stroke();
    c.setLineDash([]);

    const fa = reduced.matches ? 0 : Math.max(0, 1 - (now - flashT) / 160);
    if (fa > 0) {
      c.fillStyle = `rgba(255,240,220,${0.14 * fa})`;
      c.fillRect(0, 0, W, H);
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const t = (now - r.t0) / 450;
      if (t >= 1) {
        ripples.splice(i, 1);
        continue;
      }
      const [x, y] = project(r.x, r.y, 0);
      c.beginPath();
      c.arc(x, y, BALL_R * P * (0.6 + t * 1.6 * r.s), 0, Math.PI * 2);
      c.strokeStyle = `rgba(255,255,255,${0.45 * (1 - t)})`;
      c.lineWidth = 3 * (1 - t) + 1;
      c.stroke();
    }

    if (state !== 'intro' && !lostBelow) {
      // Shadow: straight down (world) onto the paddle's surface.
      const down = mulT(tracker.R, [0, 0, -1]);
      if (down[2] < -0.3 && rel[2] > -BALL_R) {
        const t = rel[2] / -down[2];
        const [x, y] = project(rel[0] + t * down[0], rel[1] + t * down[1], 0);
        const r = BALL_R * P * (0.9 + rel[2] * 1.2);
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        const a = 0.5 / (1 + rel[2] * 8);
        g.addColorStop(0, `rgba(40,0,0,${a})`);
        g.addColorStop(1, 'rgba(40,0,0,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }

      const [bx, by, f] = project(rel[0], rel[1], rel[2]);
      const br = BALL_R * P * f;

      // approach ring: closes onto the ball as it reaches the paddle
      if (state === 'playing') {
        const ttc = timeToContact();
        if (ttc < 0.35) {
          const q = ttc / 0.35;
          c.beginPath();
          c.arc(bx, by, br * (1.04 + q * 1.4), 0, Math.PI * 2);
          c.strokeStyle = `rgba(255,236,170,${0.9 * (1 - q)})`;
          c.lineWidth = 3;
          c.stroke();
        }
      }

      // the ball (a touch see-through when it's high, so the shadow shows)
      const alpha = 1 - Math.min(0.4, Math.max(0, rel[2] - 0.03) * 2.5);
      const g = c.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.7, `rgba(255,244,228,${alpha})`);
      g.addColorStop(1, `rgba(206,188,160,${alpha})`);
      c.fillStyle = g;
      c.beginPath();
      c.arc(bx, by, br, 0, Math.PI * 2);
      c.fill();

      // Off the screen: an edge marker pointing at it, with how far out it is.
      const pad = 30;
      const hide = br * 0.5; // only once the ball is mostly off-screen
      if (bx < -hide || bx > W + hide || by < -hide || by > H + hide) {
        const mx = Math.max(pad, Math.min(W - pad, bx));
        const my = Math.max(pad, Math.min(H - pad, by));
        const ang = Math.atan2(by - my, bx - mx);
        const [sx, sy] = toScr(rel[0], rel[1]);
        const out = Math.hypot(Math.max(0, Math.abs(sx) - halfW()), Math.max(0, Math.abs(sy) - halfH()));
        const falling = dot(ball.v, [0, 0, 1]) < 0;
        const col = falling ? '255,196,120' : '255,255,255';
        const mr = 12 + Math.min(10, Math.max(0, rel[2]) * 30);
        c.beginPath();
        c.arc(mx, my, mr, 0, Math.PI * 2);
        c.fillStyle = `rgba(20,8,8,0.55)`;
        c.fill();
        c.strokeStyle = `rgba(${col},0.95)`;
        c.lineWidth = 2.5;
        c.stroke();
        c.save();
        c.translate(mx, my);
        c.rotate(ang);
        c.beginPath();
        c.moveTo(mr + 12, 0);
        c.lineTo(mr + 2, -7);
        c.lineTo(mr + 2, 7);
        c.closePath();
        c.fillStyle = `rgba(${col},0.95)`;
        c.fill();
        c.restore();
        c.font = '700 13px ui-sans-serif, system-ui, -apple-system, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = `rgb(${col})`;
        c.fillText(`${Math.max(1, Math.round(out * 100))}`, mx, my - 1);
        c.font = '600 9px ui-sans-serif, system-ui, -apple-system, sans-serif';
        c.fillText('cm', mx, my + mr + 9);
      }
    }

    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.font = '700 20px ui-sans-serif, system-ui, -apple-system, sans-serif';
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      const t = (now - p.t0) / 700;
      if (t >= 1) {
        pops.splice(i, 1);
        continue;
      }
      const [x, y] = project(p.x, p.y, 0);
      const rise = reduced.matches ? 0 : t * 36;
      c.fillStyle =
        p.tone === 'sweet' ? `rgba(255,226,120,${1 - t})` : p.tone === 'dead' ? `rgba(220,230,255,${1 - t})` : `rgba(255,255,255,${1 - t})`;
      c.fillText(p.text, x, y - BALL_R * P * 1.3 - rise);
    }
  };

  // Live level: the dot rolls downhill, relative to your calibrated level.
  const lc = levelCanvas.getContext('2d')!;
  const drawLevel = () => {
    const size = 168;
    const d = Math.min(devicePixelRatio || 1, 2);
    if (levelCanvas.width !== size * d) {
      levelCanvas.width = levelCanvas.height = size * d;
    }
    lc.setTransform(d, 0, 0, d, 0, 0);
    lc.clearRect(0, 0, size, size);
    const c = size / 2;
    const r = c - 4;
    lc.fillStyle = 'rgba(255,255,255,0.05)';
    lc.beginPath();
    lc.arc(c, c, r, 0, Math.PI * 2);
    lc.fill();
    const MAX = 10; // degrees at the rim
    for (const deg of [2, 5, 10]) {
      lc.beginPath();
      lc.arc(c, c, (deg / MAX) * r, 0, Math.PI * 2);
      lc.strokeStyle = deg === 2 ? 'rgba(140,230,170,0.6)' : 'rgba(255,255,255,0.18)';
      lc.lineWidth = deg === 2 ? 2 : 1;
      lc.stroke();
    }
    if (!sensorsLive) {
      levelRead.textContent = 'No motion sensors';
      return;
    }
    const db = wrap180(tracker.raw.beta - settings.level.beta);
    const dg = wrap180(tracker.raw.gamma - settings.level.gamma);
    const [sx, sy] = toScreen(dg, db); // right edge down → dot right; top edge up → dot down
    const mag = Math.hypot(sx, sy);
    const k = mag > MAX ? MAX / mag : 1;
    const x = c + (sx * k * r) / MAX;
    const y = c + (sy * k * r) / MAX;
    const ok = mag <= 2;
    lc.beginPath();
    lc.arc(x, y, 10, 0, Math.PI * 2);
    lc.fillStyle = ok ? '#8ce6aa' : '#ffd08a';
    lc.fill();
    levelRead.textContent = `${mag.toFixed(1)}° ${ok ? 'level' : 'tilted'}`;
  };

  // ---------- loop ----------
  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (input === 'touch') {
      const age = (now - tapT) / 1000;
      const vz = age >= 0 && age < 0.16 ? 1.3 * (1 - age / 0.16) : 0;
      tracker.manual(tapTiltY, tapTiltX, vz, now);
    }
    // Small fixed substeps so fast balls can't skip through the paddle.
    const n = Math.ceil(dt / 0.002);
    for (let i = 0; i < n; i++) step(dt / n, now - (dt * 1000 * (n - 1 - i)) / n);
    if (state === 'falling' && now >= overAt) gameOver(overReason);
    draw(now);
    if (!calib.hidden) drawLevel();
  };
  raf = requestAnimationFrame(frame);

  intro();

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
};
