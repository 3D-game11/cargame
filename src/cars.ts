import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type CarType = 'sedan' | 'hatch' | 'suv' | 'sports' | 'taxi' | 'police' | 'van' | 'truck' | 'bus';

export interface CarModel {
  type: CarType;
  /** Positioned in the world and yawed. */
  root: THREE.Group;
  /** Child of root, used for body roll / pitch. */
  body: THREE.Group;
  paintMesh: THREE.Mesh;
  cargoMesh: THREE.Mesh | null;
  /** Only populated for cars built with `separateWheels` (the player). */
  wheels: THREE.Group[];
  frontWheels: THREE.Group[];
  wheelRadius: number;
  length: number;
  width: number;
  blinkL: THREE.Object3D;
  blinkR: THREE.Object3D;
  sirenR: THREE.Object3D | null;
  sirenB: THREE.Object3D | null;
  tailMaterial: THREE.MeshStandardMaterial;
}

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);

/** Shared materials. World toggles light intensities for day / night. */
export const MAT = {
  glass: std({ color: 0x0c1422, metalness: 0.6, roughness: 0.08 }),
  dark: std({ color: 0x1a1b1f, metalness: 0.2, roughness: 0.7 }),
  tire: std({ color: 0x121212, roughness: 0.95 }),
  rim: std({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.28 }),
  head: std({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 0.6, roughness: 0.2 }),
  tail: std({ color: 0x3a0000, emissive: 0xff1010, emissiveIntensity: 0.6, roughness: 0.3 }),
  blink: std({ color: 0x663300, emissive: 0xff8a00, emissiveIntensity: 3.5 }),
  sirenR: std({ color: 0x330000, emissive: 0xff0628, emissiveIntensity: 5 }),
  sirenB: std({ color: 0x000033, emissive: 0x0a48ff, emissiveIntensity: 5 }),
  sign: std({ color: 0xffe066, emissive: 0xffc400, emissiveIntensity: 0.9 }),
};

function makeGlowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const glowTexture = makeGlowTexture();

