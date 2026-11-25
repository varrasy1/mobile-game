import type { Palette } from './theme';
import { css } from './theme';

/**
 * Roadside props, civilian traffic and headlight glows.
 *
 * Everything is vector-drawn from cached Path2D geometry (unit space, scaled
 * per instance). Seeded variation is bucketed into a handful of variants per
 * kind so the caches stay tiny. Soft glows (headlight cones, light pools,
 * tail glow, ember glow) are pre-baked once into small sprites and blitted
 * with drawImage, so the per-frame cost is a few image draws, not gradients.
 */

export type PropKind = 'tree' | 'rock' | 'bush' | 'pine' | 'snowpine' | 'cactus' | 'building' | 'lamp' | 'ember' | 'palm';

export interface PropDrawOptions {
  pal: Palette;
  night: number;
  time: number;
  pxScale: number;
}

export interface TrafficStyle {
  name: string;
  length: number;
  width: number;
}

export interface TrafficDrawOptions {
  pal: Palette;
  night: number;
  time: number;
  pxScale: number;
  paint: string;
  brake: number;
  indicator: -1 | 0 | 1;
  ghost?: boolean;
}

type RGBA = Palette['prop'];
type Tuple = [number, number, number, number];

const TAU = Math.PI * 2;

// ─── Colour helpers ───────────────────────────────────────────────────────

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function mix(a: RGBA, b: RGBA, t: number): Tuple {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}
/** a + (b − a)·k, allowing extrapolation (k > 1 or k < 0), rgb clamped. */
function ext(a: RGBA, b: RGBA, k: number): Tuple {
  return [
    clamp255(a[0] + (b[0] - a[0]) * k),
    clamp255(a[1] + (b[1] - a[1]) * k),
    clamp255(a[2] + (b[2] - a[2]) * k),
    1,
  ];
}
const lum = (c: RGBA): number => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const opaque = (c: RGBA): Tuple => [c[0], c[1], c[2], 1];
const BLACK: RGBA = [0, 0, 0, 1];
const WHITE: RGBA = [255, 255, 255, 1];

function hexRGBA(h: string): Tuple {
  if (h.length === 4) {
    return [parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16), parseInt(h[3]! + h[3]!, 16), 1];
  }
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 1];
}

/** All derived prop colours for one palette (recomputed only when it changes). */
interface Tones {
  light: boolean;
  shadeA: string;
  shadeB: string;
  shadeLine: string;
  prop: string;
  alt: string;
  alt2: string;
  deep: string;
  rockDeep: string;
  rockHi: string;
  // Pines
  pine0: string;
  pine1: string;
  pine2: string;
  pineCore: string;
  snow: string;
  snowSoft: string;
  snowRing: string;
  // Cactus
  cacDeep: string;
  cac0: string;
  cac1: string;
  cac2: string;
  cacRib: string;
  flowerA: string;
  flowerB: string;
  // Palm
  palmBack: string;
  palmFront: string;
  palmRib: string;
  nut: string;
  nutHi: string;
  // Buildings
  roofEdge: string;
  roof: string;
  wallR: string;
  wallB: string;
  glass: string;
  detail: string;
  detailTop: string;
  // Lamp
  pole: string;
  poleTop: string;
  head: string;
  // Ember
  emberDeep: string;
  ember0: string;
  ember1: string;
}

let tonesPal: Palette | null = null;
let tonesHash = -1;
let tones: Tones | null = null;

function palHash(p: Palette): number {
  const a = p.prop;
  const b = p.propAlt;
  const s = p.propShade;
  const g = p.bg;
  const e = p.edge;
  return (
    a[0] * 1 + a[1] * 3 + a[2] * 7 + b[0] * 11 + b[1] * 13 + b[2] * 17 + s[0] * 19 + s[3] * 5003 +
    g[0] * 23 + g[1] * 29 + g[2] * 31 + e[0] * 37 + e[1] * 41 + e[2] * 43 + a[0] * b[2] * 0.001 + g[1] * a[2] * 0.0007
  );
}

function getTones(pal: Palette): Tones {
  if (pal === tonesPal && tones) return tones;
  const h = palHash(pal);
  if (h === tonesHash && tones) {
    tonesPal = pal;
    return tones;
  }
  tonesPal = pal;
  tonesHash = h;
  tones = computeTones(pal);
  return tones;
}

function computeTones(pal: Palette): Tones {
  const light = lum(pal.bg) > 0.5;
  const P = opaque(pal.prop);
  const A = opaque(pal.propAlt);
  const S = pal.propShade;
  const hiSide = lum(P) > lum(A) ? P : A;
  const loSide = lum(P) > lum(A) ? A : P;

  const deep = mix(P, BLACK, light ? 0.13 : 0.34);
  const alt2 = ext(P, A, 1.9);

  // Pine: same family as the canopy, slightly deeper and cooler.
  const pineBase = mix(P, [40, 70, 60, 1], light ? 0.12 : 0.1);
  const pine0 = mix(pineBase, BLACK, light ? 0.06 : 0.08);
  const pine1 = ext(pineBase, mix(A, [40, 70, 60, 1], 0.1), 1.3);
  const pine2 = ext(pineBase, mix(A, [40, 70, 60, 1], 0.1), 2.3);

  // Desert greens, nudged toward the biome tint.
  const g0: RGBA = light ? [124, 148, 114, 1] : [48, 74, 58, 1];
  const g1: RGBA = light ? [142, 166, 128, 1] : [62, 94, 72, 1];
  const g2: RGBA = light ? [168, 190, 150, 1] : [84, 120, 92, 1];
  const gd: RGBA = light ? [96, 118, 90, 1] : [28, 44, 36, 1];
  const tint = 0.25;

  const trunk: RGBA = light ? [132, 104, 78, 1] : [80, 62, 46, 1];

  const roofEdge = light ? mix(hiSide, WHITE, 0.5) : mix(hiSide, WHITE, 0.14);
  const roof = light ? mix(hiSide, WHITE, 0.22) : mix(hiSide, WHITE, 0.05);
  const wallB = mix(loSide, BLACK, light ? 0.12 : 0.3);
  const wallR = mix(loSide, BLACK, light ? 0.22 : 0.48);

  const edge = opaque(pal.edge);
  const bg = opaque(pal.bg);
  const emberBase: RGBA = light ? [86, 78, 76, 1] : [30, 26, 27, 1];
  const ember0 = mix(emberBase, P, 0.18);

  return {
    light,
    shadeA: css(S, 0.55),
    shadeB: css(S, 0.62),
    shadeLine: css(S, light ? 1.6 : 0.9),
    prop: css(P),
    alt: css(A),
    alt2: css(alt2),
    deep: css(deep),
    rockDeep: css(mix(A, BLACK, light ? 0.14 : 0.32)),
    rockHi: css(ext(P, A, 1.75)),
    pine0: css(pine0),
    pine1: css(pine1),
    pine2: css(pine2),
    pineCore: css(mix(pine0, BLACK, light ? 0.22 : 0.4)),
    snow: 'rgba(244,246,248,0.95)',
    snowSoft: 'rgba(244,246,248,0.7)',
    snowRing: css(mix(pine0, BLACK, light ? 0.25 : 0.2)),
    cacDeep: css(mix(gd, P, tint)),
    cac0: css(mix(g0, P, tint)),
    cac1: css(mix(g1, P, tint)),
    cac2: css(mix(g2, P, tint * 0.6)),
    cacRib: css(mix(gd, P, tint), light ? 0.55 : 0.7),
    flowerA: light ? '#E07C5E' : '#D9805F',
    flowerB: light ? '#E2B44C' : '#D8B45A',
    palmBack: css(mix(P, BLACK, light ? 0.07 : 0.12)),
    palmFront: css(ext(P, A, 1.25)),
    palmRib: css(ext(P, A, 2.4), light ? 0.8 : 0.6),
    nut: css(mix(trunk, P, 0.25)),
    nutHi: css(mix(mix(trunk, P, 0.25), WHITE, light ? 0.25 : 0.1)),
    roofEdge: css(roofEdge),
    roof: css(roof),
    wallR: css(wallR),
    wallB: css(wallB),
    glass: light ? 'rgba(60,70,84,0.2)' : 'rgba(0,0,0,0.34)',
    detail: css(light ? mix(hiSide, BLACK, 0.06) : mix(hiSide, WHITE, 0.05)),
    detailTop: css(light ? mix(hiSide, WHITE, 0.62) : mix(hiSide, WHITE, 0.12)),
    pole: css(mix(edge, bg, light ? 0.45 : 0.62)),
    poleTop: css(mix(edge, bg, light ? 0.25 : 0.42)),
    head: css(mix(edge, bg, light ? 0.18 : 0.5)),
    emberDeep: css(mix(ember0, BLACK, 0.4)),
    ember0: css(ember0),
    ember1: css(mix(ember0, WHITE, light ? 0.1 : 0.06)),
  };
}

// ─── Deterministic variation ──────────────────────────────────────────────

function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const bucket = (seed: number, n: number): number => Math.min(n - 1, Math.max(0, Math.floor(seed * n)));
/** A second, decorrelated [0,1) value derived from the seed. */
const seed2 = (seed: number): number => {
  const v = Math.sin(seed * 12.9898 + 4.1414) * 43758.5453;
  return v - Math.floor(v);
};

