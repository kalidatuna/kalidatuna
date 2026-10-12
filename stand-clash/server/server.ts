// STAND CLASH game server: serves the built client and runs authoritative multiplayer rooms.
//   npm run build && npm start        → http://localhost:8080 (WebSocket on /ws)
// Environment: PORT (default 8080), HOST (default 0.0.0.0)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { World } from '../src/shared/world';
import { Sim, Fighter, EDGE_KEYS, EdgeKey } from '../src/shared/sim';
import { BotBrain } from '../src/shared/ai';
import { CHARACTERS, CharId, PLAYABLE } from '../src/shared/characters';
import { v3, vdist, clamp } from '../src/shared/math';
import type { ClientMsg, ServerMsg, NetPlayer, NetFighter, NetProj, Phase, ResultRow } from '../src/shared/protocol';
import { MAX_PLAYERS, MATCH_SECONDS } from '../src/shared/protocol';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
const TICK = 1 / 60;
const SNAP_EVERY = 3; // 20 Hz snapshots
const BOT_NAMES = ['Bot Kakyoin', 'Bot Polnareff', 'Bot Avdol', 'Bot Joseph', 'Bot Vanilla', 'Bot Hol Horse'];

const world = new World();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ------------------------------------------------------------------ static file server
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
    return;
  }
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('STAND CLASH server is running.\nThe client is not built yet: run "npm run build" (or use "npm run dev" and open http://localhost:5173).');
    return;
  }
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
});

// ------------------------------------------------------------------ clients & rooms
interface Client {
  cid: number;
  ws: WebSocket;
  name: string;
  char: CharId;
  room: Room | null;
  fid: number;
  lastInAt: number;
  msgCount: number;
  alive: boolean;
}

const clients = new Set<Client>();
const rooms = new Map<string, Room>();
let nextCid = 1;

function send(c: Client, m: ServerMsg) {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m));
}

function makeCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let s = '';
    for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(s)) return s;
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

class Room {
  clients = new Set<Client>();
  bots: { fid: number; name: string; char: CharId }[] = [];
  host: Client;
  phase: Phase = 'lobby';
  target = 5;
  sim: Sim | null = null;
  private timer: NodeJS.Timeout | null = null;
  private tickN = 0;
  private left = MATCH_SECONDS;
  private nextFid = 1;
  private lastTime = 0;
  private acc = 0;

  constructor(public code: string, host: Client) {
    this.host = host;
  }

  size() {
    return this.clients.size + this.bots.length;
  }

  players(): NetPlayer[] {
    return [...[...this.clients].map((c) => ({ id: c.fid, name: c.name, char: c.char, bot: false })), ...this.bots.map((b) => ({ id: b.fid, name: b.name, char: b.char, bot: true }))];
  }

  broadcast(m: ServerMsg) {
    const s = JSON.stringify(m);
    for (const c of this.clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(s);
  }

  sendRoom() {
    const players = this.players();
    for (const c of this.clients) send(c, { t: 'room', code: this.code, host: this.host.fid, you: c.fid, phase: this.phase, players, target: this.target });
  }

  add(c: Client) {
    c.room = this;
    c.fid = this.nextFid++;
    this.clients.add(c);
    if (this.sim && this.phase === 'match') this.spawnHuman(c);
    this.sendRoom();
  }

  remove(c: Client) {
    this.clients.delete(c);
    c.room = null;
    if (this.sim) this.sim.removeFighter(c.fid);
    if (this.clients.size === 0) {
      this.destroy();
      return;
    }
    if (this.host === c) this.host = [...this.clients][0];
    this.sendRoom();
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    rooms.delete(this.code);
    log(`room ${this.code} closed`);
  }

  addBot(char: CharId) {
    if (this.size() >= MAX_PLAYERS) return;
    const name = BOT_NAMES.find((n) => !this.bots.some((b) => b.name === n)) ?? 'Bot';
    this.bots.push({ fid: this.nextFid++, name, char });
    this.sendRoom();
  }

  removeBot() {
    this.bots.pop();
    this.sendRoom();
  }

  private spawnPos(i: number) {
    const s = world.plazaSpawns[i % world.plazaSpawns.length];
    return v3(s.x, 0, s.z);
  }

  private spawnHuman(c: Client) {
    const sim = this.sim!;
    const f = sim.addFighter(c.char, { id: c.fid, remote: true, name: c.name, pos: this.spawnPos(c.fid) });
    f.respawnDelay = 3;
    f.yaw = f.aimYaw = Math.atan2(-f.pos.x, -f.pos.z);
    c.lastInAt = 0;
  }

  start(target: number) {
    this.target = [3, 5, 10].includes(target) ? target : 5;
    this.phase = 'match';
    this.left = MATCH_SECONDS;
    const sim = (this.sim = new Sim(world));
    sim.ffa = true;
    sim.spawnFn = (f) => {
      // respawn at the plaza spot farthest from other fighters
      let best = this.spawnPos(0);
      let bestD = -1;
      for (const s of world.plazaSpawns) {
        let d = 1e9;
        for (const o of sim.fighters) if (o !== f && !o.dead) d = Math.min(d, vdist(o.pos, s));
        if (d > bestD) {
          bestD = d;
          best = v3(s.x, 0, s.z);
        }
      }
      return best;
    };
    for (const c of this.clients) this.spawnHuman(c);
    for (const b of this.bots) {
      const f = sim.addFighter(b.char, { id: b.fid, isBot: true, name: b.name, pos: this.spawnPos(b.fid) });
      f.brain = new BotBrain({ level: 0.55 });
      f.respawnDelay = 3;
    }
    for (const c of this.clients) send(c, { t: 'start', you: c.fid, target: this.target, duration: MATCH_SECONDS });
    this.sendRoom();
    this.lastTime = performance.now();
    this.acc = 0;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.loop(), 1000 / 60);
    log(`room ${this.code} match started: ${this.players().map((p) => p.name).join(', ')}`);
  }

