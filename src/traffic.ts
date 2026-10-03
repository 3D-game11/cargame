import * as THREE from 'three';
import { createCar, paintMaterial, type CarModel, type CarType } from './cars';
import {
  DESPAWN_AHEAD,
  DESPAWN_BEHIND,
  LANE_COUNT,
  SPAWN_Z,
  approach,
  laneCenter,
  toMs,
  type GameMode,
} from './config';

interface LaneChange {
  from: number;
  to: number;
  t: number;
  /** Seconds of blinking left before the car starts moving across. */
  signal: number;
}

export interface TrafficCar {
  model: CarModel;
  lane: number;
  x: number;
  z: number;
  /** -1: same direction as the player (toward -z). +1: oncoming. */
  dir: 1 | -1;
  /** Absolute speed in m/s. */
  speed: number;
  desired: number;
  lc: LaneChange | null;
  passed: boolean;
  crashed: boolean;
  spin: number;
  yaw: number;
  vx: number;
}

export interface PlayerBox {
  x: number;
  z: number;
  length: number;
  width: number;
  speed: number;
}

export interface TrafficOptions {
  difficulty: number;
  spawn: boolean;
  collide: boolean;
  nearMiss: boolean;
}

const TYPES: [CarType, number][] = [
  ['sedan', 28],
  ['hatch', 18],
  ['suv', 17],
  ['van', 8],
  ['taxi', 7],
  ['police', 3],
  ['sports', 4],
  ['truck', 9],
  ['bus', 6],
];
const TYPE_TOTAL = TYPES.reduce((s, [, w]) => s + w, 0);