// ─── Unit-space geometry builders ─────────────────────────────────────────

/** Scalloped circle (canopy). */
function scallop(n: number, amp: number, phase: number, wobble: (a: number) => number): Path2D {
  const p = new Path2D();
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    const r = (1 - amp + amp * Math.sqrt(Math.abs(Math.sin((n * a) / 2 + phase)))) * wobble(a);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

/** Serrated star (conifer layer); teeth are rounded points. */
function serrated(p: Path2D, n: number, inner: number, ctrl: number, rot: number, s: number, cx = 0, cy = 0): void {
  const step = TAU / n;
  const v0 = rot + step / 2;
  p.moveTo(cx + Math.cos(v0) * inner * s, cy + Math.sin(v0) * inner * s);
  for (let i = 1; i <= n; i++) {
    const tip = rot + i * step;
    const v = tip + step / 2;
    p.quadraticCurveTo(cx + Math.cos(tip) * ctrl * s, cy + Math.sin(tip) * ctrl * s, cx + Math.cos(v) * inner * s, cy + Math.sin(v) * inner * s);
  }
  p.closePath();
}

/** Rounded irregular polygon (rock). */
function roundedPoly(r: () => number, n: number, jitter: number, sx = 1, sy = 1): Path2D {
  const xs: number[] = [];
  const ys: number[] = [];
  const off = r() * TAU;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * TAU + (r() - 0.5) * 0.5;
    const rad = 1 - jitter + r() * jitter;
    xs.push(Math.cos(a) * rad * sx);
    ys.push(Math.sin(a) * rad * sy);
  }
  const p = new Path2D();
  const mx = (i: number): number => (xs[i % n]! + xs[(i + 1) % n]!) / 2;
  const my = (i: number): number => (ys[i % n]! + ys[(i + 1) % n]!) / 2;
  p.moveTo(mx(n - 1), my(n - 1));
  for (let i = 0; i < n; i++) p.quadraticCurveTo(xs[i]!, ys[i]!, mx(i), my(i));
  p.closePath();
  return p;
}

function disc(p: Path2D, x: number, y: number, r: number): void {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, TAU);
}

/** Capsule from (0,0) out to length l at angle a, half-width hw (unioned by nonzero fill). */
function capsule(p: Path2D, a: number, l: number, hw: number, x0 = 0, y0 = 0): void {
  const ex = x0 + Math.cos(a) * l;
  const ey = y0 + Math.sin(a) * l;
  p.moveTo(ex + Math.cos(a - Math.PI / 2) * hw, ey + Math.sin(a - Math.PI / 2) * hw);
  p.arc(ex, ey, hw, a - Math.PI / 2, a + Math.PI / 2);
  p.arc(x0, y0, hw, a + Math.PI / 2, a + Math.PI * 1.5);
  p.closePath();
}

// ─── Per-kind caches ──────────────────────────────────────────────────────

interface TreeGeo {
  canopy: Path2D;
  inner: Path2D;
  hi: Path2D;
}
interface RockGeo {
  body: Path2D;
  facet: Path2D;
}
interface BushGeo {
  body: Path2D;
  hi: Path2D;
}
interface PineGeo {
  l0: Path2D;
  l1: Path2D;
  l2: Path2D;
  s0: Path2D;
  s1: Path2D;
  s2: Path2D;
}
interface CactusGeo {
  shadow: Path2D;
  body: Path2D;
  top: Path2D;
  tips: Path2D;
  ribs: Path2D;
  flowersA: Path2D;
  flowersB: Path2D;
  barrel: boolean;
}
interface PalmGeo {
  back: Path2D;
  front: Path2D;
  ribs: Path2D;
  all: Path2D;
}
interface EmberGeo {
  body: Path2D;
  facet: Path2D;
  cracks: Path2D;
  hot: Path2D;
}

const treeCache: TreeGeo[] = [];
const rockCache: RockGeo[] = [];
const bushCache: BushGeo[] = [];
const pineCache: PineGeo[] = [];
const cactusCache: CactusGeo[] = [];
const palmCache: PalmGeo[] = [];
const emberCache: EmberGeo[] = [];

function treeGeo(v: number): TreeGeo {
  let g = treeCache[v];
  if (g) return g;
  const r = rng(101 + v * 7);
  const n = 7 + v;
  const ph = r() * 3;
  const wob = (a: number): number => 1 + 0.035 * Math.sin(a * 2 + v) + 0.025 * Math.sin(a * 3 + ph);
  const canopy = scallop(n, 0.1, ph, wob);
  const inner = new Path2D();
  inner.addPath(scallop(n - 2, 0.14, ph + 1, wob), { a: 0.6, b: 0, c: 0, d: 0.6, e: -0.18, f: -0.2 });
  const hi = new Path2D();
  hi.addPath(scallop(5, 0.16, ph + 2, wob), { a: 0.27, b: 0, c: 0, d: 0.27, e: -0.3, f: -0.34 });
  g = { canopy, inner, hi };
  treeCache[v] = g;
  return g;
}

function rockGeo(v: number): RockGeo {
  let g = rockCache[v];
  if (g) return g;
  const r = rng(211 + v * 13);
  const sx = 1 + (v % 2) * 0.08;
  const sy = 0.88 + (v % 3) * 0.05;
  const body = roundedPoly(r, 6 + (v % 3), 0.22, sx, sy);
  const facet = new Path2D();
  facet.addPath(roundedPoly(r, 5 + (v % 2), 0.25, sx, sy), { a: 0.58, b: 0, c: 0, d: 0.54, e: -0.2, f: -0.24 });
  g = { body, facet };
  rockCache[v] = g;
  return g;
}

function bushGeo(v: number): BushGeo {
  let g = bushCache[v];
  if (g) return g;
  const r = rng(307 + v * 5);
  const count = 3 + (v % 2);
  const off = r() * TAU;
  const body = new Path2D();
  const hi = new Path2D();
  for (let i = 0; i < count; i++) {
    const a = off + (i / count) * TAU + (r() - 0.5) * 0.4;
    const d = 0.4 + r() * 0.08;
    const rr = 0.56 + r() * 0.1;
    const cx = Math.cos(a) * d;
    const cy = Math.sin(a) * d;
    disc(body, cx, cy, rr);
    disc(hi, cx - rr * 0.28, cy - rr * 0.3, rr * 0.36);
  }
  disc(body, 0, 0, 0.5);
  g = { body, hi };
  bushCache[v] = g;
  return g;
}

function pineGeo(v: number): PineGeo {
  let g = pineCache[v];
  if (g) return g;
  const n = 9 + v;
  const rot = v * 0.37;
  const half = Math.PI / n;
  const l0 = new Path2D();
  serrated(l0, n, 0.74, 1.24, rot, 1);
  const l1 = new Path2D();
  serrated(l1, n - 2, 0.7, 1.26, rot + half, 0.66, -0.04, -0.05);
  const l2 = new Path2D();
  serrated(l2, n - 4, 0.66, 1.3, rot, 0.36, -0.07, -0.09);
  // Snow: the same layers shrunk toward the upper-left, so a green crescent
  // remains on the lee (bottom-right) side of every tier.
  const s0 = new Path2D();
  serrated(s0, n, 0.7, 1.22, rot, 0.86, -0.07, -0.08);
  const s1 = new Path2D();
  serrated(s1, n - 2, 0.66, 1.22, rot + half, 0.55, -0.09, -0.11);
  const s2 = new Path2D();
  serrated(s2, n - 4, 0.64, 1.24, rot, 0.28, -0.1, -0.12);
  g = { l0, l1, l2, s0, s1, s2 };
  pineCache[v] = g;
  return g;
}

function cactusGeo(v: number): CactusGeo {
  let g = cactusCache[v];
  if (g) return g;
  const r = rng(401 + v * 11);
  const body = new Path2D();
  const top = new Path2D();
  const tips = new Path2D();
  const ribs = new Path2D();
  const flowersA = new Path2D();
  const flowersB = new Path2D();
  let barrel = false;
  if (v < 2) {
    // Saguaro: trunk crown + 2–3 arms reaching out and up.
    const arms = v === 0 ? 2 : 3;
    const off = r() * TAU;
    for (let i = 0; i < arms; i++) {
      const a = off + (i / arms) * TAU + (r() - 0.5) * 0.7;
      const l = 0.7 + r() * 0.24;
      capsule(body, a, l, 0.2);
      const tx = Math.cos(a) * l;
      const ty = Math.sin(a) * l;
      disc(tips, tx, ty, 0.2);
      disc(top, tx - 0.04, ty - 0.05, 0.13);
      ribs.moveTo(Math.cos(a) * 0.5, Math.sin(a) * 0.5);
      ribs.lineTo(tx - Math.cos(a) * 0.2, ty - Math.sin(a) * 0.2);
    }
    disc(body, 0, 0, 0.5);
    disc(top, -0.05, -0.06, 0.4);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ribs.moveTo(Math.cos(a) * 0.12, Math.sin(a) * 0.12);
      ribs.lineTo(Math.cos(a) * 0.46, Math.sin(a) * 0.46);
    }
    if (v === 1) {
      disc(flowersA, 0.05, -0.14, 0.075);
      disc(flowersB, -0.15, 0.06, 0.065);
      disc(flowersA, 0.12, 0.12, 0.055);
    }
  } else {
    barrel = true;
    const pots: [number, number, number][] =
      v === 2
        ? [[0, 0, 0.82]]
        : [
            [-0.3, -0.2, 0.56],
            [0.42, 0.12, 0.42],
            [-0.12, 0.56, 0.32],
          ];
    for (const [cx, cy, rr] of pots) {
      disc(body, cx, cy, rr);
      disc(top, cx - rr * 0.09, cy - rr * 0.1, rr * 0.8);
      const ribsN = rr > 0.6 ? 14 : 10;
      for (let i = 0; i < ribsN; i++) {
        const a = (i / ribsN) * TAU;
        ribs.moveTo(cx + Math.cos(a) * rr * 0.18, cy + Math.sin(a) * rr * 0.18);
        ribs.lineTo(cx + Math.cos(a) * rr * 0.93, cy + Math.sin(a) * rr * 0.93);
      }
      // Crown of tiny flowers.
      const fl = rr > 0.6 ? 6 : 4;
      for (let i = 0; i < fl; i++) {
        const a = (i / fl) * TAU + r();
        const target = i % 2 === 0 ? flowersA : flowersB;
        disc(target, cx + Math.cos(a) * rr * 0.17, cy + Math.sin(a) * rr * 0.17, rr * 0.09);
      }
    }
  }
  g = { shadow: body, body, top, tips, ribs, flowersA, flowersB, barrel };
  cactusCache[v] = g;
  return g;
}