  private loop() {
    const now = performance.now();
    this.acc += Math.min(0.25, (now - this.lastTime) / 1000);
    this.lastTime = now;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick();
      if (this.phase !== 'match') return;
    }
  }

  private tick() {
    const sim = this.sim!;
    sim.step(TICK);
    this.left -= TICK;
    const events = sim.drainEvents();
    if (events.length) this.broadcast({ t: 'ev', e: events });
    this.tickN++;
    if (this.tickN % SNAP_EVERY === 0) this.broadcast(this.snapshot());
    let leader: Fighter | null = null;
    for (const f of sim.fighters) if (!leader || f.stats.kos > leader.stats.kos || (f.stats.kos === leader.stats.kos && f.stats.dmg > leader.stats.dmg)) leader = f;
    if (leader && (leader.stats.kos >= this.target || this.left <= 0)) this.end(leader.id, leader.stats.kos >= this.target ? 'ko' : 'time');
  }

  private snapshot(): ServerMsg {
    const sim = this.sim!;
    const f: NetFighter[] = sim.fighters.map((x) => ({
      id: x.id,
      p: [r2(x.pos.x), r2(x.pos.y), r2(x.pos.z)],
      v: [r2(x.vel.x), r2(x.vel.y), r2(x.vel.z)],
      y: r2(x.yaw),
      ay: r2(x.aimYaw),
      ap: r2(x.aimPitch),
      g: x.grounded ? 1 : 0,
      hp: r2(x.hp),
      mhp: x.maxHp,
      en: Math.round(x.energy),
      so: x.standOut ? 1 : 0,
      a: x.action ? [x.action.id, r2(x.action.t), x.action.step] : null,
      bl: x.blocking ? 1 : 0,
      st: r2(Math.max(0, x.stun)),
      la: x.launched ? 1 : 0,
      fr: x.frozen ? 1 : 0,
      d: x.dead ? 1 : 0,
      bt: x.boostT > 0 ? 1 : 0,
      hf: x.hitFlash > 0 ? 1 : 0,
      inv: x.invuln > 0 ? 1 : 0,
      k: x.stats.kos,
      de: x.stats.deaths,
      dmg: Math.round(x.stats.dmg),
      mc: x.stats.maxCombo,
    }));
    const pr: NetProj[] = sim.projectiles.map((q) => ({
      id: q.id,
      k: q.kind === 'bullet' ? 1 : 0,
      p: [r2(q.pos.x), r2(q.pos.y), r2(q.pos.z)],
      v: [r2(q.vel.x), r2(q.vel.y), r2(q.vel.z)],
      f: q.frozen ? 1 : 0,
      s: q.stuck ? 1 : 0,
      o: q.owner,
    }));
    const ts = sim.timeStop;
    return {
      t: 'snap',
      time: r2(sim.time),
      left: r2(this.left),
      f,
      pr,
      ts: ts ? { c: ts.caster, t: r2(ts.t), d: ts.dur, p: [r2(ts.center.x), r2(ts.center.y), r2(ts.center.z)], r: ts.radius } : null,
    };
  }

  private end(winner: number, reason: 'ko' | 'time') {
    const sim = this.sim!;
    const bots = new Set(this.bots.map((b) => b.fid));
    const rows: ResultRow[] = sim.fighters
      .map((f) => ({ id: f.id, name: f.name, char: f.char, kos: f.stats.kos, deaths: f.stats.deaths, dmg: Math.round(f.stats.dmg), maxCombo: f.stats.maxCombo, bot: bots.has(f.id) }))
      .sort((a, b) => b.kos - a.kos || b.dmg - a.dmg);
    this.broadcast(this.snapshot());
    this.broadcast({ t: 'results', rows, winner, reason });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.phase = 'results';
    log(`room ${this.code} match over (${reason}), winner ${rows[0]?.name}`);
    setTimeout(() => {
      if (!rooms.has(this.code)) return;
      this.phase = 'lobby';
      this.sim = null;
      this.sendRoom();
    }, 6000);
  }

  /** Client-authoritative movement with server sanity checks. */
  onInput(c: Client, m: Extract<ClientMsg, { t: 'in' }>) {
    const sim = this.sim;
    if (!sim || this.phase !== 'match') return;
    const f = sim.byId.get(c.fid);
    if (!f) return;
    const inp = sim.input(f.id);
    const finite = (a: number[]) => a.every((n) => Number.isFinite(n));
    if (!finite([...m.p, ...m.v, m.y, m.ay, m.ap, m.mx, m.mz])) return;
    inp.yaw = m.ay;
    inp.pitch = clamp(m.ap, -1.3, 1.3);
    inp.block = !!m.bl;
    inp.mx = clamp(m.mx, -1, 1);
    inp.mz = clamp(m.mz, -1, 1);
    if (f.dead || f.frozen) return; // frozen players cannot move in stopped time
    const now = performance.now();
    const dt = c.lastInAt ? (now - c.lastInAt) / 1000 : 1;
    c.lastInAt = now;
    const np = v3(clamp(m.p[0], -115, 115), clamp(m.p[1], 0, 60), clamp(m.p[2], -115, 115));
    const maxMove = 48 * Math.min(dt, 0.5) + 2.5;
    if (vdist(np, f.pos) > maxMove) {
      send(c, { t: 'corr', p: [f.pos.x, f.pos.y, f.pos.z] });
      return;
    }
    f.pos = np;
    f.vel = v3(clamp(m.v[0], -60, 60), clamp(m.v[1], -60, 60), clamp(m.v[2], -60, 60));
    f.yaw = m.y;
    f.grounded = !!m.g;
  }

  onAction(c: Client, k: EdgeKey) {
    const sim = this.sim;
    if (!sim || this.phase !== 'match') return;
    const f = sim.byId.get(c.fid);
    if (!f || f.dead) return;
    sim.input(f.id)[k] = true;
  }
}

