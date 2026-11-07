import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { h, useStyles } from '../../lib/dom';
import type { MountFn } from '../../types';
import css from './style.css?inline';
import { createDome, DOME_RADIUS } from './dome';
import { createGarden } from './garden';

const DAY = {
  bg: new THREE.Color(0xcfd9e6),
  fog: new THREE.Color(0xcfd9e6),
  hemi: 1.1,
  sun: 2.6,
  env: 0.9,
  table: new THREE.Color(0xb9aa96),
};
const NIGHT = {
  bg: new THREE.Color(0x0b1020),
  fog: new THREE.Color(0x0b1020),
  hemi: 0.12,
  sun: 0.25,
  env: 0.18,
  table: new THREE.Color(0x3a3530),
};

export const mount: MountFn = (root, { signal }) => {
  useStyles(css, signal);

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'gg-canvas';

  const wrap = h('div', { class: 'gg' }, renderer.domElement);
  root.append(wrap);

  // ---------- scene ----------
  const scene = new THREE.Scene();
  scene.background = DAY.bg.clone();
  scene.fog = new THREE.Fog(DAY.fog.clone(), 9, 22);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
  camera.position.set(4.6, 3.1, 5.4);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.85, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 2.2;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x6b5440, DAY.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, DAY.sun);
  sun.position.set(4, 7, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -3.5;
  sun.shadow.camera.right = sun.shadow.camera.top = 3.5;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 20;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun);

  // ---------- table ----------
  const tableMat = new THREE.MeshStandardMaterial({ color: DAY.table.clone(), roughness: 0.9 });
  const table = new THREE.Mesh(new THREE.CircleGeometry(30, 64), tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.43;
  table.receiveShadow = true;
  scene.add(table);

  // ---------- content ----------
  const garden = createGarden();
  scene.add(garden.group);
  const dome = createDome();
  scene.add(dome.group);

  // ---------- UI ----------
  // Icon + label; the label hides on narrow screens to keep the scene visible.
  const btn = (icon: string, label: string, title: string) =>
    h('button', { class: 'gg-btn', type: 'button', title, 'aria-label': label },
      h('span', { class: 'gg-ico', 'aria-hidden': 'true' }, icon),
      h('span', { class: 'gg-label' }, label));
  const relabel = (el: HTMLElement, icon: string, label: string) => {
    el.querySelector('.gg-ico')!.textContent = icon;
    el.querySelector('.gg-label')!.textContent = label;
    el.setAttribute('aria-label', label);
  };
  const liftBtn = btn('⬆', 'Lift dome', 'Lift the glass off (L)');
  const nightBtn = btn('🌙', 'Night', 'Toggle day / night (N)');
  const rotateBtn = btn('⟳', 'Auto-rotate', 'Toggle auto-rotate (A)');
  const wipeBtn = btn('🧽', 'Wipe glass', 'Drag on the dome to clear the frost (W)');
  rotateBtn.classList.add('is-on');
  const frost = h('input', { type: 'range', min: 0, max: 100, value: 90, 'aria-label': 'Frost amount' });
  const hint = h('p', { class: 'gg-hint' }, 'Drag to orbit · scroll / pinch to zoom');

  wrap.append(
    h(
      'div',
      { class: 'gg-panel' },
      liftBtn,
      nightBtn,
      rotateBtn,
      wipeBtn,
      h('label', { class: 'gg-frost' }, h('span', {}, 'Frost'), frost),
      hint,
    ),
  );

  // ---------- state & animation targets ----------
  let lifted = false;
  let liftT = 0;
  let night = false;
  let nightT = 0;
  let wiping = false;

  const toggle = (el: HTMLElement, on: boolean) => el.classList.toggle('is-on', on);

  liftBtn.addEventListener('click', () => {
    lifted = !lifted;
    relabel(liftBtn, lifted ? '⬇' : '⬆', lifted ? 'Lower dome' : 'Lift dome');
    toggle(liftBtn, lifted);
  }, { signal });
  const setNight = (on: boolean, instant = false) => {
    night = on;
    if (instant) nightT = on ? 1 : 0;
    relabel(nightBtn, on ? '☀' : '🌙', on ? 'Day' : 'Night');
    toggle(nightBtn, on);
  };
  nightBtn.addEventListener('click', () => setNight(!night), { signal });
  rotateBtn.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    toggle(rotateBtn, controls.autoRotate);
  }, { signal });
  const setWiping = (on: boolean) => {
    wiping = on;
    toggle(wipeBtn, on);
    wrap.classList.toggle('is-wiping', on);
    hint.textContent = on
      ? 'Drag on the glass to wipe it · drag elsewhere to orbit'
      : 'Drag to orbit · scroll / pinch to zoom';
  };
  wipeBtn.addEventListener('click', () => setWiping(!wiping), { signal });
  const applyFrost = () => {
    dome.material.roughness = (Number(frost.value) / 100) * 0.9;
  };
  frost.addEventListener('input', applyFrost, { signal });
  applyFrost();

  // Defaults: start at night (fireflies out) with the wipe tool ready.
  setNight(true, true);
  setWiping(true);

  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'l') liftBtn.click();
    else if (k === 'n') nightBtn.click();
    else if (k === 'a') rotateBtn.click();
    else if (k === 'w') wipeBtn.click();
  }, { signal });

  // ---------- wiping ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let painting = false;
  /** Wipe where the pointer meets the glass; returns whether it hit. */
  const paintAt = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(dome.glass, false)[0];
    if (hit?.uv) dome.wipe(hit.uv);
    return !!hit;
  };
  // Capture phase so we can claim the gesture before OrbitControls sees it.
  // Presses that miss the glass fall through, so you can still orbit in wipe mode.
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!wiping || !paintAt(e)) return;
    e.stopImmediatePropagation();
    painting = true;
    renderer.domElement.setPointerCapture(e.pointerId);
  }, { signal, capture: true });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (painting) paintAt(e);
  }, { signal });
  const stop = () => (painting = false);
  renderer.domElement.addEventListener('pointerup', stop, { signal });
  renderer.domElement.addEventListener('pointercancel', stop, { signal });

  // ---------- sizing ----------
  const resize = () => {
    const w = wrap.clientWidth || 1;
    const hgt = wrap.clientHeight || 1;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    // Keep the whole dome in frame on tall/narrow screens.
    camera.fov = camera.aspect < 0.8 ? 52 : 38;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  // ---------- loop ----------
  const timer = new THREE.Timer();
  timer.connect(document); // pauses delta accumulation while the tab is hidden
  const ease = (x: number) => x * x * (3 - 2 * x);

  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);

    liftT = THREE.MathUtils.clamp(liftT + (lifted ? dt : -dt) / 1.4, 0, 1);
    const l = ease(liftT);
    dome.group.position.y = l * (DOME_RADIUS + 0.9);
    dome.group.rotation.z = l * 0.12;
    dome.group.position.x = l * 0.6;

    nightT = THREE.MathUtils.clamp(nightT + (night ? dt : -dt) / 1.8, 0, 1);
    const n = ease(nightT);
    (scene.background as THREE.Color).lerpColors(DAY.bg, NIGHT.bg, n);
    scene.fog!.color.lerpColors(DAY.fog, NIGHT.fog, n);
    tableMat.color.lerpColors(DAY.table, NIGHT.table, n);
    hemi.intensity = THREE.MathUtils.lerp(DAY.hemi, NIGHT.hemi, n);
    sun.intensity = THREE.MathUtils.lerp(DAY.sun, NIGHT.sun, n);
    scene.environmentIntensity = THREE.MathUtils.lerp(DAY.env, NIGHT.env, n);

    garden.update(dt, n);
    dome.update(dt);
    controls.update(dt);
    renderer.render(scene, camera);
  });

  // ---------- cleanup ----------
  return () => {
    renderer.setAnimationLoop(null);
    timer.dispose();
    ro.disconnect();
    controls.dispose();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
      if (obj instanceof THREE.InstancedMesh) obj.dispose();
    });
    envTex.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    wrap.remove();
  };
};
