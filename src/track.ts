/**
 * Procedural endless course.
 *
 * The centreline is a list of spine nodes spaced exactly NODE_SPACING apart:
 * straights joined by constant-radius corners of random angle (kinks to 180°
 * hairpins). Every candidate segment is simulated first and only committed if
 * it keeps a full road-plus-run-off clearance from the live course, so the
 * road can wander in any direction and still never overlap itself.
 * Rendering and sampling interpolate the nodes with Catmull-Rom splines.
 */

export const NODE_SPACING = 14;
export const ROAD_HALF_WIDTH = 84;
export const NODES_AHEAD = 260;
export const PRUNE_BEHIND = 1700;
/** Run-off (gravel) width beyond each road edge. */
export const RUNOFF = 40;
/** Minimum centre-line distance between two non-adjacent parts of the course. */
const CLEARANCE = 2 * (84 + RUNOFF) + 6;
/** Path distance below which two course points count as neighbours. */
const NEIGHBOUR = CLEARANCE * 1.5;

const APEX_HALF_NODES = 4; // 9 nodes → 8 × 14 = 112px ≈ 110px span
export const APEX_INSET = 7;

export interface TrackNode {
  x: number;
  y: number;
  /** Arc length from the track origin. */
  s: number;
  /** Heading relative to up (−Y), radians. */
  heading: number;
  /** Signed curvature (+ = bending right on screen). */
  k: number;
  /** Right-hand unit normal. */
  nx: number;
  ny: number;
}

export interface ApexZone {
  s: number;
  /** +1 = inside edge on the right, −1 = left. */
  side: number;
  /** Flat [x0, y0, x1, y1, …] along the inner border. */
  pts: number[];
  /** Arc midpoint (ripple origin). */
  mx: number;
  my: number;
  /** Glow centre, slightly further inside the road. */
  gx: number;
  gy: number;
  collected: boolean;
  passed: boolean;
  /** Seconds since collection (drives the fade); −1 while uncollected. */
  fade: number;
  /** Closest approach while inside the zone (graded on exit). */
  best: number;
}

export interface TrackQuery {
  /** Arc length of the closest point on the centreline. */
  s: number;
  /** Signed lateral offset from the centreline (+ = right of travel). */
  lateral: number;
  /** Unsigned shortest distance to the centreline polyline. */
  dist: number;
}

export interface TrackPose {
  x: number;
  y: number;
  /** Screen-space travel angle (atan2 convention). */
  angle: number;
  nx: number;
  ny: number;
}

export interface Orb {
  x: number;
  y: number;
  s: number;
  /** Position within its chain (drives the rising arpeggio). */
  idx: number;
  taken: boolean;
  /** Seconds since pickup; −1 while available. */
  age: number;
}

export interface BoostPad {
  x: number;
  y: number;
  s: number;
  /** Travel angle at the pad. */
  angle: number;
  lat: number;
  used: boolean;
  /** Jump ramp instead of a boost strip. */
  ramp: boolean;
}

export type PropKind = 'tree' | 'rock' | 'bush' | 'pine' | 'snowpine' | 'cactus' | 'building' | 'lamp' | 'ember' | 'palm';

export interface Prop {
  x: number;
  y: number;
  s: number;
  kind: PropKind;
  r: number;
  seed: number;
  /** Lamps: world angle pointing toward the road. */
  angle: number;
}

/** 0 magnet · 1 shield · 2 +time · 3 double points */
export type PowerKind = 0 | 1 | 2 | 3;

export interface PowerUp {
  x: number;
  y: number;
  s: number;
  lat: number;
  kind: PowerKind;
  taken: boolean;
  age: number;
}

/** Distance between checkpoints / world zones. */
export const ZONE_LENGTH = 10000;
const ZONE_COUNT = 6;

