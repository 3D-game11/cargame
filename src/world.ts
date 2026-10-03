import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLOW, MAT, glowTexture } from './cars';
import { LANE_COUNT, LANE_WIDTH, ROAD_HALF, ROAD_TOTAL, SHOULDER, type GameMode, type TimeOfDay } from './config';

/** Scenery lives between BACK and FRONT and is recycled as the world scrolls. */
const FRONT = -600;
const BACK = 40;
const SPAN = BACK - FRONT;
const ROAD_TILE = 12;
const GRASS_TILE = 24;

const TREE_COUNT = 120;
const BUILDING_COUNT = 36;
const LAMP_PERIOD = 60;
const POST_PERIOD = 4;

interface TreeSlot {
  x: number;
  z: number;
  s: number;
  rot: number;
  pine: boolean;
  /** Index in the trunk mesh. */
  ti: number;
  /** Index in the pine or round foliage mesh. */
  idx: number;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function makeRoadTexture(twoWay: boolean): THREE.CanvasTexture {
  const W = 1024;
  const H = 1024;
  const { c, g } = canvas(W, H);
  const px = W / ROAD_TOTAL;
  g.fillStyle = '#3a3d43';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 26000; i++) {
    const v = 38 + Math.floor(Math.random() * 46);
    g.fillStyle = `rgba(${v},${v},${v + 4},0.55)`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  const sh = SHOULDER * px;
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.fillRect(0, 0, sh, H);
  g.fillRect(W - sh, 0, sh, H);
  // Worn tyre tracks in every lane.
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let i = 0; i < LANE_COUNT; i++) {
    const cx = sh + (i + 0.5) * LANE_WIDTH * px;
    for (const o of [-0.8, 0.8]) g.fillRect(cx + o * px - 0.3 * px, 0, 0.6 * px, H);
  }
  const lw = 0.16 * px;
  g.fillStyle = '#ececec';
  g.fillRect(sh - lw, 0, lw, H);
  g.fillRect(W - sh, 0, lw, H);
  for (let i = 1; i < LANE_COUNT; i++) {
    const x = sh + i * LANE_WIDTH * px;
    if (twoWay && i === LANE_COUNT / 2) {
      g.fillStyle = '#f0b92a';
      g.fillRect(x - lw * 1.7, 0, lw, H);
      g.fillRect(x + lw * 0.7, 0, lw, H);
    } else {
      g.fillStyle = '#ececec';
      g.fillRect(x - lw / 2, 0, lw, H * (4.5 / ROAD_TILE));
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, SPAN / ROAD_TILE);
  return t;
}

function makeGrassTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#4b7a34';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const r = 20 + Math.random() * 60;
    const x = Math.random() * S;
    const y = Math.random() * S;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = Math.random() < 0.5 ? '70,110,45' : '62,96,38';
    grd.addColorStop(0, `rgba(${tone},0.6)`);
    grd.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = grd;
    // Draw wrapped copies so the tile is seamless.
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) g.fillRect(x - r + ox, y - r + oy, r * 2, r * 2);
  }
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(40,70,25,0.5)' : 'rgba(110,150,70,0.45)';
    g.fillRect(Math.random() * S, Math.random() * S, 2, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeFacadeTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const S = 256;
  const cells = 8;
  const cell = S / cells;
  const a = canvas(S, S);
  const b = canvas(S, S);
  a.g.fillStyle = '#d4d6da';
  a.g.fillRect(0, 0, S, S);
  b.g.fillStyle = '#000';
  b.g.fillRect(0, 0, S, S);
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = i * cell + 5;
      const y = j * cell + 7;
      const w = cell - 10;
      const h = cell - 13;
      a.g.fillStyle = '#34465c';
      a.g.fillRect(x, y, w, h);
      a.g.fillStyle = 'rgba(255,255,255,0.18)';
      a.g.fillRect(x, y, w, 3);
      if (Math.random() < 0.38) {
        b.g.fillStyle = Math.random() < 0.75 ? '#ffd79a' : '#cfe4ff';
        b.g.fillRect(x, y, w, h);
      }
    }
  }
  const mk = (cv: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  return { map: mk(a.c), emissive: mk(b.c) };
}