/**
 * One pinnate frond along +x: a curved spine with a tapered, saw-toothed
 * half-width profile so the edge reads as leaflets.
 */
function frond(p: Path2D, a: number, len: number, w: number, bend: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const N = 16;
  const teeth = 7;
  const pt = (t: number, side: number): [number, number] => {
    const sx = 0.06 + t * (len - 0.06);
    const sy = bend * t * t;
    // Spine normal (derivative of the spine curve).
    const dx = len - 0.06;
    const dy = 2 * bend * t;
    const dl = Math.hypot(dx, dy);
    const nx = -dy / dl;
    const ny = dx / dl;
    const saw = 1 - 0.38 * ((t * teeth + (side > 0 ? 0.5 : 0)) % 1);
    const hw = w * Math.sin(Math.PI * Math.pow(t, 0.75)) * (t > 0.08 ? saw : 1);
    const x = sx + nx * hw * side;
    const y = sy + ny * hw * side;
    return [x * c - y * s, x * s + y * c];
  };
  const [x0, y0] = pt(0, 1);
  p.moveTo(x0, y0);
  for (let i = 1; i <= N; i++) {
    const [x, y] = pt(i / N, 1);
    p.lineTo(x, y);
  }
  for (let i = N - 1; i >= 0; i--) {
    const [x, y] = pt(i / N, -1);
    p.lineTo(x, y);
  }
  p.closePath();
}

function palmGeo(v: number): PalmGeo {
  let g = palmCache[v];
  if (g) return g;
  const r = rng(503 + v * 17);
  const n = 6 + (v % 3);
  const off = r() * TAU;
  const back = new Path2D();
  const front = new Path2D();
  const ribs = new Path2D();
  const all = new Path2D();
  for (let i = 0; i < n * 2; i++) {
    const isBack = i % 2 === 0;
    const k = isBack ? i / 2 : (i - 1) / 2;
    const a = off + (k / n) * TAU + (isBack ? 0 : Math.PI / n) + (r() - 0.5) * 0.25;
    if (!isBack && k % 2 === 1 && n > 6) continue;
    const len = isBack ? 0.94 + r() * 0.08 : 0.74 + r() * 0.12;
    const w = isBack ? 0.2 : 0.17;
    const bend = (isBack ? 0.16 : 0.12) + r() * 0.08;
    frond(isBack ? back : front, a, len, w, bend);
    frond(all, a, len, w, bend);
    const c = Math.cos(a);
    const s = Math.sin(a);
    ribs.moveTo(c * 0.1, s * 0.1);
    const mx = 0.06 + (len - 0.06) * 0.5;
    const my = 0;
    const ex = len * 0.92;
    const ey = bend * 0.85;
    ribs.quadraticCurveTo(mx * c - my * s, mx * s + my * c, ex * c - ey * s, ex * s + ey * c);
  }
  g = { back, front, ribs, all };
  palmCache[v] = g;
  return g;
}

function emberGeo(v: number): EmberGeo {
  let g = emberCache[v];
  if (g) return g;
  const r = rng(601 + v * 19);
  const body = roundedPoly(r, 7 + (v % 2), 0.2, 1.02, 0.92);
  const facet = new Path2D();
  facet.addPath(roundedPoly(r, 6, 0.24, 1, 0.9), { a: 0.55, b: 0, c: 0, d: 0.52, e: -0.2, f: -0.22 });
  const cracks = new Path2D();
  const hot = new Path2D();
  const jx = (r() - 0.5) * 0.3;
  const jy = (r() - 0.5) * 0.3;
  const branches = 3 + (v % 2);
  const off = r() * TAU;
  for (let i = 0; i < branches; i++) {
    let a = off + (i / branches) * TAU + (r() - 0.5) * 0.6;
    let x = jx;
    let y = jy;
    cracks.moveTo(x, y);
    const segs = 3;
    const reach = 0.62 + r() * 0.18;
    for (let s = 0; s < segs; s++) {
      a += (r() - 0.5) * 0.9;
      const d = reach / segs;
      x += Math.cos(a) * d;
      y += Math.sin(a) * d;
      cracks.lineTo(x, y);
      if (s === 1 && r() > 0.4) {
        const b = a + (r() > 0.5 ? 1 : -1) * (0.7 + r() * 0.4);
        cracks.lineTo(x + Math.cos(b) * 0.22, y + Math.sin(b) * 0.22);
        cracks.moveTo(x, y);
      }
    }
  }
  disc(hot, jx, jy, 0.1);
  g = { body, facet, cracks, hot };
  emberCache[v] = g;
  return g;
}

// ─── Buildings ────────────────────────────────────────────────────────────

interface Block {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Wall height in unit space (oblique offset toward +x,+y). */
  h: number;
}
interface BuildingGeo {
  blocks: Block[];
  ground: Path2D;
  wallsR: Path2D[];
  wallsB: Path2D[];
  roofs: Path2D[];
  roofInner: Path2D[];
  detailShadow: Path2D;
  detail: Path2D;
  detailTop: Path2D;
  detailDark: Path2D;
}
const buildingCache: BuildingGeo[] = [];

type Detail =
  | { t: 'ac'; x: number; y: number; w: number; h: number }
  | { t: 'tank'; x: number; y: number; r: number }
  | { t: 'hut'; x: number; y: number; w: number; h: number };

const BUILDING_PLANS: { blocks: Block[]; details: Detail[] }[] = [
  {
    blocks: [{ x0: -0.92, y0: -0.86, x1: 0.84, y1: 0.86, h: 0.44 }],
    details: [
      { t: 'ac', x: -0.52, y: -0.5, w: 0.26, h: 0.2 },
      { t: 'ac', x: -0.52, y: -0.16, w: 0.26, h: 0.2 },
      { t: 'tank', x: 0.38, y: 0.38, r: 0.18 },
      { t: 'hut', x: 0.18, y: -0.46, w: 0.36, h: 0.28 },
    ],
  },
  {
    blocks: [
      { x0: 0.12, y0: -0.2, x1: 0.94, y1: 0.9, h: 0.24 },
      { x0: -0.94, y0: -0.92, x1: 0.12, y1: 0.9, h: 0.52 },
    ],
    details: [
      { t: 'ac', x: -0.6, y: -0.6, w: 0.24, h: 0.2 },
      { t: 'tank', x: -0.38, y: 0.42, r: 0.16 },
      { t: 'ac', x: 0.5, y: 0.12, w: 0.22, h: 0.18 },
      { t: 'ac', x: 0.5, y: 0.44, w: 0.22, h: 0.18 },
    ],
  },
  {
    blocks: [
      { x0: -0.94, y0: -0.94, x1: 0.94, y1: 0.94, h: 0.14 },
      { x0: -0.58, y0: -0.66, x1: 0.42, y1: 0.46, h: 0.5 },
    ],
    details: [
      { t: 'tank', x: -0.16, y: -0.2, r: 0.17 },
      { t: 'ac', x: 0.12, y: 0.12, w: 0.2, h: 0.16 },
      { t: 'ac', x: 0.66, y: 0.66, w: 0.2, h: 0.16 },
    ],
  },
  {
    blocks: [
      { x0: 0.08, y0: -0.7, x1: 0.94, y1: 0.94, h: 0.28 },
      { x0: -0.94, y0: -0.92, x1: -0.06, y1: 0.82, h: 0.46 },
    ],
    details: [
      { t: 'ac', x: -0.5, y: -0.54, w: 0.24, h: 0.2 },
      { t: 'hut', x: -0.5, y: 0.32, w: 0.34, h: 0.3 },
      { t: 'tank', x: 0.52, y: -0.3, r: 0.15 },
      { t: 'ac', x: 0.5, y: 0.4, w: 0.24, h: 0.18 },
    ],
  },
];

function rectPoly(p: Path2D, pts: readonly number[]): void {
  p.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i]!, pts[i + 1]!);
  p.closePath();
}