const glowMat = (color: number, opacity: number) => {
  const m = new THREE.SpriteMaterial({
    map: glowTexture,
    color,
    opacity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  m.visible = false;
  return m;
};

/** Light halos, only visible at night. */
export const GLOW = {
  head: glowMat(0xfff0d0, 0.85),
  tail: glowMat(0xff2416, 0.75),
};

const paintCache = new Map<number, THREE.MeshStandardMaterial>();
export function paintMaterial(color: number): THREE.MeshStandardMaterial {
  let m = paintCache.get(color);
  if (!m) {
    m = std({ color, metalness: 0.55, roughness: 0.3 });
    paintCache.set(color, m);
  }
  return m;
}

type Slot =
  | 'paint'
  | 'cargo'
  | 'glass'
  | 'dark'
  | 'tire'
  | 'rim'
  | 'head'
  | 'tail'
  | 'blinkL'
  | 'blinkR'
  | 'sirenR'
  | 'sirenB'
  | 'sign';

/** Collects transformed part geometries per material slot, then merges them so each car is ~8 draw calls. */
class Parts {
  readonly map = new Map<Slot, THREE.BufferGeometry[]>();

  add(slot: Slot, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.clearGroups();
    g.translate(x, y, z);
    let list = this.map.get(slot);
    if (!list) this.map.set(slot, (list = []));
    list.push(g);
  }

  box(slot: Slot, w: number, h: number, d: number, x: number, y: number, z: number) {
    this.add(slot, new THREE.BoxGeometry(w, h, d), x, y, z);
  }

  merged(): Map<Slot, THREE.BufferGeometry> {
    const out = new Map<Slot, THREE.BufferGeometry>();
    for (const [slot, list] of this.map) {
      const m = mergeGeometries(list, false);
      if (m) {
        m.computeBoundingSphere();
        out.set(slot, m);
      }
    }
    return out;
  }
}

interface Profile {
  L: number;
  W: number;
  clear: number;
  h: number;
  /** Distance from the nose where the hood reaches full body height. */
  hood: number;
  /** Greenhouse x-coords measured from the rear: [rearBase, frontBase, rearTop, frontTop]. */
  cab: [number, number, number, number];
  ch: number;
  wheelR: number;
  axle: number;
}

const PROFILES: Record<'sedan' | 'hatch' | 'suv' | 'sports' | 'van', Profile> = {
  sedan: { L: 4.6, W: 1.84, clear: 0.24, h: 0.68, hood: 1.25, cab: [0.95, 3.2, 1.45, 2.7], ch: 0.56, wheelR: 0.34, axle: 0.85 },
  hatch: { L: 3.95, W: 1.76, clear: 0.24, h: 0.66, hood: 0.95, cab: [0.22, 2.8, 0.38, 2.2], ch: 0.6, wheelR: 0.32, axle: 0.7 },
  suv: { L: 4.75, W: 1.96, clear: 0.36, h: 0.86, hood: 1.15, cab: [0.22, 3.5, 0.38, 2.98], ch: 0.72, wheelR: 0.42, axle: 0.9 },
  sports: { L: 4.45, W: 1.96, clear: 0.16, h: 0.58, hood: 1.55, cab: [1.05, 3.1, 1.6, 2.5], ch: 0.46, wheelR: 0.35, axle: 0.85 },
  van: { L: 5.1, W: 2.0, clear: 0.3, h: 0.95, hood: 0.75, cab: [0.06, 4.25, 0.08, 3.75], ch: 1.05, wheelR: 0.38, axle: 0.85 },
};

/** Profile x (0 = rear, L = front) to model z (front faces -z). */
const zOf = (x: number, L: number) => L / 2 - x;

function extrudeSide(shape: THREE.Shape, L: number, width: number, bevel: number) {
  const depth = width - bevel * 2;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  g.translate(-L / 2, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

interface BuiltCar {
  slots: Map<Slot, THREE.BufferGeometry>;
  length: number;
  width: number;
  wheelR: number;
  wheelPos: THREE.Vector3[];
  headGlow: THREE.Vector3[];
  tailGlow: THREE.Vector3[];
}

function lights(parts: Parts, W: number, frontZ: number, rearZ: number, hy: number, ty: number, built: BuiltCar) {
  for (const s of [-1, 1]) {
    parts.box('head', 0.36, 0.11, 0.07, s * (W / 2 - 0.3), hy, frontZ);
    parts.box('tail', 0.4, 0.13, 0.07, s * (W / 2 - 0.3), ty, rearZ);
    const slot: Slot = s < 0 ? 'blinkL' : 'blinkR';
    parts.box(slot, 0.1, 0.09, 0.08, s * (W / 2 - 0.05), hy, frontZ);
    parts.box(slot, 0.1, 0.09, 0.08, s * (W / 2 - 0.05), ty, rearZ);
    built.headGlow.push(new THREE.Vector3(s * (W / 2 - 0.3), hy, frontZ - 0.15));
    built.tailGlow.push(new THREE.Vector3(s * (W / 2 - 0.3), ty, rearZ + 0.12));
  }
}

function buildProfileCar(type: CarType): BuiltCar {
  const key = type === 'taxi' || type === 'police' ? 'sedan' : (type as keyof typeof PROFILES);
  const p = PROFILES[key];
  const { L, W, clear, h, cab, ch } = p;
  const bev = 0.05;
  const parts = new Parts();
  const built: BuiltCar = {
    slots: new Map(),
    length: L,
    width: W,
    wheelR: p.wheelR,
    wheelPos: [],
    headGlow: [],
    tailGlow: [],
  };

  // Lower body — side profile extruded across the width.
  const s = new THREE.Shape();
  s.moveTo(0.12, 0);
  s.lineTo(L - 0.15, 0);
  s.lineTo(L, 0.18 * h);
  s.lineTo(L, 0.52 * h);
  s.lineTo(L - 0.14, 0.74 * h);
  s.lineTo(L - p.hood, h);
  s.lineTo(0.22, h);
  s.lineTo(0, 0.84 * h);
  s.lineTo(0, 0.15 * h);
  s.closePath();
  parts.add('paint', extrudeSide(s, L, W, bev), 0, clear, 0);

  // Greenhouse (all glass) + roof + B-pillar.
  const gw = W * 0.84;
  const gy = clear + h - 0.02;
  const gs = new THREE.Shape();
  gs.moveTo(cab[0], 0);
  gs.lineTo(cab[1], 0);
  gs.lineTo(cab[3], ch);
  gs.lineTo(cab[2], ch);
  gs.closePath();
  parts.add('glass', extrudeSide(gs, L, gw, 0.03), 0, gy, 0);
  const roofY = gy + ch;
  parts.box('paint', gw + 0.05, 0.07, cab[3] - cab[2] + 0.12, 0, roofY, zOf((cab[2] + cab[3]) / 2, L));
  const pLo = Math.max(cab[0], cab[2]);
  const pHi = Math.min(cab[1], cab[3]);
  parts.box('paint', gw + 0.03, ch, 0.12, 0, gy + ch / 2, zOf((pLo + pHi) / 2 - 0.05, L));
  if (type === 'van' || type === 'suv') {
    parts.box('paint', gw + 0.03, ch, 0.12, 0, gy + ch / 2, zOf(pLo + 0.35, L));
  }

  const fz = -(L / 2 + bev);
  const rz = L / 2 + bev;
  // Bumpers + grille.
  parts.box('dark', W * 0.97, 0.2, 0.16, 0, clear + 0.06, fz + 0.06);
  parts.box('dark', W * 0.97, 0.2, 0.16, 0, clear + 0.06, rz - 0.06);
  parts.box('dark', W * 0.42, 0.13, 0.05, 0, clear + 0.32 * h, fz);
  lights(parts, W, fz, rz, clear + 0.42 * h, clear + 0.64 * h, built);

  if (type === 'sports') {
    parts.box('dark', W * 0.94, 0.05, 0.34, 0, clear + h + 0.27, zOf(0.22, L));
    for (const sx of [-1, 1]) parts.box('dark', 0.06, 0.28, 0.12, sx * W * 0.3, clear + h + 0.12, zOf(0.26, L));
    // Side skirts and a darker diffuser give the player car a sportier silhouette.
    parts.box('dark', W + 0.02, 0.1, L * 0.5, 0, clear + 0.02, 0);
  }
  if (type === 'taxi') {
    parts.box('sign', 0.64, 0.2, 0.3, 0, roofY + 0.13, zOf((cab[2] + cab[3]) / 2, L));
  }
  if (type === 'police') {
    const mid = zOf((cab[2] + cab[3]) / 2, L);
    parts.box('dark', 1.3, 0.06, 0.32, 0, roofY + 0.06, mid);
    parts.box('sirenR', 0.55, 0.13, 0.28, -0.32, roofY + 0.15, mid);
    parts.box('sirenB', 0.55, 0.13, 0.28, 0.32, roofY + 0.15, mid);
  }

  const wz = L / 2 - p.axle;
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) built.wheelPos.push(new THREE.Vector3(sx * (W / 2 - 0.1), p.wheelR, sz * wz));
  addMergedWheels(parts, built);
  built.slots = parts.merged();
  return built;
}

function buildTruck(): BuiltCar {
  const L = 8.8;
  const W = 2.45;
  const clear = 0.42;
  const r = 0.52;
  const parts = new Parts();
  const built: BuiltCar = { slots: new Map(), length: L, width: W, wheelR: r, wheelPos: [], headGlow: [], tailGlow: [] };
  const cabL = 2.3;
  const cabH = 2.45;
  parts.box('paint', W, cabH, cabL, 0, clear + 0.15 + cabH / 2, -L / 2 + cabL / 2);
  parts.box('glass', W * 0.88, 0.95, 0.06, 0, clear + cabH - 0.42, -L / 2 - 0.01);
  parts.box('glass', W + 0.02, 0.8, cabL * 0.42, 0, clear + cabH - 0.42, -L / 2 + cabL * 0.3);
  parts.box('dark', W * 0.7, 0.7, 0.06, 0, clear + 0.85, -L / 2 - 0.01);
  parts.box('dark', W + 0.04, 0.32, 0.26, 0, clear + 0.18, -L / 2 + 0.06);
  parts.box('dark', W * 0.85, 0.42, L - 0.6, 0, clear + 0.2, 0.2);
  const boxL = L - cabL - 0.25;
  parts.box('cargo', W + 0.05, 3.0, boxL, 0, clear + 0.42 + 1.5, -L / 2 + cabL + 0.25 + boxL / 2);
  parts.box('dark', W, 0.22, 0.16, 0, clear + 0.1, L / 2 - 0.05);
  lights(parts, W, -L / 2 - 0.02, L / 2 + 0.03, clear + 0.45, clear + 0.6, built);
  for (const z of [-L / 2 + 1.25, L / 2 - 1.0, L / 2 - 2.25])
    for (const sx of [-1, 1]) built.wheelPos.push(new THREE.Vector3(sx * (W / 2 - 0.12), r, z));
  addMergedWheels(parts, built);
  built.slots = parts.merged();
  return built;
}

function buildBus(): BuiltCar {
  const L = 11.8;
  const W = 2.55;
  const clear = 0.35;
  const H = 2.95;
  const r = 0.5;
  const parts = new Parts();
  const built: BuiltCar = { slots: new Map(), length: L, width: W, wheelR: r, wheelPos: [], headGlow: [], tailGlow: [] };
  parts.box('paint', W, H, L, 0, clear + H / 2, 0);
  parts.box('glass', W + 0.02, 1.0, L - 3.2, 0, clear + H - 0.85, 0.6);
  parts.box('glass', W * 0.9, 1.45, 0.06, 0, clear + H - 1.0, -L / 2 - 0.02);
  parts.box('glass', W * 0.8, 0.8, 0.06, 0, clear + H - 0.8, L / 2 + 0.02);
  parts.box('cargo', W + 0.03, 0.28, L + 0.02, 0, clear + 1.05, 0);
  parts.box('dark', W + 0.02, 0.32, L + 0.04, 0, clear + 0.16, 0);
  parts.box('sign', W * 0.6, 0.22, 0.05, 0, clear + H - 0.15, -L / 2 - 0.03);
  lights(parts, W, -L / 2 - 0.03, L / 2 + 0.03, clear + 0.55, clear + 0.75, built);
  for (const z of [-L / 2 + 2.4, L / 2 - 2.8])
    for (const sx of [-1, 1]) built.wheelPos.push(new THREE.Vector3(sx * (W / 2 - 0.12), r, z));
  addMergedWheels(parts, built);
  built.slots = parts.merged();
  return built;
}

const wheelGeoCache = new Map<number, { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry; hub: THREE.BufferGeometry }>();
function wheelGeo(r: number) {
  let w = wheelGeoCache.get(r);
  if (!w) {
    const tire = new THREE.CylinderGeometry(r, r, 0.28, 18);
    tire.rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.3, 12);
    rim.rotateZ(Math.PI / 2);
    // A cross on the hub so spinning is visible.
    const a = new THREE.BoxGeometry(0.32, r * 1.05, 0.09);
    const b = new THREE.BoxGeometry(0.32, 0.09, r * 1.05);
    const hub = mergeGeometries([a, b])!;
    w = { tire, rim, hub };
    wheelGeoCache.set(r, w);
  }
  return w;
}

function addMergedWheels(parts: Parts, built: BuiltCar) {
  const w = wheelGeo(built.wheelR);
  for (const p of built.wheelPos) {
    parts.add('tire', w.tire, p.x, p.y, p.z);
    parts.add('rim', w.rim, p.x, p.y, p.z);
  }
}

const builtCache = new Map<CarType, BuiltCar>();
function getBuilt(type: CarType): BuiltCar {
  let b = builtCache.get(type);
  if (!b) {
    b = type === 'truck' ? buildTruck() : type === 'bus' ? buildBus() : buildProfileCar(type);
    builtCache.set(type, b);
  }
  return b;
}

export function createCar(type: CarType, color: number, opts: { separateWheels?: boolean } = {}): CarModel {
  const built = getBuilt(type);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // The player gets its own tail-light material so brake lights can flare independently.
  const tailMaterial = opts.separateWheels ? MAT.tail.clone() : MAT.tail;

  let paintMesh: THREE.Mesh | null = null;
  let cargoMesh: THREE.Mesh | null = null;
  const blink: Record<'L' | 'R', THREE.Object3D> = { L: new THREE.Object3D(), R: new THREE.Object3D() };
  let sirenR: THREE.Object3D | null = null;
  let sirenB: THREE.Object3D | null = null;

  for (const [slot, geo] of built.slots) {
    if (opts.separateWheels && (slot === 'tire' || slot === 'rim')) continue;
    let mat: THREE.Material;
    switch (slot) {
      case 'paint':
        mat = paintMaterial(color);
        break;
      case 'cargo':
        mat = paintMaterial(0xeeeeee);
        break;
      case 'blinkL':
      case 'blinkR':
        mat = MAT.blink;
        break;
      case 'tail':
        mat = tailMaterial;
        break;
      default:
        mat = MAT[slot];
    }
    const mesh = new THREE.Mesh(geo, mat);
    if (slot === 'paint' || slot === 'cargo') mesh.castShadow = true;
    body.add(mesh);
    if (slot === 'paint') paintMesh = mesh;
    if (slot === 'cargo') cargoMesh = mesh;
    if (slot === 'blinkL') blink.L = mesh;
    if (slot === 'blinkR') blink.R = mesh;
    if (slot === 'sirenR') sirenR = mesh;
    if (slot === 'sirenB') sirenB = mesh;
  }
  blink.L.visible = false;
  blink.R.visible = false;

  for (const p of opts.separateWheels ? [] : built.headGlow) {
    const sp = new THREE.Sprite(GLOW.head);
    sp.position.copy(p);
    sp.scale.setScalar(type === 'truck' || type === 'bus' ? 2.2 : 1.7);
    body.add(sp);
  }
  for (const p of built.tailGlow) {
    const sp = new THREE.Sprite(GLOW.tail);
    sp.position.copy(p);
    sp.scale.setScalar(1.2);
    body.add(sp);
  }

  const wheels: THREE.Group[] = [];
  const frontWheels: THREE.Group[] = [];
  if (opts.separateWheels) {
    const wg = wheelGeo(built.wheelR);
    for (const p of built.wheelPos) {
      const w = new THREE.Group();
      w.rotation.order = 'YXZ';
      w.position.copy(p);
      const tire = new THREE.Mesh(wg.tire, MAT.tire);
      tire.castShadow = true;
      w.add(tire, new THREE.Mesh(wg.rim, MAT.rim), new THREE.Mesh(wg.hub, MAT.dark));
      root.add(w);
      wheels.push(w);
      if (p.z < 0) frontWheels.push(w);
    }
  }

  return {
    type,
    root,
    body,
    paintMesh: paintMesh!,
    cargoMesh,
    wheels,
    frontWheels,
    wheelRadius: built.wheelR,
    length: built.length,
    width: built.width,
    blinkL: blink.L,
    blinkR: blink.R,
    sirenR,
    sirenB,
    tailMaterial,
  };
}
