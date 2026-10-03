import * as THREE from 'three';
import { createCar, paintMaterial, type CarModel } from './cars';
import { PLAYER_CFG, ROAD_HALF, SHOULDER, approach, clamp, damp } from './config';
import type { PlayerBox } from './traffic';

export interface Controls {
  steer: number;
  gas: boolean;
  brake: boolean;
  nitro: boolean;
}

export class Player {
  readonly model: CarModel;
  readonly headlight: THREE.SpotLight;
  x = 0;
  speed = 0;
  vx = 0;
  yaw = 0;
  nitro = 1;
  nitroOn = false;
  throttle = 0;
  braking = false;
  scraping = false;
  crashed = false;

  private steer = 0;
  private spin = 0;
  private pitch = 0;
  private roll = 0;

  constructor(scene: THREE.Scene, color: number) {
    this.model = createCar('sports', color, { separateWheels: true });
    scene.add(this.model.root);

    this.headlight = new THREE.SpotLight(0xfff2d8, 70, 130, 0.5, 0.6, 1);
    this.headlight.position.set(0, 0.7, -2.0);
    this.headlight.target.position.set(0, 0, -40);
    this.model.root.add(this.headlight, this.headlight.target);
    this.headlight.visible = false;
  }

  get box(): PlayerBox {
    return { x: this.x, z: 0, length: this.model.length, width: this.model.width, speed: this.speed };
  }

  setColor(color: number) {
    this.model.paintMesh.material = paintMaterial(color);
  }

  reset(x: number, speed: number) {
    this.x = x;
    this.speed = speed;
    this.vx = 0;
    this.yaw = 0;
    this.steer = 0;
    this.spin = 0;
    this.nitro = 1;
    this.nitroOn = false;
    this.crashed = false;
    this.scraping = false;
    this.pitch = 0;
    this.roll = 0;
    this.apply(0);
  }

  drive(dt: number, c: Controls) {
    const cfg = PLAYER_CFG;
    this.steer = approach(this.steer, c.steer, dt * 5.5);
    const maxLat = 5 + this.speed * 0.075;
    this.vx += (this.steer * maxLat - this.vx) * damp(9, dt);

    this.nitroOn = c.nitro && this.nitro > 0.02;
    this.braking = c.brake;
    this.throttle = c.gas || this.nitroOn ? 1 : 0;

    if (this.nitroOn) {
      this.speed = approach(this.speed, cfg.nitroSpeed, 16 * dt);
      this.nitro = Math.max(0, this.nitro - dt * 0.32);
    } else {
      if (this.speed > cfg.maxSpeed) this.speed = approach(this.speed, cfg.maxSpeed, 6 * dt);
      else if (c.brake) this.speed -= cfg.brake * dt;
      else if (c.gas) this.speed += cfg.accel * (1 - 0.65 * (this.speed / cfg.maxSpeed)) * dt;
      else this.speed -= cfg.coast * dt;
      this.nitro = Math.min(1, this.nitro + dt * 0.035);
    }
    this.speed = clamp(this.speed, cfg.minSpeed, cfg.nitroSpeed);

    this.x += this.vx * dt;
    const limit = ROAD_HALF + SHOULDER * 0.55 - this.model.width / 2;
    this.scraping = false;
    if (Math.abs(this.x) > limit) {
      this.x = Math.sign(this.x) * limit;
      this.vx = 0;
      this.scraping = Math.abs(c.steer) > 0 && Math.sign(c.steer) === Math.sign(this.x);
      this.speed = Math.max(cfg.minSpeed, this.speed - 7 * dt);
    }

    this.yaw = -Math.atan2(this.vx, Math.max(this.speed, 5)) * 0.9;
    const targetPitch = c.brake ? -0.035 : c.gas || this.nitroOn ? 0.018 : 0;
    this.pitch += (targetPitch - this.pitch) * damp(6, dt);
    this.roll += (this.vx * 0.012 - this.roll) * damp(8, dt);
    this.apply(dt);
  }

  crash(side: number, headOn: boolean) {
    this.crashed = true;
    this.nitroOn = false;
    this.spin = side * (2.4 + Math.random() * 1.6);
    this.vx = side * 4.5;
    this.speed *= headOn ? 0.15 : 0.55;
  }

  crashUpdate(dt: number) {
    this.speed *= Math.exp(-1.6 * dt);
    this.spin *= Math.exp(-1.2 * dt);
    this.yaw += this.spin * dt;
    this.vx *= Math.exp(-2.2 * dt);
    const limit = ROAD_HALF + SHOULDER * 0.55 - this.model.width / 2;
    this.x = clamp(this.x + this.vx * dt, -limit, limit);
    this.roll *= Math.exp(-3 * dt);
    this.pitch *= Math.exp(-3 * dt);
    this.braking = true;
    this.apply(dt);
  }

  /** Gentle autopilot used behind the main menu. */
  cruise(dt: number, kmh: number) {
    this.speed = kmh / 3.6;
    this.steer = 0;
    this.yaw = Math.sin(performance.now() * 0.0004) * 0.01;
    this.braking = false;
    this.apply(dt);
  }

  private apply(dt: number) {
    const m = this.model;
    m.root.position.set(this.x, 0, 0);
    m.root.rotation.y = this.yaw;
    m.body.rotation.set(this.pitch, 0, this.roll);
    const spinStep = (this.speed / m.wheelRadius) * dt;
    for (const w of m.wheels) w.rotation.x -= spinStep;
    for (const w of m.frontWheels) w.rotation.y = -this.steer * 0.35;
    m.tailMaterial.emissiveIntensity = this.braking ? 6 : this.headlight.visible ? 2.2 : 0.6;
  }
}