/** v in 0..7: plan v&3, transposed when v ≥ 4 (a 90° turn of the footprint). */
function buildingGeo(v: number): BuildingGeo {
  let g = buildingCache[v];
  if (g) return g;
  const plan = BUILDING_PLANS[v & 3]!;
  const flip = v >= 4;
  const blocks: Block[] = plan.blocks.map((b) =>
    flip ? { x0: b.y0, y0: b.x0, x1: b.y1, y1: b.x1, h: b.h } : { ...b },
  );
  const ground = new Path2D();
  const wallsR: Path2D[] = [];
  const wallsB: Path2D[] = [];
  const roofs: Path2D[] = [];
  const roofInner: Path2D[] = [];
  for (const b of blocks) {
    const d = b.h * 1.9;
    rectPoly(ground, [b.x0, b.y0, b.x1, b.y0, b.x1 + d, b.y0 + d, b.x1 + d, b.y1 + d, b.x0 + d, b.y1 + d, b.x0, b.y1]);
    const s = b.h;
    const wr = new Path2D();
    rectPoly(wr, [b.x1, b.y0, b.x1 + s, b.y0 + s, b.x1 + s, b.y1 + s, b.x1, b.y1]);
    const wb = new Path2D();
    rectPoly(wb, [b.x0, b.y1, b.x1, b.y1, b.x1 + s, b.y1 + s, b.x0 + s, b.y1 + s]);
    wallsR.push(wr);
    wallsB.push(wb);
    const rf = new Path2D();
    rf.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    roofs.push(rf);
    const ri = new Path2D();
    const inset = 0.055;
    ri.rect(b.x0 + inset, b.y0 + inset, b.x1 - b.x0 - inset * 2, b.y1 - b.y0 - inset * 2);
    roofInner.push(ri);
  }
  const detailShadow = new Path2D();
  const detail = new Path2D();
  const detailTop = new Path2D();
  const detailDark = new Path2D();
  for (const d0 of plan.details) {
    const x = flip ? d0.y : d0.x;
    const y = flip ? d0.x : d0.y;
    if (d0.t === 'tank') {
      disc(detailShadow, x + 0.07, y + 0.09, d0.r);
      disc(detail, x, y, d0.r);
      disc(detailTop, x - 0.02, y - 0.02, d0.r * 0.72);
      disc(detailDark, x - 0.02, y - 0.02, d0.r * 0.18);
    } else {
      const w = flip ? d0.h : d0.w;
      const h = flip ? d0.w : d0.h;
      const hx = x - w / 2;
      const hy = y - h / 2;
      const sh = d0.t === 'hut' ? 0.11 : 0.06;
      detailShadow.roundRect(hx + sh, hy + sh, w, h, 0.02);
      detail.roundRect(hx, hy, w, h, 0.025);
      detailTop.roundRect(hx + 0.025, hy + 0.025, w - 0.05, h - 0.05, 0.02);
      if (d0.t === 'ac') {
        const fr = Math.min(w, h) * 0.3;
        disc(detailDark, x + w * 0.12, y, fr);
      } else {
        detailDark.rect(hx + w * 0.62, hy + h * 0.2, w * 0.24, h * 0.6);
      }
    }
  }
  g = { blocks, ground, wallsR, wallsB, roofs, roofInner, detailShadow, detail, detailTop, detailDark };
  buildingCache[v] = g;
  return g;
}

// ─── Glow sprites (baked once) ────────────────────────────────────────────

type Sprite = HTMLCanvasElement;
const sprites = new Map<string, Sprite>();

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Radial soft glow, colour (r,g,b), alpha falls off smoothly to 0 at the rim. */
function radialSprite(r: number, g: number, b: number): Sprite {
  const key = `r${r},${g},${b}`;
  let s = sprites.get(key);
  if (s) return s;
  const N = 64;
  s = makeCanvas(N, N);
  const cx = s.getContext('2d');
  if (cx) {
    const img = cx.createImageData(N, N);
    const d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5 - N / 2) / (N / 2);
        const dy = (y + 0.5 - N / 2) / (N / 2);
        const q = Math.sqrt(dx * dx + dy * dy);
        const t = clamp01(1 - q);
        const a = t * t * (3 - 2 * t) * (0.55 + 0.45 * Math.exp(-q * q * 9));
        const i = (y * N + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = Math.round(a * 255);
      }
    }
    cx.putImageData(img, 0, 0);
  }
  sprites.set(key, s);
  return s;
}

/**
 * Headlight cone pointing toward −y with its apex at the bottom-centre.
 * Drawn into a dest rect of (w × len) whose bottom-centre is the lamp.
 */
function coneSprite(): Sprite {
  const key = 'cone';
  let s = sprites.get(key);
  if (s) return s;
  const W = 96;
  const H = 192;
  s = makeCanvas(W, H);
  const cx = s.getContext('2d');
  if (cx) {
    const img = cx.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      const v = (H - (y + 0.5)) / H; // 0 at lamp, 1 at far end
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5 - W / 2) / (W / 2);
        const spread = 0.07 + v * 0.93;
        const ang = Math.abs(u) / spread;
        const at = clamp01(1 - ang);
        const angular = at * at * (3 - 2 * at);
        const far = clamp01(1 - v);
        const dist = Math.pow(far, 1.5) * clamp01(v * 10 + 0.15);
        const hot = Math.exp(-(v * v) * 90) * Math.exp(-u * u * 60) * 0.5;
        const a = clamp01(angular * dist * 0.85 + hot);
        const i = (y * W + x) * 4;
        d[i] = 255;
        d[i + 1] = 241;
        d[i + 2] = 218;
        d[i + 3] = Math.round(a * 255);
      }
    }
    cx.putImageData(img, 0, 0);
  }
  sprites.set(key, s);
  return s;
}

function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, rx: number, ry: number, alpha: number): void {
  if (alpha <= 0.002) return;
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(s, x - rx, y - ry, rx * 2, ry * 2);
}

// ─── Prop drawing ─────────────────────────────────────────────────────────

/** Two-layer soft contact shadow of a unit path, offset in world px. */
function shadowOf(
  ctx: CanvasRenderingContext2D,
  T: Tones,
  path: Path2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  ox: number,
  oy: number,
): void {
  ctx.save();
  ctx.translate(x + ox, y + oy);
  ctx.rotate(rot);
  ctx.scale(r * 1.07, r * 1.07);
  ctx.fillStyle = T.shadeA;
  ctx.fill(path);
  ctx.restore();
  ctx.save();
  ctx.translate(x + ox * 0.8, y + oy * 0.8);
  ctx.rotate(rot);
  ctx.scale(r * 0.97, r * 0.97);
  ctx.fillStyle = T.shadeB;
  ctx.fill(path);
  ctx.restore();
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, T: Tones): void {
  const g = treeGeo(bucket(seed, 4));
  const rot = seed2(seed) * TAU;
  shadowOf(ctx, T, g.canopy, x, y, r, rot, r * 0.26, r * 0.4);
  ctx.translate(x, y);
  ctx.scale(r, r);
  // Rim: the canopy in a deeper tone, then the body shifted up-left over it.
  ctx.save();
  ctx.rotate(rot);
  ctx.fillStyle = T.deep;
  ctx.fill(g.canopy);
  ctx.restore();
  ctx.save();
  ctx.translate(-0.045, -0.055);
  ctx.scale(0.965, 0.965);
  ctx.rotate(rot);
  ctx.fillStyle = T.prop;
  ctx.fill(g.canopy);
  ctx.restore();
  ctx.fillStyle = T.alt;
  ctx.fill(g.inner);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = T.alt2;
  ctx.fill(g.hi);
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, T: Tones): void {
  const g = rockGeo(bucket(seed, 4));
  const rot = (seed2(seed) - 0.5) * 1.4;
  shadowOf(ctx, T, g.body, x, y, r, rot, r * 0.22, r * 0.32);
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.save();
  ctx.rotate(rot);
  ctx.fillStyle = T.rockDeep;
  ctx.fill(g.body);
  ctx.restore();
  ctx.translate(-0.05, -0.06);
  ctx.scale(0.95, 0.95);
  ctx.rotate(rot);
  ctx.fillStyle = T.alt;
  ctx.fill(g.body);
  ctx.fillStyle = T.rockHi;
  ctx.fill(g.facet);
}

function drawBush(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, T: Tones): void {
  const g = bushGeo(bucket(seed, 4));
  const rot = seed2(seed) * TAU;
  shadowOf(ctx, T, g.body, x, y, r, rot, r * 0.2, r * 0.3);
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.save();
  ctx.rotate(rot);
  ctx.fillStyle = T.deep;
  ctx.fill(g.body);
  ctx.restore();
  ctx.translate(-0.05, -0.06);
  ctx.scale(0.94, 0.94);
  ctx.rotate(rot);
  ctx.fillStyle = T.prop;
  ctx.fill(g.body);
  ctx.rotate(-rot);
  ctx.translate(0.02, 0.02);
  ctx.rotate(rot);
  ctx.fillStyle = T.alt;
  ctx.fill(g.hi);
}

