export type ThemeName = 'dark' | 'light';

/** [r, g, b, a] with rgb 0–255 and alpha 0–1. */
export type RGBA = readonly [number, number, number, number];

export interface Palette {
  bg: RGBA;
  road: RGBA;
  roadShadow: RGBA;
  edge: RGBA;
  dash: RGBA;
  carBody: RGBA;
  canopy: RGBA;
  accent: RGBA;
  trail: RGBA;
  wheel: RGBA;
  dust: RGBA;
  carShadow: RGBA;
  prop: RGBA;
  propAlt: RGBA;
  propShade: RGBA;
  orb: RGBA;
}

const hex = (h: string, a = 1): RGBA => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  a,
];

export const PALETTES: Record<ThemeName, Palette> = {
  dark: {
    bg: hex('#111317'),
    road: hex('#1C2026'),
    roadShadow: [0, 0, 0, 0.45],
    edge: hex('#E6E2D8'),
    dash: [230, 226, 216, 0.08],
    carBody: hex('#F4F1EA'),
    canopy: hex('#111317'),
    accent: hex('#E86A4A'),
    trail: [244, 241, 234, 0.14],
    wheel: hex('#08090B'),
    dust: [230, 226, 216, 0.2],
    carShadow: [0, 0, 0, 0.42],
    prop: hex('#1A1E24'),
    propAlt: hex('#22262D'),
    propShade: [0, 0, 0, 0.38],
    orb: hex('#F4F1EA'),
  },
  light: {
    bg: hex('#ECE8E0'),
    road: hex('#FAF8F4'),
    roadShadow: [28, 30, 34, 0.12],
    edge: hex('#22252A'),
    dash: [34, 37, 42, 0.08],
    carBody: hex('#1C1F24'),
    canopy: hex('#FAF8F4'),
    accent: hex('#E05A3A'),
    trail: [28, 31, 36, 0.12],
    wheel: hex('#0B0C0E'),
    dust: [34, 37, 42, 0.16],
    carShadow: [28, 30, 34, 0.22],
    prop: hex('#DDD7CB'),
    propAlt: hex('#D2CBBE'),
    propShade: [28, 30, 34, 0.1],
    orb: hex('#1C1F24'),
  },
};

/** Sector moods: the accent colour shifts as you drive deeper. */
const MOODS: Record<ThemeName, RGBA[]> = {
  dark: [hex('#E86A4A'), hex('#E8A04A'), hex('#4FC49E'), hex('#5B9EEA'), hex('#A47DEB'), hex('#E8608F')],
  light: [hex('#E05A3A'), hex('#D0862A'), hex('#2A9F7A'), hex('#3D7FD0'), hex('#8659D4'), hex('#D04876')],
};
export const MOOD_COUNT = MOODS.dark.length;

const KEYS = Object.keys(PALETTES.dark) as (keyof Palette)[];
const TRANSITION_S = 0.4;

/** CSS colour string for an RGBA tuple, optionally scaling its alpha. */
export function css(c: RGBA, alphaMul = 1): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${+(c[3] * alphaMul).toFixed(4)})`;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

function mixRGBA(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/**
 * Holds the active theme and blends the canvas palette between dark and light
 * over 400ms. The DOM side (body background, HUD colour) uses a matching CSS
 * transition driven by the `data-theme` attribute.
 */
export class Theme {
  name: ThemeName;
  palette: Palette;
  /** 0 = dark, 1 = light (linear progress, eased when resolving). */
  private progress: number;
  private moodFrom = 0;
  private moodTo = 0;
  private moodT = 1;

  constructor(name: ThemeName) {
    this.name = name;
    this.progress = name === 'light' ? 1 : 0;
    this.palette = { ...PALETTES[name] };
    this.applyDom();
  }

  toggle(): ThemeName {
    this.name = this.name === 'dark' ? 'light' : 'dark';
    this.applyDom();
    return this.name;
  }

  /** Starts a smooth accent shift to the given sector mood. */
  setMood(index: number): void {
    const next = ((index % MOOD_COUNT) + MOOD_COUNT) % MOOD_COUNT;
    if (next === this.moodTo) return;
    this.moodFrom = this.moodTo;
    this.moodTo = next;
    this.moodT = 0;
  }

  /** Advances the blends; returns true while a transition is running. */
  update(dt: number): boolean {
    const target = this.name === 'light' ? 1 : 0;
    const themeMoving = this.progress !== target;
    const moodMoving = this.moodT < 1;
    if (!themeMoving && !moodMoving) return false;
    if (themeMoving) {
      const step = dt / TRANSITION_S;
      this.progress =
        target > this.progress ? Math.min(target, this.progress + step) : Math.max(target, this.progress - step);
    }
    if (moodMoving) this.moodT = Math.min(1, this.moodT + dt / 1.4);
    this.resolve(smooth(this.progress));
    return true;
  }

  private resolve(t: number): void {
    const a = PALETTES.dark;
    const b = PALETTES.light;
    const out = {} as Record<keyof Palette, RGBA>;
    for (const k of KEYS) {
      const ca = a[k];
      const cb = b[k];
      out[k] = [
        ca[0] + (cb[0] - ca[0]) * t,
        ca[1] + (cb[1] - ca[1]) * t,
        ca[2] + (cb[2] - ca[2]) * t,
        ca[3] + (cb[3] - ca[3]) * t,
      ];
    }
    const mt = smooth(this.moodT);
    const dark = mixRGBA(MOODS.dark[this.moodFrom], MOODS.dark[this.moodTo], mt);
    const light = mixRGBA(MOODS.light[this.moodFrom], MOODS.light[this.moodTo], mt);
    out.accent = mixRGBA(dark, light, t);
    this.palette = out;
    document.documentElement.style.setProperty('--accent', css(out.accent));
  }

  private applyDom(): void {
    document.documentElement.dataset.theme = this.name;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = this.name === 'dark' ? '#111317' : '#ECE8E0';
  }
}
