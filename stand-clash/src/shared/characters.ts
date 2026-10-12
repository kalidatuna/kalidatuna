// Character and ability data. All combat numbers live here so the server validates with the same values.

export type CharId = 'jotaro' | 'dio' | 'zombie' | 'gunner' | 'rogue' | 'dummy';
export type AbilityId =
  | 'combo'
  | 'barrage'
  | 'uppercut'
  | 'knives'
  | 'leap'
  | 'evade'
  | 'timestop'
  | 'shoot'
  | 'pose';

/** A single damaging moment inside an ability's timeline. */
export interface HitDef {
  t: number; // seconds after the ability starts
  reach: number; // forward distance of hit sphere centre
  radius: number;
  dmg: number;
  stun: number;
  kbH: number; // horizontal knockback speed
  kbV: number; // vertical knockback speed
  heavy?: boolean; // breaks guard unless perfect blocked
  pull?: number; // drags the target toward the attacker (barrages)
}

export interface AbilityDef {
  id: AbilityId;
  name: string;
  cooldown: number;
  energy: number;
  duration: number;
  needsStand: boolean;
  moveMul: number; // movement multiplier while active
  hits?: HitDef[];
  announce?: string;
  shout?: string;
}

export interface CharDef {
  id: CharId;
  name: string;
  standName: string | null;
  color: string; // aura/UI colour
  maxHp: number;
  maxEnergy: number;
  speed: number;
  abilities: Partial<Record<AbilityId, AbilityDef>>;
  shout: string; // barrage shout, e.g. ORA
  timeStop?: number; // seconds of stopped time
  heavyKey: AbilityId | null; // R
  specialMove: AbilityId | null; // Shift while Stand is out
  playable: boolean;
  blurb: string;
}

const comboHits = (stand: boolean, scale = 1): HitDef[][] => {
  const r = stand ? 2.6 : 1.6;
  const m = (stand ? 1 : 0.65) * scale;
  return [
    [{ t: 0.09, reach: r, radius: 1.35, dmg: 6 * m, stun: 0.38, kbH: 2.5, kbV: 0 }],
    [{ t: 0.09, reach: r, radius: 1.35, dmg: 6 * m, stun: 0.38, kbH: 2.5, kbV: 0 }],
    [{ t: 0.16, reach: r + 0.3, radius: 1.5, dmg: 11 * m, stun: 0.6, kbH: 11, kbV: 5 }],
  ];
};

/** Step durations of the 3-hit basic combo. */
export const COMBO_STEP_TIME = [0.3, 0.3, 0.5];
export const COMBO_HITS_STAND = comboHits(true);
export const COMBO_HITS_BARE = comboHits(false);

function barrageHits(duration: number, every: number, dmg: number, finalDmg: number): HitDef[] {
  const hits: HitDef[] = [];
  for (let t = 0.15; t < duration - 0.2; t += every) {
    hits.push({ t, reach: 2.4, radius: 1.6, dmg, stun: 0.3, kbH: 0.6, kbV: 0.4, pull: 2.5 });
  }
  hits.push({ t: duration - 0.12, reach: 2.6, radius: 1.8, dmg: finalDmg, stun: 0.8, kbH: 14, kbV: 6, heavy: false });
  return hits;
}

const common = {
  combo: { id: 'combo', name: 'Stand Combo', cooldown: 0, energy: 0, duration: 0.3, needsStand: false, moveMul: 0.35 } as AbilityDef,
  pose: { id: 'pose', name: 'JoJo Pose', cooldown: 1, energy: 0, duration: 2.2, needsStand: false, moveMul: 0 } as AbilityDef,
};

