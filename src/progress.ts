/**
 * Meta progression: coins, XP / level, owned + selected car, and a rolling set
 * of three missions with escalating tiers. Persisted in localStorage.
 */

const KEY = 'flowline.progress.v1';

/** Stats gathered during a single run (missions read from these). */
export interface RunStats {
  score: number;
  perfects: number;
  sector: number; // 1-based sector reached
  insane: number; // INSANE drifts
  bestDrift: number; // best single drift points
  nitros: number;
  chains: number;
  topKmh: number;
  streak: number; // best apex streak
  coins: number; // coins collected during the run
}

export const emptyRun = (): RunStats => ({
  score: 0,
  perfects: 0,
  sector: 1,
  insane: 0,
  bestDrift: 0,
  nitros: 0,
  chains: 0,
  topKmh: 0,
  streak: 0,
  coins: 0,
});

interface Template {
  stat: keyof RunStats;
  goals: number[];
  text: (n: number) => string;
}

const TEMPLATES: Template[] = [
  { stat: 'perfects', goals: [2, 4, 7, 10, 15], text: (n) => `Hit ${n} PERFECT apexes` },
  { stat: 'sector', goals: [2, 3, 4, 5, 6, 8], text: (n) => `Reach sector ${n}` },
  { stat: 'bestDrift', goals: [800, 1600, 3000, 5000, 8000], text: (n) => `Bank a ${fmt(n)} drift` },
  { stat: 'score', goals: [5000, 12000, 25000, 45000, 80000], text: (n) => `Score ${fmt(n)} in one run` },
  { stat: 'nitros', goals: [1, 3, 5, 8], text: (n) => `Fire nitro ${n}×` },
  { stat: 'insane', goals: [1, 2, 4, 7], text: (n) => `Pull ${n} INSANE drift${n > 1 ? 's' : ''}` },
  { stat: 'chains', goals: [1, 3, 5, 8, 12], text: (n) => `Complete ${n} light chain${n > 1 ? 's' : ''}` },
  { stat: 'topKmh', goals: [220, 260, 300, 340], text: (n) => `Top ${n} km/h` },
  { stat: 'streak', goals: [4, 7, 10, 15, 20], text: (n) => `Reach ${n}x flow` },
  { stat: 'coins', goals: [40, 90, 160, 260], text: (n) => `Collect ${n} coins in a run` },
];

export interface Mission {
  /** Sequence number; determines template and tier. */
  seq: number;
  stat: keyof RunStats;
  goal: number;
  text: string;
  reward: number;
  done: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function makeMission(seq: number): Mission {
  const t = TEMPLATES[seq % TEMPLATES.length];
  const tier = Math.min(t.goals.length - 1, Math.floor(seq / TEMPLATES.length));
  const goal = t.goals[tier];
  return { seq, stat: t.stat, goal, text: t.text(goal), reward: 150 + tier * 125, done: false };
}

/** Cumulative XP required to reach `level` (level 1 = 0). */
export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : Math.round(900 * Math.pow(level - 1, 1.55));
}

interface Saved {
  coins: number;
  xp: number;
  owned: string[];
  selected: string;
  missions: Mission[];
  nextSeq: number;
}

export class Progress {
  coins = 0;
  xp = 0;
  owned: string[] = ['gt'];
  selected = 'gt';
  missions: Mission[] = [];
  private nextSeq = 0;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Saved>;
        this.coins = Math.max(0, Math.floor(s.coins ?? 0));
        this.xp = Math.max(0, Math.floor(s.xp ?? 0));
        if (Array.isArray(s.owned) && s.owned.length) this.owned = s.owned.filter((x) => typeof x === 'string');
        if (typeof s.selected === 'string' && this.owned.includes(s.selected)) this.selected = s.selected;
        if (Array.isArray(s.missions)) this.missions = s.missions.slice(0, 3);
        this.nextSeq = Math.max(0, Math.floor(s.nextSeq ?? 0));
      }
    } catch {
      /* fresh profile */
    }
    if (!this.owned.includes('gt')) this.owned.unshift('gt');
    while (this.missions.length < 3) this.missions.push(makeMission(this.nextSeq++));
  }

  get level(): number {
    let l = 1;
    while (this.xp >= xpForLevel(l + 1)) l++;
    return l;
  }

  /** 0…1 progress inside the current level. */
  get levelProgress(): number {
    const l = this.level;
    const a = xpForLevel(l);
    const b = xpForLevel(l + 1);
    return (this.xp - a) / (b - a);
  }

  save(): void {
    const s: Saved = {
      coins: this.coins,
      xp: this.xp,
      owned: this.owned,
      selected: this.selected,
      missions: this.missions,
      nextSeq: this.nextSeq,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }

  /** Marks newly completed missions for this run; returns them (rewards paid out). */
  checkMissions(run: RunStats): Mission[] {
    const out: Mission[] = [];
    for (const m of this.missions) {
      if (!m.done && run[m.stat] >= m.goal) {
        m.done = true;
        this.coins += m.reward;
        out.push(m);
      }
    }
    if (out.length) this.save();
    return out;
  }

  /** End of run: grant XP + coins, roll completed missions. Returns levels gained. */
  finishRun(run: RunStats): { xpGained: number; levelsGained: number; levelCoins: number } {
    const before = this.level;
    const xpGained = Math.floor(run.score / 10);
    this.xp += xpGained;
    this.coins += run.coins;
    const after = this.level;
    let levelCoins = 0;
    for (let l = before + 1; l <= after; l++) levelCoins += 150 * l;
    this.coins += levelCoins;
    this.missions = this.missions.map((m) => (m.done ? makeMission(this.nextSeq++) : m));
    this.save();
    return { xpGained, levelsGained: after - before, levelCoins };
  }

  buy(id: string, price: number): boolean {
    if (this.owned.includes(id) || this.coins < price) return false;
    this.coins -= price;
    this.owned.push(id);
    this.selected = id;
    this.save();
    return true;
  }

  select(id: string): void {
    if (!this.owned.includes(id)) return;
    this.selected = id;
    this.save();
  }
}
