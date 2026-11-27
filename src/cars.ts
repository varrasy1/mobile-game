import type { Palette } from './theme';
import { css } from './theme';

/**
 * The garage: eight original, procedurally drawn top-down car models.
 * Every car is drawn in its LOCAL frame (x right, y rearward, nose at −y),
 * centred on the origin. Geometry is cached as Path2D per model.
 */

export interface CarStats {
  speed: number;
  handling: number;
  nitro: number;
}

export interface CarModel {
  id: 'gt' | 'wedge' | 'formula' | 'muscle' | 'hyper' | 'rally' | 'phantom' | 'inferno';
  name: string;
  /** ≤ 32 chars. */
  tagline: string;
  /** Coins, 0 for the starter. */
  price: number;
  /** Required player level. */
  level: number;
  /** Each 1..5. */
  stats: CarStats;
  /** Local-frame positions (x right, y rearward; nose at −y). */
  rearWheels: [number, number][];
  exhausts: [number, number][];
  length: number;
  width: number;
}

export const CARS: CarModel[] = [
  {
    id: 'gt',
    name: 'Aero',
    tagline: 'Sculpted, balanced, pure.',
    price: 0,
    level: 1,
    stats: { speed: 2, handling: 2, nitro: 2 },
    rearWheels: [
      [-9.1, 11.5],
      [9.1, 11.5],
    ],
    exhausts: [
      [-3.5, 20.4],
      [3.5, 20.4],
    ],
    length: 40,
    width: 23.2,
  },
  {
    id: 'wedge',
    name: 'Vector',
    tagline: 'Straight lines, sharp exits.',
    price: 1500,
    level: 2,
    stats: { speed: 4, handling: 2, nitro: 3 },
    rearWheels: [
      [-9.2, 12.5],
      [9.2, 12.5],
    ],
    exhausts: [
      [-4.8, 21.2],
      [4.8, 21.2],
    ],
    length: 42,
    width: 23.6,
  },
  {
    id: 'formula',
    name: 'Apex',
    tagline: 'Born on the racing line.',
    price: 3500,
    level: 4,
    stats: { speed: 3, handling: 5, nitro: 2 },
    rearWheels: [
      [-8.6, 13.6],
      [8.6, 13.6],
    ],
    exhausts: [[0, 22.2]],
    length: 44,
    width: 22.6,
  },
  {
    id: 'muscle',
    name: 'Torque',
    tagline: 'All shove, no apology.',
    price: 6000,
    level: 6,
    stats: { speed: 4, handling: 2, nitro: 5 },
    rearWheels: [
      [-9.2, 13.4],
      [9.2, 13.4],
    ],
    exhausts: [
      [-6.2, 23.2],
      [6.2, 23.2],
    ],
    length: 46,
    width: 24.4,
  },
  {
    id: 'hyper',
    name: 'Zenith',
    tagline: 'The future, lit from within.',
    price: 10000,
    level: 8,
    stats: { speed: 5, handling: 4, nitro: 4 },
    rearWheels: [
      [-9.2, 12.6],
      [9.2, 12.6],
    ],
    exhausts: [
      [-2.2, 22.3],
      [2.2, 22.3],
    ],
    length: 44,
    width: 23.8,
  },
  {
    id: 'rally',
    name: 'Gravel',
    tagline: 'Sideways is the fast way.',
    price: 4500,
    level: 5,
    stats: { speed: 3, handling: 4, nitro: 3 },
    rearWheels: [
      [-9.4, 12],
      [9.4, 12],
    ],
    exhausts: [[4.6, 20.7]],
    length: 40,
    width: 24,
  },
  {
    id: 'phantom',
    name: 'Umbra',
    tagline: 'Gone before you see it.',
    price: 8000,
    level: 7,
    stats: { speed: 4, handling: 4, nitro: 4 },
    rearWheels: [
      [-9, 12.4],
      [9, 12.4],
    ],
    exhausts: [
      [-2.3, 22.2],
      [2.3, 22.2],
    ],
    length: 44,
    width: 23,
  },
  {
    id: 'inferno',
    name: 'Afterburn',
    tagline: 'Light the fuse. Hold on.',
    price: 15000,
    level: 10,
    stats: { speed: 5, handling: 3, nitro: 5 },
    rearWheels: [
      [-9.2, 12.8],
      [9.2, 12.8],
    ],
    exhausts: [[0, 24.2]],
    length: 48,
    width: 24,
  },
];

export function carById(id: string): CarModel {
  return CARS.find((c) => c.id === id) ?? (CARS[0] as CarModel);
}

export interface DrawCarOptions {
  pal: Palette;
  /** −1..1, front wheels pivot by steer·0.35 rad. */
  steer: number;
  /** 0..1 taillight glow (drift/boost). */
  glow: number;
  /** 0..1 nitro flame intensity. */
  nitro: number;
  /** Seconds, for flicker. */
  time: number;
  /** Car's world heading (atan2 convention), for world-fixed gloss lighting. */
  worldAngle: number;
  /** Device px per world px (dpr · cameraScale). */
  pxScale: number;
  /** Silhouette only (body in pal.carBody); caller sets globalAlpha. */
  ghost?: boolean;
  /** Custom paint (hex) from the garage; omitted = the model's factory paint. */
  paint?: string;
  /** Hex colour of the neon underbody light; omitted = none. */
  underglow?: string;
}