export const CHARACTERS: Record<CharId, CharDef> = {
  jotaro: {
    id: 'jotaro',
    name: 'Jotaro Kujo',
    standName: 'Star Platinum',
    color: '#8e5cff',
    maxHp: 220,
    maxEnergy: 100,
    speed: 9.5,
    shout: 'ORA',
    timeStop: 2,
    heavyKey: 'uppercut',
    specialMove: 'leap',
    playable: true,
    blurb: 'Precise, overwhelming power. Close the gap with a Stand leap and finish with a launching uppercut.',
    abilities: {
      combo: common.combo,
      pose: common.pose,
      barrage: {
        id: 'barrage',
        name: 'ORA Rush',
        cooldown: 6,
        energy: 25,
        duration: 1.6,
        needsStand: true,
        moveMul: 0.3,
        hits: barrageHits(1.6, 0.085, 1.5, 7),
        announce: 'STAND RUSH',
        shout: 'ORA',
      },
      uppercut: {
        id: 'uppercut',
        name: 'Star Uppercut',
        cooldown: 4,
        energy: 15,
        duration: 0.75,
        needsStand: true,
        moveMul: 0.1,
        hits: [{ t: 0.32, reach: 2.4, radius: 1.6, dmg: 17, stun: 1.0, kbH: 6, kbV: 17, heavy: true }],
        shout: 'ORA!',
      },
      leap: {
        id: 'leap',
        name: 'Stand Leap',
        cooldown: 3,
        energy: 12,
        duration: 0.5,
        needsStand: true,
        moveMul: 1,
        hits: [{ t: 0.12, reach: 1.2, radius: 2.2, dmg: 5, stun: 0.4, kbH: 7, kbV: 4 }],
      },
      timestop: {
        id: 'timestop',
        name: 'Star Platinum: The World',
        cooldown: 25,
        energy: 50,
        duration: 0.7,
        needsStand: true,
        moveMul: 0,
        announce: 'STAR PLATINUM: THE WORLD!',
      },
    },
  },
  dio: {
    id: 'dio',
    name: 'DIO',
    standName: 'The World',
    color: '#ffd23f',
    maxHp: 210,
    maxEnergy: 110,
    speed: 9.8,
    shout: 'MUDA',
    timeStop: 3,
    heavyKey: 'knives',
    specialMove: 'evade',
    playable: true,
    blurb: 'Mocking speed and lethal reach. Pin foes with knives, slip away, and stop time for three full seconds.',
    abilities: {
      combo: common.combo,
      pose: common.pose,
      barrage: {
        id: 'barrage',
        name: 'MUDA Rush',
        cooldown: 6,
        energy: 25,
        duration: 1.4,
        needsStand: true,
        moveMul: 0.3,
        hits: barrageHits(1.4, 0.075, 1.5, 7),
        announce: 'STAND RUSH',
        shout: 'MUDA',
      },
      knives: {
        id: 'knives',
        name: 'Knife Throw',
        cooldown: 3.2,
        energy: 12,
        duration: 0.45,
        needsStand: false,
        moveMul: 0.5,
        shout: 'MUDA!',
      },
      evade: {
        id: 'evade',
        name: 'Evasive Dash',
        cooldown: 1.6,
        energy: 10,
        duration: 0.25,
        needsStand: true,
        moveMul: 1,
      },
      timestop: {
        id: 'timestop',
        name: 'ZA WARUDO',
        cooldown: 30,
        energy: 50,
        duration: 0.7,
        needsStand: true,
        moveMul: 0,
        announce: 'ZA WARUDO!',
      },
    },
  },
  zombie: {
    id: 'zombie',
    name: 'Vampire Zombie',
    standName: null,
    color: '#7bd389',
    maxHp: 55,
    maxEnergy: 0,
    speed: 7.2,
    shout: 'GRAAH',
    heavyKey: null,
    specialMove: null,
    playable: false,
    blurb: '',
    abilities: { combo: common.combo, pose: common.pose },
  },
  gunner: {
    id: 'gunner',
    name: 'Hol Horse',
    standName: 'Emperor',
    color: '#f5a623',
    maxHp: 75,
    maxEnergy: 100,
    speed: 8,
    shout: 'BANG',
    heavyKey: 'shoot',
    specialMove: null,
    playable: false,
    blurb: '',
    abilities: {
      combo: common.combo,
      pose: common.pose,
      shoot: { id: 'shoot', name: 'Emperor', cooldown: 1.4, energy: 8, duration: 0.4, needsStand: true, moveMul: 0.4 },
    },
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue Stand User',
    standName: 'Red Riot',
    color: '#ff4d6d',
    maxHp: 95,
    maxEnergy: 100,
    speed: 8.5,
    shout: 'DORA',
    heavyKey: null,
    specialMove: null,
    playable: false,
    blurb: '',
    abilities: {
      combo: common.combo,
      pose: common.pose,
      barrage: {
        id: 'barrage',
        name: 'DORA Rush',
        cooldown: 8,
        energy: 30,
        duration: 1.1,
        needsStand: true,
        moveMul: 0.3,
        hits: barrageHits(1.1, 0.11, 1.2, 5),
        announce: 'STAND RUSH',
        shout: 'DORA',
      },
    },
  },
  dummy: {
    id: 'dummy',
    name: 'Training Dummy',
    standName: null,
    color: '#c8a26b',
    maxHp: 300,
    maxEnergy: 100,
    speed: 7,
    shout: '',
    heavyKey: null,
    specialMove: null,
    playable: false,
    blurb: '',
    abilities: { combo: common.combo, pose: common.pose },
  },
};

export const PLAYABLE: CharId[] = ['jotaro', 'dio'];

// Movement tuning
export const MOVE = {
  accelGround: 70,
  accelAir: 28,
  friction: 14,
  gravity: 32,
  jumpVel: 11.5,
  airJumpVel: 11,
  standBoostVel: 18,
  dashSpeed: 24,
  dashTime: 0.16,
  dashCooldown: 0.45,
  maxFall: -45,
  coyote: 0.1,
};

export const BLOCK = {
  perfectWindow: 0.2,
  reduction: 0.85,
  arcCos: Math.cos((70 * Math.PI) / 180), // ±70° frontal arc
  staggerOnPerfect: 0.7,
};

export const TIMESTOP_RADIUS = 38;
export const KNIFE = { count: 5, spread: 0.07, speed: 46, dmg: 5, stun: 0.3, kbH: 2, kbV: 1 };
export const BULLET = { speed: 55, dmg: 7, stun: 0.25, kbH: 3, kbV: 0.5 };
