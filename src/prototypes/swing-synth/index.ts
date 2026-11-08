import { ChevronDown, Hand, Power, Smartphone, SlidersHorizontal } from 'lucide';
import { h, useStyles } from '../../lib/dom';
import { setBusy } from '../../lib/feedback';
import { hapticTick } from '../../lib/haptics';
import { icon } from '../../lib/icon';
import { keepAwake, requestMotion, waitForMotion } from '../../lib/sensors';
import type { MountFn } from '../../types';
import css from './style.css?inline';
import { createVoice, VOICES, type Voice, type VoiceName } from './voice';

type Notes = 'glide' | 'scale';
type Peak = 'speed' | 'gforce';
type Input = 'motion' | 'touch';

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24]; // minor pentatonic over two octaves
const ELEV_MAX = 75; // degrees above/below level that span the range
const ARM = 0.9; // metres from shoulder to the top of the phone, for tip speed
const TRAIL_MS = 2600;

const noteName = (f: number) => {
  const m = Math.round(69 + 12 * Math.log2(f / 440));
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};

interface Settings {
  voice: VoiceName;
  notes: Notes;
  peak: Peak;
}

export const mount: MountFn = (root, { slug, signal }) => {
  useStyles(css, signal);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const key = (k: string) => `${slug}:${k}`;
  const settings: Settings = { voice: 'plasma', notes: 'scale', peak: 'speed' };
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(key('settings')) || '{}'));
  } catch {
    /* defaults */
  }
  if (!(settings.voice in VOICES)) settings.voice = 'plasma';
  let best = Number(localStorage.getItem(key('best'))) || 0;

  // ---------- DOM ----------
  const canvas = h('canvas', { class: 'ss-canvas', 'aria-label': 'Swing trail' });
  const noteEl = h('output', { class: 'ss-note', 'aria-label': 'Note' }, '–');
  const speedEl = h('output', { class: 'ss-stat-v' }, '0');
  const forceEl = h('output', { class: 'ss-stat-v' }, '0.0');
  const bestEl = h('output', { class: 'ss-stat-v' }, String(best));
  const stat = (label: string, el: HTMLElement, unit: string) =>
    h('div', { class: 'ss-stat' }, h('span', { class: 'ss-stat-l' }, label), h('span', {}, el, h('span', { class: 'ss-unit' }, unit)));
  const status = h('p', { class: 'ss-status', role: 'status' });
  const modeChip = h('span', { class: 'ss-chip' });

  const intro = h(
    'div',
    { class: 'ss-intro' },
    h('h2', {}, 'Swing Synth'),
    h(
      'ol',
      { class: 'ss-steps' },
      h('li', {}, icon(Smartphone, 16), h('span', {}, 'Hold the bottom of your phone like a hilt, top pointing out. Grip it firmly.')),
      h('li', {}, icon(Power, 16), h('span', {}, 'Tap Ignite, then sweep big arcs. Point higher for higher notes.')),
      h('li', {}, icon(Hand, 16), h('span', {}, 'Faster swings build the buzzing whoosh. It peaks mid-arc, where the tip moves fastest.')),
    ),
    h('p', { class: 'ss-note-text' }, 'Headphones make it pan with your swing. On iPhone, Ignite asks for motion access.'),
  );

  const igniteBtn = h('button', { class: 'ss-btn ss-primary', type: 'button' }, icon(Power, 20), h('span', {}, 'Ignite')) as HTMLButtonElement;

  // Segmented controls (radio groups, DESIGN.md §3)
  const segmented = <T extends string>(name: string, legend: string, options: [T, string][], value: T, onChange: (v: T) => void) => {
    const fs = h('fieldset', { class: 'ss-seg' }, h('legend', {}, legend));
    const row = h('div', { class: 'ss-seg-row' });
    for (const [v, label] of options) {
      const input = h('input', { type: 'radio', name: `${slug}-${name}`, value: v }) as HTMLInputElement;
      input.checked = v === value;
      input.addEventListener('change', () => input.checked && onChange(v), { signal });
      row.append(h('label', { class: 'ss-seg-opt' }, input, h('span', {}, label)));
    }
    fs.append(row);
    return fs;
  };

  const save = () => {
    localStorage.setItem(key('settings'), JSON.stringify(settings));
    summarise();
  };
  const panelId = `${slug}-controls`;
  const panelInner = h(
    'div',
    { class: 'ss-panel-inner' },
    segmented<VoiceName>(
      'voice',
      'Voice',
      (Object.keys(VOICES) as VoiceName[]).map((v) => [v, VOICES[v].label]),
      settings.voice,
      (v) => {
        settings.voice = v;
        voice?.setVoice(v);
        save();
        setStatus(`${VOICES[v].label} voice`);
      },
    ),
    segmented<Notes>('notes', 'Notes', [['scale', 'Scale'], ['glide', 'Glide']], settings.notes, (v) => {
      settings.notes = v;
      save();
      setStatus(v === 'scale' ? 'Notes snap to a scale' : 'Notes glide smoothly');
    }),
    segmented<Peak>('peak', 'Whoosh peaks with', [['speed', 'Speed'], ['gforce', 'G-force']], settings.peak, (v) => {
      settings.peak = v;
      save();
      setStatus(v === 'speed' ? 'Whoosh follows swing speed' : 'Whoosh follows G-force (snappy starts and stops)');
    }),
  );
  const panel = h('div', { class: 'ss-panel', id: panelId }, panelInner);
  const ctrlLabel = h('span', {});
  const ctrlBtn = h(
    'button',
    { class: 'ss-btn ss-disclosure', type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
    icon(SlidersHorizontal),
    ctrlLabel,
    icon(ChevronDown, 18, 'ss-chev'),
  ) as HTMLButtonElement;
  const summarise = () => {
    ctrlLabel.textContent = `Sound · ${VOICES[settings.voice].label} · ${settings.notes === 'scale' ? 'Scale' : 'Glide'}`;
  };
  summarise();
  const setOpen = (open: boolean) => {
    ctrlBtn.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('is-open', open);
    panel.inert = !open;
  };
  setOpen(false);
  ctrlBtn.addEventListener('click', () => setOpen(ctrlBtn.getAttribute('aria-expanded') !== 'true'), { signal });
  panel.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        ctrlBtn.focus();
      }
    },
    { signal },
  );

  const wrap = h(
    'div',
    { class: 'ss' },
    canvas,
    h(
      'div',
      { class: 'ss-hud' },
      h('div', { class: 'ss-hud-row' }, modeChip),
      noteEl,
      h('div', { class: 'ss-stats' }, stat('Tip speed', speedEl, 'km/h'), stat('Force', forceEl, 'g'), stat('Best swing', bestEl, 'km/h')),
      status,
    ),
    h('div', { class: 'ss-intro-wrap' }, intro),
    h('div', { class: 'ss-dock' }, panel, h('div', { class: 'ss-bar' }, igniteBtn, ctrlBtn)),
  );
  root.append(wrap);
  const c2d = canvas.getContext('2d')!;

  // ---------- state ----------
  let voice: Voice | null = null;
  let on = false;
  let input: Input = 'motion';
  let sensorsLive = false;
  let elev = 0; // degrees, blade above (+) / below (−) level
  let az = 0; // degrees, blade direction left/right relative to where you started
  let az0: number | null = null;
  let omega = 0; // deg/s, rotation speed
  let gAbs = 0; // g, linear acceleration magnitude (without gravity)
  let drive = 0; // smoothed 0–1
  let peakD = 0;
  let rising = false;
  let swingPeakKmh = 0;
  let pulseT = -1e9;
  const trail: { x: number; y: number; d: number; t: number }[] = [];

  const setStatus = (s: string) => {
    if (status.textContent !== s) status.textContent = s;
  };
  modeChip.hidden = true; // unknown until the first Ignite
  const updateChip = () =>
    modeChip.replaceChildren(icon(input === 'motion' ? Smartphone : Hand, 16), h('span', {}, input === 'motion' ? 'Motion' : 'Drag'));
  updateChip();

  // ---------- sensors ----------
  addEventListener(
    'devicemotion',
    (e) => {
      if (input !== 'motion') return;
      const r = e.rotationRate;
      if (r && r.alpha != null) omega = Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0);
      const a = e.acceleration;
      if (a && a.x != null) gAbs = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0) / 9.81;
    },
    { signal },
  );
  addEventListener(
    'deviceorientation',
    (e) => {
      if (input !== 'motion' || e.beta == null) return;
      const b = (e.beta * Math.PI) / 180;
      const al = ((e.alpha ?? 0) * Math.PI) / 180;
      // Direction of the phone's top edge (the "blade"): Rz(α)·Rx(β)·ŷ
      const dx = -Math.sin(al) * Math.cos(b);
      const dy = Math.cos(al) * Math.cos(b);
      const dz = Math.sin(b);
      elev = (Math.asin(Math.max(-1, Math.min(1, dz))) * 180) / Math.PI;
      if (Math.hypot(dx, dy) > 0.15) {
        const heading = (Math.atan2(dx, dy) * 180) / Math.PI;
        if (az0 == null) az0 = heading;
        az = ((((heading - az0) % 360) + 540) % 360) - 180;
      }
    },
    { signal },
  );

  // Drag fallback (desktop / no sensors): x = direction, y = height, drag speed = swing speed.
  let lastPtr: { x: number; y: number; t: number } | null = null;
  const ptr = (e: PointerEvent) => {
    if (input !== 'touch' || !on) return;
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    const nAz = nx * 90;
    const nEl = -ny * ELEV_MAX;
    const t = performance.now();
    if (lastPtr) {
      const dt = Math.max(0.008, (t - lastPtr.t) / 1000);
      const deg = Math.hypot(nAz - lastPtr.x, nEl - lastPtr.y);
      const w = (deg / dt) * 3; // a finger drag covers far fewer degrees than an arm
      omega = omega * 0.5 + w * 0.5;
      gAbs = Math.min(4, w / 400);
    }
    lastPtr = { x: nAz, y: nEl, t };
    az = nAz;
    elev = nEl;
  };
  canvas.addEventListener('pointerdown', (e) => {
    lastPtr = null;
    canvas.setPointerCapture(e.pointerId);
    ptr(e);
  }, { signal });
  canvas.addEventListener('pointermove', (e) => (e.buttons || e.pointerType === 'mouse') && ptr(e), { signal });
  canvas.addEventListener('pointerup', () => (lastPtr = null), { signal });

  // ---------- pitch ----------
  const pitch = (): number => {
    const v = VOICES[settings.voice];
    const t = Math.max(0, Math.min(1, (elev + ELEV_MAX) / (2 * ELEV_MAX)));
    if (settings.notes === 'glide') return v.root * 2 ** (t * 2);
    const i = Math.round(t * (PENTA.length - 1));
    return v.root * 2 ** (PENTA[i] / 12);
  };

  // ---------- power ----------
  const powerOn = () => {
    on = true;
    az0 = null;
    trail.length = 0;
    voice!.setVoice(settings.voice);
    voice!.ignite(pitch());
    igniteBtn.replaceChildren(icon(Power, 20), h('span', {}, 'Power down'));
    wrap.classList.add('is-on');
    intro.parentElement!.hidden = true;
    setStatus(input === 'motion' ? 'Sweep big arcs. Higher points play higher notes' : 'Drag across the screen to sweep. Faster = louder whoosh');
    if (input === 'motion') void keepAwake(wakeAc.signal);
  };
  let wakeAc = new AbortController();
  signal.addEventListener('abort', () => wakeAc.abort(), { once: true });

  const powerOff = () => {
    on = false;
    voice?.powerDown();
    igniteBtn.replaceChildren(icon(Power, 20), h('span', {}, 'Ignite'));
    wrap.classList.remove('is-on');
    intro.parentElement!.hidden = false;
    wakeAc.abort();
    wakeAc = new AbortController();
    setStatus('Powered down');
  };

  igniteBtn.addEventListener(
    'click',
    async () => {
      hapticTick();
      if (on) return powerOff();
      // Create audio inside the tap so iOS unlocks it.
      voice ??= createVoice(signal);
      if (sensorsLive || input === 'touch') return powerOn();
      setBusy(igniteBtn, true);
      setStatus('Asking for motion access…');
      const perm = await requestMotion();
      if (signal.aborted) return;
      if (perm === 'granted') {
        setStatus('Waiting for motion sensors…');
        sensorsLive = await waitForMotion(signal);
      }
      setBusy(igniteBtn, false);
      if (signal.aborted) return;
      input = sensorsLive ? 'motion' : 'touch';
      updateChip();
      modeChip.hidden = false;
      powerOn();
      if (!sensorsLive) {
        setStatus(
          perm === 'denied'
            ? 'Motion access was blocked, so drag on the screen to sweep. Reload to try again.'
            : 'No motion sensors here, so drag on the screen to sweep',
        );
      }
    },
    { signal },
  );
  document.addEventListener('visibilitychange', () => document.hidden && on && powerOff(), { signal });

  // ---------- render ----------
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

  const hexA = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  const draw = (now: number) => {
    const c = c2d;
    const col = VOICES[settings.voice].color;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#07080f');
    bg.addColorStop(1, '#111426');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // Lanes fit between the HUD (top) and the dock (bottom).
    const top = 200;
    const bottom = 96;
    const cx = W / 2;
    const cy = top + (H - top - bottom) / 2;
    const sx = (W * 0.44) / 90; // px per degree of direction
    const sy = Math.max(1, (H - top - bottom) / 2 - 8) / ELEV_MAX; // px per degree of height

    // note lanes
    const v = VOICES[settings.voice];
    c.font = '600 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    if (settings.notes === 'scale') {
      const cur = noteName(pitch());
      for (let i = 0; i < PENTA.length; i++) {
        const e = -ELEV_MAX + (i / (PENTA.length - 1)) * 2 * ELEV_MAX;
        const y = cy - e * sy;
        const name = noteName(v.root * 2 ** (PENTA[i] / 12));
        const active = on && name === cur;
        c.fillStyle = active ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)';
        c.fillRect(0, y - 0.5, W, active ? 2 : 1);
        c.fillStyle = active ? col : 'rgba(255,255,255,0.35)';
        c.fillText(name, 12, y - 9);
      }
    } else {
      for (let o = 0; o <= 2; o++) {
        const e = -ELEV_MAX + o * ELEV_MAX;
        const y = cy - e * sy;
        c.fillStyle = 'rgba(255,255,255,0.06)';
        c.fillRect(0, y - 0.5, W, 1);
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.fillText(noteName(v.root * 2 ** o), 12, y - 9);
      }
    }

    // beam along the phone (the screen's long axis): brighter and wider as you swing
    if (on) {
      const flicker = reduced.matches ? 1 : 0.92 + Math.random() * 0.08;
      const pulse = reduced.matches ? 0 : Math.max(0, 1 - (now - pulseT) / 260);
      const wGlow = (18 + drive * 40 + pulse * 30) * flicker;
      const g = c.createLinearGradient(cx - wGlow, 0, cx + wGlow, 0);
      g.addColorStop(0, hexA(col, 0));
      g.addColorStop(0.5, hexA(col, (0.25 + drive * 0.45 + pulse * 0.2) * flicker));
      g.addColorStop(1, hexA(col, 0));
      c.fillStyle = g;
      c.fillRect(cx - wGlow, 0, wGlow * 2, H);
      c.fillStyle = `rgba(255,255,255,${0.55 + drive * 0.4})`;
      c.fillRect(cx - 1.5 - drive, 0, 3 + drive * 2, H);
    }

    // trail of where the blade has pointed
    const cutoff = now - TRAIL_MS;
    while (trail.length && trail[0].t < cutoff) trail.shift();
    c.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1];
      const b = trail[i];
      if (Math.abs(b.x - a.x) > 60) continue; // wrapped around behind you
      const age = 1 - (now - b.t) / TRAIL_MS;
      c.strokeStyle = hexA(col, age * (0.25 + b.d * 0.75));
      c.lineWidth = 2 + b.d * 10 * age;
      c.beginPath();
      c.moveTo(cx + a.x * sx, cy - a.y * sy);
      c.lineTo(cx + b.x * sx, cy - b.y * sy);
      c.stroke();
    }
    if (on) {
      const px = cx + Math.max(-95, Math.min(95, az)) * sx;
      const py = cy - Math.max(-ELEV_MAX - 10, Math.min(ELEV_MAX + 10, elev)) * sy;
      const r = 8 + drive * 14;
      const g = c.createRadialGradient(px, py, 0, px, py, r * 2.2);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.35, hexA(col, 0.8));
      g.addColorStop(1, hexA(col, 0));
      c.fillStyle = g;
      c.beginPath();
      c.arc(px, py, r * 2.2, 0, Math.PI * 2);
      c.fill();
    }
  };

  // ---------- loop ----------
  let raf = 0;
  let last = performance.now();
  let lastUi = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (input === 'touch' && lastPtr && now - lastPtr.t > 60) {
      omega *= Math.exp(-dt / 0.05); // pointer stopped moving
      gAbs *= Math.exp(-dt / 0.05);
    }

    // Drive: what the whoosh follows. Speed peaks mid-arc (fastest tip, and the most
    // centripetal force); G-force peaks at the snap of starting and stopping.
    const raw = settings.peak === 'speed' ? (omega - 40) / 680 : (gAbs - 0.12) / 2.2;
    const target = Math.max(0, Math.min(1, raw)) ** 1.15;
    const tau = target > drive ? 0.025 : 0.14; // fast attack, smooth release
    drive += (target - drive) * (1 - Math.exp(-dt / tau));

    const kmh = ((omega * Math.PI) / 180) * ARM * 3.6;
    if (on) {
      voice?.update(pitch(), drive, Math.sin((az * Math.PI) / 180));
      trail.push({ x: Math.max(-95, Math.min(95, az)), y: elev, d: drive, t: now });

      // Peak of a swing: drive was climbing past 0.5 and has started to fall.
      if (drive > peakD) {
        peakD = drive;
        if (drive > 0.5) rising = true;
      }
      swingPeakKmh = Math.max(swingPeakKmh, kmh);
      if (rising && drive < peakD - 0.06) {
        rising = false;
        pulseT = now;
        hapticTick(); // best effort: iOS may ignore it outside a tap
        const peak = Math.round(swingPeakKmh);
        if (peak > best) {
          best = peak;
          localStorage.setItem(key('best'), String(best));
          bestEl.textContent = String(best);
          bestEl.classList.remove('is-pop');
          void bestEl.offsetWidth;
          bestEl.classList.add('is-pop');
          setStatus(`New best swing: ${best} km/h`);
        }
      }
      if (drive < 0.15) {
        peakD = drive;
        swingPeakKmh = 0;
      }
    }

    if (now - lastUi > 90) {
      lastUi = now;
      noteEl.textContent = on ? noteName(pitch()) : '–';
      speedEl.textContent = on ? String(Math.round(kmh)) : '0';
      forceEl.textContent = on ? gAbs.toFixed(1) : '0.0';
      wrap.style.setProperty('--ss-drive', drive.toFixed(3));
    }
    draw(now);
  };
  raf = requestAnimationFrame(frame);

  // initial look
  wrap.style.setProperty('--ss-col', VOICES[settings.voice].color);
  const syncColour = () => wrap.style.setProperty('--ss-col', VOICES[settings.voice].color);
  panel.addEventListener('change', syncColour, { signal });

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
};
