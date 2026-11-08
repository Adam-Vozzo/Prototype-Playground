import { Hand, Pause, Play, RotateCcw, Smartphone, Trophy, Volume2 } from 'lucide';
import { h, useStyles } from '../../lib/dom';
import { setBusy } from '../../lib/feedback';
import { hapticTick } from '../../lib/haptics';
import { icon } from '../../lib/icon';
import { keepAwake, requestMotion, toScreen, waitForMotion } from '../../lib/sensors';
import type { MountFn } from '../../types';
import {
  add,
  BALL_R,
  bounce,
  dot,
  G,
  mulT,
  PaddleTracker,
  PX_PER_M,
  scale,
  stepBall,
  sub,
  type Ball,
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

export const mount: MountFn = (root, { slug, signal }) => {
  useStyles(css, signal);
  const bestKey = `${slug}:best`;
  let best = Number(localStorage.getItem(bestKey)) || 0;
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
  const soundBtn = h(
    'button',
    { class: 'pb-btn', type: 'button', 'aria-pressed': 'true' },
    icon(Volume2),
    h('span', {}, 'Sound'),
  ) as HTMLButtonElement;

  const cardTitle = h('h2', { class: 'pb-card-title' });
  const cardBody = h('div', { class: 'pb-card-body' });
  const primaryBtn = h('button', { class: 'pb-btn pb-primary', type: 'button' }, icon(Play, 20), h('span', {}, 'Start'));
  const tapBtn = h('button', { class: 'pb-btn', type: 'button' }, icon(Hand), h('span', {}, 'Play with taps instead'));
  const card = h(
    'div',
    { class: 'pb-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'pb-card-title' },
    cardTitle,
    cardBody,
    h('div', { class: 'pb-card-actions' }, primaryBtn, tapBtn),
  );
  cardTitle.id = 'pb-card-title';
  const overlay = h('div', { class: 'pb-overlay' }, card);

  const wrap = h(
    'div',
    { class: 'pb' },
    canvas,
    h('div', { class: 'pb-hud' }, h('div', { class: 'pb-hud-row' }, bestEl, modeChip), scoreEl, status),
    h('div', { class: 'pb-bar', role: 'group', 'aria-label': 'Game controls' }, pauseBtn, restartBtn, soundBtn),
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
        h('p', { class: 'pb-note' }, 'Turn on Portrait Orientation Lock so the screen doesn’t rotate. Unfold your phone for a bigger paddle. On iPhone, Start asks for motion access.'),
      ],
      'Start',
      Play,
      true,
    );
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
    setStatus(`${reason}. ${score} points.`);
  };

  const pause = () => {
    if (state !== 'playing') return;
    state = 'paused';
    pauseBtn.disabled = true;
    showCard('Paused', [h('p', { class: 'pb-note' }, `Score ${score}`)], 'Resume');
    setStatus('Paused');
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
    setBusy(primaryBtn as HTMLButtonElement, true);
    setStatus('Asking for motion access…');
    const perm = await requestMotion();
    if (signal.aborted) return;
    if (perm === 'granted') {
      setStatus('Waiting for motion sensors…');
      sensorsLive = await waitForMotion(signal);
    }
    setBusy(primaryBtn as HTMLButtonElement, false);
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
    const res = bounce(ball, tracker, rDev);
    if (!res) return;
    const vOut = dot(sub(ball.v, tracker.pointVel(rDev)), n);
    const apex = (vOut * vOut) / (2 * G * Math.max(0.3, n[2]));
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
    stepBall(ball, dt);
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
    const an = -G * n[2];
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
  };
  raf = requestAnimationFrame(frame);

  intro();

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
};
