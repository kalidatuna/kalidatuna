// Title, character select, mode select, missions, multiplayer lobby, pause, settings and results screens.
import { CHARACTERS, CharId, PLAYABLE } from '../../shared/characters';
import type { Phase, NetPlayer, ServerMsg } from '../../shared/protocol';
import type { Game, ResultData } from '../game/game';
import { FreeRoamMode, TrainingMode, MissionMode, MISSIONS } from '../game/modes';
import { MPMode } from '../game/mp';
import { NetClient } from '../net/netClient';
import { audio } from '../engine/audio';
import { settings, saveSettings } from '../engine/settings';

type ScreenName = 'title' | 'char' | 'mode' | 'missions' | 'lobby' | 'pause' | 'results' | 'controls' | 'settings';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Camera and aim (click to lock the pointer)'],
  ['Space', 'Jump · press again in the air to double jump (Stand out: Stand-assisted leap)'],
  ['Shift', 'Dash / air dash · with Stand out: Star Platinum Leap or The World Evasive Dash'],
  ['E', 'Summon or dismiss your Stand'],
  ['Left click', 'Basic 3-hit combo (Stand punches when summoned)'],
  ['Right click', 'Block (hold) · tap just before a hit for a PERFECT BLOCK'],
  ['Q', 'Barrage — ORA ORA / MUDA MUDA'],
  ['R', 'Jotaro: Star Uppercut · DIO: Knife Throw (aim with the crosshair)'],
  ['F', 'Time Stop (Jotaro 2s · DIO 3s)'],
  ['V', 'JoJo pose (regenerates Stand energy faster)'],
  ['Tab / Middle', 'Lock-on to the nearest enemy'],
  ['Esc', 'Pause and release the mouse'],
];

const STATS: Record<string, [string, number][]> = {
  jotaro: [
    ['Power', 0.95],
    ['Speed', 0.75],
    ['Range', 0.55],
    ['Time Stop', 0.55],
  ],
  dio: [
    ['Power', 0.85],
    ['Speed', 0.85],
    ['Range', 0.85],
    ['Time Stop', 0.9],
  ],
};

export class Menus {
  root: HTMLElement;
  char: CharId = 'jotaro';
  current: ScreenName | null = null;
  private prev: ScreenName = 'title';
  private last: { kind: 'free' | 'training' | 'mission'; stage?: number } | null = null;
  net = new NetClient();
  room: { code: string; host: number; you: number; phase: Phase; players: NetPlayer[]; target: number } | null = null;
  private lobbyMsg = '';
  private lastResults: ResultData | null = null;
  private inMatch = false;

