// Headless checks of the shared simulation: movement, collisions, every ability, time stop, AI, KO.
// Run with: npm run test:sim
import { World } from '../src/shared/world';
import { Sim } from '../src/shared/sim';
import { BotBrain } from '../src/shared/ai';
import { v3 } from '../src/shared/math';

let failures = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
}
const DT = 1 / 60;
const run = (sim: Sim, secs: number) => {
  for (let i = 0; i < Math.round(secs / DT); i++) sim.step(DT);
};

const t0 = Date.now();
const world = new World();
check('world generated', world.solids.length > 200, `${world.boxes.length} boxes, ${world.solids.length} solid, gen ${Date.now() - t0}ms`);

// ---- movement + gravity + grounded
{
  const sim = new Sim(world);
  const p = sim.addFighter('jotaro', { pos: v3(0, 0, 14) });
  run(sim, 0.2);
  check('spawn grounded', p.grounded && Math.abs(p.pos.y) < 0.01, `y=${p.pos.y.toFixed(2)}`);
  const inp = sim.input(p.id);
  inp.mz = 1;
  inp.yaw = 0;
  run(sim, 0.5);
  check('runs forward with acceleration', p.pos.z > 16.5 && p.vel.z > 8, `z=${p.pos.z.toFixed(2)} vz=${p.vel.z.toFixed(2)}`);
  inp.mz = 0;
  inp.jump = true;
  sim.step(DT);
  let maxY = 0;
  for (let i = 0; i < 20; i++) {
    sim.step(DT);
    maxY = Math.max(maxY, p.pos.y);
  }
  inp.jump = true; // double jump
  for (let i = 0; i < 60; i++) {
    sim.step(DT);
    maxY = Math.max(maxY, p.pos.y);
  }
  check('jump + double jump height', maxY > 3, `maxY=${maxY.toFixed(2)}`);
  run(sim, 1.5);
  check('lands again', p.grounded, `y=${p.pos.y.toFixed(2)}`);
}

// ---- collision against the fountain pillar & stepping onto low objects
{
  const sim = new Sim(world);
  const p = sim.addFighter('jotaro', { pos: v3(0, 0, -9) });
  const inp = sim.input(p.id);
  inp.mz = 1; // walk toward fountain at origin (basin ring radius 5)
  run(sim, 2);
  check('blocked by fountain basin', p.pos.z < -3.5 || p.pos.y > 0.5, `z=${p.pos.z.toFixed(2)} y=${p.pos.y.toFixed(2)}`);
}

// ---- stand boost reaches a shop roof style height
{
  const sim = new Sim(world);
  const p = sim.addFighter('jotaro', { pos: v3(0, 0, 14) });
  const inp = sim.input(p.id);
  inp.summon = true;
  sim.step(DT);
  check('stand summoned', p.standOut);
  inp.jump = true;
  sim.step(DT);
  let maxY = 0;
  for (let i = 0; i < 25; i++) {
    sim.step(DT);
    maxY = Math.max(maxY, p.pos.y);
  }
  inp.jump = true;
  for (let i = 0; i < 90; i++) {
    sim.step(DT);
    maxY = Math.max(maxY, p.pos.y);
  }
  check('stand-assisted leap height > 5.5m', maxY > 5.5, `maxY=${maxY.toFixed(2)}`);
}