type Weighted = [PropKind, number][];
interface ZoneScenery {
  far: Weighted;
  near: Weighted;
  density: number;
  lamps: boolean;
}
const ZONES: ZoneScenery[] = [
  { far: [['tree', 4], ['palm', 3], ['rock', 1]], near: [['bush', 3], ['rock', 2]], density: 1, lamps: false },
  { far: [['cactus', 4], ['rock', 3]], near: [['cactus', 2], ['rock', 3], ['bush', 1]], density: 0.85, lamps: false },
  { far: [['pine', 7], ['tree', 1]], near: [['bush', 2], ['rock', 1], ['pine', 1]], density: 1.35, lamps: false },
  { far: [['building', 1]], near: [['bush', 1]], density: 0.9, lamps: true },
  { far: [['snowpine', 6], ['rock', 1]], near: [['rock', 2], ['snowpine', 1]], density: 1.1, lamps: false },
  { far: [['ember', 3], ['rock', 3]], near: [['rock', 3], ['ember', 1]], density: 1, lamps: false },
];

function pick(list: Weighted, r: number): PropKind {
  let total = 0;
  for (const [, w] of list) total += w;
  let x = r * total;
  for (const [k, w] of list) {
    x -= w;
    if (x <= 0) return k;
  }
  return list[0][0];
}

function propSize(kind: PropKind, r: number): number {
  switch (kind) {
    case 'tree':
      return 9 + r * 16;
    case 'pine':
    case 'snowpine':
      return 10 + r * 14;
    case 'palm':
      return 12 + r * 8;
    case 'cactus':
      return 6 + r * 6;
    case 'building':
      return 18 + r * 22;
    case 'ember':
      return 5 + r * 7;
    case 'bush':
      return 4 + r * 5;
    default:
      return 3 + r * 6;
  }
}

interface Pending {
  s: number;
  lat: number;
  kind: 'orb' | 'pad' | 'power' | 'apex';
  idx: number;
}

const SCENERY_LAG_NODES = 150;

type SegmentType = 'corner' | 'straight';

export interface Corner {
  s0: number;
  s1: number;
  /** +1 = turns right, −1 = left. */
  side: number;
  /** Turn angle (radians, unsigned) and centre-line radius. */
  angle: number;
  radius: number;
  /** Suggested turn-in point (arc length) for a full-lock drift. */
  turnIn: number;
}

/** Approximate path radius of a car holding full lock (used for turn-in hints). */
export const DRIFT_LINE_RADIUS = 98;

/**
 * Where to start holding for a corner at the given speed: the geometric
 * turn-in, moved earlier by the distance the car covers while steering and
 * slip build up (measured ≈ 0.25 s of travel).
 */
export function turnInPoint(c: Corner, speed: number): number {
  return Math.max(c.s0 - 240, c.turnIn - speed * 0.25);
}

type CornerKind = 'kink' | 'standard' | 'tight' | 'hairpin';

interface Segment {
  type: SegmentType;
  K: number;
  L: number;
  pos: number;
  /** Exact heading at the end of the segment (snapped to avoid drift). */
  endHeading: number;
}