  constructor(private game: Game) {
    this.root = document.getElementById('screens')!;
    game.onPause = () => this.show('pause');
    game.onResults = (r) => {
      this.lastResults = r;
      this.show('results');
    };
    this.net.on((m) => this.onNet(m));
    this.net.onStatus(() => {
      if (this.current === 'lobby') this.render();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.current === 'pause' && !e.defaultPrevented) {
        e.preventDefault();
        this.resume();
      }
    });
  }

  show(name: ScreenName) {
    if (name !== this.current && this.current && this.current !== 'controls' && this.current !== 'settings') this.prev = this.current;
    this.current = name;
    this.render();
  }

  hide() {
    this.current = null;
    this.root.innerHTML = '';
  }

  private click(sel: string, fn: () => void) {
    const el = this.root.querySelector(sel) as HTMLElement | null;
    if (el)
      el.onclick = () => {
        audio.init();
        audio.play('ui');
        fn();
      };
  }

  private menacing(n = 14): string {
    let s = '<div class="menacing-bg">';
    for (let i = 0; i < n; i++) {
      const x = (i * 73) % 100;
      const y = (i * 37 + 11) % 100;
      const sz = 30 + ((i * 17) % 40);
      s += `<i style="left:${x}%;top:${y}%;font-size:${sz}px;animation-delay:${(i * 0.17) % 2}s">${i % 5 === 4 ? 'ド' : 'ゴ'}</i>`;
    }
    return s + '</div>';
  }

  render() {
    const g = this.game;
    const r = this.root;
    switch (this.current) {
      case 'title':
        g.showcaseChar(this.char);
        r.innerHTML = `<section class="screen">${this.menacing()}
          <div class="title-logo">STAND<br>CLASH<span>スタンドクラッシュ</span></div>
          <div class="subtitle">A BIZARRE BLOCK BRAWLER · ORA ORA vs MUDA MUDA</div>
          <div class="btn-col">
            <button class="btn gold" id="b-play">PLAY</button>
            <button class="btn" id="b-mp">MULTIPLAYER</button>
            <button class="btn" id="b-ctrl">CONTROLS</button>
            <button class="btn" id="b-set">SETTINGS</button>
          </div>
          <div class="footer-note">Unofficial fan game inspired by JoJo's Bizarre Adventure. All models, sounds and music are generated in code.</div>
        </section>`;
        this.click('#b-play', () => this.show('char'));
        this.click('#b-mp', () => {
          this.mpIntent = true;
          this.show('char');
        });
        this.click('#b-ctrl', () => this.show('controls'));
        this.click('#b-set', () => this.show('settings'));
        break;
      case 'char': {
        g.showcaseChar(this.char);
        const cards = PLAYABLE.map((id) => {
          const c = CHARACTERS[id];
          const ab = c.abilities;
          const list = [
            ['LMB', '3-hit Stand combo'],
            ['Q', ab.barrage?.name ?? ''],
            ['R', c.heavyKey ? ab[c.heavyKey]!.name : ''],
            ['SHIFT', (c.specialMove ? ab[c.specialMove]!.name : 'Dash') + ' (Stand out)'],
            ['F', `${ab.timestop?.name} — ${c.timeStop}s`],
          ];
          return `<div class="card panel ${id === this.char ? 'sel' : ''}" data-c="${id}">
            <div class="cn">${c.name}</div><div class="sn">「${c.standName}」</div>
            ${STATS[id].map(([n, v]) => `<div class="stat-row"><span style="width:70px">${n}</span><div class="sb"><i style="width:${v * 100}%"></i></div></div>`).join('')}
            <p>${c.blurb}</p>
            <ul>${list.map(([k, v]) => `<li><b>${k}</b>${v}</li>`).join('')}</ul></div>`;
        }).join('');
        r.innerHTML = `<section class="screen" style="justify-content:flex-end;padding-bottom:40px">
          <h2 class="scr">CHOOSE YOUR STAND USER</h2>
          <div class="cards">${cards}</div>
          <div class="btn-row"><button class="btn small" id="b-back">BACK</button><button class="btn gold" id="b-ok">CONFIRM</button></div>
        </section>`;
        r.querySelectorAll('.card').forEach((el) => {
          (el as HTMLElement).onclick = () => {
            audio.init();
            audio.play('summon', 0.6);
            this.char = (el as HTMLElement).dataset.c as CharId;
            this.render();
          };
        });
        this.click('#b-back', () => {
          this.mpIntent = false;
          this.show('title');
        });
        this.click('#b-ok', () => this.show(this.mpIntent ? 'lobby' : 'mode'));
        break;
      }
      case 'mode': {
        const modes = [
          ['free', '🏙', 'FREE ROAM', 'Explore Morioh and fight respawning Stand users on streets and rooftops.'],
          ['training', '🎯', 'TRAINING', 'Practice against a configurable dummy with damage and combo feedback.'],
          ['missions', '📜', 'MISSIONS', 'Defeat a Stand user gang, survive vampire waves, then face DIO.'],
          ['mp', '⚔', 'MULTIPLAYER', 'Host or join a room with 2–4 players and optional bots.'],
        ];
        r.innerHTML = `<section class="screen">
          <h2 class="scr">SELECT MODE</h2>
          <div class="cards">${modes.map(([id, ic, n, d]) => `<div class="card panel mode-card" data-m="${id}"><div class="ic">${ic}</div><div class="cn">${n}</div><p>${d}</p></div>`).join('')}</div>
          <div class="btn-row"><button class="btn small" id="b-back">BACK</button></div></section>`;
        r.querySelectorAll('.mode-card').forEach((el) => {
          (el as HTMLElement).onclick = () => {
            audio.init();
            audio.play('ui');
            const m = (el as HTMLElement).dataset.m!;
            if (m === 'free') this.startLocal({ kind: 'free' });
            else if (m === 'training') this.startLocal({ kind: 'training' });
            else if (m === 'missions') this.show('missions');
            else this.show('lobby');
          };
        });
        this.click('#b-back', () => this.show('char'));
        break;
      }
      case 'missions':
        r.innerHTML = `<section class="screen">
          <h2 class="scr">MISSIONS</h2>
          <div class="cards">${MISSIONS.map((m) => `<div class="card panel mode-card" data-s="${m.id}"><div class="ic" style="font-family:var(--jp);font-size:26px;font-weight:900;color:#b14dff">${m.jp}</div><div class="cn">${m.id}. ${m.name}</div><p>${m.desc}</p></div>`).join('')}</div>
          <div class="btn-row"><button class="btn small" id="b-back">BACK</button></div></section>`;
        r.querySelectorAll('.mode-card').forEach((el) => {
          (el as HTMLElement).onclick = () => {
            audio.init();
            audio.play('ui');
            this.startLocal({ kind: 'mission', stage: Number((el as HTMLElement).dataset.s) });
          };
        });
        this.click('#b-back', () => this.show('mode'));
        break;
      case 'lobby':
        this.renderLobby();
        break;
      case 'pause': {
        const mp = g.mode?.kind === 'mp';
        r.innerHTML = `<section class="screen dim">
          <h2 class="scr">PAUSED</h2>
          ${mp ? '<div class="subtitle">The match keeps running while you are paused!</div>' : ''}
          <div class="btn-col">
            <button class="btn gold" id="b-res">RESUME</button>
            <button class="btn" id="b-ctrl">CONTROLS</button>
            <button class="btn" id="b-set">SETTINGS</button>
            ${mp ? '' : '<button class="btn" id="b-restart">RESTART</button>'}
            <button class="btn" id="b-quit">${mp ? 'LEAVE MATCH' : 'QUIT TO MENU'}</button>
          </div></section>`;
        this.click('#b-res', () => this.resume());
        this.click('#b-ctrl', () => this.show('controls'));
        this.click('#b-set', () => this.show('settings'));
        this.click('#b-restart', () => this.last && this.startLocal(this.last));
        this.click('#b-quit', () => {
          if (mp) {
            this.net.send({ t: 'leave' });
            this.room = null;
            this.inMatch = false;
          }
          g.toMenu();
          this.show('title');
        });
        break;
      }
      case 'results': {
        const res = this.lastResults!;
        const mp = this.inMatch;
        r.innerHTML = `<section class="screen dim">${this.menacing(8)}
          <div class="results panel">
            <h2 class="scr" style="font-size:54px">${res.title}</h2>
            <div class="subtitle" style="margin:4px 0 10px">${res.sub}</div>
            ${res.rank ? `<div class="rank">${res.rank}</div>` : ''}
            ${res.rows.length ? `<table>${res.rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>` : ''}
            ${res.tableHtml ?? ''}
            <div class="btn-row">
              ${res.canRetry ? '<button class="btn small gold" id="b-retry">RETRY</button>' : ''}
              ${res.canNext ? '<button class="btn small gold" id="b-next">NEXT MISSION</button>' : ''}
              ${mp && this.room ? '<button class="btn small gold" id="b-lobby">BACK TO LOBBY</button>' : ''}
              <button class="btn small" id="b-menu">MAIN MENU</button>
            </div>
          </div></section>`;
        this.click('#b-retry', () => this.last && this.startLocal(this.last));
        this.click('#b-next', () => this.last && this.startLocal({ kind: 'mission', stage: (this.last.stage ?? 1) + 1 }));
        this.click('#b-lobby', () => {
          this.inMatch = false;
          g.toMenu();
          this.show('lobby');
        });
        this.click('#b-menu', () => {
          if (this.room) this.net.send({ t: 'leave' });
          this.room = null;
          this.inMatch = false;
          g.toMenu();
          this.show('title');
        });
        break;
      }
      case 'controls':
        r.innerHTML = `<section class="screen dim">
          <h2 class="scr">CONTROLS</h2>
          <div class="panel controls-grid">${CONTROLS.map(([k, v]) => `<div><kbd>${k}</kbd></div><div>${v}</div>`).join('')}</div>
          <div class="subtitle" style="font-size:16px;max-width:640px">Tips: barrages pull enemies in · uppercut breaks guard · hits during stopped time are stored and land all at once when time resumes · with your Stand out, your double jump becomes a huge Stand-assisted leap onto rooftops.</div>
          <div class="btn-row"><button class="btn small" id="b-back">BACK</button></div></section>`;
        this.click('#b-back', () => this.show(this.prev));
        break;
      case 'settings': {
        const rows: [string, string, string][] = [
          ['Mouse sensitivity', `<input type="range" id="s-sens" min="0.2" max="3" step="0.05" value="${settings.sens}">`, settings.sens.toFixed(2)],
          ['Invert Y', `<input type="checkbox" id="s-inv" ${settings.invertY ? 'checked' : ''}>`, ''],
          ['Field of view', `<input type="range" id="s-fov" min="55" max="100" step="1" value="${settings.fov}">`, String(settings.fov)],
          ['Screen shake', `<input type="range" id="s-shake" min="0" max="1.5" step="0.05" value="${settings.shake}">`, settings.shake.toFixed(2)],
          ['Master volume', `<input type="range" id="s-master" min="0" max="1" step="0.01" value="${settings.master}">`, String(Math.round(settings.master * 100))],
          ['Effects volume', `<input type="range" id="s-sfx" min="0" max="1" step="0.01" value="${settings.sfx}">`, String(Math.round(settings.sfx * 100))],
          ['Music volume', `<input type="range" id="s-music" min="0" max="1" step="0.01" value="${settings.music}">`, String(Math.round(settings.music * 100))],
          ['Shadows', `<input type="checkbox" id="s-shadow" ${settings.shadows ? 'checked' : ''}>`, ''],
        ];
        r.innerHTML = `<section class="screen dim">
          <h2 class="scr">SETTINGS</h2>
          <div class="panel settings-grid">${rows.map(([a, b, c], i) => `<label>${a}</label><div>${b}</div><span id="sv-${i}">${c}</span>`).join('')}</div>
          <div class="btn-row"><button class="btn small" id="b-test">TEST SOUND</button><button class="btn small gold" id="b-back">BACK</button></div></section>`;
        const bind = (id: string, idx: number, fn: (v: string, el: HTMLInputElement) => string) => {
          const el = r.querySelector('#' + id) as HTMLInputElement;
          el.oninput = () => {
            const shown = fn(el.value, el);
            const sv = r.querySelector('#sv-' + idx);
            if (sv) sv.textContent = shown;
            audio.applyVolumes();
            saveSettings();
          };
        };
        bind('s-sens', 0, (v) => ((settings.sens = Number(v)), Number(v).toFixed(2)));
        bind('s-inv', 1, (_, el) => ((settings.invertY = el.checked), ''));
        bind('s-fov', 2, (v) => ((settings.fov = Number(v)), v));
        bind('s-shake', 3, (v) => ((settings.shake = Number(v)), Number(v).toFixed(2)));
        bind('s-master', 4, (v) => ((settings.master = Number(v)), String(Math.round(Number(v) * 100))));
        bind('s-sfx', 5, (v) => ((settings.sfx = Number(v)), String(Math.round(Number(v) * 100))));
        bind('s-music', 6, (v) => ((settings.music = Number(v)), String(Math.round(Number(v) * 100))));
        bind('s-shadow', 7, (_, el) => ((settings.shadows = el.checked), ''));
        this.click('#b-test', () => {
          audio.play('punch');
          setTimeout(() => audio.play('heavy'), 180);
          setTimeout(() => audio.play('summon'), 420);
        });
        this.click('#b-back', () => this.show(this.prev));
        break;
      }
      default:
        r.innerHTML = '';
    }
  }

  private mpIntent = false;

  private resume() {
    this.hide();
    this.game.resume();
  }

  startLocal(opts: { kind: 'free' | 'training' | 'mission'; stage?: number }) {
    this.last = opts;
    this.inMatch = false;
    const g = this.game;
    g.state = 'menu';
    this.hide();
    const mode = opts.kind === 'free' ? new FreeRoamMode(g, this.char) : opts.kind === 'training' ? new TrainingMode(g, this.char) : new MissionMode(g, this.char, opts.stage ?? 1);
    g.begin(mode);
  }

  // ---------------------------------------------------------------- multiplayer lobby
  private renderLobby() {
    const r = this.root;
    const connected = this.net.status === 'open';
    const room = this.room;
    if (!room) {
      r.innerHTML = `<section class="screen dim">
        <h2 class="scr">MULTIPLAYER</h2>
        <div class="panel lobby">
          <div class="row"><span>Name</span><input class="text name" id="l-name" maxlength="14" value="${esc(settings.name)}"></div>
          <div class="row"><span>Server</span><input class="text name" id="l-url" style="width:330px;font-size:16px" value="${esc(settings.server || NetClient.defaultUrl())}"></div>
          <div class="row"><span>Fighter: <b style="color:var(--gold)">${CHARACTERS[this.char].name}</b></span></div>
          <div class="row"><button class="btn small gold" id="l-host">HOST ROOM</button></div>
          <div class="row"><input class="text" id="l-code" maxlength="4" placeholder="CODE" style="width:130px;text-align:center"><button class="btn small" id="l-join">JOIN</button></div>
          <div class="msg">${esc(this.lobbyMsg)}</div>
          <div class="help">Host a room, share the 4-letter code, and your friends join with it.<br>Everyone must point at the same server address (see README for hosting over the internet).</div>
        </div>
        <div class="btn-row" style="margin-top:14px"><button class="btn small" id="b-back">BACK</button></div></section>`;
      const doConnect = async (after: () => void) => {
        settings.name = ((r.querySelector('#l-name') as HTMLInputElement).value.trim() || 'Player').slice(0, 14);
        const url = (r.querySelector('#l-url') as HTMLInputElement).value.trim();
        settings.server = url === NetClient.defaultUrl() ? '' : url;
        saveSettings();
        try {
          if (this.net.status !== 'open' || this.net.url !== url) {
            this.lobbyMsg = 'Connecting…';
            this.render();
            await this.net.connect(url);
          }
          this.net.send({ t: 'hello', name: settings.name, char: this.char });
          after();
        } catch (e) {
          this.lobbyMsg = (e as Error).message + ' — is the server running?';
          this.render();
        }
      };
      this.click('#l-host', () => doConnect(() => this.net.send({ t: 'host' })));
      this.click('#l-join', () => {
        const code = (r.querySelector('#l-code') as HTMLInputElement).value.trim().toUpperCase();
        if (code.length !== 4) {
          this.lobbyMsg = 'Enter the 4-letter room code';
          this.render();
          return;
        }
        doConnect(() => this.net.send({ t: 'join', code }));
      });
      this.click('#b-back', () => this.show(this.mpIntent ? 'char' : 'mode'));
      return;
    }
    const isHost = room.host === room.you;
    const humans = room.players.filter((p) => !p.bot).length;
    r.innerHTML = `<section class="screen dim">
      <h2 class="scr">ROOM</h2>
      <div class="panel lobby">
        <div class="code">${room.code}</div>
        <div class="help">Share this code · ${connected ? '<span style="color:#5cff8a">● connected</span>' : '<span style="color:#ff4d6d">● disconnected</span>'} · ping ${Math.round(this.net.ping)} ms</div>
        <div class="players">${room.players
          .map((p) => `<div class="pl"><span>${p.bot ? '🤖 ' : ''}${esc(p.name)}${p.id === room.you ? ' (you)' : ''}${p.id === room.host ? ' ★' : ''}</span><span>${CHARACTERS[p.char].name}</span></div>`)
          .join('')}</div>
        <div class="row">
          <button class="btn small" id="r-char">SWITCH TO ${this.char === 'jotaro' ? 'DIO' : 'JOTARO'}</button>
          ${isHost ? '<button class="btn small" id="r-bot">+ BOT</button><button class="btn small" id="r-unbot">− BOT</button>' : ''}
        </div>
        ${
          isHost
            ? `<div class="row"><span>K.O.s to win</span><select id="r-target" class="text" style="font-size:18px">${[3, 5, 10]
                .map((n) => `<option ${room.target === n ? 'selected' : ''}>${n}</option>`)
                .join('')}</select>
               <button class="btn small gold" id="r-start" ${room.players.length < 2 ? 'disabled' : ''}>START MATCH</button></div>`
            : '<div class="help">Waiting for the host to start…</div>'
        }
        <div class="msg">${esc(this.lobbyMsg)}</div>
        <div class="help">${humans} player${humans === 1 ? '' : 's'} · 2–4 fighters per room (bots fill empty slots for practice)</div>
      </div>
      <div class="btn-row" style="margin-top:14px"><button class="btn small" id="r-leave">LEAVE ROOM</button></div></section>`;
    this.click('#r-char', () => {
      this.char = this.char === 'jotaro' ? 'dio' : 'jotaro';
      this.net.send({ t: 'char', char: this.char });
    });
    this.click('#r-bot', () => this.net.send({ t: 'bot', op: 'add', char: Math.random() < 0.5 ? 'jotaro' : 'dio' }));
    this.click('#r-unbot', () => this.net.send({ t: 'bot', op: 'remove' }));
    this.click('#r-start', () => {
      const target = Number((r.querySelector('#r-target') as HTMLSelectElement).value);
      this.net.send({ t: 'start', target });
    });
    this.click('#r-leave', () => {
      this.net.send({ t: 'leave' });
      this.room = null;
      this.lobbyMsg = '';
      this.render();
    });
  }

  private onNet(m: ServerMsg) {
    switch (m.t) {
      case 'room': {
        this.room = { code: m.code, host: m.host, you: m.you, phase: m.phase, players: m.players, target: m.target };
        const me = m.players.find((p) => p.id === m.you);
        if (me) this.char = me.char;
        this.lobbyMsg = '';
        if (this.current === 'lobby') this.render();
        break;
      }
      case 'start': {
        const room = this.room;
        if (!room) break;
        this.inMatch = true;
        this.hide();
        const me = room.players.find((p) => p.id === m.you);
        const g = this.game;
        g.state = 'menu';
        g.begin(new MPMode(g, this.net, m.you, me?.char ?? this.char, m.target, room.code, room.players, m.duration));
        break;
      }
      case 'err':
        this.lobbyMsg = m.msg;
        if (this.current === 'lobby') this.render();
        break;
      default:
        break;
    }
  }
}