// ---- rooftop traversal: Stand-assisted double jump onto a shop roof (parapet included)
{
  // find shop walls: 'wall' boxes 5–7 m tall that carry a parapet ('trim') on top
  const shops = world.solids.filter((b) => b.mat === 'wall' && b.max.y >= 5 && b.max.y <= 7.1 && world.solids.some((t) => t.mat === 'trim' && Math.abs(t.min.y - b.max.y) < 0.01 && t.min.x >= b.min.x - 0.01 && t.max.x <= b.max.x + 0.01 && t.min.z >= b.min.z - 0.01 && t.max.z <= b.max.z + 0.01));
  let reached = 0;
  let tried = 0;
  let awning = 0;
  for (const b of shops.slice(0, 8)) {
    tried++;
    const sim = new Sim(world);
    const cx = (b.min.x + b.max.x) / 2;
    // stand in the street in front of the shop (awnings face the street on +/- z)
    const front = b.max.z + 3.2;
    const back = b.min.z - 3.2;
    const startZ = world.query(cx - 0.4, 0.1, front - 0.4, cx + 0.4, 2, front + 0.4, []).length === 0 ? front : back;
    const dir = startZ === front ? -1 : 1;
    const p = sim.addFighter('jotaro', { pos: v3(cx, 0, startZ) });
    const inp = sim.input(p.id);
    inp.summon = true;
    sim.step(DT);
    inp.mz = dir;
    inp.yaw = dir > 0 ? 0 : Math.PI;
    // two hops: street → awning, awning → roof (each: jump, then Stand-assisted air jump near the apex)
    for (let hop = 0; hop < 2; hop++) {
      inp.jump = true;
      sim.step(DT);
      for (let i = 0; i < 24; i++) sim.step(DT);
      inp.jump = true;
      for (let i = 0; i < 90 && !(p.grounded && p.vel.y === 0 && i > 10); i++) sim.step(DT);
      if (hop === 0) awning += p.pos.y > 3 && p.pos.y < 3.5 ? 1 : 0;
      if (p.pos.y >= b.max.y - 0.01) break; // made it onto the roof
    }
    inp.mz = 0;
    for (let i = 0; i < 30; i++) sim.step(DT);
    if (p.pos.y >= b.max.y - 0.01) reached++;
  }
  check('Stand-assisted jumps (+ ledge mantle) reach shop rooftops from the street', reached >= Math.ceil(tried / 2), `${awning}/${tried} awnings, ${reached}/${tried} roofs reached`);
}

// ---- dash
{
  const sim = new Sim(world);
  const p = sim.addFighter('dio', { pos: v3(0, 0, 14) });
  const inp = sim.input(p.id);
  inp.dash = true;
  inp.yaw = Math.PI / 2;
  run(sim, 0.3);
  check('dash moves quickly', p.pos.x > 2.5, `x=${p.pos.x.toFixed(2)}`);
}

function duel(attacker: 'jotaro' | 'dio') {
  const sim = new Sim(world);
  const a = sim.addFighter(attacker, { pos: v3(0, 0, 12), team: 0 });
  const b = sim.addFighter('zombie', { pos: v3(0, 0, 14), team: 1 });
  b.maxHp = b.hp = 5000;
  return { sim, a, b, inp: sim.input(a.id) };
}

// ---- 3-hit combo
for (const c of ['jotaro', 'dio'] as const) {
  const { sim, a, b, inp } = duel(c);
  inp.summon = true;
  sim.step(DT);
  for (let i = 0; i < 3; i++) {
    inp.attack = true;
    run(sim, 0.28);
  }
  run(sim, 0.5);
  const hits = sim.drainEvents().filter((e) => e.k === 'hit').length;
  check(`${c}: 3-hit combo lands 3 hits`, hits === 3, `hits=${hits} hp=${b.hp.toFixed(0)} combo=${a.stats.maxCombo}`);
}

// ---- barrage
for (const c of ['jotaro', 'dio'] as const) {
  const { sim, a, b, inp } = duel(c);
  inp.barrage = true;
  run(sim, 2);
  const ev = sim.drainEvents();
  const hits = ev.filter((e) => e.k === 'hit').length;
  check(`${c}: barrage multi-hit`, hits > 12, `hits=${hits} dmg=${(5000 - b.hp).toFixed(0)} cd=${a.cds.barrage?.toFixed(1)}`);
  check(`${c}: barrage announced STAND RUSH`, ev.some((e) => e.k === 'announce' && e.text === 'STAND RUSH'));
  inp.barrage = true;
  sim.step(DT);
  check(`${c}: barrage on cooldown`, a.action?.id !== 'barrage');
}