function drawPine(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, T: Tones, snow: boolean): void {
  const g = pineGeo(bucket(seed, 4));
  const rot = seed2(seed) * TAU;
  shadowOf(ctx, T, g.l0, x, y, r, rot, r * 0.3, r * 0.44);
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.rotate(rot);
  if (!snow) {
    ctx.fillStyle = T.pine0;
    ctx.fill(g.l0);
    ctx.fillStyle = T.pine1;
    ctx.fill(g.l1);
    ctx.fillStyle = T.pine2;
    ctx.fill(g.l2);
    ctx.fillStyle = T.pineCore;
    ctx.beginPath();
    ctx.arc(-0.08, -0.1, 0.075, 0, TAU);
    ctx.fill();
    return;
  }
  // Snow-laden: snow tiers sit up-left of each green tier, the deeper ring
  // keeps the silhouette crisp on a light, snowy ground.
  ctx.fillStyle = T.snowRing;
  ctx.fill(g.l0);
  ctx.save();
  ctx.translate(-0.03, -0.035);
  ctx.scale(0.96, 0.96);
  ctx.fillStyle = T.pine0;
  ctx.fill(g.l0);
  ctx.restore();
  ctx.fillStyle = T.snowSoft;
  ctx.fill(g.s0);
  ctx.fillStyle = T.pine0;
  ctx.fill(g.l1);
  ctx.fillStyle = T.snow;
  ctx.fill(g.s1);
  ctx.fillStyle = T.pine1;
  ctx.fill(g.l2);
  ctx.fillStyle = T.snow;
  ctx.fill(g.s2);
}

function drawCactus(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, T: Tones): void {
  const g = cactusGeo(bucket(seed, 4));
  const rot = seed2(seed) * TAU;
  shadowOf(ctx, T, g.shadow, x, y, r, rot, r * 0.24, r * 0.36);
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.save();
  ctx.rotate(rot);
  ctx.fillStyle = T.cacDeep;
  ctx.fill(g.body);
  ctx.restore();
  ctx.translate(-0.03, -0.035);
  ctx.rotate(rot);
  ctx.fillStyle = T.cac0;
  ctx.fill(g.body);
  ctx.fillStyle = T.cac1;
  ctx.fill(g.tips);
  ctx.fill(g.top);
  ctx.strokeStyle = T.cacRib;
  ctx.lineWidth = g.barrel ? 0.035 : 0.03;
  ctx.lineCap = 'round';
  ctx.stroke(g.ribs);
  if (!g.barrel) {
    ctx.fillStyle = T.cac2;
    ctx.beginPath();
    ctx.arc(-0.06, -0.07, 0.1, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = T.flowerA;
  ctx.fill(g.flowersA);
  ctx.fillStyle = T.flowerB;
  ctx.fill(g.flowersB);
}

function drawPalm(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, o: PropDrawOptions, T: Tones): void {
  const g = palmGeo(bucket(seed, 4));
  const base = seed2(seed) * TAU;
  const sway = Math.sin(o.time * 1.1 + seed * 40) * 0.05 + Math.sin(o.time * 0.47 + seed * 13) * 0.03;
  const rot = base + sway;
  const dx = Math.sin(o.time * 0.9 + seed * 20) * r * 0.025;
  // Tall: the crown's shadow lands well away, joined by a faint trunk shadow.
  const sx = r * 0.55;
  const sy = r * 0.8;
  ctx.save();
  ctx.strokeStyle = T.shadeA;
  ctx.lineWidth = Math.max(1, r * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + r * 0.05, y + r * 0.08);
  ctx.lineTo(x + sx, y + sy);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(x + dx + sx, y + sy);
  ctx.rotate(rot);
  ctx.scale(r * 1.02, r * 1.02);
  ctx.fillStyle = T.shadeB;
  ctx.fill(g.all);
  ctx.restore();
  ctx.translate(x + dx, y);
  ctx.scale(r, r);
  ctx.rotate(rot);
  ctx.fillStyle = T.palmBack;
  ctx.fill(g.back);
  ctx.fillStyle = T.palmFront;
  ctx.fill(g.front);
  ctx.strokeStyle = T.palmRib;
  ctx.lineWidth = 0.025;
  ctx.lineCap = 'round';
  ctx.stroke(g.ribs);
  ctx.fillStyle = T.nut;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.4;
    const cx = Math.cos(a) * 0.075;
    const cy = Math.sin(a) * 0.075;
    ctx.moveTo(cx + 0.07, cy);
    ctx.arc(cx, cy, 0.07, 0, TAU);
  }
  ctx.fill();
  ctx.fillStyle = T.nutHi;
  ctx.beginPath();
  ctx.arc(-0.03, -0.035, 0.035, 0, TAU);
  ctx.fill();
}

/** World-px window rhythm on building walls. */
const WIN_PERIOD = 5.6;
const WIN_LEN = 3.4;
/** Lit-window patterns as slot bitmasks (LSB first), 10 slots, repeat. */
const LIT_PATTERNS = [0b1101100101, 0b0110111001, 0b1011001110, 0b0011101101, 0b1110010011];
const LIT_SLOTS = 10;
const litDash: number[][] = LIT_PATTERNS.map(() => []);

/** Fills litDash[pi] with on/off runs (unit space) for the given pattern. */
function litPattern(pi: number, per: number, win: number): number[] {
  const out = litDash[pi]!;
  out.length = 0;
  const bits = LIT_PATTERNS[pi]!;
  let gap = 0;
  let first = -1;
  for (let i = 0; i < LIT_SLOTS; i++) {
    if ((bits >> i) & 1) {
      if (first < 0) first = i;
      else out.push(gap);
      out.push(win);
      gap = per - win;
    } else gap += per;
  }
  // Close the loop: trailing gap plus leading empty slots.
  out.push(gap + Math.max(0, first) * per);
  return out;
}

function buildingVariant(seed: number): number {
  return bucket(seed, 4) + (seed2(seed) > 0.5 ? 4 : 0);
}

/** Iterates the window floor lines of one block (unit space). */
function windowLines(
  b: Block,
  r: number,
  fn: (x0: number, y0: number, x1: number, y1: number, lw: number, floor: number, face: number) => void,
): void {
  const margin = 1.4 / r;
  const floors = Math.max(1, Math.min(5, Math.round((b.h * r) / 5.2)));
  const lw = (b.h / floors) * 0.42;
  for (let f = 0; f < floors; f++) {
    const t = ((f + 0.5) / floors) * b.h;
    // Right face (runs along y), bottom face (runs along x).
    fn(b.x1 + t, b.y0 + t + margin, b.x1 + t, b.y1 + t - margin, lw, f, 0);
    fn(b.x0 + t + margin, b.y1 + t, b.x1 + t - margin, b.y1 + t, lw, f, 1);
  }
}

function drawBuilding(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, T: Tones): void {
  const g = buildingGeo(buildingVariant(seed));
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.fillStyle = T.shadeB;
  ctx.fill(g.ground);
  ctx.lineCap = 'butt';
  // Blocks are ordered low → high, so a tower's walls land on its podium.
  for (let i = 0; i < g.blocks.length; i++) {
    const b = g.blocks[i]!;
    if (i > 0) {
      ctx.save();
      ctx.clip(g.roofInner[i - 1]!);
      ctx.translate(b.h * 0.9, b.h * 0.9);
      ctx.fillStyle = T.shadeB;
      ctx.fill(g.roofs[i]!);
      ctx.restore();
    }
    ctx.fillStyle = T.wallB;
    ctx.fill(g.wallsB[i]!);
    ctx.fillStyle = T.wallR;
    ctx.fill(g.wallsR[i]!);
    // Ribbon windows: quiet glass bands by day, individual lit panes at night.
    ctx.strokeStyle = T.glass;
    windowLines(b, r, (x0, y0, x1, y1, lw) => {
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    });
    // Bright parapet lip around a slightly deeper roof deck.
    ctx.fillStyle = T.roofEdge;
    ctx.fill(g.roofs[i]!);
    ctx.fillStyle = T.roof;
    ctx.fill(g.roofInner[i]!);
  }
  ctx.fillStyle = T.shadeB;
  ctx.fill(g.detailShadow);
  ctx.fillStyle = T.detail;
  ctx.fill(g.detail);
  ctx.fillStyle = T.detailTop;
  ctx.fill(g.detailTop);
  ctx.fillStyle = T.wallR;
  ctx.fill(g.detailDark);
}

/** Lamp geometry scale: designed at r = 8. */
const lampK = (r: number): number => Math.max(0.7, Math.min(1.6, r / 8));

function drawLamp(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, o: PropDrawOptions, T: Tones, ang: number): void {
  const k = lampK(r);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const arm = 13 * k;
  const hx = x + c * arm;
  const hy = y + s * arm;
  const tall = 15 * k;
  // Long pole shadow, then the arm + head shadow at the pole's tip.
  ctx.strokeStyle = T.shadeA;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + tall, y + tall);
  ctx.lineTo(hx + tall, hy + tall);
  ctx.stroke();
  ctx.save();
  ctx.translate(hx + tall, hy + tall);
  ctx.rotate(ang);
  ctx.fillStyle = T.shadeA;
  ctx.beginPath();
  ctx.roundRect(-3.4 * k, -1.7 * k, 6.8 * k, 3.4 * k, 1.6 * k);
  ctx.fill();
  ctx.restore();
  // Base plate + pole top.
  ctx.fillStyle = T.shadeB;
  ctx.beginPath();
  ctx.arc(x + 0.6 * k, y + 0.8 * k, 2.6 * k, 0, TAU);
  ctx.fill();
  ctx.fillStyle = T.pole;
  ctx.beginPath();
  ctx.arc(x, y, 2.3 * k, 0, TAU);
  ctx.fill();
  // Arm.
  ctx.strokeStyle = T.pole;
  ctx.lineWidth = 1.1 * k;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = T.poleTop;
  ctx.beginPath();
  ctx.arc(x, y, 1.2 * k, 0, TAU);
  ctx.fill();
  // Head with its lens.
  ctx.translate(hx, hy);
  ctx.rotate(ang);
  ctx.fillStyle = T.head;
  ctx.beginPath();
  ctx.roundRect(-3.4 * k, -1.7 * k, 6.8 * k, 3.4 * k, 1.6 * k);
  ctx.fill();
  const n = clamp01(o.night);
  ctx.fillStyle = `rgba(255,${(226 + 20 * n) | 0},${(170 + 40 * n) | 0},${(0.35 + 0.6 * n).toFixed(3)})`;
  ctx.beginPath();
  ctx.roundRect(-2.2 * k, -0.8 * k, 4.4 * k, 1.6 * k, 0.8 * k);
  ctx.fill();
}

