import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './random';

export const SOIL_RADIUS = 1.98;

const POND = { x: -0.72, z: 0.55, r: 0.4 };
const TREE = { x: 0.45, z: -0.45 };

/** Gentle mound with a hollow for the pond. */
export function heightAt(x: number, z: number) {
  const r2 = x * x + z * z;
  let y = 0.015 + 0.16 * Math.max(0, 1 - r2 / (SOIL_RADIUS * SOIL_RADIUS));
  y += 0.012 * Math.sin(x * 7.1) * Math.cos(z * 6.3);
  const pd = Math.hypot(x - POND.x, z - POND.z);
  if (pd < POND.r + 0.15) {
    const t = THREE.MathUtils.smoothstep(pd, POND.r - 0.05, POND.r + 0.15);
    y = THREE.MathUtils.lerp(pondLevel() - 0.04, y, t);
  }
  return y;
}
const pondLevel = () => 0.015 + 0.16 * (1 - (POND.x ** 2 + POND.z ** 2) / SOIL_RADIUS ** 2) - 0.035;

/** Shared wind uniform – every swaying material reads it. */
export const wind = { value: 0 };

/**
 * Bend vertices with height. `height` is the local-space Y at which bend is full.
 * Phase comes from the instance position so stems and flower heads move together.
 */