// ---- uppercut launches
{
  const { sim, b, inp } = duel('jotaro');
  inp.heavy = true;
  let maxY = 0;
  for (let i = 0; i < 90; i++) {
    sim.step(DT);
    maxY = Math.max(maxY, b.pos.y);
  }
  check('jotaro: uppercut launches target', maxY > 2, `target maxY=${maxY.toFixed(2)}`);
}

// ---- stand leap
{
  const { sim, a, inp } = duel('jotaro');
  a.pos = v3(0, 0, 0);
  a.pos = v3(-20, 0, 14);
  inp.summon = true;
  sim.step(DT);
  inp.yaw = Math.PI / 2;
  run(sim, 0.4);
  inp.dash = true;
  let maxY = 0;
  const x0 = a.pos.x;
  for (let i = 0; i < 120; i++) {
    sim.step(DT);
    maxY = Math.max(maxY, a.pos.y);
  }
  check('jotaro: stand leap travels', a.pos.x - x0 > 8 && maxY > 2, `dx=${(a.pos.x - x0).toFixed(1)} maxY=${maxY.toFixed(1)}`);
}

// ---- knives
{
  const { sim, b, inp } = duel('dio');
  b.pos = v3(0, 0, 24);
  inp.heavy = true;
  sim.step(DT);
  run(sim, 0.2);
  const n = sim.projectiles.length;
  run(sim, 0.6);
  check('dio: knife throw spawns 5 projectiles', n === 5, `n=${n}`);
  check('dio: knives hit target at range', b.hp < 5000, `dmg=${(5000 - b.hp).toFixed(0)}`);
}

// ---- evasive dash
{
  const { sim, a, inp } = duel('dio');
  inp.summon = true;
  sim.step(DT);
  inp.yaw = -Math.PI / 2;
  run(sim, 0.4);
  inp.dash = true;
  const x0 = a.pos.x;
  sim.step(DT);
  const inv = a.invuln;
  run(sim, 0.35);
  check('dio: evasive dash moves fast with i-frames', x0 - a.pos.x > 5 && inv > 0.2, `dx=${(x0 - a.pos.x).toFixed(1)} inv=${inv.toFixed(2)}`);
}

// ---- time stop: freezing, queued damage, caster movement, duration
for (const c of ['jotaro', 'dio'] as const) {
  const { sim, a, b, inp } = duel(c);
  const bot = sim.input(b.id);
  b.vel = v3(0, 0, 0);
  inp.timestop = true;
  run(sim, 0.75);
  check(`${c}: time stop active`, !!sim.timeStop && b.frozen, `ts=${!!sim.timeStop}`);
  const bz = b.pos.z;
  bot.mz = 1;
  inp.attack = true;
  run(sim, 0.4);
  const hpDuring = b.hp;
  check(`${c}: frozen target does not move or take damage yet`, Math.abs(b.pos.z - bz) < 1e-6 && hpDuring === 5000, `dz=${(b.pos.z - bz).toFixed(3)} hp=${hpDuring}`);
  check(`${c}: hits queued during stop`, sim.tsQueue.length > 0, `queued=${sim.tsQueue.length}`);
  inp.mx = 1;
  const ax = a.pos.x;
  run(sim, 0.3);
  check(`${c}: caster moves in stopped time`, a.pos.x - ax > 1, `dx=${(a.pos.x - ax).toFixed(2)}`);
  inp.mx = 0;
  run(sim, (a.def.timeStop ?? 2) + 0.2);
  check(`${c}: time resumes and queued damage applies`, !sim.timeStop && !b.frozen && b.hp < 5000, `hp=${b.hp.toFixed(0)}`);
  inp.timestop = true;
  sim.step(DT);
  check(`${c}: time stop has long cooldown`, (a.cds.timestop ?? 0) > 20 && !sim.timeStop, `cd=${a.cds.timestop?.toFixed(1)}`);
}

