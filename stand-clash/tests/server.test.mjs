// Protocol-level multiplayer test with two raw WebSocket clients (no browser):
// rooms, validation (teleport correction, cooldowns), server-side damage, K.O. target → results.
// Usage: node tests/server.test.mjs [ws://localhost:8080/ws]
import WebSocket from 'ws';

const url = process.argv[2] ?? 'ws://localhost:8080/ws';
let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, char) {
  const ws = new WebSocket(url);
  const c = { ws, msgs: [], room: null, start: null, snap: null, results: null, corr: 0, events: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'room') c.room = m;
    else if (m.t === 'start') c.start = m;
    else if (m.t === 'snap') c.snap = m;
    else if (m.t === 'results') c.results = m;
    else if (m.t === 'corr') c.corr++;
    else if (m.t === 'ev') c.events.push(...m.e);
  });
  c.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  c.ready = new Promise((r) => ws.on('open', () => (c.send({ t: 'hello', name, char }), r())));
  return c;
}
const waitFor = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(20);
  }
  return null;
};

const A = client('Attacker', 'jotaro');
const B = client('Target', 'dio');
await Promise.all([A.ready, B.ready]);
A.send({ t: 'host' });
await waitFor(() => A.room);
B.send({ t: 'join', code: A.room.code });
await waitFor(() => B.room && A.room.players.length === 2);
check('two clients in one room', A.room.players.length === 2, A.room.code);

// joining a non-existent room is rejected
const C = client('Nobody', 'jotaro');
await C.ready;
let err = null;
C.ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t === 'err') err = m.msg;
});
C.send({ t: 'join', code: 'ZZZZ' });
await waitFor(() => err);
check('unknown room code rejected', err === 'Room not found', err);
C.ws.close();

A.send({ t: 'start', target: 3 });
await waitFor(() => A.start && B.start);
check('match started for both', !!A.start && !!B.start, `target=${A.start?.target}`);
await waitFor(() => A.snap && B.snap);
const me = A.start.you;
const them = B.start.you;
const fOf = (snap, id) => snap.f.find((f) => f.id === id);

// validation: a teleport is corrected
let ap = fOf(A.snap, me).p;
A.send({ t: 'in', p: [ap[0] + 60, ap[1], ap[2]], v: [0, 0, 0], y: 0, ay: 0, ap: 0, g: 1, bl: 0, mx: 0, mz: 0 });
await waitFor(() => A.corr > 0, 2000);
check('server rejects teleporting (sends correction)', A.corr > 0);

// walk A next to B with speed-legal steps, then attack until 3 K.O.s
let pos = [...fOf(A.snap, me).p];
const walkTo = async (target) => {
  for (let i = 0; i < 300; i++) {
    const dx = target[0] - pos[0];
    const dz = target[2] - pos[2];
    const d = Math.hypot(dx, dz);
    if (d < 1.6) return Math.atan2(dx, dz);
    const step = Math.min(0.3, d - 1.5);
    pos = [pos[0] + (dx / d) * step, 0, pos[2] + (dz / d) * step];
    A.send({ t: 'in', p: pos, v: [0, 0, 0], y: Math.atan2(dx, dz), ay: Math.atan2(dx, dz), ap: 0, g: 1, bl: 0, mx: 0, mz: 0 });
    await sleep(33);
  }
  return 0;
};

// server-side cooldown: two barrages back-to-back → only one starts
let yaw = await walkTo(fOf(A.snap, them).p);
A.events = [];
A.send({ t: 'act', k: 'barrage' });
await sleep(150);
A.send({ t: 'act', k: 'barrage' });
await sleep(400);
const barrages = A.events.filter((e) => e.k === 'action' && e.id === me && e.ab === 'barrage').length;
check('server enforces cooldowns (second barrage ignored)', barrages === 1, `barrages=${barrages}`);
await sleep(1500);
const dmgHits = A.events.filter((e) => e.k === 'hit' && e.a === me && e.v === them && e.dmg > 0).length;
check('server resolves barrage hits on the remote target', dmgHits > 5, `hits=${dmgHits}`);

const t0 = Date.now();
while (!A.results && Date.now() - t0 < 120000) {
  const t = fOf(A.snap, them);
  if (!t || t.d) {
    await sleep(100);
    continue;
  }
  yaw = await walkTo(t.p);
  A.send({ t: 'in', p: pos, v: [0, 0, 0], y: yaw, ay: yaw, ap: 0, g: 1, bl: 0, mx: 0, mz: 0 });
  A.send({ t: 'act', k: 'barrage' });
  A.send({ t: 'act', k: 'heavy' });
  A.send({ t: 'act', k: 'attack' });
  await sleep(120);
}
await waitFor(() => B.results, 3000);
const kos = A.events.filter((e) => e.k === 'ko' && e.a === me).length;
const respawns = A.events.filter((e) => e.k === 'respawn' && e.id === them).length;
check('K.O.s and respawns happen server-side', kos >= 3 && respawns >= 2, `kos=${kos} respawns=${respawns}`);
check('match ends when the K.O. target is reached', A.results?.reason === 'ko' && A.results?.winner === me, JSON.stringify(A.results?.rows?.map((r) => `${r.name}:${r.kos}`)));
check('both clients get the results', !!B.results && B.results.winner === me);
await waitFor(() => A.room?.phase === 'lobby', 9000);
check('room returns to lobby phase', A.room?.phase === 'lobby');
A.ws.close();
B.ws.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
