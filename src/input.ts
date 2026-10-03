type TouchKey = 'left' | 'right' | 'gas' | 'brake' | 'nitro';

const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  private keys = new Set<string>();
  private touch: Record<TouchKey, boolean> = { left: false, right: false, gas: false, brake: false, nitro: false };
  private pressHandlers = new Map<string, () => void>();

  constructor(touchRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressHandlers.get(e.code)?.();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());

    touchRoot.querySelectorAll<HTMLElement>('[data-touch]').forEach((el) => {
      const key = el.dataset.touch as TouchKey;
      const off = () => {
        this.touch[key] = false;
        el.classList.remove('active');
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.touch[key] = true;
        el.classList.add('active');
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  /** Register a one-shot handler fired on the initial key press (not on auto-repeat). */
  onPress(codes: string[], fn: () => void) {
    for (const c of codes) this.pressHandlers.set(c, fn);
  }

  clear() {
    this.keys.clear();
    for (const k of Object.keys(this.touch) as TouchKey[]) this.touch[k] = false;
  }

  private has(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  get steer(): number {
    let s = 0;
    if (this.has('ArrowLeft', 'KeyA') || this.touch.left) s -= 1;
    if (this.has('ArrowRight', 'KeyD') || this.touch.right) s += 1;
    return s;
  }
  get gas() {
    return this.has('ArrowUp', 'KeyW') || this.touch.gas;
  }
  get brake() {
    return this.has('ArrowDown', 'KeyS') || this.touch.brake;
  }
  get nitro() {
    return this.has('Space', 'ShiftLeft', 'ShiftRight') || this.touch.nitro;
  }
  get horn() {
    return this.has('KeyH');
  }
}