/** Small, fast deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Track {
  /** Diagnostics: how often the generator had to fall back. */
  static fallbacks = 0;
  readonly nodes: TrackNode[] = [];
  readonly apexes: ApexZone[] = [];
  readonly corners: Corner[] = [];
  readonly orbs: Orb[] = [];
  readonly pads: BoostPad[] = [];
  readonly props: Prop[] = [];
  readonly powerups: PowerUp[] = [];
  private zoneOrigin = 0;
  private nextPowerS = 2400;
  readonly halfWidth = ROAD_HALF_WIDTH;

  private pending: Pending[] = [];
  private sceneryS = 0;

  private heading = 0;
  private seg: Segment;
  private lastType: SegmentType = 'straight';
  private rng: () => number;
  private hint = 0;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    // Calm opening straight so the title screen starts relaxed.
    this.seg = { type: 'straight', K: 0, L: 900, pos: 0, endHeading: 0 };
    this.nodes.push({ x: 0, y: 0, s: 0, heading: 0, k: 0, nx: 1, ny: 0 });
    this.update(0);
  }

  get firstS(): number {
    return this.nodes[0].s;
  }

  get lastS(): number {
    return this.nodes[this.nodes.length - 1].s;
  }

  /** Generates ahead of / prunes behind the car's arc-length position. */
  update(carS: number): void {
    const needed = carS + NODES_AHEAD * NODE_SPACING;
    while (this.lastS < needed) this.addNode();

    let drop = 0;
    while (drop < this.nodes.length - 4 && this.nodes[drop + 1].s < carS - PRUNE_BEHIND) drop++;
    if (drop > 0) {
      this.nodes.splice(0, drop);
      this.hint = Math.max(0, this.hint - drop);
    }
    let apexDrop = 0;
    while (apexDrop < this.apexes.length && this.apexes[apexDrop].s < this.firstS + 70) apexDrop++;
    if (apexDrop > 0) this.apexes.splice(0, apexDrop);
    const cut = this.firstS + 40;
    pruneBefore(this.orbs, cut);
    pruneBefore(this.pads, cut);
    pruneBefore(this.powerups, cut);
    let cd = 0;
    while (cd < this.corners.length && this.corners[cd].s1 < this.firstS) cd++;
    if (cd > 0) this.corners.splice(0, cd);
    pruneBefore(this.props, this.firstS - 600);
  }

  // ───────────────────────── generation ─────────────────────────

  /**
   * Course layout: straights joined by crisp 90° corners. Headings are only
   * up / left / right (never down), so the course can never cross itself:
   * from "up" a corner turns left or right; from a sideways run the only
   * corner turns back up. Corner + corner gives a chicane.
   */
  /** 0…1 difficulty from distance travelled since the course began. */
  private get difficulty(): number {
    return Math.min(1, this.lastS / 30000);
  }

  /** Simulates a segment from the current end of the course. */
  private simulate(K: number, L: number, extra = 0): { x: number; y: number }[] {
    const last = this.nodes[this.nodes.length - 1];
    let x = last.x;
    let y = last.y;
    let h = this.heading;
    const pts: { x: number; y: number }[] = [];
    const steps = Math.ceil(L / NODE_SPACING);
    for (let i = 0; i < steps; i++) {
      const mid = h + (K * NODE_SPACING) / 2;
      h += K * NODE_SPACING;
      x += Math.sin(mid) * NODE_SPACING;
      y -= Math.cos(mid) * NODE_SPACING;
      pts.push({ x, y });
    }
    // Escape check: a short straight after the segment must be clear too.
    for (let i = 0; i < Math.ceil(extra / NODE_SPACING); i++) {
      x += Math.sin(h) * NODE_SPACING;
      y -= Math.cos(h) * NODE_SPACING;
      pts.push({ x, y });
    }
    return pts;
  }

  /**
   * True if every simulated point keeps CLEARANCE from the committed course.
   * Points that are close *along the road* (path distance < NEIGHBOUR) are
   * neighbours, not overlaps, and are skipped; everything else must be clear.
   */
  private clear(pts: { x: number; y: number }[]): boolean {
    const n = this.nodes;
    const end = n[n.length - 1].s;
    const c2 = CLEARANCE * CLEARANCE;
    for (let i = 0; i < pts.length; i++) {
      const t = (i + 1) * NODE_SPACING;
      const p = pts[i];
      for (let j = n.length - 1; j >= 0; j--) {
        const a = n[j];
        if (t + (end - a.s) < NEIGHBOUR) continue;
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        if (dx * dx + dy * dy < c2) return false;
      }
    }
    return true;
  }

  /** Smallest non-neighbour distance from the points to the course. */
  private minGap(pts: { x: number; y: number }[]): number {
    const n = this.nodes;
    const end = n[n.length - 1].s;
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const t = (i + 1) * NODE_SPACING;
      for (let j = n.length - 1; j >= 0; j--) {
        if (t + (end - n[j].s) < NEIGHBOUR) continue;
        const d = Math.hypot(pts[i].x - n[j].x, pts[i].y - n[j].y);
        if (d < best) best = d;
      }
    }
    return best;
  }

  private commitStraight(L: number): void {
    const r = this.rng;
    const here = this.lastS;
    this.lastType = 'straight';
    this.seg = { type: 'straight', K: 0, L, pos: 0, endHeading: this.heading };
    // Long straights get a jump ramp or a boost strip.
    if (here > 1600 && L > 420) {
      const roll = r();
      if (roll < 0.45) this.pending.push({ s: here + L * 0.42, lat: 0, kind: 'pad', idx: 1 });
      else if (roll < 0.8) this.pending.push({ s: here + L * 0.4, lat: (r() - 0.5) * 70, kind: 'pad', idx: 0 });
    }
  }

  private commitCorner(sign: number, angle: number, R: number): void {
    const here = this.lastS;
    const n = Math.max(3, Math.round((angle * R) / NODE_SPACING));
    const L = n * NODE_SPACING;
    const K = angle / L;
    const h = this.heading;
    this.lastType = 'corner';
    // Headings stay continuous (unwrapped) so interpolation never jumps by 2π.
    this.seg = { type: 'corner', K: K * sign, L, pos: 0, endHeading: h + sign * angle };

    // Turn-in hint: where a full-lock drift line meets the entry straight.
    // Exit offset of a full-lock arc started d px into the corner is
    // −(R−r)(1−cos θ) + d·sin θ; zero at d = (R−r)·tan(θ/2). Beyond ~120° the
    // tangent explodes (a hairpin can't be fixed by timing alone — you feather
    // the hold), so the angle is capped there.
    const half = Math.min(angle, (120 * Math.PI) / 180) / 2;
    const turnIn = Math.max(here - 160, Math.min(here + L * 0.4, here + (R - DRIFT_LINE_RADIUS) * Math.tan(half)));
    this.corners.push({ s0: here, s1: here + L, side: sign, angle, radius: R, turnIn });

    const mid = here + L / 2;
    if (angle > 0.5) this.pending.push({ s: mid, lat: 0, kind: 'apex', idx: sign });
    // Light chain on the drift line: outside → apex → outside.
    const span = L / 2 + 90;
    let idx = 0;
    for (let d = -span; d <= span * 0.6; d += 28) {
      const u = d / span;
      const bell = Math.exp(-u * u * 3.2);
      this.pending.push({ s: mid + d, lat: sign * (-34 + 92 * bell), kind: 'orb', idx: idx++ });
    }
  }

  /**
   * Picks the next segment: a straight, or a randomised corner (kink, standard,
   * tight or hairpin), sometimes chained straight into another corner (esses).
   */
  private nextSegment(): void {
    const r = this.rng;
    const h = wrap(this.heading);
    const d = this.difficulty;
    const prev = this.lastType;

    // Corner after corner = esses/chicane; more likely as the course hardens.
    const wantCorner = prev !== 'corner' || r() < 0.25 + 0.25 * d;
    if (!wantCorner || this.lastS < 900) {
      const L = this.lastS < 900 ? 700 : r() < 0.18 ? 520 + r() * 380 : 140 + r() * (380 - 160 * d);
      if (Math.abs(h) < 0.56 * Math.PI && this.clear(this.simulate(0, L, 300))) {
        this.commitStraight(L);
        return;
      }
    }

    // Candidate corners, tried in random order until one fits.
    const sideways = Math.abs(Math.abs(h) - Math.PI / 2) < Math.PI / 4;
    const kinds: [CornerKind, number][] = [
      ['kink', 0.2],
      ['standard', 0.42 - 0.1 * d],
      ['tight', 0.2 + 0.15 * d],
      ['hairpin', sideways ? 0.18 + 0.1 * d : 0],
    ];
    for (let attempt = 0; attempt < 14; attempt++) {
      let x = r() * kinds.reduce((a, k) => a + k[1], 0);
      let kind: CornerKind = 'standard';
      for (const [k, w] of kinds) {
        x -= w;
        if (x <= 0) {
          kind = k;
          break;
        }
      }
      let angle: number;
      let R: number;
      if (kind === 'kink') {
        angle = (25 + r() * 25) * (Math.PI / 180);
        R = 150 + r() * 90;
      } else if (kind === 'standard') {
        angle = (60 + r() * 45) * (Math.PI / 180);
        R = 115 + r() * 70;
      } else if (kind === 'tight') {
        angle = (105 + r() * 40) * (Math.PI / 180);
        R = 112 + r() * 26;
      } else {
        angle = (165 + r() * 15) * (Math.PI / 180);
        R = 128 + r() * 24;
      }
      // Bias toward turning back "up" when the course leans far over.
      let sign = r() < 0.5 ? -1 : 1;
      if (Math.abs(h) > 0.35 * Math.PI && r() < 0.75) sign = -Math.sign(h);
      const end = wrap(h + sign * angle);
      if (Math.abs(end) > 0.56 * Math.PI) continue;
      const L = angle * R;
      if (!this.clear(this.simulate((sign * angle) / L, L, 420))) continue;
      this.commitCorner(sign, angle, R);
      return;
    }
    // Fallback: search a wide set of shapes and take the one with the most
    // room (prefer ones that bring the heading back toward "up").
    Track.fallbacks++;
    let best: { score: number; apply: () => void } | null = null;
    for (const sign of [-1, 1]) {
      for (const deg of [15, 30, 45, 60, 90, 120, 150, 180]) {
        for (const R of [125, 170, 230]) {
          const angle = (deg * Math.PI) / 180;
          const end = wrap(h + sign * angle);
          const L = angle * R;
          const gap = this.minGap(this.simulate((sign * angle) / L, L, 420));
          const score = Math.min(gap, CLEARANCE + 40) - Math.abs(end) * 40;
          if (!best || score > best.score) best = { score, apply: () => this.commitCorner(sign, angle, R) };
        }
      }
    }
    for (const L of [140, 280]) {
      const gap = this.minGap(this.simulate(0, L, 420));
      const score = Math.min(gap, CLEARANCE + 40) - Math.abs(h) * 40;
      if (!best || score > best.score) best = { score, apply: () => this.commitStraight(L) };
    }
    if (best) best.apply();
  }

  private curvatureAtSegment(): number {
    return this.seg.type === 'corner' ? this.seg.K : 0;
  }

  private addNode(): void {
    if (this.seg.pos >= this.seg.L - 1e-6) {
      this.heading = this.seg.endHeading;
      this.nextSegment();
    }
    const k = this.curvatureAtSegment();
    this.seg.pos += NODE_SPACING;

    const prev = this.nodes[this.nodes.length - 1];
    const mid = this.heading + (k * NODE_SPACING) / 2;
    this.heading += k * NODE_SPACING;
    const node: TrackNode = {
      x: prev.x + Math.sin(mid) * NODE_SPACING,
      y: prev.y - Math.cos(mid) * NODE_SPACING,
      s: prev.s + NODE_SPACING,
      heading: this.heading,
      k,
      nx: Math.cos(this.heading),
      ny: Math.sin(this.heading),
    };
    this.nodes.push(node);
    if (node.s > this.nextPowerS) {
      const r = this.rng;
      const lanes = [-36, 0, 36];
      if (Math.abs(this.heading) < 0.1 && this.seg.type === 'straight')
        this.pending.push({ s: node.s + 40, lat: lanes[Math.floor(r() * 3)], kind: 'power', idx: Math.floor(r() * 4) });
      this.nextPowerS = node.s + 2200 + r() * 1400;
    }
    this.flushPending();
    while (this.sceneryS < node.s - SCENERY_LAG_NODES * NODE_SPACING) {
      this.placeScenery(this.sceneryS);
      this.sceneryS += NODE_SPACING;
    }
  }

  private flushPending(): void {
    const limit = this.lastS - 2 * NODE_SPACING;
    for (let i = 0; i < this.pending.length; ) {
      const p = this.pending[i];
      if (p.s > limit - (p.kind === 'apex' ? 6 * NODE_SPACING : 0)) {
        i++;
        continue;
      }
      if (p.kind === 'apex') {
        this.pending.splice(i, 1);
        this.makeApex(Math.round((p.s - this.nodes[0].s) / NODE_SPACING), p.idx);
        continue;
      }
      this.pending.splice(i, 1);
      const pose = this.poseAt(p.s);
      if (!pose) continue;
      const x = pose.x + pose.nx * p.lat;
      const y = pose.y + pose.ny * p.lat;
      if (p.kind === 'orb') this.orbs.push({ x, y, s: p.s, idx: p.idx, taken: false, age: -1 });
      else if (p.kind === 'pad') this.pads.push({ x, y, s: p.s, angle: pose.angle, lat: p.lat, used: false, ramp: p.idx === 1 });
      else this.powerups.push({ x, y, s: p.s, lat: p.lat, kind: p.idx as PowerKind, taken: false, age: -1 });
    }
  }

  /** Sparse off-road scenery, placed well behind the generation front so the
   *  road can be checked on both sides before anything is planted. */
  /** World zone (0…5) for an arc length; zones are aligned to the current run's start. */
  zoneAt(s: number): number {
    const z = s < this.zoneOrigin ? 0 : Math.floor((s - this.zoneOrigin) / ZONE_LENGTH);
    return ((z % ZONE_COUNT) + ZONE_COUNT) % ZONE_COUNT;
  }

  /** Re-aligns zones to a new run start and replants scenery ahead of `from`. */
  setZoneOrigin(origin: number, from: number): void {
    this.zoneOrigin = origin;
    const keep = this.props.filter((p) => p.s < from);
    this.props.length = 0;
    this.props.push(...keep);
    this.sceneryS = Math.min(this.sceneryS, from);
    const front = this.lastS - SCENERY_LAG_NODES * NODE_SPACING;
    while (this.sceneryS < front) {
      this.placeScenery(this.sceneryS);
      this.sceneryS += NODE_SPACING;
    }
  }

  private placeScenery(s: number): void {
    const r = this.rng;
    const n = this.nodes;
    const i = Math.round((s - n[0].s) / NODE_SPACING);
    if (i < 0 || i >= n.length) return;
    const node = n[i];
    const zone = ZONES[this.zoneAt(s)];

    // Street lamps: regular rhythm, alternating sides.
    if (zone.lamps && Math.round(s / NODE_SPACING) % 12 === 0) {
      const side = Math.round(s / NODE_SPACING) % 24 === 0 ? 1 : -1;
      const lat = side * (ROAD_HALF_WIDTH + 16);
      this.props.push({
        x: node.x + node.nx * lat,
        y: node.y + node.ny * lat,
        s,
        kind: 'lamp',
        r: 8,
        seed: r(),
        angle: Math.atan2(-node.ny * side, -node.nx * side),
      });
    }

    for (const side of [-1, 1]) {
      const roll = r();
      if (roll > 0.2 * zone.density) continue;
      const far = roll < 0.13 * zone.density;
      const kind = pick(far ? zone.far : zone.near, r());
      const rad = propSize(kind, r());
      const gap = kind === 'building' ? 34 + r() * 120 : far ? 30 + Math.pow(r(), 1.4) * 360 : 14 + r() * 40;
      const lat = side * (ROAD_HALF_WIDTH + rad + gap);
      const along = (r() - 0.5) * NODE_SPACING;
      const x = node.x + node.nx * lat - node.ny * along;
      const y = node.y + node.ny * lat + node.nx * along;
      if (this.clearance(x, y, i) < ROAD_HALF_WIDTH + rad * (kind === 'building' ? 1.5 : 1) + 10) continue;
      this.props.push({ x, y, s, kind, r: rad, seed: r(), angle: 0 });
    }
  }

  private clearance(x: number, y: number, around: number): number {
    const n = this.nodes;
    let best = Infinity;
    const lo = Math.max(0, around - SCENERY_LAG_NODES);
    const hi = Math.min(n.length - 1, around + SCENERY_LAG_NODES);
    for (let j = lo; j <= hi; j += 2) {
      const dx = n[j].x - x;
      const dy = n[j].y - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** Builds an apex zone on the inside edge around node i. */
  private makeApex(i: number, side: number): void {
    const n = this.nodes;
    if (i < APEX_HALF_NODES || i + APEX_HALF_NODES >= n.length) return;
    const node = n[i];
    const off = side * (ROAD_HALF_WIDTH - APEX_INSET);
    const pts: number[] = [];
    for (let j = i - APEX_HALF_NODES; j <= i + APEX_HALF_NODES; j++) {
      const p = n[j];
      pts.push(p.x + p.nx * off, p.y + p.ny * off);
    }
    const glow = side * (ROAD_HALF_WIDTH - 20);
    this.apexes.push({
      s: node.s,
      side,
      pts,
      mx: node.x + node.nx * off,
      my: node.y + node.ny * off,
      gx: node.x + node.nx * glow,
      gy: node.y + node.ny * glow,
      collected: false,
      passed: false,
      fade: -1,
      best: Infinity,
    });
  }

  // ───────────────────────── queries ─────────────────────────

  /** Shortest distance from (x, y) to the centreline polyline. */
  nearest(x: number, y: number): TrackQuery {
    const n = this.nodes;
    const last = n.length - 2;
    let lo = Math.max(0, Math.min(last, this.hint) - 24);
    let hi = Math.min(last, Math.max(0, this.hint) + 24);
    let best = Infinity;
    let bi = 0;
    let bt = 0;

    for (let pass = 0; pass < 8; pass++) {
      for (let i = lo; i <= hi; i++) {
        const a = n[i];
        const b = n[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a.x + dx * t - x;
        const py = a.y + dy * t - y;
        const d2 = px * px + py * py;
        if (d2 < best) {
          best = d2;
          bi = i;
          bt = t;
        }
      }
      // Expand the window if the minimum sits on its border.
      if (bi === lo && lo > 0) {
        hi = lo;
        lo = Math.max(0, lo - 40);
      } else if (bi === hi && hi < last) {
        lo = hi;
        hi = Math.min(last, hi + 40);
      } else break;
    }

    this.hint = bi;
    const a = n[bi];
    const b = n[bi + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // Right-hand normal of the segment: (−dy, dx)/len
    const lateral = ((x - a.x) * -dy + (y - a.y) * dx) / len;
    return { s: a.s + bt * NODE_SPACING, lateral, dist: Math.sqrt(best) };
  }

  /** Catmull-Rom interpolated pose on the centreline, or null if out of range. */
  poseAt(s: number): TrackPose | null {
    const n = this.nodes;
    const f = (s - n[0].s) / NODE_SPACING;
    if (f < 0 || f > n.length - 1) return null;
    const i = Math.min(n.length - 2, Math.floor(f));
    const t = f - i;
    const p0 = n[Math.max(0, i - 1)];
    const p1 = n[i];
    const p2 = n[i + 1];
    const p3 = n[Math.min(n.length - 1, i + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    const cr = (a: number, b: number, c: number, d: number): number =>
      0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    const heading = p1.heading + (p2.heading - p1.heading) * t;
    return {
      x: cr(p0.x, p1.x, p2.x, p3.x),
      y: cr(p0.y, p1.y, p2.y, p3.y),
      angle: heading - Math.PI / 2,
      nx: Math.cos(heading),
      ny: Math.sin(heading),
    };
  }

  curvatureAt(s: number): number {
    const n = this.nodes;
    const f = (s - n[0].s) / NODE_SPACING;
    const i = Math.max(0, Math.min(n.length - 2, Math.floor(f)));
    const t = Math.max(0, Math.min(1, f - i));
    return n[i].k + (n[i + 1].k - n[i].k) * t;
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function pruneBefore<T extends { s: number }>(arr: T[], s: number): void {
  let k = 0;
  while (k < arr.length && arr[k].s < s) k++;
  if (k > 0) arr.splice(0, k);
}

/** Shortest distance from a point to a flat [x, y, …] polyline. */
export function distToPolyline(x: number, y: number, pts: number[]): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const dx = pts[i + 2] - ax;
    const dy = pts[i + 3] - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((x - ax) * dx + (y - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x;
    const py = ay + dy * t - y;
    const d2 = px * px + py * py;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