function addSway(material: THREE.Material, height: number, amount: number) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 o = vec3(0.0);
          #ifdef USE_INSTANCING
            o = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          float k = clamp(position.y / ${height.toFixed(4)}, 0.0, 1.5);
          k *= k;
          float s = sin(uTime * 1.6 + o.x * 2.7 + o.z * 1.9) * 0.6
                  + sin(uTime * 3.3 + o.z * 4.1 - o.x) * 0.25;
          transformed.x += s * k * ${amount.toFixed(4)};
          transformed.z += cos(uTime * 1.3 + o.x * 3.3) * k * ${(amount * 0.5).toFixed(4)};
        }`,
      );
  };
  material.customProgramCacheKey = () => `sway-${height}-${amount}`;
}

/** Polar-grid disc so the soil can be displaced smoothly. */
function soilGeometry() {
  const rings = 40;
  const segs = 128;
  const pos: number[] = [];
  const idx: number[] = [];
  pos.push(0, heightAt(0, 0), 0);
  for (let r = 1; r <= rings; r++) {
    const rad = (r / rings) * SOIL_RADIUS;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      pos.push(x, heightAt(x, z), z);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs;
    const a1 = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function lumpy(geo: THREE.BufferGeometry, rand: () => number, amt: number) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  // Displace by direction so shared (non-indexed) verts stay welded.
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let f = seen.get(key);
    if (f === undefined) seen.set(key, (f = 1 + (rand() - 0.5) * amt));
    v.multiplyScalar(f);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createGarden(seed = 7) {
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  const tmp = new THREE.Object3D();
  const color = new THREE.Color();

  const blocked = (x: number, z: number, pad = 0) =>
    Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.06 + pad ||
    Math.hypot(x - TREE.x, z - TREE.z) < 0.12 + pad;

  const randomInDisc = (maxR: number) => {
    const r = Math.sqrt(rand()) * maxR;
    const a = rand() * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  };

  // ---------- plinth & soil ----------
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a26, roughness: 0.65, metalness: 0.05 });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.4, 0.38, 96), wood);
  plinth.position.y = -0.21; // top sits just under the soil rim
  plinth.castShadow = plinth.receiveShadow = true;
  group.add(plinth);
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(2.42, 2.42, 0.06, 96), wood);
  lip.position.y = -0.4;
  lip.receiveShadow = true;
  group.add(lip);

  const soil = new THREE.Mesh(
    soilGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }),
  );
  soil.receiveShadow = true;
  group.add(soil);

  // ---------- pond ----------
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(POND.r + 0.02, 64),
    new THREE.MeshPhysicalMaterial({
      color: 0x2a6f86,
      roughness: 0.04,
      metalness: 0,
      clearcoat: 1,
      // Kept opaque on purpose: transparent meshes are skipped by the
      // transmission pass, so they'd vanish behind the frosted glass.
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(POND.x, pondLevel(), POND.z);
  water.receiveShadow = true;
  group.add(water);

  // ---------- pebbles & rocks ----------
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
  const pebbleGeo = lumpy(new THREE.IcosahedronGeometry(1, 0), rand, 0.35);
  const pebbleCount = 46;
  const pebbles = new THREE.InstancedMesh(pebbleGeo, stoneMat, pebbleCount + 9 + 5);
  pebbles.castShadow = pebbles.receiveShadow = true;
  let pi = 0;
  for (let i = 0; i < pebbleCount; i++, pi++) {
    const a = (i / pebbleCount) * Math.PI * 2 + rand() * 0.05;
    const r = POND.r + 0.04 + rand() * 0.05;
    const x = POND.x + Math.cos(a) * r;
    const z = POND.z + Math.sin(a) * r;
    const s = 0.03 + rand() * 0.035;
    tmp.position.set(x, heightAt(x, z) + s * 0.3, z);
    tmp.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    tmp.scale.set(s * 1.3, s * 0.7, s);
    tmp.updateMatrix();
    pebbles.setMatrixAt(pi, tmp.matrix);
    pebbles.setColorAt(pi, color.setHSL(0.08, 0.05, 0.45 + rand() * 0.25));
  }
  // Stepping stones from the front edge towards the tree.
  for (let i = 0; i < 9; i++, pi++) {
    const t = i / 8;
    const x = THREE.MathUtils.lerp(0.2, TREE.x - 0.05, t) + Math.sin(t * 5) * 0.25;
    const z = THREE.MathUtils.lerp(1.75, TREE.z + 0.3, t);
    tmp.position.set(x, heightAt(x, z) + 0.005, z);
    tmp.rotation.set(0, rand() * 3, 0);
    tmp.scale.set(0.11 + rand() * 0.03, 0.02, 0.09 + rand() * 0.03);
    tmp.updateMatrix();
    pebbles.setMatrixAt(pi, tmp.matrix);
    pebbles.setColorAt(pi, color.setHSL(0.1, 0.06, 0.55 + rand() * 0.15));
  }
  // A few boulders.
  for (const [x, z, s] of [[-1.25, -0.6, 0.2], [-1.05, -0.85, 0.12], [1.3, 0.75, 0.16], [1.45, 0.5, 0.09], [-0.15, -1.45, 0.14]]) {
    tmp.position.set(x, heightAt(x, z) + s * 0.25, z);
    tmp.rotation.set(rand(), rand() * 6, rand());
    tmp.scale.set(s * 1.2, s * 0.85, s);
    tmp.updateMatrix();
    pebbles.setMatrixAt(pi, tmp.matrix);
    pebbles.setColorAt(pi, color.setHSL(0.6, 0.04, 0.38 + rand() * 0.12));
    pi++;
  }
  group.add(pebbles);

  // ---------- grass ----------
  const BLADE_H = 0.22;
  const bladeGeo = new THREE.PlaneGeometry(0.022, BLADE_H, 1, 4);
  bladeGeo.translate(0, BLADE_H / 2, 0);
  {
    const p = bladeGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / BLADE_H;
      p.setX(i, p.getX(i) * (1 - t * 0.92));
      p.setZ(i, t * t * 0.03); // slight natural curl
    }
    bladeGeo.computeVertexNormals();
  }
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide });
  addSway(grassMat, BLADE_H, 0.05);
  const GRASS = 5200;
  const grass = new THREE.InstancedMesh(bladeGeo, grassMat, GRASS);
  grass.receiveShadow = true;
  let gi = 0;
  for (let tries = 0; gi < GRASS && tries < GRASS * 3; tries++) {
    const [x, z] = randomInDisc(SOIL_RADIUS - 0.05);
    if (blocked(x, z)) continue;
    // Thin the grass along the path.
    const pathT = THREE.MathUtils.clamp((1.75 - z) / (1.75 - (TREE.z + 0.3)), 0, 1);
    const pathX = THREE.MathUtils.lerp(0.2, TREE.x - 0.05, pathT) + Math.sin(pathT * 5) * 0.25;
    if (z < 1.8 && z > TREE.z + 0.2 && Math.abs(x - pathX) < 0.1 && rand() < 0.85) continue;
    tmp.position.set(x, heightAt(x, z) - 0.005, z);
    tmp.rotation.set((rand() - 0.5) * 0.35, rand() * Math.PI * 2, (rand() - 0.5) * 0.35);
    const s = 0.55 + rand() * 0.75;
    tmp.scale.set(1, s, 1);
    tmp.updateMatrix();
    grass.setMatrixAt(gi, tmp.matrix);
    grass.setColorAt(gi, color.setHSL(0.24 + rand() * 0.08, 0.5 + rand() * 0.25, 0.22 + rand() * 0.18));
    gi++;
  }
  grass.count = gi;
  group.add(grass);

  // ---------- flowers ----------
  const STEM_H = 0.3;
  const stemGeo = new THREE.CylinderGeometry(0.004, 0.006, STEM_H, 5);
  stemGeo.translate(0, STEM_H / 2, 0);
  const petals: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const petal = new THREE.SphereGeometry(0.022, 8, 6);
    petal.scale(1, 0.3, 0.6);
    petal.translate(0.022, 0, 0);
    petal.rotateY((i / 5) * Math.PI * 2);
    petals.push(petal.toNonIndexed());
  }
  const headGeo = mergeGeometries(petals)!;
  headGeo.rotateX(-0.25);
  headGeo.translate(0, STEM_H, 0);
  const centerGeo = new THREE.SphereGeometry(0.011, 8, 6);
  centerGeo.translate(0, STEM_H + 0.006, 0);

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f7a2e, roughness: 0.8 });
  const petalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, side: THREE.DoubleSide });
  const centerMat = new THREE.MeshStandardMaterial({ color: 0xf2b632, roughness: 0.6 });
  for (const m of [stemMat, petalMat, centerMat]) addSway(m, STEM_H, 0.035);

  const FLOWERS = 120;
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, FLOWERS);
  const heads = new THREE.InstancedMesh(headGeo, petalMat, FLOWERS);
  const centers = new THREE.InstancedMesh(centerGeo, centerMat, FLOWERS);
  stems.castShadow = heads.castShadow = true;
  const palette = [0xf7f3ff, 0xff8fb1, 0xffd166, 0xb197fc, 0xff6b6b, 0x8ecae6];
  let fi = 0;
  // Flowers grow in little clumps.
  for (let c = 0; c < 18 && fi < FLOWERS; c++) {
    const [cx, cz] = randomInDisc(SOIL_RADIUS - 0.25);
    if (blocked(cx, cz, 0.1)) continue;
    const hue = palette[Math.floor(rand() * palette.length)];
    const n = 4 + Math.floor(rand() * 6);
    for (let k = 0; k < n && fi < FLOWERS; k++) {
      const x = cx + (rand() - 0.5) * 0.3;
      const z = cz + (rand() - 0.5) * 0.3;
      if (blocked(x, z) || Math.hypot(x, z) > SOIL_RADIUS - 0.08) continue;
      tmp.position.set(x, heightAt(x, z), z);
      tmp.rotation.set((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3);
      const s = 0.6 + rand() * 0.6;
      tmp.scale.setScalar(s);
      tmp.updateMatrix();
      stems.setMatrixAt(fi, tmp.matrix);
      heads.setMatrixAt(fi, tmp.matrix);
      centers.setMatrixAt(fi, tmp.matrix);
      heads.setColorAt(fi, color.set(hue).offsetHSL(0, 0, (rand() - 0.5) * 0.08));
      fi++;
    }
  }
  stems.count = heads.count = centers.count = fi;
  group.add(stems, heads, centers);

  // ---------- mushrooms ----------
  const mushStem = new THREE.CylinderGeometry(0.012, 0.016, 0.06, 10);
  mushStem.translate(0, 0.03, 0);
  const mushCap = new THREE.SphereGeometry(0.035, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  mushCap.scale(1, 0.7, 1);
  mushCap.translate(0, 0.055, 0);
  const mushStemMesh = new THREE.InstancedMesh(mushStem, new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 0.7 }), 9);
  const mushCapMesh = new THREE.InstancedMesh(mushCap, new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }), 9);
  mushCapMesh.castShadow = true;
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.17 + rand() * 0.12;
    const x = TREE.x + Math.cos(a) * r;
    const z = TREE.z + Math.sin(a) * r;
    tmp.position.set(x, heightAt(x, z), z);
    tmp.rotation.set((rand() - 0.5) * 0.4, rand() * 6, (rand() - 0.5) * 0.4);
    tmp.scale.setScalar(0.6 + rand() * 0.8);
    tmp.updateMatrix();
    mushStemMesh.setMatrixAt(i, tmp.matrix);
    mushCapMesh.setMatrixAt(i, tmp.matrix);
  }
  group.add(mushStemMesh, mushCapMesh);

  // ---------- blossom tree ----------
  const tree = new THREE.Group();
  tree.position.set(TREE.x, heightAt(TREE.x, TREE.z) - 0.02, TREE.z);
  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.9 });
  const limb = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) => {
    const len = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(r1, r0, len, 10);
    g.translate(0, len / 2, 0);
    const m = new THREE.Mesh(g, bark);
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    m.castShadow = true;
    tree.add(m);
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const tips = [v(-0.35, 1.05, 0.1), v(0.32, 1.15, -0.05), v(0.05, 1.32, 0.25), v(-0.05, 1.2, -0.3), v(0.25, 0.95, 0.3)];
  const fork = v(0.03, 0.62, 0);
  limb(v(0, 0, 0), v(-0.04, 0.35, 0.02), 0.075, 0.06);
  limb(v(-0.04, 0.35, 0.02), fork, 0.06, 0.045);
  for (const t of tips) {
    const mid = fork.clone().lerp(t, 0.55).add(v((rand() - 0.5) * 0.08, 0.04, (rand() - 0.5) * 0.08));
    limb(fork, mid, 0.04, 0.025);
    limb(mid, t, 0.025, 0.012);
  }
  const blossomMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, flatShading: true });
  const puffGeo = lumpy(new THREE.IcosahedronGeometry(1, 1), rand, 0.25);
  const puffs = new THREE.InstancedMesh(puffGeo, blossomMat, tips.length * 6);
  puffs.castShadow = true;
  let bi = 0;
  for (const t of tips) {
    for (let k = 0; k < 6; k++) {
      tmp.position.copy(t).add(v((rand() - 0.5) * 0.28, (rand() - 0.3) * 0.18, (rand() - 0.5) * 0.28));
      tmp.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      tmp.scale.setScalar(0.09 + rand() * 0.09);
      tmp.updateMatrix();
      puffs.setMatrixAt(bi, tmp.matrix);
      puffs.setColorAt(bi, color.setHSL(0.93 + rand() * 0.04, 0.55 + rand() * 0.2, 0.72 + rand() * 0.12));
      bi++;
    }
  }
  tree.add(puffs);
  group.add(tree);

  // ---------- fallen petals on the ground under the tree ----------
  const fallen = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.012, 6).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffb7cc, roughness: 0.8, side: THREE.DoubleSide }),
    140,
  );
  for (let i = 0; i < 140; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.6;
    const x = TREE.x + Math.cos(a) * r;
    const z = TREE.z + Math.sin(a) * r;
    tmp.position.set(x, heightAt(x, z) + 0.004, z);
    tmp.rotation.set(0, rand() * 6, 0);
    tmp.scale.setScalar(0.7 + rand() * 0.8);
    tmp.updateMatrix();
    fallen.setMatrixAt(i, tmp.matrix);
  }
  group.add(fallen);

  // ---------- fireflies (opaque + HDR so the frost blurs them into a glow) ----------
  const FIREFLIES = 40;
  const fireflyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.4, 1.2) });
  const fireflies = new THREE.InstancedMesh(new THREE.SphereGeometry(0.018, 8, 6), fireflyMat, FIREFLIES);
  const flies = Array.from({ length: FIREFLIES }, () => {
    const [x, z] = randomInDisc(1.5);
    return { x, z, y: 0.25 + rand() * 1.1, p: rand() * 100, s: 0.3 + rand() * 0.6 };
  });
  fireflies.frustumCulled = false; // instances move every frame
  group.add(fireflies);

  const lantern = new THREE.PointLight(0xffc86b, 0, 3.5, 1.6);
  lantern.position.set(0, 0.8, 0);
  group.add(lantern);

  let t = 0;
  function update(dt: number, night: number) {
    t += dt;
    wind.value = t;
    tree.rotation.z = Math.sin(t * 0.9) * 0.012;
    tree.rotation.x = Math.cos(t * 0.7) * 0.008;

    const show = night > 0.02;
    fireflies.visible = show;
    lantern.intensity = night * 1.4;
    if (show) {
      for (let i = 0; i < FIREFLIES; i++) {
        const f = flies[i];
        const tt = t * f.s + f.p;
        tmp.position.set(
          f.x + Math.sin(tt * 0.7) * 0.25 + Math.sin(tt * 1.9) * 0.05,
          f.y + Math.sin(tt * 1.1) * 0.15,
          f.z + Math.cos(tt * 0.8) * 0.25,
        );
        const blink = 0.4 + 0.6 * Math.max(0, Math.sin(tt * 2.3));
        tmp.scale.setScalar(night * blink);
        tmp.rotation.set(0, 0, 0);
        tmp.updateMatrix();
        fireflies.setMatrixAt(i, tmp.matrix);
      }
      fireflies.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, update };
}
