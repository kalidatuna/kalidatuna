// Persisted player settings.
export interface Settings {
  sens: number;
  invertY: boolean;
  fov: number;
  master: number;
  sfx: number;
  music: number;
  shadows: boolean;
  shake: number;
  name: string;
  server: string;
}

const DEFAULTS: Settings = {
  sens: 1,
  invertY: false,
  fov: 72,
  master: 0.8,
  sfx: 0.9,
  music: 0.45,
  shadows: true,
  shake: 1,
  name: 'Player' + Math.floor(Math.random() * 900 + 100),
  server: '',
};

const KEY = 'standclash.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
