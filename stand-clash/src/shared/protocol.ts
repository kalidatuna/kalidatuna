// Wire protocol between browser clients and the room server (JSON over WebSocket).
import type { CharId } from './characters';
import type { EdgeKey, SimEvent } from './sim';

export type Phase = 'lobby' | 'match' | 'results';

export interface NetPlayer {
  id: number; // fighter id inside the room
  name: string;
  char: CharId;
  bot: boolean;
}

/** Compact fighter snapshot. Arrays keep the payload small. */
export interface NetFighter {
  id: number;
  p: [number, number, number];
  v: [number, number, number];
  y: number; // body yaw
  ay: number; // aim yaw
  ap: number; // aim pitch
  g: 0 | 1; // grounded
  hp: number;
  mhp: number;
  en: number;
  so: 0 | 1; // stand out
  a: [string, number, number] | null; // action id, t, step
  bl: 0 | 1;
  st: number; // stun
  la: 0 | 1; // launched
  fr: 0 | 1; // frozen
  d: 0 | 1; // dead
  bt: 0 | 1; // stand boost visual
  hf: 0 | 1; // hit flash
  inv: 0 | 1;
  k: number; // kos
  de: number; // deaths
  dmg: number;
  mc: number; // max combo
}

export interface NetProj {
  id: number;
  k: 0 | 1; // 0 knife, 1 bullet
  p: [number, number, number];
  v: [number, number, number];
  f: 0 | 1;
  s: 0 | 1;
  o: number;
}

export interface NetTimeStop {
  c: number;
  t: number;
  d: number;
  p: [number, number, number];
  r: number;
}

export type ClientMsg =
  | { t: 'hello'; name: string; char: CharId }
  | { t: 'host' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'char'; char: CharId }
  | { t: 'bot'; op: 'add' | 'remove'; char?: CharId }
  | { t: 'start'; target: number }
  | {
      t: 'in';
      p: [number, number, number];
      v: [number, number, number];
      y: number;
      ay: number;
      ap: number;
      g: 0 | 1;
      bl: 0 | 1;
      mx: number;
      mz: number;
    }
  | { t: 'act'; k: EdgeKey }
  | { t: 'ping'; ts: number };

export interface ResultRow {
  id: number;
  name: string;
  char: CharId;
  kos: number;
  deaths: number;
  dmg: number;
  maxCombo: number;
  bot: boolean;
}

export type ServerMsg =
  | { t: 'welcome'; cid: number }
  | { t: 'room'; code: string; host: number; you: number; phase: Phase; players: NetPlayer[]; target: number }
  | { t: 'start'; you: number; target: number; duration: number }
  | { t: 'snap'; time: number; left: number; f: NetFighter[]; pr: NetProj[]; ts: NetTimeStop | null }
  | { t: 'ev'; e: SimEvent[] }
  | { t: 'results'; rows: ResultRow[]; winner: number; reason: 'ko' | 'time' }
  | { t: 'corr'; p: [number, number, number] }
  | { t: 'err'; msg: string }
  | { t: 'pong'; ts: number };

export const MAX_PLAYERS = 4;
export const MATCH_SECONDS = 240;