function emberPulse(o: PropDrawOptions, seed: number): number {
  return 0.5 + 0.5 * Math.sin(o.time * 2.3 + seed * 37) * (0.75 + 0.25 * Math.sin(o.time * 5.1 + seed * 11));
}

function drawEmber(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, o: PropDrawOptions, T: Tones): void {
  const g = emberGeo(bucket(seed, 4));
  const rot = seed2(seed) * TAU;
  shadowOf(ctx, T, g.body, x, y, r, rot, r * 0.22, r * 0.32);
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.save();
  ctx.rotate(rot);
  ctx.fillStyle = T.emberDeep;
  ctx.fill(g.body);
  ctx.restore();
  ctx.translate(-0.045, -0.055);
  ctx.scale(0.95, 0.95);
  ctx.rotate(rot);
  ctx.fillStyle = T.ember0;
  ctx.fill(g.body);
  ctx.fillStyle = T.ember1;
  ctx.fill(g.facet);
  const p = emberPulse(o, seed);
  ctx.clip(g.body);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(96,26,12,0.9)';
  ctx.lineWidth = 0.15;
  ctx.stroke(g.cracks);
  ctx.strokeStyle = `rgba(255,${(108 + 40 * p) | 0},44,${(0.7 + 0.3 * p).toFixed(3)})`;
  ctx.lineWidth = 0.06;
  ctx.stroke(g.cracks);
  ctx.fillStyle = `rgba(255,${(150 + 60 * p) | 0},96,${(0.75 + 0.25 * p).toFixed(3)})`;
  ctx.fill(g.hot);
}

/** Base pass (normal compositing). */
export function drawProp(
  ctx: CanvasRenderingContext2D,
  kind: PropKind,
  x: number,
  y: number,
  r: number,
  seed: number,
  o: PropDrawOptions,
  lampAngle?: number,
): void {
  const T = getTones(o.pal);
  ctx.save();
  switch (kind) {
    case 'tree':
      drawTree(ctx, x, y, r, seed, T);
      break;
    case 'rock':
      drawRock(ctx, x, y, r, seed, T);
      break;
    case 'bush':
      drawBush(ctx, x, y, r, seed, T);
      break;
    case 'pine':
      drawPine(ctx, x, y, r, seed, T, false);
      break;
    case 'snowpine':
      drawPine(ctx, x, y, r, seed, T, true);
      break;
    case 'cactus':
      drawCactus(ctx, x, y, r, seed, T);
      break;
    case 'palm':
      drawPalm(ctx, x, y, r, seed, o, T);
      break;
    case 'building':
      drawBuilding(ctx, x, y, r, seed, T);
      break;
    case 'lamp':
      drawLamp(ctx, x, y, r, o, T, lampAngle ?? 0);
      break;
    case 'ember':
      drawEmber(ctx, x, y, r, seed, o, T);
      break;
  }
  ctx.restore();
}

const WARM = 'rgba(255,190,118,';
const COOL = 'rgba(176,206,255,';