const COLORS = [
  0xf2f2f2, 0x1a1a1d, 0x9aa3ad, 0x5c6670, 0xb3202a, 0x1f4e9c, 0x2e7d4f, 0xd9a21b, 0x6b2e8c, 0xe36414, 0x6f4e37,
  0x89c2d9, 0xc0c4c8,
];
const CARGO = [0xeeeeee, 0xd0d4d9, 0x2f5d8a, 0xa23b2a, 0x3c7a3c, 0xe0b23a, 0x24323f];

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export class Traffic {
  cars: TrafficCar[] = [];
  onNearMiss: ((car: TrafficCar, gap: number) => void) | null = null;
  onOvertake: (() => void) | null = null;

  private pool = new Map<CarType, CarModel[]>();
  private mode: GameMode = 'oneway';
  private cooldown = 0;
  private time = 0;

  constructor(private scene: THREE.Scene) {}

  laneDir(lane: number): 1 | -1 {
    return this.mode === 'twoway' && lane < LANE_COUNT / 2 ? 1 : -1;
  }

  clear() {
    for (const c of this.cars) this.release(c);
    this.cars = [];
  }

  reset(mode: GameMode, playerLane: number) {
    this.clear();
    this.mode = mode;
    this.cooldown = 0;
    // Pre-populate the road so the first seconds are not empty; keep the player's lane clear up close.
    for (let z = -50; z > SPAWN_Z; z -= 12 + Math.random() * 18) {
      this.trySpawn(z, 0, z > -140 ? playerLane : -1);
    }
  }

  private pickType(): CarType {
    let r = Math.random() * TYPE_TOTAL;
    for (const [t, w] of TYPES) {
      r -= w;
      if (r <= 0) return t;
    }
    return 'sedan';
  }

  private acquire(type: CarType): CarModel {
    const m = this.pool.get(type)?.pop() ?? createCar(type, 0xffffff);
    if (!m.root.parent) this.scene.add(m.root);
    m.root.visible = true;
    m.root.rotation.set(0, 0, 0);
    return m;
  }

  private release(c: TrafficCar) {
    const m = c.model;
    m.root.visible = false;
    m.blinkL.visible = false;
    m.blinkR.visible = false;
    let list = this.pool.get(m.type);
    if (!list) this.pool.set(m.type, (list = []));
    list.push(m);
  }

  private trySpawn(z: number, difficulty: number, avoidLane = -1): boolean {
    const lane = Math.floor(Math.random() * LANE_COUNT);
    if (lane === avoidLane) return false;
    const x = laneCenter(lane);

    for (const o of this.cars) {
      const sameLane = Math.abs(o.x - x) < 2.6 || o.lc?.to === lane;
      if (sameLane && Math.abs(o.z - z) < 22 + o.model.length) return false;
    }
    // Never let a fresh spawn close off every lane at once.
    const occupied = new Set<number>([lane]);
    for (const o of this.cars) {
      if (Math.abs(o.z - z) < 24) {
        occupied.add(o.lane);
        if (o.lc) occupied.add(o.lc.to);
      }
    }
    if (occupied.size >= LANE_COUNT) return false;

    const type = this.pickType();
    const heavy = type === 'truck' || type === 'bus';
    let kmh = heavy ? 50 + Math.random() * 25 : 62 + Math.random() * 38;
    if (type === 'sports' || type === 'police') kmh += 22;
    kmh *= 1 + difficulty * 0.18;

    const model = this.acquire(type);
    const color = type === 'taxi' ? 0xf5c518 : type === 'police' ? 0xf4f6f8 : pick(COLORS);
    model.paintMesh.material = paintMaterial(color);
    if (model.cargoMesh) model.cargoMesh.material = paintMaterial(type === 'bus' ? pick(COLORS) : pick(CARGO));

    const dir = this.laneDir(lane);
    const car: TrafficCar = {
      model,
      lane,
      x,
      z,
      dir,
      speed: toMs(kmh),
      desired: toMs(kmh),
      lc: null,
      passed: false,
      crashed: false,
      spin: 0,
      yaw: dir === 1 ? Math.PI : 0,
      vx: 0,
    };
    this.cars.push(car);
    this.place(car);
    return true;
  }

  /** Knock a car out of the traffic flow after the player hits it. */
  crashCar(c: TrafficCar, pushVx: number, newSpeed: number) {
    c.crashed = true;
    c.lc = null;
    c.vx = pushVx;
    c.speed = newSpeed;
    c.spin = (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 2);
    c.model.blinkL.visible = true;
    c.model.blinkR.visible = true;
  }

  update(dt: number, p: PlayerBox, opts: TrafficOptions): TrafficCar | null {
    this.time += dt;

    if (opts.spawn) {
      this.cooldown -= dt;
      const target = Math.round(11 + opts.difficulty * 12);
      if (this.cooldown <= 0 && this.cars.length < target) {
        if (this.trySpawn(SPAWN_Z - Math.random() * 50, opts.difficulty)) this.cooldown = 0.18;
      }
    }

    this.followTraffic(dt, p);

    const blinkOn = Math.floor(this.time * 3) % 2 === 0;
    const sirenOn = Math.floor(this.time * 7) % 2 === 0;
    let hit: TrafficCar | null = null;

    for (const c of this.cars) {
      if (c.crashed) {
        c.spin *= Math.exp(-1.4 * dt);
        c.yaw += c.spin * dt;
        c.vx *= Math.exp(-2 * dt);
        c.x += c.vx * dt;
        c.model.blinkL.visible = c.model.blinkR.visible = blinkOn;
      } else {
        this.updateLaneChange(c, dt, opts.difficulty);
        const goingRight = c.lc ? laneCenter(c.lc.to) > laneCenter(c.lc.from) : false;
        // Model-local left is world -x for same-direction cars and world +x for oncoming ones.
        const localRight = c.dir === -1 ? goingRight : !goingRight;
        c.model.blinkL.visible = !!c.lc && !localRight && blinkOn;
        c.model.blinkR.visible = !!c.lc && localRight && blinkOn;
        c.yaw = (c.dir === 1 ? Math.PI : 0) + c.dir * Math.atan2(c.vx, Math.max(c.speed, 1));
      }
      if (c.model.sirenR && c.model.sirenB) {
        c.model.sirenR.visible = sirenOn;
        c.model.sirenB.visible = !sirenOn;
      }

      c.z += (c.dir * c.speed + p.speed) * dt;
      this.place(c);

      if (opts.nearMiss && !c.passed && c.z - c.model.length / 2 > p.z + p.length / 2) {
        c.passed = true;
        const gap = Math.abs(c.x - p.x) - (c.model.width + p.width) / 2;
        if (gap < 1.0 && !c.crashed) this.onNearMiss?.(c, gap);
        if (c.dir === -1) this.onOvertake?.();
      }

      if (opts.collide && !hit && !c.crashed) {
        const dx = Math.abs(c.x - p.x);
        const dz = Math.abs(c.z - p.z);
        if (dx < ((c.model.width + p.width) / 2) * 0.9 && dz < ((c.model.length + p.length) / 2) * 0.93) hit = c;
      }
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.z > DESPAWN_BEHIND || c.z < DESPAWN_AHEAD) {
        this.release(c);
        this.cars.splice(i, 1);
      }
    }
    return hit;
  }

  /** Simple car-following: slow down behind a slower leader (including the player). */
  private followTraffic(dt: number, p: PlayerBox) {
    for (const c of this.cars) {
      if (c.crashed) {
        c.speed = Math.max(0, c.speed - 10 * dt);
        continue;
      }
      let gap = Infinity;
      let leaderSpeed = c.desired;
      for (const o of this.cars) {
        if (o === c || o.dir !== c.dir) continue;
        if (Math.abs(o.x - c.x) > (o.model.width + c.model.width) / 2 + 0.5) continue;
        const ahead = (o.z - c.z) * c.dir;
        if (ahead <= 0) continue;
        const g = ahead - (o.model.length + c.model.length) / 2;
        if (g < gap) {
          gap = g;
          leaderSpeed = o.crashed ? 0 : o.speed;
        }
      }
      if (c.dir === -1 && Math.abs(p.x - c.x) < (p.width + c.model.width) / 2 + 0.5) {
        const ahead = c.z - p.z;
        if (ahead > 0) {
          const g = ahead - (p.length + c.model.length) / 2;
          if (g < gap) {
            gap = g;
            leaderSpeed = p.speed;
          }
        }
      }
      const safe = 7 + c.speed * 0.9;
      let target = c.desired;
      if (gap < safe) target = Math.max(0, Math.min(target, leaderSpeed - (safe - gap) * 0.12));
      const rate = target < c.speed ? (gap < safe * 0.45 ? 16 : 6) : 2.2;
      c.speed = approach(c.speed, target, rate * dt);
    }
  }

  private updateLaneChange(c: TrafficCar, dt: number, difficulty: number) {
    if (!c.lc) {
      c.vx = 0;
      const heavy = c.model.type === 'truck' || c.model.type === 'bus';
      const rate = (heavy ? 0.015 : 0.04) + difficulty * 0.07;
      if (c.z > -70 || c.z < SPAWN_Z + 20 || Math.random() > rate * dt) return;
      const to = c.lane + (Math.random() < 0.5 ? -1 : 1);
      if (to < 0 || to >= LANE_COUNT || this.laneDir(to) !== c.dir) return;
      const tx = laneCenter(to);
      for (const o of this.cars) {
        if (o === c) continue;
        const inLane = Math.abs(o.x - tx) < 2.6 || o.lc?.to === to;
        if (inLane && Math.abs(o.z - c.z) < (o.model.length + c.model.length) / 2 + 14) return;
      }
      c.lc = { from: c.lane, to, t: 0, signal: 1.4 };
      return;
    }
    const lc = c.lc;
    if (lc.signal > 0) {
      lc.signal -= dt;
      return;
    }
    const prevX = c.x;
    lc.t = Math.min(1, lc.t + dt / 1.9);
    const s = lc.t * lc.t * (3 - 2 * lc.t);
    c.x = laneCenter(lc.from) + (laneCenter(lc.to) - laneCenter(lc.from)) * s;
    c.vx = (c.x - prevX) / Math.max(dt, 1e-4);
    if (lc.t >= 1) {
      c.lane = lc.to;
      c.lc = null;
      c.vx = 0;
    }
  }

  private place(c: TrafficCar) {
    c.model.root.position.set(c.x, 0, c.z);
    c.model.root.rotation.y = c.yaw;
  }
}
