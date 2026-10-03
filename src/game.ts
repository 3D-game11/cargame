import * as THREE from 'three';
import { AudioFX } from './audio';
import { PLAYER_CFG, PLAYER_COLORS, clamp, damp, laneCenter, type GameMode, type TimeOfDay } from './config';
import { Sparks } from './effects';
import { Input } from './input';
import { Player } from './player';
import { load, save } from './storage';
import { Traffic, type TrafficCar } from './traffic';
import { UI } from './ui';
import { World } from './world';

type State = 'menu' | 'countdown' | 'playing' | 'paused' | 'crashed' | 'gameover';

interface Settings {
  mode: GameMode;
  time: TimeOfDay;
  color: number;
  muted: boolean;
}

interface RunStats {
  score: number;
  distance: number;
  nearMiss: number;
  overtakes: number;
  topSpeed: number;
  combo: number;
  comboTimer: number;
}

const START_LANE = 2;
const COUNTDOWN = 3;
const CRASH_TIME = 1.8;

const MODE_HINT: Record<GameMode, string> = {
  oneway: 'Бүх эгнээ нэг чиглэлд хөдөлнө.',
  twoway: 'Зүүн 2 эгнээ эсрэг урсгалтай — тэнд явбал оноо ×2!',
};

const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export class Game {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private player: Player;
  private traffic: Traffic;
  private input: Input;
  private audio = new AudioFX();
  private ui = new UI();
  private sparks = new Sparks();

  private state: State = 'menu';
  private settings: Settings;
  private run: RunStats = this.freshRun();
  private best = 0;
  private timer = 0;
  private goTimer = 0;
  private scrapeTimer = 0;
  private camMode = 0;
  private shake = 0;
  private orbit = 0.6;
  private menuShift = 0;
  private frameDz = 0;
  private last = performance.now();

  private camPos = new THREE.Vector3(6, 2.5, 6);
  private camLook = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpD = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2600);
    this.world = new World(this.renderer);

    this.settings = {
      mode: 'oneway',
      time: 'day',
      color: PLAYER_COLORS[0],
      muted: false,
      ...load<Partial<Settings>>('settings', {}),
    };

    this.player = new Player(this.world.scene, this.settings.color);
    this.traffic = new Traffic(this.world.scene);
    this.world.scene.add(this.sparks.points);
    this.input = new Input(this.ui.touch);

    this.traffic.onNearMiss = (car, gap) => this.nearMiss(car, gap);
    this.traffic.onOvertake = () => {
      if (this.state === 'playing') this.run.overtakes++;
    };

    if (window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

    this.bindUI();
    this.applySettings();
    this.toMenu();

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.setPaused(true);
    });
  }

  start() {
    this.renderer.setAnimationLoop(this.tick);
  }

  // ---------------------------------------------------------------- setup

  private freshRun(): RunStats {
    return { score: 0, distance: 0, nearMiss: 0, overtakes: 0, topSpeed: 0, combo: 0, comboTimer: 0 };
  }

  private bindUI() {
    const byId = (id: string) => document.getElementById(id)!;

    document.querySelectorAll<HTMLElement>('.seg[data-setting]').forEach((seg) => {
      const key = seg.dataset.setting as 'mode' | 'time';
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (key === 'mode') this.settings.mode = btn.dataset.value as GameMode;
          else this.settings.time = btn.dataset.value as TimeOfDay;
          this.applySettings();
        });
      });
    });

    const colors = byId('colors');
    for (const c of PLAYER_COLORS) {
      const b = document.createElement('button');
      b.style.background = `#${c.toString(16).padStart(6, '0')}`;
      b.dataset.color = String(c);
      b.setAttribute('aria-label', 'Өнгө');
      b.addEventListener('click', () => {
        this.settings.color = c;
        this.applySettings();
      });
      colors.appendChild(b);
    }

    byId('btn-start').addEventListener('click', () => this.startRun());
    byId('btn-retry').addEventListener('click', () => this.startRun());
    byId('btn-menu').addEventListener('click', () => this.toMenu());
    byId('btn-pause-menu').addEventListener('click', () => this.toMenu());
    byId('btn-resume').addEventListener('click', () => this.setPaused(false));
    byId('btn-pause').addEventListener('click', () => this.setPaused(this.state !== 'paused'));
    byId('btn-mute').addEventListener('click', () => this.toggleMute());
    byId('btn-cam').addEventListener('click', () => (this.camMode = 1 - this.camMode));

    this.input.onPress(['KeyC'], () => {
      if (this.state === 'playing' || this.state === 'countdown') this.camMode = 1 - this.camMode;
    });
    this.input.onPress(['KeyP', 'Escape'], () => {
      if (this.state === 'playing' || this.state === 'paused') this.setPaused(this.state === 'playing');
    });
    this.input.onPress(['KeyM'], () => this.toggleMute());
    this.input.onPress(['Enter'], () => {
      if (this.state === 'menu' || this.state === 'gameover') this.startRun();
      else if (this.state === 'paused') this.setPaused(false);
    });
  }

  private applySettings() {
    const s = this.settings;
    document.querySelectorAll<HTMLElement>('.seg[data-setting]').forEach((seg) => {
      const value = seg.dataset.setting === 'mode' ? s.mode : s.time;
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.value === value));
    });
    document.querySelectorAll<HTMLButtonElement>('#colors button').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.color) === s.color),
    );
    document.getElementById('mode-hint')!.textContent = MODE_HINT[s.mode];
    document.getElementById('btn-mute')!.classList.toggle('off', s.muted);

    this.world.setMode(s.mode);
    this.world.setTime(s.time);
    this.player.setColor(s.color);
    this.player.headlight.visible = s.time === 'night';
    this.audio.setMuted(s.muted);
    this.best = load<number>(`best-${s.mode}`, 0);
    this.ui.setMenuBest(this.best);
    save('settings', s);
  }

  private toggleMute() {
    this.settings.muted = !this.settings.muted;
    this.applySettings();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- state changes

  private toMenu() {
    this.state = 'menu';
    this.traffic.clear();
    this.player.reset(laneCenter(START_LANE), PLAYER_CFG.startSpeed);
    this.ui.show(this.ui.menu, true);
    this.ui.show(this.ui.pause, false);
    this.ui.show(this.ui.gameover, false);
    this.ui.show(this.ui.hud, false);
    this.ui.show(this.ui.touch, false);
    this.ui.showCountdown(null);
    this.ui.clearPopups();
    this.audio.nitro(false);
    this.audio.horn(false);
  }

  private startRun() {
    this.audio.init();
    (document.activeElement as HTMLElement | null)?.blur();
    this.input.clear();
    this.run = this.freshRun();
    this.best = load<number>(`best-${this.settings.mode}`, 0);
    this.traffic.reset(this.settings.mode, START_LANE);
    this.player.reset(laneCenter(START_LANE), 0);
    this.sparks.update(10, 0);
    this.state = 'countdown';
    this.timer = COUNTDOWN;
    this.shake = 0;
    this.ui.show(this.ui.menu, false);
    this.ui.show(this.ui.gameover, false);
    this.ui.show(this.ui.pause, false);
    this.ui.show(this.ui.hud, true);
    this.ui.show(this.ui.touch, document.body.classList.contains('touch'));
    this.ui.clearPopups();
    this.ui.showCountdown(String(COUNTDOWN));
    this.audio.beep();
  }

  private setPaused(paused: boolean) {
    if (paused && this.state === 'playing') {
      this.state = 'paused';
      this.input.clear();
      this.ui.show(this.ui.pause, true);
      this.audio.engine(0, 0, false);
      this.audio.nitro(false);
      this.audio.horn(false);
    } else if (!paused && this.state === 'paused') {
      this.state = 'playing';
      this.ui.show(this.ui.pause, false);
      this.last = performance.now();
    }
  }

  private crash(car: TrafficCar) {
    const p = this.player;
    this.state = 'crashed';
    this.timer = CRASH_TIME;
    const side = Math.sign(p.x - car.x) || (Math.random() < 0.5 ? -1 : 1);
    const headOn = car.dir === 1;
    const impactSpeed = p.speed;
    p.crash(side, headOn);
    this.traffic.crashCar(car, -side * 3.5, headOn ? 0 : Math.max(car.speed, impactSpeed * 0.85));
    this.sparks.emit((p.x + car.x) / 2, 0.7, car.z / 2, 110, 10);
    this.shake = 1.3;
    this.ui.flash();
    this.audio.crash();
    this.audio.nitro(false);
    this.audio.horn(false);
    navigator.vibrate?.(250);
  }

  private gameOver() {
    this.state = 'gameover';
    const r = this.run;
    const score = Math.floor(r.score);
    const newRecord = score > this.best && score > 0;
    if (newRecord) {
      this.best = score;
      save(`best-${this.settings.mode}`, score);
    }
    this.ui.show(this.ui.hud, false);
    this.ui.show(this.ui.touch, false);
    this.ui.clearPopups();
    this.ui.showGameOver({
      score,
      best: this.best,
      distance: r.distance,
      topSpeed: r.topSpeed,
      nearMiss: r.nearMiss,
      overtakes: r.overtakes,
      newRecord,
    });
    this.ui.setMenuBest(this.best);
  }

  private nearMiss(car: TrafficCar, gap: number) {
    if (this.state !== 'playing' || this.player.speed < 80 / 3.6) return;
    const r = this.run;
    r.nearMiss++;
    r.combo = r.comboTimer > 0 ? r.combo + 1 : 1;
    r.comboTimer = 3.5;
    const close = gap < 0.4;
    const base = (close ? 400 : 250) + (car.dir === 1 ? 150 : 0);
    const bonus = base * r.combo;
    r.score += bonus;
    this.player.nitro = Math.min(1, this.player.nitro + 0.14);
    this.ui.popup(`${close ? 'МАШ ОЙРХОН!' : 'ОЙРХОН!'} +${bonus}`, r.combo > 1 ? `КОМБО ×${r.combo}` : '');
    this.audio.whoosh();
  }

  // ---------------------------------------------------------------- loop

  private tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.renderer.render(this.world.scene, this.camera);
  };

  private update(dt: number) {
    this.frameDz = 0;
    switch (this.state) {
      case 'menu':
        this.player.cruise(dt, 70);
        this.frameDz = this.player.speed * dt;
        break;
      case 'countdown':
        this.updateCountdown(dt);
        break;
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'crashed':
        this.updateCrashed(dt);
        break;
      case 'paused':
      case 'gameover':
        break;
    }
    if (this.state !== 'paused') {
      this.world.update(this.frameDz, dt, this.camera.position);
      this.sparks.update(dt, this.frameDz);
      this.updateCamera(dt);
    }
    this.updateAudio();
  }

  private updateCountdown(dt: number) {
    this.player.cruise(dt, 0);
    const prev = Math.ceil(this.timer);
    this.timer -= dt;
    const cur = Math.ceil(this.timer);
    if (cur !== prev && cur > 0) {
      this.ui.showCountdown(String(cur));
      this.audio.beep();
    }
    if (this.timer <= 0) {
      this.state = 'playing';
      this.player.speed = PLAYER_CFG.startSpeed;
      this.goTimer = 0.9;
      this.ui.showCountdown('ЯВ!', true);
      this.audio.beep(true);
    }
    this.updateHud();
  }

  private updatePlaying(dt: number) {
    const p = this.player;
    const r = this.run;
    const inp = this.input;

    if (this.goTimer > 0) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.ui.showCountdown(null);
    }

    p.drive(dt, { steer: inp.steer, gas: inp.gas, brake: inp.brake, nitro: inp.nitro });
    const dz = p.speed * dt;
    this.frameDz = dz;

    if (p.scraping) {
      const sx = p.x + Math.sign(p.x) * (p.model.width / 2);
      this.sparks.emit(sx, 0.45, 0.6, 3, 4);
      this.shake = Math.max(this.shake, 0.18);
      this.scrapeTimer -= dt;
      if (this.scrapeTimer <= 0) {
        this.audio.scrape();
        this.scrapeTimer = 0.09;
      }
    }

    const difficulty = Math.min(1, r.distance / 15000);
    const hit = this.traffic.update(dt, p.box, { difficulty, spawn: true, collide: true, nearMiss: true });

    const kmh = p.speed * 3.6;
    const oncoming = this.settings.mode === 'twoway' && p.x < 0;
    let mult = 1;
    if (kmh > 120) mult += 0.5;
    if (oncoming) mult += 1;
    r.distance += dz;
    r.score += dz * mult;
    r.topSpeed = Math.max(r.topSpeed, kmh);
    if (r.comboTimer > 0) {
      r.comboTimer -= dt;
      if (r.comboTimer <= 0) r.combo = 0;
    }

    this.updateHud();
    if (hit) this.crash(hit);
  }

  private updateCrashed(dt: number) {
    const p = this.player;
    p.crashUpdate(dt);
    this.frameDz = p.speed * dt;
    this.traffic.update(dt, p.box, { difficulty: 0, spawn: false, collide: false, nearMiss: false });
    this.timer -= dt;
    if (this.timer <= 0) this.gameOver();
  }

  private updateHud() {
    const p = this.player;
    const r = this.run;
    const kmh = p.speed * 3.6;
    const tags: { text: string; cls: string }[] = [];
    if (this.state === 'playing') {
      if (kmh > 120) tags.push({ text: 'ӨНДӨР ХУРД ×1.5', cls: 'speed' });
      if (this.settings.mode === 'twoway' && p.x < 0) tags.push({ text: 'ЭСРЭГ ЧИГЛЭЛ ×2', cls: 'oncoming' });
      if (r.combo > 1 && r.comboTimer > 0) tags.push({ text: `КОМБО ×${r.combo}`, cls: 'combo' });
    }
    this.ui.updateHUD({
      score: r.score,
      distance: r.distance,
      best: Math.max(this.best, r.score),
      kmh,
      speedFrac: p.speed / PLAYER_CFG.nitroSpeed,
      nitro: p.nitro,
      nitroOn: p.nitroOn,
      tags,
    });
  }

  private updateAudio() {
    const p = this.player;
    const s = this.state;
    if (s === 'playing') {
      this.audio.engine(p.speed * 3.6, p.throttle, true);
      this.audio.nitro(p.nitroOn);
      this.audio.horn(this.input.horn);
    } else if (s === 'countdown') {
      const rev = this.input.gas;
      this.audio.engine(rev ? 38 : 4, rev ? 1 : 0.15, true);
    } else {
      this.audio.engine(0, 0, false);
      if (s !== 'paused') this.audio.nitro(false);
    }
  }

  // ---------------------------------------------------------------- camera

  private orbitTarget(pos: THREE.Vector3, look: THREE.Vector3, radius: number) {
    const p = this.player;
    pos.set(p.x + Math.sin(this.orbit) * radius, 2.0 + Math.sin(this.orbit * 0.7) * 0.5, Math.cos(this.orbit) * radius);
    look.set(p.x, 0.75, 0);
  }

  private driveTarget(pos: THREE.Vector3, look: THREE.Vector3) {
    const p = this.player;
    const sf = clamp(p.speed / PLAYER_CFG.maxSpeed, 0, 1.4);
    const portrait = this.camera.aspect < 1 ? 1.2 : 0;
    if (this.camMode === 0) {
      pos.set(p.x * 0.8, 3.0 + sf * 0.2 + portrait, 7.4 - sf * 0.5 + portrait * 1.5);
      look.set(p.x * 0.9, 1.0, -14);
    } else {
      pos.set(p.x, 1.1, -0.55);
      look.set(p.x - Math.sin(p.yaw) * 30, 1.0, -Math.cos(p.yaw) * 30);
    }
  }

  private updateCamera(dt: number) {
    const cam = this.camera;
    const p = this.player;
    const s = this.state;
    const pos = this.tmpA;
    const look = this.tmpB;
    let fov = 50;

    if (s === 'menu' || s === 'gameover') {
      this.orbit += dt * (s === 'menu' ? 0.2 : 0.3);
      this.orbitTarget(pos, look, s === 'menu' ? 8.5 : 10);
      this.camPos.lerp(pos, damp(s === 'menu' ? 20 : 3, dt));
      this.camLook.lerp(look, damp(8, dt));
    } else if (s === 'countdown') {
      this.orbit += dt * 0.2;
      this.orbitTarget(this.tmpC, this.tmpD, 8.5);
      this.driveTarget(pos, look);
      const t = smoothstep(1 - this.timer / COUNTDOWN);
      pos.lerpVectors(this.tmpC, pos, t);
      look.lerpVectors(this.tmpD, look, t);
      this.camPos.lerp(pos, damp(10, dt));
      this.camLook.lerp(look, damp(10, dt));
      fov = 50 + t * 10;
    } else {
      this.driveTarget(pos, look);
      const k = this.camMode === 0 ? damp(7, dt) : 1;
      this.camPos.lerp(pos, k);
      this.camLook.lerp(look, k);
      const sf = clamp(p.speed / PLAYER_CFG.maxSpeed, 0, 1.4);
      fov = (this.camMode === 0 ? 60 : 72) + sf * 13 + (p.nitroOn ? 8 : 0);
    }
    if (cam.aspect < 1) fov *= 1 + (1 - cam.aspect) * 0.5;

    // Screen shake: crashes, scrapes and a faint rumble at high speed.
    this.shake *= Math.exp(-3.5 * dt);
    const rumble = s === 'playing' ? clamp(p.speed / PLAYER_CFG.nitroSpeed, 0, 1) * 0.02 + (p.nitroOn ? 0.025 : 0) : 0;
    const amp = this.shake * 0.35 + rumble;
    cam.position.set(
      this.camPos.x + (Math.random() - 0.5) * amp,
      this.camPos.y + (Math.random() - 0.5) * amp,
      this.camPos.z + (Math.random() - 0.5) * amp,
    );
    cam.lookAt(this.camLook);

    cam.fov += (fov - cam.fov) * damp(4, dt);
    // Shift the picture right while the menu panel covers the left side.
    const wantShift = s === 'menu' && cam.aspect > 1.1 && window.innerWidth > 640 ? 0.17 : 0;
    this.menuShift += (wantShift - this.menuShift) * damp(5, dt);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.menuShift > 0.001) cam.setViewOffset(w, h, -this.menuShift * w, 0, w, h);
    else if (cam.view?.enabled) cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }
}