/** Additive light pass ('lighter' set by the caller). */
export function drawPropLight(
  ctx: CanvasRenderingContext2D,
  kind: PropKind,
  x: number,
  y: number,
  r: number,
  seed: number,
  o: PropDrawOptions,
  lampAngle?: number,
): void {
  const n = clamp01(o.night);
  if (n <= 0.001) return;
  if (kind === 'lamp') {
    const ang = lampAngle ?? 0;
    const k = lampK(r);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const hx = x + c * 13 * k;
    const hy = y + s * 13 * k;
    const flick = seed > 0.92 ? 0.78 + 0.22 * Math.abs(Math.sin(o.time * 23 + seed * 90) * Math.sin(o.time * 7.3)) : 1;
    ctx.save();
    // Pool on the road side of the head.
    blit(ctx, radialSprite(255, 180, 104), hx + c * 12, hy + s * 12, 62, 62, 0.62 * n * flick);
    blit(ctx, radialSprite(255, 214, 160), hx + c * 5, hy + s * 5, 28, 28, 0.42 * n * flick);
    blit(ctx, radialSprite(255, 246, 228), hx, hy, 7 * k, 7 * k, 0.95 * n * flick);
    ctx.restore();
    return;
  }
  if (kind === 'ember') {
    const p = emberPulse(o, seed);
    const g = emberGeo(bucket(seed, 4));
    ctx.save();
    blit(ctx, radialSprite(255, 98, 36), x, y, r * 2.6, r * 2.6, (0.28 + 0.24 * p) * n);
    ctx.globalAlpha = 1;
    ctx.translate(x - 0.045 * r, y - 0.055 * r);
    ctx.scale(r * 0.95, r * 0.95);
    ctx.rotate(seed2(seed) * TAU);
    ctx.clip(g.body);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(255,110,40,${(0.35 * n * (0.6 + 0.4 * p)).toFixed(3)})`;
    ctx.lineWidth = 0.22;
    ctx.stroke(g.cracks);
    ctx.strokeStyle = `rgba(255,200,120,${(0.5 * n * (0.5 + 0.5 * p)).toFixed(3)})`;
    ctx.lineWidth = 0.05;
    ctx.stroke(g.cracks);
    ctx.restore();
    return;
  }
  if (kind === 'building') {
    const g = buildingGeo(buildingVariant(seed));
    ctx.save();
    blit(ctx, radialSprite(255, 176, 104), x + r * 0.3, y + r * 0.3, r * 1.7, r * 1.7, 0.07 * n);
    ctx.globalAlpha = 1;
    ctx.translate(x, y);
    ctx.scale(r, r);
    ctx.lineCap = 'butt';
    const per = WIN_PERIOD / r;
    const win = WIN_LEN / r;
    const h0 = Math.floor(seed * 9973);
    for (let bi = 0; bi < g.blocks.length; bi++) {
      windowLines(g.blocks[bi]!, r, (x0, y0, x1, y1, lw, floor, face) => {
        const hsh = (h0 + floor * 7 + face * 13 + bi * 29) % 97;
        const pi = hsh % LIT_PATTERNS.length;
        ctx.setLineDash(litPattern(pi, per, win));
        ctx.lineDashOffset = -((hsh >> 2) % LIT_SLOTS) * per;
        ctx.strokeStyle = (hsh % 3 !== 0 ? WARM : COOL) + (0.72 * n).toFixed(3) + ')';
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      });
    }
    ctx.restore();
  }
}

// ─── Traffic ──────────────────────────────────────────────────────────────

export const TRAFFIC_STYLES: TrafficStyle[] = [
  { name: 'sedan', length: 40, width: 20 },
  { name: 'hatchback', length: 36, width: 19 },
  { name: 'van', length: 48, width: 22 },
  { name: 'pickup', length: 50, width: 22 },
  { name: 'box truck', length: 72, width: 26 },
  { name: 'cab', length: 42, width: 20 },
];

export const TRAFFIC_PAINTS: string[] = [
  '#5E6B7A', // slate blue
  '#8B9097', // silver
  '#3F4B5E', // navy
  '#7D5A56', // rosewood
  '#5C7364', // sage
  '#A69677', // sand
  '#6A6783', // dusk violet
  '#4B5058', // graphite
  '#93714F', // ochre
  '#6B878B', // sea glass
];

interface TrafficGeo {
  body: Path2D;
  /** Whole-vehicle outline for the shadow sprite. */
  outline: Path2D;
  L: number;
  W: number;
  shadow: Sprite | null;
}

const trafficCache: TrafficGeo[] = [];

/** Symmetric body: right half [x,y] line / [cx,cy,x,y] quad segments, mirrored. */
function symBody(segs: readonly (readonly number[])[]): Path2D {
  const p = new Path2D();
  const s0 = segs[0]!;
  p.moveTo(s0[0]!, s0[1]!);
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.length === 2) p.lineTo(s[0]!, s[1]!);
    else p.quadraticCurveTo(s[0]!, s[1]!, s[2]!, s[3]!);
  }
  for (let i = segs.length - 1; i >= 1; i--) {
    const s = segs[i]!;
    const prev = segs[i - 1]!;
    const px = -prev[prev.length - 2]!;
    const py = prev[prev.length - 1]!;
    if (s.length === 2) p.lineTo(px, py);
    else p.quadraticCurveTo(-s[0]!, s[1]!, px, py);
  }
  p.closePath();
  return p;
}

function carBody(L: number, W: number, taper: number, rf: number, rr: number, y0 = -L / 2, y1 = L / 2): Path2D {
  const hw = W / 2;
  const hf = hw - taper;
  return symBody([
    [0, y0],
    [hf - rf, y0],
    [hf + taper * 0.3, y0, hw, y0 + rf + taper],
    [hw, y1 - rr],
    [hw, y1, hw - rr, y1],
    [0, y1],
  ]);
}

function trafficGeo(style: number): TrafficGeo {
  let g = trafficCache[style];
  if (g) return g;
  const st = TRAFFIC_STYLES[style]!;
  const L = st.length;
  const W = st.width;
  let body: Path2D;
  let outline: Path2D;
  switch (style) {
    case 1:
      body = carBody(L, W, 1.4, 5.6, 4.2);
      outline = body;
      break;
    case 2:
      body = carBody(L, W, 1.6, 5, 2.4);
      outline = body;
      break;
    case 3:
      body = carBody(L, W, 1.4, 5.2, 1.8);
      outline = body;
      break;
    case 4: {
      body = carBody(19, 24, 1.6, 4.6, 1.6, -36, -17);
      outline = new Path2D(body);
      outline.roundRect(-13, -16.5, 26, 52.5, 1.8);
      break;
    }
    default:
      body = carBody(L, W, 1.3, 5.2, 3.6);
      outline = body;
  }
  g = { body, outline, L, W, shadow: null };
  trafficCache[style] = g;
  return g;
}

const SHADOW_PAD = 8;
const SHADOW_RES = 2;

function trafficShadow(g: TrafficGeo): Sprite {
  if (g.shadow) return g.shadow;
  const w = Math.ceil((g.W + SHADOW_PAD * 2) * SHADOW_RES);
  const h = Math.ceil((g.L + SHADOW_PAD * 2) * SHADOW_RES);
  const c = makeCanvas(w, h);
  const cx = c.getContext('2d');
  if (cx) {
    cx.setTransform(SHADOW_RES, 0, 0, SHADOW_RES, w / 2, h / 2);
    cx.shadowColor = '#000';
    cx.shadowBlur = 5 * SHADOW_RES;
    cx.fillStyle = '#000';
    cx.save();
    cx.scale(0.96, 0.97);
    cx.fill(g.outline);
    cx.restore();
  }
  g.shadow = c;
  return c;
}

interface PaintTones {
  body: string;
  roof: string;
  dark: string;
  darker: string;
  box: string;
  boxTop: string;
  boxSeam: string;
}
const paintCache = new Map<string, PaintTones>();
let paintLight = false;

function paintTones(paint: string, light: boolean): PaintTones {
  if (light !== paintLight) {
    paintCache.clear();
    paintLight = light;
  }
  let t = paintCache.get(paint);
  if (t) return t;
  const c = hexRGBA(paint.startsWith('#') ? paint : '#808080');
  const neutral: RGBA = light ? [222, 218, 210, 1] : [138, 142, 149, 1];
  const box = mix(c, neutral, 0.8);
  t = {
    body: css(c),
    roof: css(mix(c, WHITE, 0.13)),
    dark: css(mix(c, BLACK, 0.3)),
    darker: css(mix(c, BLACK, 0.55)),
    box: css(box),
    boxTop: css(mix(box, WHITE, light ? 0.3 : 0.08)),
    boxSeam: css(mix(box, BLACK, 0.18)),
  };
  paintCache.set(paint, t);
  return t;
}

const GLASS = '#15181D';
const GLASS_SHINE = 'rgba(255,255,255,0.14)';
const TYRE = '#0A0B0D';

/** Local-frame direction of a world/screen direction (dx, dy), normalised. */
function localDir(ctx: CanvasRenderingContext2D, dx: number, dy: number): [number, number] {
  const m = ctx.getTransform();
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-9) return [dx, dy];
  const lx = (m.d * dx - m.c * dy) / det;
  const ly = (-m.b * dx + m.a * dy) / det;
  const len = Math.hypot(lx, ly) || 1;
  return [lx / len, ly / len];
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** Greenhouse (dark glass) with the roof panel inset over it. */
function cabin(
  ctx: CanvasRenderingContext2D,
  P: PaintTones,
  hw: number,
  gy0: number,
  gy1: number,
  ry0: number,
  ry1: number,
  rhw: number,
): void {
  ctx.fillStyle = GLASS;
  rr(ctx, -hw, gy0, hw * 2, gy1 - gy0, Math.min(3.2, hw * 0.4));
  ctx.strokeStyle = GLASS_SHINE;
  ctx.lineWidth = 0.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-hw * 0.55, gy0 + 1.4);
  ctx.quadraticCurveTo(0, gy0 + 0.7, hw * 0.55, gy0 + 1.4);
  ctx.stroke();
  ctx.fillStyle = P.roof;
  rr(ctx, -rhw, ry0, rhw * 2, ry1 - ry0, 2);
}

function mirrors(ctx: CanvasRenderingContext2D, P: PaintTones, hw: number, y: number): void {
  ctx.fillStyle = P.dark;
  rr(ctx, -hw - 1.6, y, 2.2, 1.4, 0.6);
  rr(ctx, hw - 0.6, y, 2.2, 1.4, 0.6);
}

/** Draws the vehicle centred at origin in its local frame, nose toward −y. */
export function drawTraffic(ctx: CanvasRenderingContext2D, style: number, o: TrafficDrawOptions): void {
  const si = ((style % TRAFFIC_STYLES.length) + TRAFFIC_STYLES.length) % TRAFFIC_STYLES.length;
  const g = trafficGeo(si);
  const T = getTones(o.pal);
  const P = paintTones(o.paint, T.light);
  const L = g.L;
  const W = g.W;
  const hl = L / 2;
  const hw = W / 2;
  const ghost = o.ghost === true;
  ctx.save();
  const baseAlpha = ctx.globalAlpha * (ghost ? 0.42 : 1);

  // Contact shadow toward world bottom-right.
  const [sx, sy] = localDir(ctx, 1, 1.35);
  const sh = trafficShadow(g);
  ctx.globalAlpha = baseAlpha * clamp01(o.pal.carShadow[3] * 1.5);
  ctx.drawImage(sh, -W / 2 - SHADOW_PAD + sx * 2.4, -L / 2 - SHADOW_PAD + sy * 2.4, W + SHADOW_PAD * 2, L + SHADOW_PAD * 2);
  ctx.globalAlpha = baseAlpha;

  // Tyres peeking out under the body.
  ctx.fillStyle = TYRE;
  const tw = 3.2;
  const th = si === 4 ? 7.4 : 6.6;
  const axles: number[] =
    si === 0 ? [-12.6, 12.4] : si === 1 ? [-11, 11] : si === 2 ? [-15.4, 16] : si === 3 ? [-15.6, 15.4] : si === 4 ? [-27.2, 20.4, 29] : [-13.4, 13.2];
  for (const ay of axles) {
    const ax = si === 4 && ay < 0 ? 12 - 1.1 : hw - 1.1;
    rr(ctx, -ax - tw / 2, ay - th / 2, tw, th, 1.2);
    rr(ctx, ax - tw / 2, ay - th / 2, tw, th, 1.2);
  }

  // Body paint + soft world-fixed gloss.
  ctx.fillStyle = P.body;
  ctx.fill(g.body);
  const [lx, ly] = localDir(ctx, -0.62, -0.78);
  const reach = Math.max(hw, hl) * 0.9;
  ctx.save();
  ctx.clip(g.body);
  const lin = ctx.createLinearGradient(lx * reach, ly * reach, -lx * reach, -ly * reach);
  lin.addColorStop(0, T.light ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.2)');
  lin.addColorStop(0.45, 'rgba(255,255,255,0)');
  lin.addColorStop(1, T.light ? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.26)');
  ctx.fillStyle = lin;
  ctx.fillRect(-hw - 1, -hl - 1, W + 2, L + 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 0.8;
  ctx.translate(-lx * 0.7, -ly * 0.7);
  ctx.stroke(g.body);
  ctx.restore();

  // Per-style cabin and load.
  switch (si) {
    case 0: // Sedan
      mirrors(ctx, P, hw, -7);
      cabin(ctx, P, hw - 1.7, -8, 11.4, -2.4, 8, hw - 2.6);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-hw + 2.4, 14.8);
      ctx.lineTo(hw - 2.4, 14.8);
      ctx.stroke();
      break;
    case 1: {
      // Hatchback with a roof cargo box.
      mirrors(ctx, P, hw, -5);
      cabin(ctx, P, hw - 1.5, -6, 15.6, -0.8, 13.8, hw - 2.4);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      rr(ctx, -3.2 + 0.6, 1 + 0.8, 6.4, 10.4, 3);
      ctx.fillStyle = T.light ? '#3A3E45' : '#2A2E35';
      rr(ctx, -3.2, 1, 6.4, 10.4, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      rr(ctx, -2.2, 1.8, 2, 8.8, 1);
      break;
    }
    case 2: {
      // Van: short nose, tall roof with rack rails.
      mirrors(ctx, P, hw, -17);
      ctx.fillStyle = GLASS;
      rr(ctx, -hw + 1.6, -18.8, W - 3.2, 6, 2.4);
      ctx.fillStyle = P.roof;
      rr(ctx, -hw + 1, -14.4, W - 2, 37.4, 2.2);
      ctx.strokeStyle = P.dark;
      ctx.lineWidth = 0.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-hw + 3, -10);
      ctx.lineTo(-hw + 3, 20);
      ctx.moveTo(hw - 3, -10);
      ctx.lineTo(hw - 3, 20);
      for (let y = -7; y <= 17; y += 8) {
        ctx.moveTo(-hw + 3, y);
        ctx.lineTo(hw - 3, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.14)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-hw + 1.4, 21.4);
      ctx.lineTo(hw - 1.4, 21.4);
      ctx.stroke();
      break;
    }
    case 3: {
      // Pickup: cab + open bed with a strapped crate.
      mirrors(ctx, P, hw, -10);
      cabin(ctx, P, hw - 1.8, -11, 3.6, -6.4, 2.2, hw - 2.7);
      ctx.fillStyle = P.dark;
      rr(ctx, -hw + 1.2, 5.6, W - 2.4, 18.6, 1.4);
      ctx.fillStyle = P.darker;
      rr(ctx, -hw + 2.3, 6.6, W - 4.6, 16.4, 0.9);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      rr(ctx, -4.4 + 1, 9 + 1.2, 8.8, 7.4, 0.8);
      ctx.fillStyle = T.light ? '#B49A76' : '#8E7A5E';
      rr(ctx, -4.4, 9, 8.8, 7.4, 0.8);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(-4.4, 12.7);
      ctx.lineTo(4.4, 12.7);
      ctx.stroke();
      break;
    }
    case 4: {
      // Box truck: painted cab, neutral box with seams and a reefer unit.
      mirrors(ctx, P, 12, -31);
      cabin(ctx, P, 10.4, -32.6, -21.8, -28.6, -19.4, 9.6);
      ctx.fillStyle = TYRE;
      ctx.fillRect(-7, -17.6, 14, 1.6);
      ctx.fillStyle = P.box;
      rr(ctx, -13, -16.5, 26, 52.5, 1.8);
      ctx.fillStyle = P.boxTop;
      rr(ctx, -12, -15.5, 24, 50.5, 1.2);
      ctx.strokeStyle = P.boxSeam;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let y = -6.5; y < 34; y += 8.4) {
        ctx.moveTo(-12, y);
        ctx.lineTo(12, y);
      }
      ctx.stroke();
      ctx.fillStyle = P.boxSeam;
      rr(ctx, -6, -14.2, 12, 4.4, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(-2.6, -12, 1.4, 0, TAU);
      ctx.arc(2.6, -12, 1.4, 0, TAU);
      ctx.fill();
      break;
    }
    default: {
      // Cab: sedan body with a roof sign and a door band.
      mirrors(ctx, P, hw, -7.6);
      ctx.fillStyle = P.dark;
      ctx.fillRect(-hw, -0.8, 1.2, 8.2);
      ctx.fillRect(hw - 1.2, -0.8, 1.2, 8.2);
      cabin(ctx, P, hw - 1.7, -8.4, 12, -2.6, 8.6, hw - 2.6);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      rr(ctx, -3.6 + 0.5, 1.4 + 0.7, 7.2, 2.8, 0.9);
      ctx.fillStyle = '#F2EBDA';
      rr(ctx, -3.6, 1.4, 7.2, 2.8, 0.9);
      ctx.fillStyle = '#2A2C30';
      ctx.fillRect(-2.4, 2.5, 4.8, 0.6);
      break;
    }
  }

  // Headlamps (front corners) and tail lights (rear corners).
  const noseY = si === 4 ? -36 : -hl;
  const fhw = si === 4 ? 12 : hw;
  const tailY = hl;
  ctx.fillStyle = ghost ? 'rgba(200,200,200,0.4)' : o.night > 0.05 ? '#FFF4DE' : 'rgba(240,236,224,0.85)';
  rr(ctx, -fhw + 1.7, noseY + 0.5, 3.6, 1.3, 0.6);
  rr(ctx, fhw - 5.3, noseY + 0.5, 3.6, 1.3, 0.6);
  const b = ghost ? 0 : clamp01(o.brake);
  ctx.fillStyle = ghost
    ? 'rgba(90,40,40,0.6)'
    : `rgb(${(150 + 105 * b) | 0},${(28 + 30 * b) | 0},${(30 + 22 * b) | 0})`;
  const tlw = si === 4 ? 3.2 : 3.8;
  rr(ctx, -hw + 1.1, tailY - 1.7, tlw, 1.3 + b * 0.3, 0.5);
  rr(ctx, hw - 1.1 - tlw, tailY - 1.7, tlw, 1.3 + b * 0.3, 0.5);
  if (!ghost && b > 0.05) {
    ctx.fillStyle = `rgba(255,120,110,${(0.7 * b).toFixed(3)})`;
    rr(ctx, -hw + 1.8, tailY - 1.5, tlw - 1.4, 0.7, 0.35);
    rr(ctx, hw - 0.4 - tlw, tailY - 1.5, tlw - 1.4, 0.7, 0.35);
  }
  // Turn signal (≈2 Hz).
  if (!ghost && o.indicator !== 0 && indicatorOn(o.time)) {
    const m = o.indicator;
    ctx.fillStyle = '#FFB23E';
    const fx = m * (fhw - 0.9);
    rr(ctx, fx - 1.1, noseY + 1.4, 2.2, 1.8, 0.8);
    const rx = m * (hw - 0.6);
    rr(ctx, rx - 1.1, tailY - 3.4, 2.2, 1.8, 0.8);
  }
  ctx.restore();
}

const indicatorOn = (t: number): boolean => t * 2 - Math.floor(t * 2) < 0.55;

/** Two headlight cones from (±x, y) pointing toward −y. */
function cones(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  width: number,
  splay: number,
  alpha: number,
): void {
  if (alpha <= 0.002) return;
  const s = coneSprite();
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  for (let m = -1; m <= 1; m += 2) {
    ctx.save();
    ctx.translate(m * x, y);
    ctx.rotate(m * splay);
    ctx.drawImage(s, -width / 2, -len, width, len);
    ctx.restore();
  }
}

/** Additive light pass in the vehicle's local frame ('lighter' set by caller). */
export function drawTrafficLights(ctx: CanvasRenderingContext2D, style: number, o: TrafficDrawOptions): void {
  if (o.ghost) return;
  const n = clamp01(o.night);
  if (n <= 0.001) return;
  const si = ((style % TRAFFIC_STYLES.length) + TRAFFIC_STYLES.length) % TRAFFIC_STYLES.length;
  const g = trafficGeo(si);
  const hl = g.L / 2;
  const hw = g.W / 2;
  const noseY = si === 4 ? -36 : -hl;
  const fhw = si === 4 ? 12 : hw;
  ctx.save();
  cones(ctx, fhw - 3.5, noseY + 1, 120, 74, 0.05, 0.6 * n);
  const bulb = radialSprite(255, 244, 226);
  blit(ctx, bulb, -(fhw - 3.5), noseY + 1, 5, 5, 0.9 * n);
  blit(ctx, bulb, fhw - 3.5, noseY + 1, 5, 5, 0.9 * n);
  const b = clamp01(o.brake);
  const red = radialSprite(255, 48, 36);
  const tr = 9 + b * 8;
  const ta = (0.38 + 0.55 * b) * n;
  blit(ctx, red, -(hw - 3), hl, tr, tr * 0.8, ta);
  blit(ctx, red, hw - 3, hl, tr, tr * 0.8, ta);
  if (b > 0.05) blit(ctx, red, 0, hl + 6, hw * 1.6, 12, 0.22 * b * n);
  if (o.indicator !== 0 && indicatorOn(o.time)) {
    const amber = radialSprite(255, 170, 50);
    const m = o.indicator;
    blit(ctx, amber, m * (fhw - 0.9), noseY + 2.3, 8, 8, 0.75 * n);
    blit(ctx, amber, m * (hw - 0.6), hl - 2.5, 8, 8, 0.75 * n);
  }
  if (si === 5) blit(ctx, radialSprite(255, 226, 170), 0, 2.8, 7, 5, 0.5 * n);
  ctx.restore();
}

/** Additive player headlights in the player car's local frame (nose −y). */
export function drawHeadlights(ctx: CanvasRenderingContext2D, intensity: number, pxScale: number): void {
  const k = clamp01(intensity);
  if (k <= 0.002) return;
  void pxScale;
  ctx.save();
  blit(ctx, radialSprite(255, 238, 214), 0, -70, 58, 84, 0.14 * k);
  cones(ctx, 6.2, -19, 170, 104, 0.06, 0.75 * k);
  const bulb = radialSprite(255, 246, 232);
  blit(ctx, bulb, -6.2, -19.4, 4.5, 4.5, 0.9 * k);
  blit(ctx, bulb, 6.2, -19.4, 4.5, 4.5, 0.9 * k);
  ctx.restore();
}
