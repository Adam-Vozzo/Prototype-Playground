import * as THREE from 'three';

export const DOME_RADIUS = 2.05;

const TEX_W = 1024;
const TEX_H = 256;

/**
 * Frosted glass dome. Frost is a roughness map painted on a canvas so the
 * user can wipe clear patches that slowly fog back over.
 */
export function createDome() {
  // Base frost pattern: patchy, heavier near the rim where condensation gathers.
  const base = document.createElement('canvas');
  base.width = TEX_W;
  base.height = TEX_H;
  const b = base.getContext('2d')!;
  const grad = b.createLinearGradient(0, 0, 0, TEX_H); // canvas top = dome crown
  grad.addColorStop(0, '#b8b8b8');
  grad.addColorStop(0.7, '#d8d8d8');
  grad.addColorStop(1, '#ffffff');
  b.fillStyle = grad;
  b.fillRect(0, 0, TEX_W, TEX_H);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * TEX_W;
    const y = Math.random() * TEX_H;
    const r = 2 + Math.random() * 18;
    const v = Math.random() < 0.5 ? 150 + Math.random() * 40 : 225 + Math.random() * 30;
    b.fillStyle = `rgba(${v},${v},${v},${0.15 + Math.random() * 0.3})`;
    b.beginPath();
    b.arc(x, y, r, 0, Math.PI * 2);
    b.fill();
  }

  // Live map = base + wipes.
  const live = document.createElement('canvas');
  live.width = TEX_W;
  live.height = TEX_H;
  const ctx = live.getContext('2d')!;
  ctx.drawImage(base, 0, 0);

  const roughnessMap = new THREE.CanvasTexture(live);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xf4f9ff,
    metalness: 0,
    roughness: 0.55,
    roughnessMap,
    transmission: 1,
    thickness: 0.35,
    ior: 1.45,
    clearcoat: 0.4,
    clearcoatRoughness: 0.25,
    side: THREE.DoubleSide,
    envMapIntensity: 1.1,
  });

  const group = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(DOME_RADIUS, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2),
    material,
  );
  glass.name = 'glass';
  group.add(glass);

  // Brass rim + finial.
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.9, roughness: 0.3 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(DOME_RADIUS + 0.02, 0.045, 16, 128), brass);
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = true;
  group.add(rim);
  const knobStem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.12, 20), brass);
  knobStem.position.y = DOME_RADIUS + 0.05;
  group.add(knobStem);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), brass);
  knob.position.y = DOME_RADIUS + 0.15;
  knob.castShadow = true;
  group.add(knob);

  let dirty = false;
  let sinceWipe = Infinity;

  /** Clear frost around a UV coordinate on the glass. */
  function wipe(uv: THREE.Vector2, radius = 26) {
    const x = uv.x * TEX_W;
    const y = (1 - uv.y) * TEX_H;
    // The equirect map is squashed horizontally near the crown; widen the brush there.
    const stretch = 1 / Math.max(0.15, Math.sin((1 - uv.y) * (Math.PI / 2) + 0.0001));
    for (const dx of [-TEX_W, 0, TEX_W]) {
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, radius);
      g.addColorStop(0, 'rgba(10,10,10,0.9)');
      g.addColorStop(1, 'rgba(10,10,10,0)');
      ctx.save();
      ctx.translate(x + dx, y);
      ctx.scale(Math.min(stretch, 6), 1);
      ctx.translate(-(x + dx), -y);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + dx, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    dirty = true;
    sinceWipe = 0;
  }

  let regrowAcc = 0;
  /** Fog wiped areas back in over time. */
  function update(dt: number) {
    sinceWipe += dt;
    regrowAcc += dt;
    // Only keep re-uploading the texture while frost is still growing back.
    if (regrowAcc > 0.1) {
      if (sinceWipe < 45) {
        ctx.globalAlpha = Math.min(1, 0.012 * (regrowAcc / 0.1));
        ctx.drawImage(base, 0, 0);
        ctx.globalAlpha = 1;
        dirty = true;
      }
      regrowAcc = 0;
    }
    if (dirty) {
      roughnessMap.needsUpdate = true;
      dirty = false;
    }
  }

  return { group, glass, material, wipe, update };
}