// ---- blocking & perfect block
{
  const { sim, a, b, inp } = duel('jotaro');
  b.yaw = Math.PI; // face attacker
  const binp = sim.input(b.id);
  binp.yaw = Math.PI;
  binp.block = true;
  run(sim, 0.5); // well past perfect window
  inp.attack = true;
  run(sim, 0.3);
  const ev = sim.drainEvents().filter((e) => e.k === 'hit');
  check('block reduces damage', ev.length === 1 && (ev[0] as any).blocked && b.hp > 4998, `hp=${b.hp.toFixed(2)}`);
  binp.block = false;
  run(sim, 0.6);
  binp.block = true;
  sim.step(DT);
  inp.attack = true;
  run(sim, 0.2);
  const ev2 = sim.drainEvents();
  check('perfect block staggers attacker', ev2.some((e) => e.k === 'announce' && e.text === 'PERFECT BLOCK') && a.stun > 0, `stun=${a.stun.toFixed(2)}`);
}

// ---- KO + respawn + DOUBLE K.O.
{
  const sim = new Sim(world);
  const a = sim.addFighter('jotaro', { pos: v3(0, 0, 12) });
  const b = sim.addFighter('zombie', { pos: v3(0, 0, 14), team: 1 });
  const c = sim.addFighter('zombie', { pos: v3(0.6, 0, 14), team: 1 });
  b.hp = c.hp = 4;
  b.respawnDelay = 1;
  c.respawnDelay = -1;
  sim.input(a.id).summon = true;
  sim.step(DT);
  sim.input(a.id).attack = true;
  run(sim, 0.4);
  const ev = sim.drainEvents();
  check('KO both targets', b.dead && c.dead && ev.filter((e) => e.k === 'ko').length === 2);
  check('DOUBLE K.O. announced', ev.some((e) => e.k === 'announce' && e.text === 'DOUBLE K.O.'));
  run(sim, 1.2);
  check('respawn after delay', !b.dead && b.hp === b.maxHp && c.dead);
}

// ---- AI fights and kills the player-side dummy target
{
  const sim = new Sim(world);
  const p = sim.addFighter('jotaro', { pos: v3(0, 0, 18) });
  p.respawnDelay = -1;
  for (const [ch, x] of [['rogue', -6], ['zombie', 6], ['gunner', 0]] as const) {
    const e = sim.addFighter(ch, { pos: v3(x, 0, 30), team: 1, isBot: true });
    e.brain = new BotBrain({ level: 0.8 });
  }
  run(sim, 25);
  const st = sim.fighters.slice(1).map((f) => `${f.char}:dmg${f.stats.dmg.toFixed(0)}`).join(' ');
  check('AI bots attack the player', p.hp < p.maxHp, `player hp=${p.hp.toFixed(0)} ${st}`);
}

// ---- boss DIO uses time stop
{
  const sim = new Sim(world);
  const p = sim.addFighter('jotaro', { pos: v3(0, 0, 16) });
  p.maxHp = p.hp = 99999;
  const boss = sim.addFighter('dio', { pos: v3(0, 0, 22), team: 1, isBot: true, hpMul: 3 });
  boss.brain = new BotBrain({ level: 1, boss: true });
  boss.hp = boss.maxHp * 0.8;
  let usedTS = false;
  for (let i = 0; i < 60 * 30 && !usedTS; i++) {
    sim.step(DT);
    if (sim.timeStop) usedTS = true;
  }
  check('DIO boss AI uses time stop', usedTS);
}

const perf0 = performance.now();
{
  const sim = new Sim(world);
  for (let i = 0; i < 10; i++) {
    const e = sim.addFighter(i % 2 ? 'rogue' : 'zombie', { pos: v3(i * 3 - 15, 0, 30), team: i % 2, isBot: true });
    e.brain = new BotBrain({ level: 0.7 });
  }
  run(sim, 10);
}
check('sim performance (10 bots, 600 ticks)', true, `${(performance.now() - perf0).toFixed(0)}ms`);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