/** Scale box UVs so a facade texture tiles at a fixed world size regardless of box dimensions. */
function scaleBoxUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, tile: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
}

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform float sunDisc;
  varying vec3 vWorld;
  void main() {
    vec3 d = normalize(vWorld - cameraPosition);
    float h = max(d.y, 0.0);
    vec3 col = mix(horizonColor, topColor, pow(smoothstep(0.0, 1.0, h), 0.55));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += sunColor * (smoothstep(sunDisc, sunDisc + 0.0015, s) * 2.5 + pow(s, 24.0) * 0.35);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class World {
  readonly scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private sky: THREE.Mesh;
  private skyU: {
    topColor: { value: THREE.Color };
    horizonColor: { value: THREE.Color };
    sunDir: { value: THREE.Vector3 };
    sunColor: { value: THREE.Color };
    sunDisc: { value: number };
  };
  private stars: THREE.Points;
  private clouds = new THREE.Group();
  private mountainMat = new THREE.MeshLambertMaterial({ color: 0x7d95a6, flatShading: true, fog: false });
  private hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  private fog = new THREE.Fog(0xcfe4f4, 70, 340);

  private roadMat: THREE.MeshStandardMaterial;
  private roadTex: Record<GameMode, THREE.CanvasTexture>;
  private grassTex: THREE.CanvasTexture;
  private roadOffset = 0;
  private grassOffset = 0;

  private periodic: { group: THREE.Object3D; period: number }[] = [];
  private lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xffd9a0, emissiveIntensity: 0.2 });
  private lampGlowMat: THREE.SpriteMaterial;
  private pools: THREE.InstancedMesh;

  private trees: TreeSlot[] = [];
  private trunks: THREE.InstancedMesh;
  private pines: THREE.InstancedMesh;
  private rounds: THREE.InstancedMesh;

  private buildings: THREE.Mesh[] = [];
  private facadeMats: THREE.MeshStandardMaterial[] = [];

  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const scene = this.scene;
    scene.fog = this.fog;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Sky dome that follows the camera.
    this.skyU = {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0.3, 0.4, -1) },
      sunColor: { value: new THREE.Color() },
      sunDisc: { value: 0.9995 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyU,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    const starPos: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      v.normalize().multiplyScalar(1000);
      starPos.push(v.x, v.y, v.z);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    scene.add(this.stars);

    // Lights.
    this.hemi = new THREE.HemisphereLight(0xdbeeff, 0x4a5a3a, 1.2);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 55;
    sc.bottom = -55;
    sc.near = 1;
    sc.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.target.position.set(0, 0, -25);
    scene.add(this.sun, this.sun.target);

    // Road + grass with scrolling textures.
    this.roadTex = { oneway: makeRoadTexture(false), twoway: makeRoadTexture(true) };
    const aniso = renderer.capabilities.getMaxAnisotropy();
    for (const t of Object.values(this.roadTex)) t.anisotropy = aniso;
    this.roadMat = new THREE.MeshStandardMaterial({ map: this.roadTex.oneway, roughness: 0.88, metalness: 0.0 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_TOTAL, SPAN), this.roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.z = (FRONT + BACK) / 2;
    road.receiveShadow = true;
    scene.add(road);

    this.grassTex = makeGrassTexture();
    this.grassTex.anisotropy = aniso;
    const G = 1800;
    this.grassTex.repeat.set(G / GRASS_TILE, G / GRASS_TILE);
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(G, G),
      new THREE.MeshStandardMaterial({ map: this.grassTex, roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, -0.04, -G / 2 + 300);
    grass.receiveShadow = true;
    scene.add(grass);

    this.buildGuardrails();
    this.lampGlowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffcf8a,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.pools = this.buildLamps();

    // Trees (instanced; matrices rewritten every frame as they scroll).
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 2, 6);
    trunkGeo.translate(0, 1, 0);
    const pineGeo = new THREE.ConeGeometry(1.7, 5, 7);
    pineGeo.translate(0, 4.0, 0);
    const roundGeo = new THREE.IcosahedronGeometry(1.9, 0);
    roundGeo.translate(0, 3.3, 0);
    const pineCount = Math.round(TREE_COUNT * 0.6);
    this.trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 }), TREE_COUNT);
    const foliage = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    this.pines = new THREE.InstancedMesh(pineGeo, foliage, pineCount);
    this.rounds = new THREE.InstancedMesh(roundGeo, foliage, TREE_COUNT - pineCount);
    const col = new THREE.Color();
    for (let i = 0; i < TREE_COUNT; i++) {
      const pine = i < pineCount;
      const slot: TreeSlot = { x: 0, z: 0, s: 1, rot: 0, pine, ti: i, idx: pine ? i : i - pineCount };
      this.placeTree(slot, BACK - Math.random() * SPAN);
      this.trees.push(slot);
      col.setHSL(pine ? 0.33 + Math.random() * 0.05 : 0.22 + Math.random() * 0.1, 0.45, pine ? 0.2 + Math.random() * 0.08 : 0.28 + Math.random() * 0.1);
      (pine ? this.pines : this.rounds).setColorAt(slot.idx, col);
    }
    for (const m of [this.trunks, this.pines, this.rounds]) {
      m.castShadow = true;
      m.frustumCulled = false;
      scene.add(m);
    }

    this.buildBuildings();
    this.buildMountains();
    this.buildClouds();
  }

  private addPeriodic(group: THREE.Object3D, period: number) {
    this.scene.add(group);
    this.periodic.push({ group, period });
  }

  private buildGuardrails() {
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, metalness: 0.75, roughness: 0.35 });
    const railX = ROAD_HALF + SHOULDER - 0.1;
    const railGeo = new THREE.BoxGeometry(0.08, 0.32, SPAN);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, metal);
      rail.position.set(s * railX, 0.62, (FRONT + BACK) / 2);
      rail.castShadow = true;
      this.scene.add(rail);
    }
    const n = Math.floor(SPAN / POST_PERIOD);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), metal, n * 2);
    let k = 0;
    for (let i = 0; i < n; i++) {
      for (const s of [-1, 1]) {
        this.tmpM.makeTranslation(s * (railX + 0.12), 0.375, BACK - i * POST_PERIOD);
        posts.setMatrixAt(k++, this.tmpM);
      }
    }
    const g = new THREE.Group();
    g.add(posts);
    this.addPeriodic(g, POST_PERIOD);
  }

  private buildLamps(): THREE.InstancedMesh {
    const n = Math.floor(SPAN / LAMP_PERIOD) + 1;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8b9199, metalness: 0.6, roughness: 0.45 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.16, 9, 8), poleMat, n * 2);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.12, 0.12), poleMat, n * 2);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.16, 0.45), this.lampMat, n * 2);
    const poolGeo = new THREE.PlaneGeometry(13, 13);
    poolGeo.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(
      poolGeo,
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: 0xffb860,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      n * 2,
    );
    const g = new THREE.Group();
    const poleX = ROAD_HALF + SHOULDER + 0.7;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const z = BACK - i * LAMP_PERIOD;
      for (const s of [-1, 1]) {
        this.tmpM.makeTranslation(s * poleX, 4.5, z);
        poles.setMatrixAt(k, this.tmpM);
        this.tmpM.makeTranslation(s * (poleX - 1.5), 8.95, z);
        arms.setMatrixAt(k, this.tmpM);
        const hx = s * (poleX - 2.9);
        this.tmpM.makeTranslation(hx, 8.85, z);
        heads.setMatrixAt(k, this.tmpM);
        this.tmpM.makeTranslation(hx, 0.03, z);
        pools.setMatrixAt(k, this.tmpM);
        const glow = new THREE.Sprite(this.lampGlowMat);
        glow.position.set(hx, 8.6, z);
        glow.scale.setScalar(5);
        g.add(glow);
        k++;
      }
    }
    poles.castShadow = true;
    pools.renderOrder = 1;
    g.add(poles, arms, heads, pools);
    this.addPeriodic(g, LAMP_PERIOD);
    return pools;
  }

  private placeTree(t: TreeSlot, z: number) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const edge = ROAD_HALF + SHOULDER + 3.5;
    t.x = side * (edge + Math.pow(Math.random(), 1.5) * 36);
    t.z = z;
    t.s = 0.7 + Math.random() * 0.8;
    t.rot = Math.random() * Math.PI * 2;
  }

  private writeTree(t: TreeSlot) {
    this.tmpP.set(t.x, 0, t.z);
    this.tmpQ.setFromAxisAngle(this.up, t.rot);
    this.tmpS.setScalar(t.s);
    this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
    this.trunks.setMatrixAt(t.ti, this.tmpM);
    (t.pine ? this.pines : this.rounds).setMatrixAt(t.idx, this.tmpM);
  }

  private buildBuildings() {
    const { map, emissive } = makeFacadeTextures();
    const roof = new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.9 });
    for (const c of [0xffffff, 0xe9dcc8, 0xc8d6e4, 0xdcc3b4, 0xb9c1c9]) {
      this.facadeMats.push(
        new THREE.MeshStandardMaterial({
          color: c,
          map,
          emissiveMap: emissive,
          emissive: 0xffffff,
          emissiveIntensity: 0,
          roughness: 0.75,
          metalness: 0.1,
        }),
      );
    }
    for (let i = 0; i < BUILDING_COUNT; i++) {
      const w = 12 + Math.random() * 16;
      const d = 12 + Math.random() * 16;
      const h = 14 + Math.pow(Math.random(), 1.4) * 55;
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(0, h / 2, 0);
      scaleBoxUV(geo, w, h, d, 24);
      const f = this.facadeMats[i % this.facadeMats.length];
      const mesh = new THREE.Mesh(geo, [f, f, roof, roof, f, f]);
      this.placeBuilding(mesh, BACK - Math.random() * SPAN);
      this.buildings.push(mesh);
      this.scene.add(mesh);
    }
  }

  private placeBuilding(m: THREE.Mesh, z: number) {
    const side = Math.random() < 0.5 ? -1 : 1;
    m.position.set(side * (ROAD_HALF + SHOULDER + 48 + Math.random() * 80), 0, z);
    m.rotation.y = (Math.random() - 0.5) * 0.3;
  }

  private buildMountains() {
    const geo = new THREE.ConeGeometry(1, 1, 7, 1);
    geo.translate(0, 0.5, 0);
    const add = (x: number, z: number, r: number, h: number) => {
      const m = new THREE.Mesh(geo, this.mountainMat);
      m.scale.set(r, h, r);
      m.position.set(x, -3, z);
      m.rotation.y = Math.random() * Math.PI;
      this.scene.add(m);
    };
    for (let i = 0; i < 22; i++) {
      add(-1000 + i * 95 + Math.random() * 40, -720 - Math.random() * 220, 140 + Math.random() * 160, 90 + Math.random() * 160);
    }
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) add(s * (560 + Math.random() * 200), -150 - i * 110, 160, 80 + Math.random() * 100);
  }

  private buildClouds() {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false, emissive: 0x8899aa, emissiveIntensity: 0.35 });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 16; i++) {
      const cluster = new THREE.Group();
      const parts = 4 + Math.floor(Math.random() * 4);
      for (let j = 0; j < parts; j++) {
        const m = new THREE.Mesh(geo, mat);
        m.scale.set(18 + Math.random() * 22, 6 + Math.random() * 6, 14 + Math.random() * 14);
        m.position.set(j * 18 - parts * 9 + Math.random() * 8, Math.random() * 5, Math.random() * 12);
        cluster.add(m);
      }
      cluster.position.set(-900 + Math.random() * 1800, 150 + Math.random() * 120, -350 - Math.random() * 650);
      this.clouds.add(cluster);
    }
    this.scene.add(this.clouds);
  }

  setMode(mode: GameMode) {
    this.roadMat.map = this.roadTex[mode];
    this.roadMat.needsUpdate = true;
  }

  setTime(tod: TimeOfDay) {
    const night = tod === 'night';
    const u = this.skyU;
    u.topColor.value.set(night ? 0x03060f : 0x2d6fcf);
    u.horizonColor.value.set(night ? 0x16203a : 0xcfe3f2);
    if (night) {
      u.sunDir.value.set(-0.45, 0.32, -1);
      u.sunColor.value.set(0xc8d6ff);
      u.sunDisc.value = 0.9996;
    } else {
      u.sunDir.value.set(0.55, 0.42, -1);
      u.sunColor.value.set(0xfff0c8);
      u.sunDisc.value = 0.9993;
    }
    this.fog.color.copy(u.horizonColor.value);
    this.fog.near = night ? 25 : 70;
    this.fog.far = night ? 250 : 340;

    this.hemi.color.set(night ? 0x4a5c90 : 0xdbeeff);
    this.hemi.groundColor.set(night ? 0x0b0c14 : 0x4a5a3a);
    this.hemi.intensity = night ? 0.55 : 1.2;
    this.sun.color.set(night ? 0x9fb4ff : 0xfff1dc);
    this.sun.intensity = night ? 0.35 : 2.7;
    // Sun sits ahead so long shadows fall toward the camera; moon on the left.
    if (night) this.sun.position.set(-45, 50, -90);
    else this.sun.position.set(35, 55, -70);

    this.scene.environmentIntensity = night ? 0.12 : 0.65;
    this.renderer.toneMappingExposure = night ? 1.15 : 1.0;

    this.lampMat.emissiveIntensity = night ? 4 : 0.15;
    this.pools.visible = night;
    this.lampGlowMat.visible = night;
    GLOW.head.visible = night;
    GLOW.tail.visible = night;
    MAT.head.emissiveIntensity = night ? 4 : 0.6;
    MAT.tail.emissiveIntensity = night ? 2.4 : 0.6;
    MAT.sign.emissiveIntensity = night ? 2 : 0.9;
    for (const m of this.facadeMats) m.emissiveIntensity = night ? 1.25 : 0;
    this.stars.visible = night;
    this.clouds.visible = !night;
    this.mountainMat.color.set(night ? 0x222c48 : 0x8aa0b0);
  }

  /** Scroll everything toward the camera by `dz` metres. */
  update(dz: number, dt: number, cameraPos: THREE.Vector3) {
    this.sky.position.copy(cameraPos);
    this.stars.position.copy(cameraPos);
    for (const c of this.clouds.children) {
      c.position.x += dt * 2.5;
      if (c.position.x > 950) c.position.x -= 1900;
    }

    this.roadOffset = (this.roadOffset + dz / ROAD_TILE) % 1;
    this.roadTex.oneway.offset.y = this.roadOffset;
    this.roadTex.twoway.offset.y = this.roadOffset;
    this.grassOffset = (this.grassOffset + dz / GRASS_TILE) % 1;
    this.grassTex.offset.y = this.grassOffset;

    for (const p of this.periodic) p.group.position.z = (p.group.position.z + dz) % p.period;

    for (const t of this.trees) {
      t.z += dz;
      if (t.z > BACK) this.placeTree(t, t.z - SPAN);
      this.writeTree(t);
    }
    this.trunks.instanceMatrix.needsUpdate = true;
    this.pines.instanceMatrix.needsUpdate = true;
    this.rounds.instanceMatrix.needsUpdate = true;

    for (const b of this.buildings) {
      b.position.z += dz;
      if (b.position.z > BACK + 30) this.placeBuilding(b, b.position.z - SPAN - 60);
    }
  }
}
