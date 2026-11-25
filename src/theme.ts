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
  },
};

const KEYS = Object.keys(PALETTES.dark) as (keyof Palette)[];
const TRANSITION_S = 0.4;

/** CSS colour string for an RGBA tuple, optionally scaling its alpha. */
export function css(c: RGBA, alphaMul = 1): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${+(c[3] * alphaMul).toFixed(4)})`;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

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

  /** Advances the blend; returns true while a transition is running. */
  update(dt: number): boolean {
    const target = this.name === 'light' ? 1 : 0;
    if (this.progress === target) return false;
    const step = dt / TRANSITION_S;
    this.progress =
      target > this.progress
        ? Math.min(target, this.progress + step)
        : Math.max(target, this.progress - step);
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
    this.palette = out;
  }

  private applyDom(): void {
    document.documentElement.dataset.theme = this.name;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = this.name === 'dark' ? '#111317' : '#ECE8E0';
  }
}
