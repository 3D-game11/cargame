const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface HudState {
  score: number;
  distance: number;
  best: number;
  kmh: number;
  speedFrac: number;
  nitro: number;
  nitroOn: boolean;
  tags: { text: string; cls: string }[];
}

export interface RunSummary {
  score: number;
  best: number;
  distance: number;
  topSpeed: number;
  nearMiss: number;
  overtakes: number;
  newRecord: boolean;
}

export const formatKm = (m: number) => `${(m / 1000).toFixed(2)} км`;
const fmt = (n: number) => Math.floor(n).toLocaleString('en-US').replace(/,/g, ' ');

/** Thin wrapper over the DOM overlays. Caches last values to avoid needless DOM writes. */
export class UI {
  readonly hud = $('hud');
  readonly touch = $('touch');
  readonly menu = $('menu');
  readonly pause = $('pause');
  readonly gameover = $('gameover');
  private countdown = $('countdown');
  private flashEl = $('flash');
  private popups = $('popups');
  private tagsEl = $('hud-tags');
  private els = {
    score: $('hud-score'),
    dist: $('hud-dist'),
    best: $('hud-best'),
    speed: $('hud-speed'),
    speedBar: $('hud-speed-bar'),
    nitroBar: $('hud-nitro-bar'),
  };
  private last: Record<string, string> = {};

  show(el: HTMLElement, visible: boolean) {
    el.classList.toggle('hidden', !visible);
  }

  private set(key: string, el: HTMLElement, text: string) {
    if (this.last[key] !== text) {
      this.last[key] = text;
      el.textContent = text;
    }
  }

  private width(key: string, el: HTMLElement, frac: number) {
    const v = `${Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 10}%`;
    if (this.last[key] !== v) {
      this.last[key] = v;
      el.style.width = v;
    }
  }

  updateHUD(s: HudState) {
    this.set('score', this.els.score, fmt(s.score));
    this.set('dist', this.els.dist, formatKm(s.distance));
    this.set('best', this.els.best, fmt(s.best));
    this.set('speed', this.els.speed, String(Math.round(s.kmh)));
    this.width('speedBar', this.els.speedBar, s.speedFrac);
    this.width('nitroBar', this.els.nitroBar, s.nitro);
    this.hud.classList.toggle('nitro-on', s.nitroOn);
    const tagKey = s.tags.map((t) => t.text).join('|');
    if (this.last.tags !== tagKey) {
      this.last.tags = tagKey;
      this.tagsEl.replaceChildren(
        ...s.tags.map((t) => {
          const d = document.createElement('div');
          d.className = `tag ${t.cls}`;
          d.textContent = t.text;
          return d;
        }),
      );
    }
  }

  popup(text: string, sub = '') {
    const d = document.createElement('div');
    d.className = 'popup';
    d.textContent = text;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      d.appendChild(s);
    }
    this.popups.prepend(d);
    while (this.popups.children.length > 3) this.popups.lastElementChild?.remove();
    d.addEventListener('animationend', () => d.remove());
  }

  showCountdown(text: string | null, go = false) {
    if (text === null) {
      this.show(this.countdown, false);
      return;
    }
    this.show(this.countdown, true);
    const d = document.createElement('div');
    d.className = go ? 'num go' : 'num';
    d.textContent = text;
    this.countdown.replaceChildren(d);
  }

  flash() {
    this.flashEl.classList.remove('on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }

  clearPopups() {
    this.popups.replaceChildren();
    this.tagsEl.replaceChildren();
    this.last.tags = '';
  }

  showGameOver(r: RunSummary) {
    $('go-score').textContent = fmt(r.score);
    $('go-best').textContent = fmt(r.best);
    $('go-dist').textContent = formatKm(r.distance);
    $('go-top').textContent = `${Math.round(r.topSpeed)} км/ц`;
    $('go-near').textContent = String(r.nearMiss);
    $('go-over').textContent = String(r.overtakes);
    this.show($('new-record'), r.newRecord);
    this.show(this.gameover, true);
  }

  setMenuBest(best: number) {
    $('menu-best').innerHTML = best > 0 ? `Энэ горимын шилдэг оноо: <b>${fmt(best)}</b>` : '';
  }
}
