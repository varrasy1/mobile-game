import type { ThemeName } from './theme';

const KEY_BEST = 'flowline.best.v1';
const KEY_GHOST = 'flowline.ghost.v1';
const KEY_PREFS = 'flowline.prefs.v1';

export const GHOST_INTERVAL = 0.1;
/** 20 minutes of samples keeps the payload well under localStorage limits. */
export const GHOST_MAX_SAMPLES = 12000;

/**
 * Ghost samples are stored track-relative as flat triplets:
 *   [Δs (px along track since run start), lateral offset (px), heading offset (mrad)]
 * Each session generates a fresh road, so raw world (x, y, angle) would place
 * the ghost off-road; this frame replays the run's line on whatever road is
 * ahead, and is converted back to world (x, y, angle) at render time.
 */
export interface GhostRun {
  score: number;
  samples: number[];
}

export interface Prefs {
  theme: ThemeName;
  muted: boolean;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage full or blocked — the game still runs */
  }
}

export function loadBest(): number {
  const v = Number(read(KEY_BEST));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function loadGhost(): GhostRun | null {
  const raw = read(KEY_GHOST);
  if (!raw) return null;
  try {
    const g = JSON.parse(raw) as Partial<GhostRun>;
    if (typeof g.score !== 'number' || !Array.isArray(g.samples) || g.samples.length < 6) return null;
    return { score: g.score, samples: g.samples.filter((n): n is number => typeof n === 'number') };
  } catch {
    return null;
  }
}

export function saveBestRun(score: number, samples: readonly number[]): void {
  write(KEY_BEST, String(Math.floor(score)));
  write(KEY_GHOST, JSON.stringify({ score: Math.floor(score), samples }));
}

export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(read(KEY_PREFS) ?? '{}') as Partial<Prefs>;
    return { theme: p.theme === 'light' ? 'light' : 'dark', muted: p.muted === true };
  } catch {
    return { theme: 'dark', muted: false };
  }
}

export function savePrefs(p: Prefs): void {
  write(KEY_PREFS, JSON.stringify(p));
}
