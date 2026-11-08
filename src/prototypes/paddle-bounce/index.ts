import { Hand, Pause, Play, RotateCcw, Smartphone, Trophy, Volume2 } from 'lucide';
import { h, useStyles } from '../../lib/dom';
import { setBusy } from '../../lib/feedback';
import { hapticTick } from '../../lib/haptics';
import { icon } from '../../lib/icon';
import { keepAwake, requestMotion, toScreen, upAccel, waitForMotion } from '../../lib/sensors';
import type { MountFn } from '../../types';
import { createSound, type Sound } from './sound';
import css from './style.css?inline';

// ---------- tuning (metres, seconds; gravity is slowed down for playability) ----------
const G = 5.2;
const PADDLE_R = 0.075; // a real blade is ~15 cm across
const BALL_R = 0.02; // 40 mm ball
const SWEET_R = 0.028;
const V_MAX = 2.7; // ~0.7 m apex
const V_MIN_HIT = 1.45; // a weak hit still clears ~0.2 m
const E_HIT = 0.55; // how much of the incoming speed an active hit keeps
const E_DEAD = 0.66; // restitution of a still paddle
const K_SWING = 1.15; // paddle speed → ball speed
const HIT_SPEED = 0.28; // m/s of upward paddle speed that counts as a swing
const EARLY_MS = 140; // a swing peak this long before contact still counts
const LATE_MS = 120; // …and a swing this soon after a dead bounce rescues it
const TILT_K = 0.22; // tilt → sideways speed
const MAX_TILT = (35 * Math.PI) / 180;
const DEAD_APEX = 0.06; // below this the ball has died out

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
  let deadCount = 0;
  let overReason = '';
  let fallT = 0;
  let fallOff = true; // false = the ball died out on the paddle instead of falling off it
  const ball = { x: 0, y: 0, h: 0.4, vx: 0, vy: 0, vh: 0 };
  let lateUntil = 0; // performance.now() deadline for a late rescue after a dead bounce

  // paddle input
  let tiltX = 0; // radians, screen frame: + = right edge down
  let tiltY = 0; // + = bottom edge down
  let vpSensor = 0; // upward paddle speed from the accelerometer (m/s, leaky)
  let lastMotionT = 0;
  let tapT = -1e9; // touch mode: synthetic swing start
  const hist: { t: number; v: number }[] = [];

  // effects
  type Pop = { text: string; x: number; y: number; t0: number; tone: 'good' | 'sweet' | 'dead' };
  const pops: Pop[] = [];
  const ripples: { x: number; y: number; t0: number; s: number }[] = [];
  let flashT = -1e9;

  const setStatus = (s: string) => {
    if (status.textContent !== s) status.textContent = s;
  };

  const vpTouch = (now: number) => {
    const age = (now - tapT) / 1000;
    return age >= 0 && age < 0.16 ? 1.5 * (1 - age / 0.16) : 0;
  };
  const vpNow = (now: number) => Math.max(vpSensor, vpTouch(now));
  const record = (now: number) => {
    hist.push({ t: now, v: vpNow(now) });
    while (hist.length && hist[0].t < now - 400) hist.shift();
  };
  const recentMax = (now: number, ms: number) => {
    let m = vpNow(now);
    for (let i = hist.length - 1; i >= 0 && hist[i].t >= now - ms; i--) m = Math.max(m, hist[i].v);
    return m;
  };

  // ---------- sensors ----------
  addEventListener(
    'devicemotion',
    (e) => {
      if (input !== 'motion') return;
      const a = upAccel(e);
      if (a == null) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - (lastMotionT || now - 16)) / 1000));
      lastMotionT = now;
      const ad = Math.abs(a) < 0.3 ? 0 : a; // ignore hand tremor
      vpSensor = (vpSensor + ad * dt) * Math.exp(-dt / 0.22); // leaky integral: paddle speed, drifts back to 0
      record(now);
    },
    { signal },
  );
  addEventListener(
    'deviceorientation',
    (e) => {
      if (input !== 'motion' || e.beta == null || e.gamma == null) return;
      const clamp = (v: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, v));
      const [sx, sy] = toScreen(Math.sin((e.gamma * Math.PI) / 180), Math.sin((e.beta * Math.PI) / 180));
      tiltX = clamp(Math.asin(Math.max(-1, Math.min(1, sx))));
      tiltY = clamp(Math.asin(Math.max(-1, Math.min(1, sy))));
    },
    { signal },
  );

  // Touch / mouse fallback: tap = swing, position = tilt.
  const pointerTilt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    tiltX = Math.max(-1, Math.min(1, nx)) * MAX_TILT * 0.5;
    tiltY = Math.max(-1, Math.min(1, ny)) * MAX_TILT * 0.5;
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
    Object.assign(ball, { x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, h: 0.42, vx: 0, vy: 0, vh: 0 });
    lateUntil = 0;
  };

  const startGame = () => {
    score = 0;
    streak = 0;
    deadCount = 0;
    scoreEl.textContent = '0';
    pops.length = ripples.length = 0;
    resetBall();
    state = 'playing';
    overlay.hidden = true;
    pauseBtn.disabled = false;
    setStatus(input === 'motion' ? 'Flick the phone up as the ball meets its shadow' : 'Tap as the ball meets its shadow');
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
          h('li', {}, icon(Smartphone, 16), h('span', {}, 'Hold your phone flat, screen up, like a paddle. Grip it firmly.')),
          h('li', {}, h('span', { class: 'pb-dot' }), h('span', {}, 'The ball shrinks onto its shadow as it falls. A ring closes in when it’s about to land.')),
          h('li', {}, icon(Hand, 16), h('span', {}, 'Flick the phone up right as it lands. Tilt to steer it back to the middle.')),
        ),
        h('p', { class: 'pb-note' }, 'Turn the volume up. On iPhone, Start asks for motion access.'),
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
  const timeToContact = () => {
    // h + vh t − G t²/2 = 0, positive root
    const d = ball.vh * ball.vh + 2 * G * ball.h;
    return (ball.vh + Math.sqrt(Math.max(0, d))) / G;
  };

  const onContact = (now: number) => {
    const dist = Math.hypot(ball.x, ball.y);
    if (dist > PADDLE_R + BALL_R * 0.25) {
      state = 'falling';
      fallT = now;
      overReason = 'Off the edge';
      fallOff = true;
      sound?.drop();
      return;
    }
    const vin = -ball.vh;
    const vHit = recentMax(now, EARLY_MS);
    ball.h = 0;
    if (vHit > HIT_SPEED) {
      hit(now, vin, vHit, dist);
    } else {
      // Dead bounce: the paddle wasn't moving. Still allow a late rescue.
      const out = E_DEAD * vin;
      ball.vh = out;
      deadCount++;
      lateUntil = now + LATE_MS;
      sound?.tok(0.3, { dead: true });
      ripples.push({ x: ball.x, y: ball.y, t0: now, s: 0.4 });
      if ((out * out) / (2 * G) < DEAD_APEX) {
        state = 'falling';
        fallT = now;
        overReason = 'The ball died out';
        fallOff = false;
        sound?.drop();
        return;
      }
      streak = 0;
      pops.push({ text: 'Swing!', x: ball.x, y: ball.y, t0: now, tone: 'dead' });
      setStatus(deadCount > 1 ? 'Flick up harder as it lands' : 'Too still. Flick up as it lands');
    }
  };

  const hit = (now: number, vin: number, vHit: number, dist: number) => {
    const out = Math.min(V_MAX, Math.max(V_MIN_HIT, E_HIT * vin + K_SWING * vHit));
    ball.vh = out;
    // Ball leaves along the paddle's normal: it goes the way the paddle leans.
    const jitter = 0.012 + Math.min(0.03, score * 0.0012);
    ball.vx += Math.sin(tiltX) * out * TILT_K + (Math.random() - 0.5) * 2 * jitter;
    ball.vy += Math.sin(tiltY) * out * TILT_K + (Math.random() - 0.5) * 2 * jitter;
    ball.vx *= 0.85; // a little spin-free damping so it stays controllable
    ball.vy *= 0.85;
    lateUntil = 0;
    deadCount = 0;
    const sweet = dist < SWEET_R;
    const pts = sweet ? 2 : 1;
    score += pts;
    streak = sweet ? streak + 1 : 0;
    scoreEl.textContent = String(score);
    scoreEl.classList.remove('is-pop');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('is-pop');
    const strength = Math.min(1, vHit / 1.6);
    sound?.tok(strength, { sweet, streak });
    hapticTick();
    flashT = now;
    ripples.push({ x: ball.x, y: ball.y, t0: now, s: 0.6 + strength });
    pops.push({ text: sweet ? '+2 Sweet' : '+1', x: ball.x, y: ball.y, t0: now, tone: sweet ? 'sweet' : 'good' });
    setStatus(sweet ? `Sweet spot × ${streak}` : 'Nice. Hit the middle for 2');
  };

  const step = (dt: number, now: number) => {
    if (state === 'playing') {
      ball.vh -= G * dt;
      ball.h += ball.vh * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      if (ball.h <= 0 && ball.vh < 0) onContact(now);
      else if (lateUntil > now && ball.vh > 0 && vpNow(now) > HIT_SPEED) {
        // Late swing just after a dead bounce: rescue it as a hit.
        const vHit = vpNow(now);
        lateUntil = 0;
        streak = 0;
        hit(now, ball.vh / E_DEAD, vHit, Math.hypot(ball.x, ball.y));
      }
    } else if (state === 'falling') {
      ball.vh -= G * dt;
      ball.h += ball.vh * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      if (!fallOff && ball.h < 0) {
        // Dribbles to a stop on the paddle.
        ball.h = 0;
        ball.vh = Math.abs(ball.vh) * 0.45;
        ball.vx *= 0.9;
        ball.vy *= 0.9;
      }
      if (now - fallT > 900) gameOver(overReason);
    }
  };

  // ---------- rendering ----------
  let W = 0, H = 0, dpr = 1;
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

  const draw = (now: number) => {
    const c = ctx2d;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    // Fit the paddle between the HUD (top) and the control bar (bottom).
    const top = 150;
    const bottom = 76;
    const cx = W / 2;
    const cy = top + (H - top - bottom) / 2;
    const R = Math.max(60, Math.min(W * 0.46, (H - top - bottom) / 2 - 10));
    const k = R / PADDLE_R; // px per metre on the paddle face

    // table / floor
    const bg = c.createRadialGradient(cx, cy, R * 0.2, cx, cy, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#1d3b5a');
    bg.addColorStop(1, '#0a1220');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // paddle: wooden rim + red rubber, shaded by tilt (light from the high side)
    const lx = cx - Math.sin(tiltX) * R * 1.6;
    const ly = cy - Math.sin(tiltY) * R * 1.6;
    c.beginPath();
    c.arc(cx, cy, R + 7, 0, Math.PI * 2);
    c.fillStyle = '#c8935a';
    c.fill();
    const rubber = c.createRadialGradient(lx, ly, R * 0.1, cx, cy, R * 1.3);
    rubber.addColorStop(0, '#ff6a5c');
    rubber.addColorStop(0.55, '#d8302a');
    rubber.addColorStop(1, '#8e1612');
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fillStyle = rubber;
    c.fill();
    // sweet spot
    c.beginPath();
    c.arc(cx, cy, SWEET_R * k, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.setLineDash([4, 6]);
    c.lineWidth = 2;
    c.stroke();
    c.setLineDash([]);

    // hit flash
    const fa = reduced.matches ? 0 : Math.max(0, 1 - (now - flashT) / 160);
    if (fa > 0) {
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.fillStyle = `rgba(255,240,220,${0.18 * fa})`;
      c.fill();
    }

    // ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const t = (now - r.t0) / 450;
      if (t >= 1) {
        ripples.splice(i, 1);
        continue;
      }
      c.beginPath();
      c.arc(cx + r.x * k, cy + r.y * k, BALL_R * k * (1 + t * 3 * r.s), 0, Math.PI * 2);
      c.strokeStyle = `rgba(255,255,255,${0.5 * (1 - t)})`;
      c.lineWidth = 3 * (1 - t) + 1;
      c.stroke();
    }

    if (state !== 'intro') {
      const bx = cx + ball.x * k;
      const by = cy + ball.y * k;
      const br = BALL_R * k;
      const hh = Math.max(0, ball.h);
      const onPaddle = Math.hypot(ball.x, ball.y) < PADDLE_R + BALL_R;
      const falling = state === 'falling' && fallOff;

      // shadow on the paddle (only while over it)
      if (onPaddle && !falling) {
        c.beginPath();
        c.ellipse(bx, by, br * (1 + hh * 0.9), br * (1 + hh * 0.9), 0, 0, Math.PI * 2);
        c.fillStyle = `rgba(30,0,0,${0.5 / (1 + hh * 5)})`;
        c.fill();
      }

      // approach ring: closes onto the shadow as contact nears
      if (state === 'playing' && ball.vh < 0) {
        const ttc = timeToContact();
        if (ttc < 0.45) {
          const p = ttc / 0.45;
          c.beginPath();
          c.arc(bx, by, br * (1.05 + p * 2.6), 0, Math.PI * 2);
          c.strokeStyle = `rgba(255,236,170,${0.85 * (1 - p)})`;
          c.lineWidth = 3;
          c.stroke();
        }
      }

      // ball: higher = closer to your eye = bigger and further from centre
      const persp = 1 + hh * 0.55;
      const fallScale = falling ? Math.max(0.05, 1 + ball.h * 1.2) : 1;
      const px = cx + ball.x * k * persp;
      const py = cy + ball.y * k * persp;
      const pr = br * 0.9 * (1 + hh * 0.9) * fallScale;
      const alpha = falling ? Math.max(0, 1 - (now - fallT) / 900) : 1;
      const g = c.createRadialGradient(px - pr * 0.35, py - pr * 0.4, pr * 0.1, px, py, pr);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.7, `rgba(255,244,228,${alpha})`);
      g.addColorStop(1, `rgba(214,196,170,${alpha})`);
      c.beginPath();
      c.arc(px, py, pr, 0, Math.PI * 2);
      c.fillStyle = g;
      c.fill();
    }

    // score pops
    c.textAlign = 'center';
    c.font = '700 20px ui-sans-serif, system-ui, -apple-system, sans-serif';
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      const t = (now - p.t0) / 700;
      if (t >= 1) {
        pops.splice(i, 1);
        continue;
      }
      const rise = reduced.matches ? 0 : t * 36;
      c.fillStyle =
        p.tone === 'sweet' ? `rgba(255,226,120,${1 - t})` : p.tone === 'dead' ? `rgba(200,220,255,${1 - t})` : `rgba(255,255,255,${1 - t})`;
      c.fillText(p.text, cx + p.x * k, cy + p.y * k - BALL_R * k * 2.2 - rise);
    }
  };

  // ---------- loop ----------
  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (input === 'touch') record(now);
    // Fixed small substeps so contact timing doesn't depend on frame rate.
    const n = Math.ceil(dt / 0.004);
    for (let i = 0; i < n; i++) step(dt / n, now - (dt * 1000 * (n - 1 - i)) / n);
    draw(now);
  };
  raf = requestAnimationFrame(frame);

  intro();

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
};
