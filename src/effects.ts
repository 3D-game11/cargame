import * as THREE from 'three';

const HIDDEN_Y = -999;

/** Pooled additive spark particles for crashes and guard-rail scrapes. */
export class Sparks {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;

  constructor(private count = 260) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = HIDDEN_Y;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffc46b,
      size: 0.14,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, n: number, power = 6) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = (Math.random() - 0.5) * power;
      this.vel[i * 3 + 1] = Math.random() * power * 0.8;
      this.vel[i * 3 + 2] = (Math.random() - 0.3) * power;
      this.life[i] = 0.35 + Math.random() * 0.55;
    }
  }

  /** `dz` is the world scroll this frame so sparks stay attached to the road. */
  update(dt: number, dz: number) {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = HIDDEN_Y;
        continue;
      }
      this.vel[j + 1] -= 16 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt + dz;
      if (this.pos[j + 1] < 0.03) {
        this.pos[j + 1] = 0.03;
        this.vel[j + 1] *= -0.35;
      }
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
  }
}
