import type { Palette } from './theme';
import { css } from './theme';

/**
 * The garage: five original, procedurally drawn top-down car models.
 * Every car is drawn in its LOCAL frame (x right, y rearward, nose at −y),
 * centred on the origin. Geometry is cached as Path2D per model.
 */

export interface CarStats {
  speed: number;
  handling: number;
  nitro: number;
}

export interface CarModel {
  id: 'gt' | 'wedge' | 'formula' | 'muscle' | 'hyper';
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
}

/** Perceived lightness 0…1 of a #rrggbb colour. */
function lightness(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
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
  const rot = -(worldAngle + Math.PI / 2);
  const wx = -0.62;
  const wy = -0.78;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const lx = wx * c - wy * s;
  const ly = wx * s + wy * c;

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

// ─── Nitro ────────────────────────────────────────────────────────────────

function flames(ctx: CanvasRenderingContext2D, m: CarModel, o: DrawCarOptions): void {
  const n = Math.min(1, o.nitro);
  const ac = o.pal.accent;
  const ex0 = m.exhausts[0] as [number, number];
  const base = ex0[1];
  const maxLen = 6 + 12 * n;

  ctx.save();
  ctx.globalAlpha *= Math.min(1, n * 1.8);
  ctx.shadowColor = css(ac);
  ctx.shadowBlur = (5 + 7 * n) * o.pxScale;
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
    const w = 1.3 + 0.9 * n;
    const sway = 0.45 * Math.sin(t * 23 + i * 1.9);
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
    const w = 0.55 + 0.4 * n;
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
  }
  if (o.nitro > 0.01) flames(ctx, model, o);
  ctx.restore();
}