/** Perceived lightness 0…1 of a #rrggbb colour. */
function lightness(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** CSS rgba() for a #rgb / #rrggbb colour at the given alpha. */
function hexA(hex: string, a: number): string {
  let h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  if (h.length === 3) h = h.charAt(0).repeat(2) + h.charAt(1).repeat(2) + h.charAt(2).repeat(2);
  const v = parseInt(h.slice(0, 6), 16);
  const n = Number.isNaN(v) ? 0xffffff : v;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${+a.toFixed(4)})`;
}

// ─── Paint ────────────────────────────────────────────────────────────────

const GLASS = '#121418';
const GLASS_SHINE = 'rgba(255,255,255,0.16)';

interface GlossSet {
  hi: number;
  spec: number;
  rim: number;
  lo: number;
}
const GLOSS_DARK: GlossSet = { hi: 0.32, spec: 0.45, rim: 0.28, lo: 0.35 };
const GLOSS_LIGHT: GlossSet = { hi: 0.55, spec: 0.7, rim: 0.4, lo: 0.16 };
const GLOSS_MID: GlossSet = { hi: 0.4, spec: 0.55, rim: 0.32, lo: 0.26 };

/** Gloss strength suited to a custom paint (dark paints get deeper lacquer). */
function glossFor(paint: string | undefined, fallback: GlossSet): GlossSet {
  if (!paint) return fallback;
  const l = lightness(paint);
  return l < 0.3 ? GLOSS_DARK : l > 0.7 ? GLOSS_LIGHT : GLOSS_MID;
}

const WEDGE = { body: '#E03A3E', detail: '#16181C' };
const FORMULA = { body: '#2C5FE0', detail: '#F2C232', dark: '#101216' };
const MUSCLE = { body: '#178C84', stripe: '#F2EDE3', detail: '#15171B' };
const HYPER = { body: '#A9B1BC', detail: '#23272E' };
const RALLY = { body: '#F2F0EB', stripe: '#1F4FD1', flare: '#F27420', detail: '#15171B' };
const PHANTOM = { body: '#40444C', detail: '#111317', fin: '#1B1E23' };
const INFERNO = { body: '#D3231B', pod: '#141518', flameHot: '#FFD34A', flame: '#FF7A1C', flameTip: '#E8341A' };

/** Matte finish: same shading, far softer highlights. */
function matte(k: GlossSet): GlossSet {
  return { hi: k.hi * 0.4, spec: k.spec * 0.22, rim: k.rim * 0.55, lo: k.lo * 1.1 };
}

// ─── Geometry cache ───────────────────────────────────────────────────────

interface Geo {
  /** Painted bodywork (fill + gloss clip). */
  body: Path2D;
  /** Outline for the clear-coat rim highlight. */
  rim: Path2D;
  /** Ghost silhouette. */
  silhouette: Path2D;
}

const cache = new Map<string, Geo>();

/**
 * Builds a left/right-symmetric closed path from its right half.
 * segs[0] = start [x,y]; then [x,y] line, [cx,cy,x,y] quad, [c1x,c1y,c2x,c2y,x,y] cubic.
 */
function sym(p: Path2D, segs: readonly (readonly number[])[]): void {
  const s0 = segs[0] as readonly number[];
  p.moveTo(s0[0] as number, s0[1] as number);
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i] as readonly number[];
    if (s.length === 2) p.lineTo(s[0]!, s[1]!);
    else if (s.length === 4) p.quadraticCurveTo(s[0]!, s[1]!, s[2]!, s[3]!);
    else p.bezierCurveTo(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!);
  }
  const last = segs[segs.length - 1] as readonly number[];
  p.lineTo(-last[last.length - 2]!, last[last.length - 1]!);
  for (let i = segs.length - 1; i >= 1; i--) {
    const s = segs[i] as readonly number[];
    const prev = segs[i - 1] as readonly number[];
    const px = -prev[prev.length - 2]!;
    const py = prev[prev.length - 1]!;
    if (s.length === 2) p.lineTo(px, py);
    else if (s.length === 4) p.quadraticCurveTo(-s[0]!, s[1]!, px, py);
    else p.bezierCurveTo(-s[2]!, s[3]!, -s[0]!, s[1]!, px, py);
  }
  p.closePath();
}

function symPath(segs: readonly (readonly number[])[]): Path2D {
  const p = new Path2D();
  sym(p, segs);
  return p;
}

function gtBody(): Path2D {
  const p = new Path2D();
  p.moveTo(0, -20);
  p.quadraticCurveTo(5.6, -20, 7.2, -16.2);
  p.bezierCurveTo(9.8, -13.5, 10, -8.5, 8.4, -4.5);
  p.quadraticCurveTo(7.2, 0, 8.2, 4.5);
  p.bezierCurveTo(10, 8.5, 10.2, 14.5, 9.2, 18);
  p.quadraticCurveTo(8.6, 20, 6.4, 20);
  p.lineTo(-6.4, 20);
  p.quadraticCurveTo(-8.6, 20, -9.2, 18);
  p.bezierCurveTo(-10.2, 14.5, -10, 8.5, -8.2, 4.5);
  p.quadraticCurveTo(-7.2, 0, -8.4, -4.5);
  p.bezierCurveTo(-10, -8.5, -9.8, -13.5, -7.2, -16.2);
  p.quadraticCurveTo(-5.6, -20, 0, -20);
  p.closePath();
  return p;
}

const WEDGE_SEGS = [
  [0, -21],
  [3.4, -21],
  [8.3, -18.6],
  [9.6, -14.4],
  [9.6, -7.6],
  [8.9, -2.6],
  [9.1, 4],
  [10.1, 8.8],
  [10.1, 19.2],
  [9.2, 21],
  [0, 21],
];

const FORMULA_TUB = [
  [0, -21.8],
  [1.5, -21.8, 1.6, -20],
  [2.1, -13],
  [2.4, -9, 3.3, -7.2, 3.6, -4.6],
  [5.6, -3.8, 6.8, -2.6, 6.9, 0],
  [6.6, 5.5],
  [6.3, 9, 4.1, 11.4, 3.4, 14],
  [2.6, 19],
  [2.4, 20.4, 0, 20.4],
];
const FORMULA_FRONT_WING = [
  [0, -20.6],
  [8.6, -21.4],
  [10.4, -21.4],
  [10.4, -18.4],
  [8.8, -18.4],
  [0, -18.8],
];
const FORMULA_REAR_WING = [
  [0, 18.4],
  [9.6, 18.4],
  [9.9, 18.8],
  [9.9, 21.6],
  [9.5, 22],
  [0, 22],
];

const MUSCLE_SEGS = [
  [0, -23],
  [6.6, -23, 8.9, -22.3],
  [9.9, -21.8, 10, -19],
  [10.1, -8.6],
  [10.1, -4, 9.4, -2, 9.6, 1],
  [9.8, 4, 11, 5.6, 11, 9],
  [11, 19.4],
  [11, 22.7, 8.4, 23],
  [0, 23],
];

const HYPER_SEGS = [
  [0, -22],
  [2.2, -22, 3.2, -21],
  [4.2, -20.2, 5.4, -20.8, 7.2, -20.6],
  [9.4, -20.2, 10.2, -17.6, 10.2, -14.2],
  [10.2, -10.6, 9.4, -7.8, 7.4, -5.2],
  [6.4, -3.8, 6.6, -1.4, 7.8, 1.2],
  [9.8, 4.4, 10.4, 8.4, 10.4, 13],
  [10.2, 19.4],
  [10.0, 21.2, 8.6, 21.2],
  [6.6, 17.8],
  [4.3, 17.8],
  [3.6, 20.8],
  [3.4, 21.8, 1.8, 21.8],
  [0, 21.8],
];

/** Boxy widebody hatch: flat flanks with bolt-on flares over each axle. */
const RALLY_SEGS = [
  [0, -20],
  [6.8, -20],
  [8.9, -20, 9.9, -18.8],
  [10.6, -17.5],
  [11.3, -16.9],
  [11.4, -15.6],
  [11.4, -8.5],
  [11.0, -7.7],
  [10.0, -7.1],
  [10.0, 6.0],
  [11.0, 6.8],
  [11.6, 7.8],
  [11.6, 16.2],
  [11.0, 16.9],
  [10.3, 17.4],
  [10.3, 19.0],
  [10.3, 19.9, 9.2, 20],
  [0, 20],
];

/** Flat-panelled stealth wedge: straight edges only. */
const PHANTOM_SEGS = [
  [0, -21.4],
  [3.4, -20.6],
  [8.6, -18.2],
  [10.4, -15.6],
  [10.5, -9.8],
  [9.4, -7.2],
  [8.2, -3.2],
  [8.4, 1.4],
  [10.6, 4.6],
  [11.0, 8.0],
  [11.0, 17.4],
  [10.2, 20.4],
  [8.4, 21.8],
  [0, 21.8],
];
/** Knife-edge splitter protruding ahead of the nose. */
const PHANTOM_SPLITTER = [
  [0, -22.9],
  [4.2, -21.7],
  [9.7, -18.7],
  [10.3, -17.4],
  [8.6, -17.6],
  [3.4, -19.8],
  [0, -20.2],
];

/** Needle nose sweeping out into the front fenders and on into the side pods; the jet nozzle sits in the tail notch. */
const INFERNO_SEGS = [
  [0, -24],
  [1.0, -24, 1.7, -22.0],
  [3.0, -17.6],
  [5.4, -15.2, 9.0, -13.6, 10.0, -11.6],
  [10.3, -10.6, 10.2, -8.0],
  [10.0, -6.0],
  [10.9, -3.6, 11.0, -0.6],
  [11.0, 17.6],
  [10.8, 19.8, 8.8, 20.4],
  [5.6, 20.4],
  [5.6, 13.0],
  [0, 13.0],
];
/** Jet nozzle housing with a petalled (saw-tooth) exit. */
const INFERNO_NOZZLE = [
  [0, 11.4],
  [4.6, 11.4],
  [5.9, 11.8, 6.0, 13.4],
  [5.6, 21.0],
  [5.4, 22.2],
  [5.0, 24.0],
  [4.0, 23.1],
  [3.0, 24.1],
  [2.0, 23.2],
  [1.0, 24.2],
  [0, 23.3],
];

function geo(id: CarModel['id']): Geo {
  let g = cache.get(id);
  if (g) return g;
  switch (id) {
    case 'gt': {
      const b = gtBody();
      g = { body: b, rim: b, silhouette: b };
      break;
    }
    case 'wedge': {
      const b = symPath(WEDGE_SEGS);
      g = { body: b, rim: b, silhouette: b };
      break;
    }
    case 'formula': {
      const tub = symPath(FORMULA_TUB);
      const body = new Path2D();
      sym(body, FORMULA_FRONT_WING);
      sym(body, FORMULA_REAR_WING);
      body.addPath(tub);
      const sil = new Path2D(body);
      for (const [x, y, w, h] of FORMULA_WHEELS) sil.roundRect(x - w / 2, y - h / 2, w, h, 1.4);
      g = { body, rim: tub, silhouette: sil };
      break;
    }
    case 'muscle': {
      const b = symPath(MUSCLE_SEGS);
      g = { body: b, rim: b, silhouette: b };
      break;
    }
    case 'hyper': {
      const b = symPath(HYPER_SEGS);
      g = { body: b, rim: b, silhouette: b };
      break;
    }
    case 'rally': {
      const b = symPath(RALLY_SEGS);
      g = { body: b, rim: b, silhouette: b };
      break;
    }
    case 'phantom': {
      const b = symPath(PHANTOM_SEGS);
      const sil = new Path2D(b);
      sym(sil, PHANTOM_SPLITTER);
      // Fins overhang the tail; the mirrored one is walked backwards to keep the winding.
      const f = PHANTOM_FIN;
      sil.moveTo(f[0]!, f[1]!);
      for (let i = 2; i < f.length; i += 2) sil.lineTo(f[i]!, f[i + 1]!);
      sil.closePath();
      sil.moveTo(-f[f.length - 2]!, f[f.length - 1]!);
      for (let i = f.length - 4; i >= 0; i -= 2) sil.lineTo(-f[i]!, f[i + 1]!);
      sil.closePath();
      g = { body: b, rim: b, silhouette: sil };
      break;
    }
    case 'inferno': {
      const b = symPath(INFERNO_SEGS);
      const sil = new Path2D(b);
      sym(sil, INFERNO_NOZZLE);
      g = { body: b, rim: b, silhouette: sil };
      break;
    }
  }
  cache.set(id, g);
  return g;
}

// ─── Shared drawing helpers ───────────────────────────────────────────────

function contactShadowPath(ctx: CanvasRenderingContext2D, o: DrawCarOptions, p: Path2D): void {
  ctx.save();
  const c = css(o.pal.carShadow);
  ctx.shadowColor = c;
  ctx.shadowBlur = 7 * o.pxScale;
  ctx.shadowOffsetY = 2 * o.pxScale;
  ctx.fillStyle = c;
  ctx.fill(p);
  ctx.restore();
}

function contactShadow(
  ctx: CanvasRenderingContext2D,
  o: DrawCarOptions,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.save();
  const c = css(o.pal.carShadow);
  ctx.shadowColor = c;
  ctx.shadowBlur = 7 * o.pxScale;
  ctx.shadowOffsetY = 2 * o.pxScale;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

/** Wheel as [x, y, w, h, radius]; `pivot` rotates it about its centre. */
function wheel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  pivot: number,
): void {
  if (pivot === 0) {
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, r);
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(pivot);
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, r);
  ctx.fill();
  ctx.restore();
}

/** Four wheels: fronts at ±fx,fy (fw×fh), rears at ±rx,ry (rw×rh). */
function wheels(
  ctx: CanvasRenderingContext2D,
  o: DrawCarOptions,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  r: number,
): void {
  ctx.fillStyle = css(o.pal.wheel);
  const s = o.steer * 0.35;
  wheel(ctx, -fx, fy, fw, fh, r, s);
  wheel(ctx, fx, fy, fw, fh, r, s);
  wheel(ctx, -rx, ry, rw, rh, r + 0.1, 0);
  wheel(ctx, rx, ry, rw, rh, r + 0.1, 0);
}

/** Unit vector toward the world-fixed key light (top-left), in the car's local frame. */
function localLight(worldAngle: number): [number, number] {
  const rot = -(worldAngle + Math.PI / 2);
  const wx = -0.62;
  const wy = -0.78;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [wx * c - wy * s, wx * s + wy * c];
}

const detailCache = new Map<string, Path2D>();

/** Appends a closed sub-path from `sym`-style segments, x scaled by m (±1). */
function segs(p: Path2D, list: readonly (readonly number[])[], m: number): void {
  const s0 = list[0] as readonly number[];
  p.moveTo(s0[0]! * m, s0[1]!);
  for (let i = 1; i < list.length; i++) {
    const s = list[i] as readonly number[];
    if (s.length === 2) p.lineTo(s[0]! * m, s[1]!);
    else if (s.length === 4) p.quadraticCurveTo(s[0]! * m, s[1]!, s[2]! * m, s[3]!);
    else p.bezierCurveTo(s[0]! * m, s[1]!, s[2]! * m, s[3]!, s[4]! * m, s[5]!);
  }
  p.closePath();
}

/**
 * Cached detail path: `pair` = the right-side shape plus its mirror image
 * (pods, decals); otherwise one left/right-symmetric shape (splitters, nozzles).
 */
function detailPath(key: string, list: readonly (readonly number[])[], pair = false): Path2D {
  let p = detailCache.get(key);
  if (!p) {
    if (pair) {
      p = new Path2D();
      segs(p, list, 1);
      segs(p, list, -1);
    } else p = symPath(list);
    detailCache.set(key, p);
  }
  return p;
}

/** A flat body panel (right-side polygon, mirrored) and its downhill direction. */
interface Facet {
  pts: readonly number[];
  tx: number;
  ty: number;
}

/** Shades flat panels by how squarely they face the key light, so creases flip as the car turns. */
function facets(
  ctx: CanvasRenderingContext2D,
  list: readonly Facet[],
  lx: number,
  ly: number,
  hi: number,
  lo: number,
): void {
  for (const f of list) {
    for (let m = 1; m >= -1; m -= 2) {
      const d = f.tx * m * lx + f.ty * ly;
      ctx.fillStyle = d > 0 ? `rgba(255,255,255,${+(d * hi).toFixed(3)})` : `rgba(0,0,0,${+(-d * lo).toFixed(3)})`;
      ctx.beginPath();
      poly(ctx, f.pts, m < 0);
      ctx.fill();
    }
  }
}

/**
 * Neon underbody light: a soft elliptical pool on the road plus a tighter
 * halo hugging the silhouette, gently breathing. Drawn under everything.
 */
function underglow(ctx: CanvasRenderingContext2D, g: Geo, m: CarModel, o: DrawCarOptions, hex: string): void {
  const pulse = 0.86 + 0.14 * Math.sin(o.time * 2.6);
  const a = 0.55 * pulse;
  const rx = m.width / 2 + 7;
  const ry = m.length / 2 + 7;
  ctx.save();
  ctx.scale(1, ry / rx);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  pool.addColorStop(0, hexA(hex, a));
  pool.addColorStop(0.55, hexA(hex, a * 0.8));
  pool.addColorStop(0.8, hexA(hex, a * 0.32));
  pool.addColorStop(1, hexA(hex, 0));
  ctx.fillStyle = pool;
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = hexA(hex, 0.9 * pulse);
  ctx.shadowBlur = 9 * o.pxScale;
  ctx.fillStyle = hexA(hex, a);
  ctx.fill(g.silhouette);
  ctx.restore();
}

/**
 * Glossy clear-coat: light from a fixed world direction (top-left), so
 * reflections glide across the body as the car turns.
 */
function gloss(
  ctx: CanvasRenderingContext2D,
  g: Geo,
  worldAngle: number,
  k: GlossSet,
  reach: number,
): void {
  const [lx, ly] = localLight(worldAngle);

  ctx.save();
  ctx.clip(g.body);

  const lin = ctx.createLinearGradient(lx * reach, ly * reach, -lx * reach, -ly * reach);
  lin.addColorStop(0, `rgba(255,255,255,${k.hi})`);
  lin.addColorStop(0.42, 'rgba(255,255,255,0)');
  lin.addColorStop(1, `rgba(0,0,0,${k.lo})`);
  ctx.fillStyle = lin;
  ctx.fillRect(-14, -26, 28, 52);

  const hx = lx * 6;
  const hy = ly * reach * 0.41;
  const spec = ctx.createRadialGradient(hx, hy, 0, hx, hy, 9);
  spec.addColorStop(0, `rgba(255,255,255,${k.spec})`);
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.fillRect(hx - 9, hy - 9, 18, 18);

  ctx.strokeStyle = `rgba(255,255,255,${k.rim})`;
  ctx.lineWidth = 0.8;
  ctx.translate(-lx * 0.7, -ly * 0.7);
  ctx.stroke(g.rim);
  ctx.restore();
}

/** Sets up the glowing taillight fill (call inside save/restore). */
function lit(ctx: CanvasRenderingContext2D, o: DrawCarOptions): void {
  ctx.shadowColor = css(o.pal.accent);
  ctx.shadowBlur = (3 + o.glow * 12) * o.pxScale;
  ctx.fillStyle = css(o.pal.accent, 0.78 + 0.22 * o.glow);
}

function poly(ctx: CanvasRenderingContext2D, pts: readonly number[], mirror: boolean): void {
  const m = mirror ? -1 : 1;
  ctx.moveTo(pts[0]! * m, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]! * m, pts[i + 1]!);
  ctx.closePath();
}

function glassShine(ctx: CanvasRenderingContext2D, x0: number, y0: number, cy: number, w: number): void {
  ctx.strokeStyle = GLASS_SHINE;
  ctx.lineWidth = 0.7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0 - w, y0);
  ctx.quadraticCurveTo(x0, cy, x0 + w, y0);
  ctx.stroke();
}

// ─── Models ───────────────────────────────────────────────────────────────

function drawGT(ctx: CanvasRenderingContext2D, g: Geo, o: DrawCarOptions): void {
  const { pal } = o;
  contactShadow(ctx, o, -9.5, -18, 19, 38, 8);

  ctx.fillStyle = css(pal.wheel);
  const s = o.steer * 0.35;
  wheel(ctx, -8.9, -11, 4.6, 8.4, 1.6, s);
  wheel(ctx, 8.9, -11, 4.6, 8.4, 1.6, s);
  wheel(ctx, -9.1, 11.5, 5, 9.2, 1.7, 0);
  wheel(ctx, 9.1, 11.5, 5, 9.2, 1.7, 0);

  ctx.fillStyle = o.paint ?? css(pal.carBody);
  ctx.fill(g.body);
  const gtDark = o.paint ? lightness(o.paint) < 0.5 : pal.carBody[0] < 128;
  gloss(ctx, g, o.worldAngle, gtDark ? GLOSS_DARK : GLOSS_LIGHT, 22);

  // Accent pinstripe down the spine.
  ctx.strokeStyle = css(pal.accent, 0.85);
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -18.6);
  ctx.lineTo(0, -8.6);
  ctx.stroke();

  // Rear wing + diffuser detail.
  ctx.strokeStyle = css(pal.canopy, 0.28);
  ctx.lineWidth = 0.6;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(-8.6, 15.2);
  ctx.lineTo(8.6, 15.2);
  for (let dx = -3; dx <= 3; dx += 3) {
    ctx.moveTo(dx, 17.4);
    ctx.lineTo(dx, 19.6);
  }
  ctx.stroke();

  // Tinted wrap-around canopy.
  ctx.fillStyle = css(pal.canopy);
  ctx.beginPath();
  ctx.moveTo(0, -7.5);
  ctx.quadraticCurveTo(4.8, -6.8, 4.8, -1.5);
  ctx.lineTo(4.1, 6);
  ctx.quadraticCurveTo(3.7, 9.6, 0, 9.9);
  ctx.quadraticCurveTo(-3.7, 9.6, -4.1, 6);
  ctx.lineTo(-4.8, -1.5);
  ctx.quadraticCurveTo(-4.8, -6.8, 0, -7.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = css(pal.carBody, 0.18);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-2.6, -5.2);
  ctx.quadraticCurveTo(0, -6.1, 2.6, -5.2);
  ctx.stroke();

  // LED taillight bar.
  ctx.save();
  lit(ctx, o);
  ctx.beginPath();
  ctx.roundRect(-6.5, 18.7, 13, 1.7, 0.85);
  ctx.fill();
  ctx.restore();
}

const WEDGE_FACET = [3.4, -21, 8.3, -18.6, 9.6, -14.4, 9.6, -7.6, 8.9, -2.6, 7.3, -2.6, 7.9, -7.6, 7.9, -13.4, 6.4, -17.6, 2.6, -19.6];
const WEDGE_HAUNCH = [9.1, 4, 10.1, 8.8, 10.1, 19.2, 8.6, 19.2, 8.6, 9.2, 7.8, 4];
const WEDGE_INTAKE = [8.9, -1.4, 9.1, 4.6, 6.8, 4.6];

function drawWedge(ctx: CanvasRenderingContext2D, g: Geo, o: DrawCarOptions): void {
  contactShadow(ctx, o, -9.8, -19.5, 19.6, 40, 6);
  wheels(ctx, o, 8.8, -12.6, 4.6, 8.4, 9.2, 12.5, 5.2, 9, 1.4);

  ctx.fillStyle = o.paint ?? WEDGE.body;
  ctx.fill(g.body);
  gloss(ctx, g, o.worldAngle, glossFor(o.paint, GLOSS_MID), 23);

  // Flat facets: fender tops and rear haunches fall away from the light.
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.beginPath();
  poly(ctx, WEDGE_FACET, false);
  poly(ctx, WEDGE_FACET, true);
  poly(ctx, WEDGE_HAUNCH, false);
  poly(ctx, WEDGE_HAUNCH, true);
  ctx.fill();

  // Pop-up headlamp lids.
  ctx.strokeStyle = 'rgba(0,0,0,0.38)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(3.6, -19.4);
  ctx.lineTo(6.6, -17.9);
  ctx.moveTo(-3.6, -19.4);
  ctx.lineTo(-6.6, -17.9);
  ctx.stroke();

  // Side intakes + louvred engine deck.
  ctx.fillStyle = WEDGE.detail;
  ctx.beginPath();
  poly(ctx, WEDGE_INTAKE, false);
  poly(ctx, WEDGE_INTAKE, true);
  ctx.fill();
  ctx.strokeStyle = WEDGE.detail;
  ctx.lineWidth = 0.95;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const y = 6.6 + i * 1.85;
    const hw = 5.6 + i * 0.12;
    ctx.moveTo(-hw, y);
    ctx.lineTo(hw, y);
  }
  ctx.stroke();

  // Raked windscreen and roof panel.
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  poly(ctx, [-5.2, -7.6, 5.2, -7.6, 6.5, -1.4, -6.5, -1.4], false);
  ctx.fill();
  glassShine(ctx, 0, -5.9, -6.6, 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(6.5, -1.4);
  ctx.lineTo(6.1, 4.4);
  ctx.lineTo(-6.1, 4.4);
  ctx.lineTo(-6.5, -1.4);
  ctx.stroke();

  // Black tail panel with full-width light bar.
  ctx.save();
  ctx.clip(g.body);
  ctx.fillStyle = WEDGE.detail;
  ctx.fillRect(-11, 19.1, 22, 3);
  ctx.restore();
  ctx.save();
  lit(ctx, o);
  ctx.beginPath();
  ctx.roundRect(-8.2, 19.6, 16.4, 1.1, 0.4);
  ctx.fill();
  ctx.restore();
}

/** [x, y, w, h] of the four exposed wheels (x is the right-side centre). */
const FORMULA_WHEELS: readonly (readonly [number, number, number, number])[] = [
  [-8.4, -12.6, 4.4, 7.6],
  [8.4, -12.6, 4.4, 7.6],
  [-8.6, 13.6, 5.4, 9],
  [8.6, 13.6, 5.4, 9],
];

function drawFormula(ctx: CanvasRenderingContext2D, g: Geo, o: DrawCarOptions): void {
  contactShadowPath(ctx, o, g.silhouette);

  // Suspension arms.
  ctx.strokeStyle = css(o.pal.wheel, 0.9);
  ctx.lineWidth = 0.7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let m = -1; m <= 1; m += 2) {
    ctx.moveTo(1.9 * m, -14.4);
    ctx.lineTo(8.4 * m, -12.6);
    ctx.lineTo(2.3 * m, -10.4);
    ctx.moveTo(5 * m, 10.2);
    ctx.lineTo(8.6 * m, 13.6);
    ctx.lineTo(3.2 * m, 16.4);
  }
  ctx.stroke();

  // Exposed wheels with a faint inner sidewall edge.
  const s = o.steer * 0.35;
  const tyre = css(o.pal.wheel);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 4; i++) {
    const [x, y, w, h] = FORMULA_WHEELS[i]!;
    ctx.save();
    ctx.translate(x, y);
    if (i < 2) ctx.rotate(s);
    ctx.fillStyle = tyre;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 1.4);
    ctx.fill();
    const ix = -Math.sign(x) * (w / 2 - 0.7);
    ctx.beginPath();
    ctx.moveTo(ix, -h / 2 + 1);
    ctx.lineTo(ix, h / 2 - 1);
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = o.paint ?? FORMULA.body;
  ctx.fill(g.body);
  gloss(ctx, g, o.worldAngle, glossFor(o.paint, GLOSS_MID), 23);

  // Wing flaps + endplates.
  ctx.strokeStyle = 'rgba(0,0,0,0.32)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-9.6, -19.4);
  ctx.lineTo(-2.2, -19.7);
  ctx.moveTo(2.2, -19.7);
  ctx.lineTo(9.6, -19.4);
  ctx.moveTo(-9.4, 20.2);
  ctx.lineTo(9.4, 20.2);
  ctx.stroke();
  ctx.fillStyle = FORMULA.detail;
  ctx.fillRect(-10.6, -21.6, 1.1, 3.4);
  ctx.fillRect(9.5, -21.6, 1.1, 3.4);
  ctx.fillRect(-10.2, 18.2, 1, 4);
  ctx.fillRect(9.2, 18.2, 1, 4);

  // Nose stripe.
  ctx.strokeStyle = FORMULA.detail;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -20.6);
  ctx.lineTo(0, -9.4);
  ctx.stroke();

  // Sidepod inlets, cockpit, helmet, airbox.
  ctx.fillStyle = FORMULA.dark;
  ctx.beginPath();
  poly(ctx, [3.8, -4.0, 6.3, -2.0, 6.6, -0.8, 4.0, -2.6], false);
  poly(ctx, [3.8, -4.0, 6.3, -2.0, 6.6, -0.8, 4.0, -2.6], true);
  ctx.ellipse(0, -3.4, 2.4, 4.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = FORMULA.detail;
  ctx.beginPath();
  ctx.arc(0, -2.6, 1.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = FORMULA.dark;
  ctx.lineWidth = 0.6;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.arc(0, -2.6, 1.5, Math.PI * 1.22, Math.PI * 1.78);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(-0.6, -3.1, 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = FORMULA.dark;
  ctx.beginPath();
  ctx.ellipse(0, 2.6, 1.1, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rain light.
  ctx.save();
  lit(ctx, o);
  ctx.beginPath();
  ctx.roundRect(-1.6, 21.7, 3.2, 1.3, 0.4);
  ctx.fill();
  ctx.restore();
}

function drawMuscle(ctx: CanvasRenderingContext2D, g: Geo, o: DrawCarOptions): void {
  contactShadow(ctx, o, -10.8, -21.6, 21.6, 44, 7);
  wheels(ctx, o, 9.2, -13.6, 4.8, 8.8, 9.2, 13.4, 6, 10, 1.6);

  ctx.fillStyle = o.paint ?? MUSCLE.body;
  ctx.fill(g.body);

  // Twin racing stripes, nose to tail.
  ctx.save();
  ctx.clip(g.body);
  ctx.fillStyle = MUSCLE.stripe;
  ctx.fillRect(-3.7, -24, 2.4, 48);
  ctx.fillRect(1.3, -24, 2.4, 48);
  ctx.restore();

  gloss(ctx, g, o.worldAngle, glossFor(o.paint, GLOSS_MID), 25);

  // Hood scoop.
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.strokeStyle = 'rgba(0,0,0,0.34)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.roundRect(-3.1, -16.6, 6.2, 8, 1.8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = MUSCLE.detail;
  ctx.beginPath();
  ctx.roundRect(-2.3, -16.1, 4.6, 1.5, 0.6);
  ctx.fill();

  // Round headlamps.
  ctx.fillStyle = 'rgba(255,250,236,0.9)';
  ctx.beginPath();
  ctx.arc(-7.1, -21.2, 1.1, 0, Math.PI * 2);
  ctx.arc(7.1, -21.2, 1.1, 0, Math.PI * 2);
  ctx.fill();

  // Greenhouse: windshield, roof pillars, rear glass.
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.moveTo(-6.6, -4.4);
  ctx.quadraticCurveTo(0, -5.6, 6.6, -4.4);
  ctx.lineTo(7.6, 1.2);
  ctx.lineTo(-7.6, 1.2);
  ctx.closePath();
  ctx.moveTo(-7.2, 8.6);
  ctx.lineTo(7.2, 8.6);
  ctx.lineTo(6.2, 12.2);
  ctx.quadraticCurveTo(0, 12.9, -6.2, 12.2);
  ctx.closePath();
  ctx.fill();
  glassShine(ctx, 0, -3.4, -4.4, 3.6);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(7.6, 1.2);
  ctx.lineTo(7.2, 8.6);
  ctx.moveTo(-7.6, 1.2);
  ctx.lineTo(-7.2, 8.6);
  // Ducktail lip.
  ctx.moveTo(-9.8, 20.4);
  ctx.quadraticCurveTo(0, 19.6, 9.8, 20.4);
  ctx.stroke();

  // Tail panel + twin light bars.
  ctx.save();
  ctx.clip(g.body);
  ctx.fillStyle = MUSCLE.detail;
  ctx.fillRect(-12, 21.4, 24, 2);
  ctx.restore();
  ctx.save();
  lit(ctx, o);
  ctx.beginPath();
  ctx.roundRect(-8.8, 21.75, 6.4, 1.1, 0.4);
  ctx.roundRect(2.4, 21.75, 6.4, 1.1, 0.4);
  ctx.fill();
  ctx.restore();
}

const HYPER_INTAKE = [6.9, -4.6, 6.0, -2.0, 6.3, 0.6, 7.6, 2.2, 5.5, 0.2, 5.1, -2.2];

function drawHyper(ctx: CanvasRenderingContext2D, g: Geo, o: DrawCarOptions): void {
  contactShadowPath(ctx, o, g.silhouette);
  wheels(ctx, o, 8.8, -12.6, 4.6, 8.4, 9.2, 12.6, 5.4, 9.4, 1.6);

  // Diffuser visible through the rear cut-outs.
  ctx.fillStyle = HYPER.detail;
  ctx.beginPath();
  ctx.roundRect(-7.4, 15.4, 14.8, 6.2, 1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  for (let x = -6; x <= 6; x += 1.5) {
    if (Math.abs(x) < 4) continue;
    ctx.moveTo(x, 17.4);
    ctx.lineTo(x, 21.2);
  }
  ctx.stroke();

  ctx.fillStyle = o.paint ?? HYPER.body;
  ctx.fill(g.body);
  gloss(ctx, g, o.worldAngle, glossFor(o.paint, GLOSS_LIGHT), 23);

  // Sculpted side intakes.
  ctx.fillStyle = HYPER.detail;
  ctx.beginPath();
  poly(ctx, HYPER_INTAKE, false);
  poly(ctx, HYPER_INTAKE, true);
  ctx.fill();

  // Channels separating the nose from the front fender pods.
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 0.55;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(3.6, -20.6);
  ctx.bezierCurveTo(4.9, -17, 5.6, -12, 5.3, -7.6);
  ctx.moveTo(-3.6, -20.6);
  ctx.bezierCurveTo(-4.9, -17, -5.6, -12, -5.3, -7.6);
  ctx.stroke();

  // Teardrop canopy, far forward.
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.moveTo(0, -15.6);
  ctx.bezierCurveTo(2.9, -15.4, 3.9, -11.4, 3.8, -8.6);
  ctx.bezierCurveTo(3.6, -4.6, 1.8, -0.4, 0, 3);
  ctx.bezierCurveTo(-1.8, -0.4, -3.6, -4.6, -3.8, -8.6);
  ctx.bezierCurveTo(-3.9, -11.4, -2.9, -15.4, 0, -15.6);
  ctx.closePath();
  ctx.fill();
  glassShine(ctx, 0, -13.2, -14.5, 2);

  // Central fin to the wing.
  ctx.lineCap = 'round';
  ctx.strokeStyle = HYPER.detail;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(0, 3.4);
  ctx.lineTo(0, 20.4);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.moveTo(-0.45, 5);
  ctx.lineTo(-0.45, 20);
  ctx.stroke();

  // Full-width rear wing with endplates.
  ctx.fillStyle = HYPER.detail;
  ctx.beginPath();
  ctx.roundRect(-10.2, 20.1, 20.4, 2.1, 0.6);
  ctx.fill();

  ctx.save();
  // Front light-blades (DRL), always on.
  ctx.strokeStyle = css(o.pal.accent, 0.95);
  ctx.shadowColor = css(o.pal.accent);
  ctx.shadowBlur = 3 * o.pxScale;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(5.0, -20.4);
  ctx.quadraticCurveTo(8.6, -20.0, 9.5, -16.6);
  ctx.moveTo(-5.0, -20.4);
  ctx.quadraticCurveTo(-8.6, -20.0, -9.5, -16.6);
  ctx.stroke();
  // Light strips along the rear haunches.
  ctx.strokeStyle = css(o.pal.accent, 0.8);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(8.0, 3.2);
  ctx.quadraticCurveTo(9.3, 7.4, 9.3, 12.6);
  ctx.lineTo(9.1, 18.4);
  ctx.moveTo(-8.0, 3.2);
  ctx.quadraticCurveTo(-9.3, 7.4, -9.3, 12.6);
  ctx.lineTo(-9.1, 18.4);
  ctx.stroke();
  // Light-strip taillight along the wing.
  lit(ctx, o);
  ctx.beginPath();
  ctx.roundRect(-9.6, 21.2, 19.2, 0.9, 0.45);
  ctx.fill();
  ctx.restore();
}

const RALLY_VENT = [2.3, -14.0, 6.1, -14.7, 6.3, -13.2, 2.5, -12.5];
const RALLY_SIDE_GLASS = [7.1, -3.2, 8.3, -2.7, 8.7, 10.2, 7.5, 10.8];
const RALLY_LAMPS = [-5.5, -1.85, 1.85, 5.5];

function drawRally(ctx: CanvasRenderingContext2D, g: Geo, o: DrawCarOptions): void {
  contactShadowPath(ctx, o, g.body);
  wheels(ctx, o, 9.6, -12, 4.8, 8.4, 9.4, 12, 5.2, 8.8, 1.5);

  // Mud flaps behind every wheel, peeking out past the flares.
  ctx.fillStyle = RALLY.flare;
  ctx.beginPath();
  for (const x of [8.8, -11.9]) {
    ctx.roundRect(x, -6.9, 3.1, 1.2, 0.3);
    ctx.roundRect(x, 17.0, 3.1, 1.2, 0.3);
  }
  ctx.fill();

  // Big single tailpipe, off-centre.
  ctx.fillStyle = '#3A3D43';
  ctx.beginPath();
  ctx.roundRect(3.5, 18.4, 2.2, 2.7, 0.9);
  ctx.fill();
  ctx.fillStyle = RALLY.detail;
  ctx.beginPath();
  ctx.arc(4.6, 20.5, 0.62, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = o.paint ?? RALLY.body;
  ctx.fill(g.body);

  // Livery: one big diagonal sweep with an orange keyline.
  ctx.save();
  ctx.clip(g.body);
  ctx.translate(0, -4);
  ctx.rotate(-0.62);
  ctx.fillStyle = RALLY.stripe;
  ctx.fillRect(-3.8, -40, 7.6, 80);
  ctx.fillStyle = RALLY.flare;
  ctx.fillRect(4.6, -40, 1.6, 80);
  ctx.restore();

  gloss(ctx, g, o.worldAngle, glossFor(o.paint, GLOSS_LIGHT), 22);

  // Black arch extensions, grille band, rear bumper; bonnet vents and pins.
  ctx.save();
  ctx.clip(g.body);
  ctx.fillStyle = RALLY.detail;
  ctx.fillRect(10.1, -18.2, 3, 11.4);
  ctx.fillRect(-13.1, -18.2, 3, 11.4);
  ctx.fillRect(10.5, 6.2, 3, 11.6);
  ctx.fillRect(-13.5, 6.2, 3, 11.6);
  ctx.fillRect(-4.6, -20.5, 9.2, 1.5);
  ctx.fillRect(-12, 19.1, 24, 1.2);
  ctx.restore();
  ctx.fillStyle = RALLY.detail;
  ctx.beginPath();
  poly(ctx, RALLY_VENT, false);
  poly(ctx, RALLY_VENT, true);
  ctx.moveTo(4.05, -17.4);
  ctx.arc(3.7, -17.4, 0.35, 0, Math.PI * 2);
  ctx.moveTo(-3.35, -17.4);
  ctx.arc(-3.7, -17.4, 0.35, 0, Math.PI * 2);
  ctx.fill();

  // Square headlamps.
  ctx.fillStyle = 'rgba(255,250,236,0.95)';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.roundRect(5.2, -19.6, 3.4, 1.4, 0.5);
  ctx.roundRect(-8.6, -19.6, 3.4, 1.4, 0.5);
  ctx.fill();
  ctx.stroke();

  // Greenhouse: windscreen, side glass, steep hatch glass.
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  poly(ctx, [-7.9, -7.2, 7.9, -7.2, 7.1, -3.4, -7.1, -3.4], false);
  poly(ctx, RALLY_SIDE_GLASS, false);
  poly(ctx, RALLY_SIDE_GLASS, true);
  poly(ctx, [-6.9, 13.4, 6.9, 13.4, 6.2, 16.6, -6.2, 16.6], false);
  ctx.fill();
  glassShine(ctx, 0, -5.2, -6.2, 3.6);

  // Roof scoop.
  ctx.fillStyle = '#26292F';
  ctx.beginPath();
  ctx.moveTo(-2.4, -0.4);
  ctx.lineTo(2.4, -0.4);
  ctx.lineTo(1.9, 4.4);
  ctx.quadraticCurveTo(0, 5.0, -1.9, 4.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#08090B';
  ctx.beginPath();
  ctx.roundRect(-2.0, -0.2, 4.0, 1.2, 0.4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.moveTo(-1.6, 3.9);
  ctx.lineTo(1.6, 3.9);
  ctx.stroke();

  // Wide roof spoiler with endplates.
  ctx.fillStyle = RALLY.detail;
  ctx.beginPath();
  ctx.roundRect(-10.4, 10.9, 20.8, 2.3, 0.6);
  ctx.roundRect(-10.9, 10.2, 1.3, 3.6, 0.4);
  ctx.roundRect(9.6, 10.2, 1.3, 3.6, 0.4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(-9.4, 11.3, 18.8, 0.4);

  // Roof light pod: four lamps.
  ctx.fillStyle = RALLY.detail;
  ctx.beginPath();
  ctx.roundRect(-7.4, -3.3, 14.8, 2.4, 1.1);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = css(o.pal.accent);
  ctx.shadowBlur = 4 * o.pxScale;
  ctx.fillStyle = css(o.pal.accent, 0.95);
  ctx.beginPath();
  for (const x of RALLY_LAMPS) {
    ctx.moveTo(x + 0.95, -2.1);
    ctx.arc(x, -2.1, 0.95, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  for (const x of RALLY_LAMPS) {
    ctx.moveTo(x + 0.08, -2.38);
    ctx.arc(x - 0.28, -2.38, 0.36, 0, Math.PI * 2);
  }
  ctx.fill();

  // Tail lamps.
  ctx.save();
  lit(ctx, o);
  ctx.beginPath();
  ctx.roundRect(6.0, 17.7, 3.6, 1.1, 0.4);
  ctx.roundRect(-9.6, 17.7, 3.6, 1.1, 0.4);
  ctx.fill();
  ctx.restore();
}

const PHANTOM_FACETS: readonly Facet[] = [
  { pts: [0, -21.4, 3.4, -20.6, 8.6, -18.2, 5.6, -15.4, 0, -14.6], tx: 0.3, ty: -0.95 },
  { pts: [8.6, -18.2, 10.4, -15.6, 10.5, -9.8, 7.0, -10.6, 5.6, -15.4], tx: 0.95, ty: -0.3 },
  { pts: [10.5, -9.8, 9.4, -7.2, 8.2, -3.2, 8.4, 1.4, 6.6, 0.4, 6.2, -5.6, 7.0, -10.6], tx: 1, ty: 0.05 },
  { pts: [8.4, 1.4, 10.6, 4.6, 11.0, 8.0, 11.0, 17.4, 8.0, 17.8, 6.8, 5.6, 6.6, 0.4], tx: 0.92, ty: 0.25 },
  { pts: [11.0, 17.4, 10.2, 20.4, 8.4, 21.8, 0, 21.8, 0, 18.6, 8.0, 17.8], tx: 0.2, ty: 0.98 },
];
const PHANTOM_CANOPY = [0, -11.2, 3.6, -8.6, 4.4, -3.4, 3.8, 3.0, 1.6, 6.0, 0, 6.4, -1.6, 6.0, -3.8, 3.0, -4.4, -3.4, -3.6, -8.6];
const PHANTOM_GLASS_FACETS: readonly Facet[] = [
  { pts: [0, -11.2, 3.6, -8.6, 4.0, -6.0, 0, -7.0], tx: 0.25, ty: -0.97 },
  { pts: [4.0, -6.0, 4.4, -3.4, 3.8, 3.0, 1.6, 6.0, 0, 6.4, 0, -7.0], tx: 1, ty: 0.1 },
];
const PHANTOM_INTAKE = [9.0, -6.2, 8.2, -3.2, 8.4, 0.8, 7.0, -2.4];
const PHANTOM_FIN = [4.2, 7.2, 5.3, 7.8, 6.9, 23.0, 5.7, 23.3];

function drawPhantom(ctx: CanvasRenderingContext2D, g: Geo, o: DrawCarOptions): void {
  contactShadowPath(ctx, o, g.silhouette);
  wheels(ctx, o, 8.9, -13.2, 4.6, 8.4, 9.0, 12.4, 5.4, 9.6, 1.5);

  // Knife-edge splitter and exhaust slots, under the bodywork.
  ctx.fillStyle = PHANTOM.detail;
  ctx.fill(detailPath('phantom-splitter', PHANTOM_SPLITTER));
  ctx.beginPath();
  ctx.roundRect(-3.5, 20.4, 2.4, 2.2, 0.5);
  ctx.roundRect(1.1, 20.4, 2.4, 2.2, 0.5);
  ctx.fill();

  ctx.fillStyle = o.paint ?? PHANTOM.body;
  ctx.fill(g.body);
  const [lx, ly] = localLight(o.worldAngle);
  facets(ctx, PHANTOM_FACETS, lx, ly, 0.16, 0.28);
  gloss(ctx, g, o.worldAngle, matte(glossFor(o.paint, GLOSS_DARK)), 23);

  // Waist intakes.
  ctx.fillStyle = PHANTOM.detail;
  ctx.beginPath();
  poly(ctx, PHANTOM_INTAKE, false);
  poly(ctx, PHANTOM_INTAKE, true);
  ctx.fill();

  // Faceted canopy.
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  poly(ctx, PHANTOM_CANOPY, false);
  ctx.fill();
  facets(ctx, PHANTOM_GLASS_FACETS, lx, ly, 0.22, 0.04);

  // Engine-deck chevron louvres.
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 0.55;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const y = 8.6 + i * 2;
    ctx.moveTo(-3.4, y + 1);
    ctx.lineTo(0, y);
    ctx.lineTo(3.4, y + 1);
  }
  ctx.stroke();

  ctx.save();
  // Glowing seams along the creases: nose chevron and flanks.
  ctx.strokeStyle = css(o.pal.accent, 0.95);
  ctx.shadowColor = css(o.pal.accent);
  ctx.shadowBlur = 3 * o.pxScale;
  ctx.lineWidth = 0.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-8.6, -18.2);
  ctx.lineTo(-5.6, -15.4);
  ctx.lineTo(0, -14.6);
  ctx.lineTo(5.6, -15.4);
  ctx.lineTo(8.6, -18.2);
  for (let m = -1; m <= 1; m += 2) {
    ctx.moveTo(7.0 * m, -10.6);
    ctx.lineTo(6.2 * m, -5.6);
    ctx.lineTo(6.6 * m, 0.4);
    ctx.lineTo(6.8 * m, 5.6);
    ctx.lineTo(8.0 * m, 17.8);
  }
  ctx.stroke();
  // Full-width light blade.
  lit(ctx, o);
  ctx.beginPath();
  ctx.roundRect(-8.6, 20.6, 17.2, 0.8, 0.4);
  ctx.fill();
  ctx.restore();

  // Twin vertical fins, overhanging the tail: cast shadow, blades, glowing crests.
  ctx.save();
  ctx.clip(g.body);
  ctx.translate(-lx * 2, -ly * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  poly(ctx, PHANTOM_FIN, false);
  poly(ctx, PHANTOM_FIN, true);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = PHANTOM.fin;
  ctx.beginPath();
  poly(ctx, PHANTOM_FIN, false);
  poly(ctx, PHANTOM_FIN, true);
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = css(o.pal.accent, 0.95);
  ctx.shadowColor = css(o.pal.accent);
  ctx.shadowBlur = 2.5 * o.pxScale;
  ctx.lineWidth = 0.35;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4.75, 7.8);
  ctx.lineTo(6.3, 22.8);
  ctx.moveTo(-4.75, 7.8);
  ctx.lineTo(-6.3, 22.8);
  ctx.stroke();
  ctx.restore();
}

/** Right side pod (mirrored for the left); clipped to the body outline. */
const INFERNO_POD = [
  [6.4, -4.4],
  [9.4, -6.6],
  [12, -6.6],
  [12, 21],
  [5.6, 21],
  [5.6, 12.0],
  [6.1, 2.0],
];
/** Flame decal licking back along each pod from its intake. */
const INFERNO_POD_FLAME = [
  [5.0, -6.0],
  [10.3, -6.0],
  [10.3, 3.0],
  [10.5, 9.6, 9.8, 15.6],
  [9.3, 10.6, 8.9, 7.6],
  [9.6, 13.4, 8.3, 18.8],
  [7.8, 13.0, 7.4, 8.8],
  [7.0, 10.6, 6.2, 13.6],
  [5.6, 8.0, 5.0, 4.0],
];
const INFERNO_INTAKE = [6.9, -3.7, 9.4, -5.5, 10.2, -5.3, 10.4, -3.9, 9.5, -3.4, 7.3, -2.5];

function drawInferno(ctx: CanvasRenderingContext2D, g: Geo, o: DrawCarOptions): void {
  contactShadowPath(ctx, o, g.silhouette);
  wheels(ctx, o, 8.5, -10.4, 3.8, 7.2, 9.2, 12.8, 5.8, 10.4, 1.5);

  ctx.fillStyle = o.paint ?? INFERNO.body;
  ctx.fill(g.body);

  // Black side pods with flames licking back from the intakes.
  const pods = detailPath('inferno-pods', INFERNO_POD, true);
  ctx.save();
  ctx.clip(g.body);
  ctx.fillStyle = INFERNO.pod;
  ctx.fill(pods);
  ctx.clip(pods);
  const fl = ctx.createLinearGradient(0, -3, 0, 18);
  fl.addColorStop(0, INFERNO.flameHot);
  fl.addColorStop(0.55, INFERNO.flame);
  fl.addColorStop(1, INFERNO.flameTip);
  ctx.fillStyle = fl;
  const flame = detailPath('inferno-flame', INFERNO_POD_FLAME, true);
  ctx.fill(flame);
  ctx.strokeStyle = 'rgba(90,10,0,0.5)';
  ctx.lineWidth = 0.4;
  ctx.stroke(flame);
  ctx.restore();

  gloss(ctx, g, o.worldAngle, glossFor(o.paint, GLOSS_MID), 25);

  // Jet intakes at the pod mouths.
  ctx.fillStyle = '#050506';
  ctx.beginPath();
  poly(ctx, INFERNO_INTAKE, false);
  poly(ctx, INFERNO_INTAKE, true);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 0.35;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let m = -1; m <= 1; m += 2) {
    ctx.moveTo(7.4 * m, -2.3);
    ctx.lineTo(9.5 * m, -3.2);
    ctx.lineTo(10.3 * m, -3.6);
  }
  ctx.stroke();

  // Nose ridge channels.
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  for (let m = -1; m <= 1; m += 2) {
    ctx.moveTo(1.1 * m, -21.4);
    ctx.quadraticCurveTo(2.6 * m, -12, 3.6 * m, -1.4);
  }
  ctx.stroke();

  // Slit headlamps along the swept fender leading edges.
  ctx.strokeStyle = 'rgba(255,248,230,0.92)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let m = -1; m <= 1; m += 2) {
    ctx.moveTo(5.0 * m, -15.3);
    ctx.quadraticCurveTo(7.4 * m, -14.2, 8.7 * m, -12.5);
  }
  ctx.stroke();

  // Cockpit bubble, far back.
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.moveTo(0, 0.4);
  ctx.bezierCurveTo(2.6, 0.6, 3.4, 3.4, 3.3, 5.6);
  ctx.bezierCurveTo(3.2, 8.2, 1.8, 10.2, 0, 11.4);
  ctx.bezierCurveTo(-1.8, 10.2, -3.2, 8.2, -3.3, 5.6);
  ctx.bezierCurveTo(-3.4, 3.4, -2.6, 0.6, 0, 0.4);
  ctx.closePath();
  ctx.fill();
  glassShine(ctx, 0, 2.6, 1.5, 1.9);

  // Afterglow between the nozzle petals.
  ctx.save();
  lit(ctx, o);
  ctx.beginPath();
  ctx.roundRect(-5, 22.4, 10, 2.0, 0.9);
  ctx.fill();
  ctx.restore();

  // Giant central jet nozzle: brushed titanium, heat-tinted toward the exit.
  const nz = detailPath('inferno-nozzle', INFERNO_NOZZLE);
  const [lx] = localLight(o.worldAngle);
  const t = 0.5 + 0.3 * lx;
  const cyl = ctx.createLinearGradient(-6, 0, 6, 0);
  cyl.addColorStop(0, '#16181B');
  cyl.addColorStop(t - 0.16, '#6C737D');
  cyl.addColorStop(t, '#DDE2E8');
  cyl.addColorStop(t + 0.2, '#7D848E');
  cyl.addColorStop(1, '#141619');
  ctx.fillStyle = cyl;
  ctx.fill(nz);
  ctx.save();
  ctx.clip(nz);
  const heat = ctx.createLinearGradient(0, 14, 0, 24.2);
  heat.addColorStop(0, 'rgba(255,190,90,0)');
  heat.addColorStop(0.4, 'rgba(255,165,60,0.3)');
  heat.addColorStop(0.72, 'rgba(130,80,230,0.36)');
  heat.addColorStop(1, 'rgba(50,100,240,0.45)');
  ctx.fillStyle = heat;
  ctx.fillRect(-7, 11, 14, 14);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  for (const y of [13.8, 16.4, 19.0, 21.5]) {
    ctx.moveTo(-7, y);
    ctx.lineTo(7, y);
  }
  for (let x = -4; x <= 4; x += 2) {
    ctx.moveTo(x, 21.5);
    ctx.lineTo(x, 23.4);
  }
  ctx.stroke();
  ctx.restore();

  // Pod tail lamps.
  ctx.save();
  lit(ctx, o);
  ctx.beginPath();
  ctx.roundRect(6.3, 19.2, 3.4, 0.9, 0.4);
  ctx.roundRect(-9.7, 19.2, 3.4, 0.9, 0.4);
  ctx.fill();
  ctx.restore();
}

// ─── Nitro ────────────────────────────────────────────────────────────────

/** Per-model nitro flame size (the jet car breathes fire). */
const FLAME_SCALE: Partial<Record<CarModel['id'], number>> = { inferno: 1.6 };

function flames(ctx: CanvasRenderingContext2D, m: CarModel, o: DrawCarOptions): void {
  const n = Math.min(1, o.nitro);
  const k = FLAME_SCALE[m.id] ?? 1;
  const ac = o.pal.accent;
  const ex0 = m.exhausts[0] as [number, number];
  const base = ex0[1];
  const maxLen = (6 + 12 * n) * k;

  ctx.save();
  ctx.globalAlpha *= Math.min(1, n * 1.8);
  ctx.shadowColor = css(ac);
  ctx.shadowBlur = (5 + 7 * n) * k * o.pxScale;
  const grad = ctx.createLinearGradient(0, base, 0, base + maxLen * 1.15);
  grad.addColorStop(0, css(ac, 1));
  grad.addColorStop(0.5, css(ac, 0.7));
  grad.addColorStop(1, css(ac, 0));
  ctx.fillStyle = grad;
  const t = o.time;
  ctx.beginPath();
  for (let i = 0; i < m.exhausts.length; i++) {
    const [ex, ey] = m.exhausts[i]!;
    const flick = 0.8 + 0.13 * Math.sin(t * 41 + i * 2.3) + 0.09 * Math.sin(t * 67 + i * 1.1 + 0.7);
    const len = maxLen * flick;
    const w = (1.3 + 0.9 * n) * k;
    const sway = 0.45 * k * Math.sin(t * 23 + i * 1.9);
    ctx.moveTo(ex - w, ey - 0.3);
    ctx.bezierCurveTo(ex - w, ey + len * 0.35, ex - w * 0.3 + sway, ey + len * 0.75, ex + sway, ey + len);
    ctx.bezierCurveTo(ex + w * 0.3 + sway, ey + len * 0.75, ex + w, ey + len * 0.35, ex + w, ey - 0.3);
    ctx.closePath();
  }
  ctx.fill();

  // White-hot core.
  ctx.shadowBlur = 2 * o.pxScale;
  const hot = `rgba(${(255 + ac[0]) >> 1},${(250 + ac[1] * 0.6) / 1.6 | 0},${(240 + ac[2] * 0.6) / 1.6 | 0},0.97)`;
  ctx.shadowColor = hot;
  ctx.fillStyle = hot;
  ctx.beginPath();
  for (let i = 0; i < m.exhausts.length; i++) {
    const [ex, ey] = m.exhausts[i]!;
    const flick = 0.85 + 0.15 * Math.sin(t * 53 + i * 1.7);
    const len = maxLen * 0.45 * flick;
    const w = (0.55 + 0.4 * n) * k;
    ctx.moveTo(ex - w, ey - 0.3);
    ctx.quadraticCurveTo(ex - w, ey + len * 0.5, ex, ey + len);
    ctx.quadraticCurveTo(ex + w, ey + len * 0.5, ex + w, ey - 0.3);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

// ─── Entry point ──────────────────────────────────────────────────────────

/**
 * Draws the car centred at the origin in its LOCAL frame (nose toward −y).
 * The caller has already translate()d/rotate()d. All ctx state is restored.
 */
export function drawCar(ctx: CanvasRenderingContext2D, model: CarModel, o: DrawCarOptions): void {
  const g = geo(model.id);
  ctx.save();
  if (o.ghost) {
    ctx.fillStyle = css(o.pal.carBody);
    ctx.fill(g.silhouette);
    ctx.restore();
    return;
  }
  if (o.underglow) underglow(ctx, g, model, o, o.underglow);
  switch (model.id) {
    case 'gt':
      drawGT(ctx, g, o);
      break;
    case 'wedge':
      drawWedge(ctx, g, o);
      break;
    case 'formula':
      drawFormula(ctx, g, o);
      break;
    case 'muscle':
      drawMuscle(ctx, g, o);
      break;
    case 'hyper':
      drawHyper(ctx, g, o);
      break;
    case 'rally':
      drawRally(ctx, g, o);
      break;
    case 'phantom':
      drawPhantom(ctx, g, o);
      break;
    case 'inferno':
      drawInferno(ctx, g, o);
      break;
  }
  if (o.nitro > 0.01) flames(ctx, model, o);
  ctx.restore();
}
