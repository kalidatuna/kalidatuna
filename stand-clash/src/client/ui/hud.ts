// In-game HUD (DOM). Text is only rewritten when values change to keep layout work low.
import type { Fighter } from '../../shared/sim';
import type { AbilityId } from '../../shared/characters';

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

interface Slot {
  el: HTMLElement;
  cd: HTMLElement;
  cdt: HTMLElement;
  id: AbilityId | 'dash' | 'summon';
  wasReady: boolean;
}

export class Hud {
  root: HTMLElement;
  private slots: Slot[] = [];
  private cache = new Map<string, string>();
  private comboT = 0;
  private comboN = 0;
  private comboDmg = 0;
  private annEl: HTMLElement;
  private feed: HTMLElement;
  trainingPanel: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div id="crosshair"></div>
      <div id="net-status" class="panel hidden"></div>
      <div id="fps"></div>
      <div id="objective" class="panel"><div class="t"></div><div class="x"></div></div>
      <div id="boss-bar" class="hidden"><div class="name"></div><div class="bar"><div class="lag"></div><div class="fill"></div></div></div>
      <div id="target-panel" class="panel hidden"><div class="name"></div><div class="bar"><div class="lag"></div><div class="fill"></div><div class="txt"></div></div></div>
      <div id="combo" class="hidden"><div class="count">0</div><div class="label">HITS!</div><div class="dmg"></div></div>
      <div id="player-panel" class="panel">
        <div id="portrait">J</div>
        <div id="p-name"></div>
        <div class="bar hp"><div class="lag"></div><div class="fill"></div><div class="txt"></div></div>
        <div class="bar energy"><div class="fill"></div></div>
        <div id="stand-state"></div>
      </div>
      <div id="abilities"></div>
      <div id="ts-overlay" class="hidden"><div class="t">時よ止まれ</div><div class="c">0.0</div></div>
      <div id="killfeed"></div>
      <div id="announce"></div>
      <div id="hint"></div>
      <div id="respawn-msg" class="hidden"></div>
      <div id="scoreboard" class="panel hidden"></div>
      <div id="training-panel" class="panel hidden"></div>
    `;
    this.annEl = $(root, '#announce');
    this.feed = $(root, '#killfeed');
    this.trainingPanel = $(root, '#training-panel');
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  private text(sel: string, v: string) {
    if (this.cache.get(sel) === v) return;
    this.cache.set(sel, v);
    $(this.root, sel).textContent = v;
  }
  private html(sel: string, v: string) {
    if (this.cache.get(sel) === v) return;
    this.cache.set(sel, v);
    $(this.root, sel).innerHTML = v;
  }
  private style(el: HTMLElement, key: string, prop: 'width' | 'height', v: string) {
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    el.style[prop] = v;
  }
  private toggle(sel: string, cls: string, on: boolean) {
    const k = sel + '.' + cls;
    const v = on ? '1' : '0';
    if (this.cache.get(k) === v) return;
    this.cache.set(k, v);
    $(this.root, sel).classList.toggle(cls, on);
  }

  setupPlayer(f: Fighter) {
    this.cache.clear();
    $(this.root, '#portrait').textContent = f.char === 'dio' ? 'D' : 'J';
    $(this.root, '#p-name').innerHTML = `${f.def.name}<small>「${f.def.standName ?? ''}」</small>`;
    const def = f.def;
    const list: { id: Slot['id']; key: string; nm: string; ic: string }[] = [
      { id: 'combo', key: 'LMB', nm: 'Combo', ic: '👊' },
      { id: 'barrage', key: 'Q', nm: def.abilities.barrage?.name ?? 'Barrage', ic: '💥' },
      { id: def.heavyKey ?? 'uppercut', key: 'R', nm: def.heavyKey ? def.abilities[def.heavyKey]!.name : '-', ic: def.heavyKey === 'knives' ? '🔪' : '⤴' },
      { id: def.specialMove ?? 'dash', key: 'SHIFT', nm: def.specialMove ? def.abilities[def.specialMove]!.name : 'Dash', ic: def.specialMove === 'leap' ? '🦘' : '⚡' },
      { id: 'timestop', key: 'F', nm: 'Time Stop', ic: '⏱' },
      { id: 'summon', key: 'E', nm: 'Stand', ic: '✦' },
    ];
    const box = $(this.root, '#abilities');
    box.innerHTML = '';
    this.slots = list.map((s) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<div class="ic">${s.ic}</div><div class="key">${s.key}</div><div class="nm">${s.nm}</div><div class="cd"></div><div class="cdt"></div>`;
      box.appendChild(el);
      return { el, cd: $(el, '.cd'), cdt: $(el, '.cdt'), id: s.id, wasReady: true };
    });
  }

  update(f: Fighter, dt: number, opts: { lock: boolean; noCooldown?: boolean }) {
    const hpR = Math.max(0, f.hp / f.maxHp);
    const hpEl = $(this.root, '.bar.hp');
    this.style($(hpEl, '.fill'), 'hpf', 'width', `${(hpR * 100).toFixed(1)}%`);
    this.style($(hpEl, '.lag'), 'hpl', 'width', `${(hpR * 100).toFixed(1)}%`);
    this.text('.bar.hp .txt', `${Math.ceil(f.hp)} / ${f.maxHp}`);
    const enR = f.maxEnergy ? f.energy / f.maxEnergy : 0;
    this.style($(this.root, '.bar.energy .fill'), 'enf', 'width', `${(enR * 100).toFixed(1)}%`);
    this.toggle('.bar.energy', 'low', enR < 0.25);
    this.text('#stand-state', f.standOut ? `「${f.def.standName}」 SUMMONED` : 'STAND DISMISSED  [E]');
    this.toggle('#stand-state', 'on', f.standOut);
    this.toggle('#crosshair', 'lock', opts.lock);

    for (const s of this.slots) {
      let cd = 0;
      let max = 1;
      let cost = 0;
      if (s.id === 'dash') {
        cd = f.dashCd;
        max = 0.45;
      } else if (s.id === 'summon') {
        cd = f.standCd;
        max = 0.3;
      } else {
        const def = f.def.abilities[s.id];
        cd = f.cds[s.id] ?? 0;
        max = def?.cooldown || 1;
        cost = def?.energy ?? 0;
      }
      if (opts.noCooldown) cd = 0;
      const ready = cd <= 0.05;
      this.style(s.cd, 'cd' + s.id, 'height', ready ? '0%' : `${Math.min(100, (cd / max) * 100).toFixed(0)}%`);
      const txt = ready || cd < 0.3 ? '' : cd >= 10 ? cd.toFixed(0) : cd.toFixed(1);
      if (s.cdt.textContent !== txt) s.cdt.textContent = txt;
      const noE = cost > f.energy;
      if (s.el.classList.contains('noenergy') !== noE) s.el.classList.toggle('noenergy', noE);
      const active = (s.id === 'summon' && f.standOut) || f.action?.id === s.id;
      if (s.el.classList.contains('active') !== active) s.el.classList.toggle('active', active);
      if (ready && !s.wasReady && max > 1) {
        s.el.classList.remove('ready-flash');
        void s.el.offsetWidth;
        s.el.classList.add('ready-flash');
      }
      s.wasReady = ready;
    }

    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.toggle('#combo', 'hidden', true);
    }
  }

  combo(n: number, dmg: number) {
    if (n < 2) {
      this.comboDmg = dmg;
      this.comboN = n;
      return;
    }
    if (n <= this.comboN) this.comboDmg = 0;
    this.comboN = n;
    this.comboDmg += dmg;
    this.comboT = 1.4;
    this.toggle('#combo', 'hidden', false);
    this.text('#combo .count', String(n));
    this.text('#combo .dmg', `${Math.round(this.comboDmg)} DMG`);
    const c = $(this.root, '#combo');
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
  }

  objective(title: string, text: string) {
    this.text('#objective .t', title);
    this.text('#objective .x', text);
  }

  target(f: Fighter | null) {
    this.toggle('#target-panel', 'hidden', !f);
    if (!f) return;
    this.text('#target-panel .name', f.name);
    const r = Math.max(0, f.hp / f.maxHp);
    const p = $(this.root, '#target-panel');
    this.style($(p, '.fill'), 'tf', 'width', `${(r * 100).toFixed(1)}%`);
    this.style($(p, '.lag'), 'tl', 'width', `${(r * 100).toFixed(1)}%`);
    this.text('#target-panel .txt', `${Math.ceil(f.hp)}`);
  }

  boss(f: Fighter | null) {
    this.toggle('#boss-bar', 'hidden', !f);
    if (!f) return;
    this.text('#boss-bar .name', f.name);
    const r = Math.max(0, f.hp / f.maxHp);
    const b = $(this.root, '#boss-bar');
    this.style($(b, '.fill'), 'bf', 'width', `${(r * 100).toFixed(1)}%`);
    this.style($(b, '.lag'), 'bl', 'width', `${(r * 100).toFixed(1)}%`);
  }

  timeStop(active: boolean, remaining: number, title = '時よ止まれ') {
    this.toggle('#ts-overlay', 'hidden', !active);
    if (active) {
      this.text('#ts-overlay .t', title);
      this.text('#ts-overlay .c', Math.max(0, remaining).toFixed(1));
    }
  }

  announce(text: string, style = '') {
    const el = document.createElement('div');
    el.className = 'ann ' + style;
    el.textContent = text;
    this.annEl.innerHTML = '';
    this.annEl.appendChild(el);
  }

  killfeed(text: string) {
    const d = document.createElement('div');
    d.textContent = text;
    this.feed.prepend(d);
    while (this.feed.children.length > 5) this.feed.lastChild?.remove();
    setTimeout(() => d.remove(), 5000);
  }

  hint(text: string) {
    this.text('#hint', text);
  }

  respawn(text: string | null) {
    this.toggle('#respawn-msg', 'hidden', !text);
    if (text) this.text('#respawn-msg', text);
  }

  net(text: string | null, good = true) {
    this.toggle('#net-status', 'hidden', !text);
    if (text) this.html('#net-status', `<span class="dot ${good ? '' : 'bad'}"></span>${text}`);
  }

  scoreboard(html: string | null) {
    this.toggle('#scoreboard', 'hidden', !html);
    if (html) this.html('#scoreboard', html);
  }

  fps(text: string) {
    this.text('#fps', text);
  }
}