// ------------------------------------------------------------------ websocket handling
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws, req) => {
  const c: Client = { cid: nextCid++, ws, name: 'Player', char: 'jotaro', room: null, fid: 0, lastInAt: 0, msgCount: 0, alive: true };
  clients.add(c);
  log(`client ${c.cid} connected from ${req.socket.remoteAddress}`);
  send(c, { t: 'welcome', cid: c.cid });
  ws.on('pong', () => (c.alive = true));
  ws.on('message', (data) => {
    c.msgCount++;
    if (c.msgCount > 240) return; // simple flood guard (per second)
    let m: ClientMsg;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    handle(c, m);
  });
  ws.on('close', () => {
    clients.delete(c);
    if (c.room) c.room.remove(c);
    log(`client ${c.cid} disconnected`);
  });
});

function handle(c: Client, m: ClientMsg) {
  switch (m.t) {
    case 'ping':
      send(c, { t: 'pong', ts: m.ts });
      break;
    case 'hello':
      c.name = String(m.name ?? 'Player').replace(/[<>&"']/g, '').trim().slice(0, 14) || 'Player';
      if (PLAYABLE.includes(m.char)) c.char = m.char;
      break;
    case 'host': {
      if (c.room) c.room.remove(c);
      const room = new Room(makeCode(), c);
      rooms.set(room.code, room);
      room.add(c);
      log(`room ${room.code} hosted by ${c.name}`);
      break;
    }
    case 'join': {
      const room = rooms.get(String(m.code ?? '').toUpperCase());
      if (!room) return send(c, { t: 'err', msg: 'Room not found' });
      if (room.phase !== 'lobby') return send(c, { t: 'err', msg: 'Match already in progress — try again in a moment' });
      if (room.size() >= MAX_PLAYERS) {
        if (room.bots.length) room.bots.pop();
        else return send(c, { t: 'err', msg: 'Room is full (4 fighters max)' });
      }
      if (c.room) c.room.remove(c);
      room.add(c);
      break;
    }
    case 'leave':
      if (c.room) c.room.remove(c);
      break;
    case 'char':
      if (c.room && c.room.phase === 'lobby' && PLAYABLE.includes(m.char)) {
        c.char = m.char;
        c.room.sendRoom();
      }
      break;
    case 'bot':
      if (c.room && c.room.host === c && c.room.phase === 'lobby') {
        if (m.op === 'add') c.room.addBot(m.char && CHARACTERS[m.char]?.playable ? m.char : 'jotaro');
        else c.room.removeBot();
      }
      break;
    case 'start':
      if (c.room && c.room.host === c && c.room.phase === 'lobby') {
        if (c.room.size() < 2) return send(c, { t: 'err', msg: 'Need at least 2 fighters (add a bot for practice)' });
        c.room.start(Number(m.target));
      }
      break;
    case 'in':
      c.room?.onInput(c, m);
      break;
    case 'act':
      if (EDGE_KEYS.includes(m.k)) c.room?.onAction(c, m.k);
      break;
  }
}

// reset flood counters and reap dead connections
setInterval(() => {
  for (const c of clients) c.msgCount = 0;
}, 1000);
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 10000);

server.listen(PORT, HOST, () => {
  log(`STAND CLASH server listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (WebSocket: /ws)`);
  if (!fs.existsSync(DIST)) log('Client not built yet — run "npm run build" to serve it from this server.');
});
