/**
 * Procedural endless ribbon track.
 *
 * The centreline is a list of spine nodes spaced exactly NODE_SPACING apart,
 * produced by integrating a smooth curvature profile. The heading θ is
 * measured relative to "up" (−Y) and hard-clamped to ±0.44π, so every step
 * moves the road strictly upward (cos θ > 0): the centreline can never
 * self-intersect or fold back. Rendering and sampling interpolate the nodes
 * with uniform Catmull-Rom splines.
 */

export const NODE_SPACING = 14;
export const ROAD_HALF_WIDTH = 68;
export const NODES_AHEAD = 260;
export const PRUNE_BEHIND = 450;

const HEADING_LIMIT = 0.44 * Math.PI;
const HEADING_SOFT = 0.38 * Math.PI;
const APEX_CURVATURE = 0.0016;
const APEX_MIN_GAP = 380;
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

type SegmentType = 'sweep' | 'scurve' | 'straight';

interface Segment {
  type: SegmentType;
  K: number;
  L: number;
  pos: number;
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
  readonly nodes: TrackNode[] = [];
  readonly apexes: ApexZone[] = [];
  readonly halfWidth = ROAD_HALF_WIDTH;

  private heading = 0;
  private seg: Segment;
  private lastApexS = -Infinity;
  private lastType: SegmentType = 'straight';
  private rng: () => number;
  private hint = 0;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    // Calm opening straight so the title screen starts relaxed.
    this.seg = { type: 'straight', K: 0, L: 700, pos: 0 };
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
  }

  // ───────────────────────── generation ─────────────────────────

  private nextSegment(): void {
    const r = this.rng;
    const h = this.heading;
    let type: SegmentType;
    const roll = r();
    if (this.lastType === 'straight') type = roll < 0.62 ? 'sweep' : 'scurve';
    else type = roll < 0.5 ? 'sweep' : roll < 0.8 ? 'scurve' : 'straight';

    let L = type === 'straight' ? 450 + r() * 250 : 450 + r() * 500;
    let K = 0;

    // Prefer bending back toward "up" once the road leans far to one side.
    const towardCentre = Math.abs(h) > 0.16 * Math.PI && r() < 0.85;
    let sign = towardCentre ? -Math.sign(h) : r() < 0.5 ? -1 : 1;

    if (type === 'sweep') {
      K = 0.0019 + r() * 0.0023;
      // Net heading change of a sin-profile sweep: K·L·2/π
      for (let attempt = 0; attempt < 2; attempt++) {
        const room = sign > 0 ? HEADING_SOFT - h : h + HEADING_SOFT;
        const maxK = (Math.max(0, room) * Math.PI) / (2 * L);
        if (maxK >= 0.0017) {
          K = Math.min(K, maxK);
          break;
        }
        sign = -sign;
      }
    } else if (type === 'scurve') {
      K = 0.0018 + r() * 0.0022;
      // Peak excursion of a full-sine S-curve: K·L/π (in the first lobe's direction)
      const room = sign > 0 ? HEADING_SOFT - h : h + HEADING_SOFT;
      if ((K * L) / Math.PI > room) {
        sign = -sign;
        const room2 = sign > 0 ? HEADING_SOFT - h : h + HEADING_SOFT;
        K = Math.min(K, (Math.max(0, room2) * Math.PI) / L);
      }
      if (K < 0.0012) {
        type = 'straight';
        L = 500;
        K = 0;
      }
    }

    this.lastType = type;
    this.seg = { type, K: K * sign, L, pos: 0 };
  }

  private curvatureAtSegment(): number {
    const { type, K, L, pos } = this.seg;
    const u = pos / L;
    if (type === 'sweep') return K * Math.sin(Math.PI * u);
    if (type === 'scurve') return K * Math.sin(2 * Math.PI * u);
    return 0;
  }

  private addNode(): void {
    if (this.seg.pos >= this.seg.L) this.nextSegment();
    const k = this.curvatureAtSegment();
    this.seg.pos += NODE_SPACING;

    const prev = this.nodes[this.nodes.length - 1];
    const mid = this.heading + (k * NODE_SPACING) / 2;
    this.heading = Math.max(-HEADING_LIMIT, Math.min(HEADING_LIMIT, this.heading + k * NODE_SPACING));
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
    this.detectApex();
  }

  /** Lagged peak detection so the full ±55px arc already exists. */
  private detectApex(): void {
    const n = this.nodes;
    const i = n.length - 1 - (APEX_HALF_NODES + 1);
    if (i < APEX_HALF_NODES) return;
    const a = Math.abs(n[i - 1].k);
    const b = Math.abs(n[i].k);
    const c = Math.abs(n[i + 1].k);
    if (b <= APEX_CURVATURE || b < a || b <= c) return;
    const node = n[i];
    if (node.s - this.lastApexS < APEX_MIN_GAP || node.s < 600) return;
    this.lastApexS = node.s;

    const side = Math.sign(node.k);
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
