import { ROAD_HALF_WIDTH, type Track, type TrackQuery } from './track';

export const BASE_SPEED = 280;
export const MAX_SPEED = 460;
/** Absolute cap including sector progression and boosts. */
export const TOP_SPEED = 520;

const STEER_SMOOTHING = 14;
export const LATERAL_GRIP = 6.2;
const FORWARD_ACCEL = 2.4;

/**
 * 2D carving model: the facing angle is decoupled from the velocity vector.
 * Rotating the chassis leaves velocity behind, which shows up as lateral slip
 * that grip damps away. Steady state slip angle ≈ atan(ω / grip) → 8°–18° in
 * typical bends.
 */
export class Car {
  x = 0;
  y = 0;
  /** Facing angle, screen atan2 convention (−π/2 = up). */
  angle = -Math.PI / 2;
  vx = 0;
  vy = -BASE_SPEED;
  /** Smoothed steering, −1…1. */
  steer = 0;
  vForward = BASE_SPEED;
  vLateral = 0;
  /** Lateral grip (1/s). Lowered while the player holds a drift. */
  grip = LATERAL_GRIP;

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Tightest drift radius (px): the same at every speed, so corners are about timing. */
  minRadius = 122;

  get turnRate(): number {
    return Math.max(1.6, this.speed / this.minRadius);
  }

  update(dt: number, steerInput: number, targetSpeed: number): void {
    this.steer += (steerInput - this.steer) * (1 - Math.exp(-STEER_SMOOTHING * dt));
    this.angle += this.steer * this.turnRate * dt;

    const fx = Math.cos(this.angle);
    const fy = Math.sin(this.angle);
    const rx = -fy;
    const ry = fx;

    let vF = this.vx * fx + this.vy * fy;
    let vL = this.vx * rx + this.vy * ry;
    vF += (targetSpeed - vF) * (1 - Math.exp(-FORWARD_ACCEL * dt));
    vL *= Math.exp(-this.grip * dt);

    this.vx = fx * vF + rx * vL;
    this.vy = fy * vF + ry * vL;
    this.vForward = vF;
    this.vLateral = vL;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /** Forward speed impulse (apex reward). */
  boost(dv: number): void {
    this.vx += Math.cos(this.angle) * dv;
    this.vy += Math.sin(this.angle) * dv;
  }

  /** World position of a point in the car's local frame (x right, y rearward). */
  local(lx: number, ly: number): [number, number] {
    const fx = Math.cos(this.angle);
    const fy = Math.sin(this.angle);
    return [this.x - fy * lx - fx * ly, this.y + fx * lx - fy * ly];
  }
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Line-following controller (Stanley-style, tuned by simulation): steer the
 * travel direction along the road tangent, corrected by the predicted lateral
 * error to the chosen line, plus curvature feed-forward. The error is measured
 * against a blend of facing and velocity angle, which removes most of the
 * grip lag — the car tracks the line without oscillating, yet still carves
 * and slips physically.
 */
export function followSteer(car: Car, track: Track, q: TrackQuery, offset: number, gain = 4): number {
  const v = car.speed;
  const p = track.poseAt(q.s + v * 0.08);
  if (!p) return 0;
  const velAngle = Math.atan2(car.vy, car.vx);
  const latVel = v * Math.sin(wrap(velAngle - p.angle));
  const e = offset - (q.lateral + latVel * 0.4);
  const desired = p.angle + Math.atan2(3.2 * e, v + 40);
  const base = car.angle - wrap(car.angle - velAngle) * 0.5;
  const ff = (track.curvatureAt(q.s + v * 0.1) * v) / car.turnRate;
  return Math.max(-1, Math.min(1, ff + wrap(desired - base) * gain));
}

/** Title / demo autopilot: follows a racing line that hugs the apexes. */
export function autopilotSteer(car: Car, track: Track, q: TrackQuery): number {
  const look = 70 + car.speed * 0.42;
  const kAhead = track.curvatureAt(q.s + look * 0.6);
  const offset = Math.max(-1, Math.min(1, kAhead / 0.004)) * (ROAD_HALF_WIDTH - 22);
  return followSteer(car, track, q, offset, 3);
}

// ───────────────────────── input ─────────────────────────

const KEY_DIRS: Record<string, number> = {
  ArrowLeft: -1,
  KeyA: -1,
  ArrowRight: 1,
  KeyD: 1,
};

/** Drag distance (CSS px) for full lock in drag mode. */
const DRAG_RANGE = 54;
/** Movement that turns a hold into a drag. */
const DRAG_THRESHOLD = 12;
/** Hold steering ramps from a gentle nudge to full lock over this time. */
const HOLD_RAMP_S = 0.2;
const HOLD_MIN = 0.45;

interface Pointer {
  startX: number;
  x: number;
  t0: number;
  drag: boolean;
  anchor: number;
  /** Last value this pointer produced (for seamless hold → drag hand-over). */
  value: number;
}

const holdValue = (side: number, t0: number, now: number): number =>
  side * Math.min(1, HOLD_MIN + ((now - t0) / 1000 / HOLD_RAMP_S) * (1 - HOLD_MIN));

/**
 * Two ways to steer, decided per finger:
 *  • Hold left / right half → steering ramps in smoothly (short taps = small
 *    corrections, long holds = full lock).
 *  • Drag horizontally → analogue "floating stick": steer follows the thumb
 *    offset, re-anchoring at the ends so reversing responds instantly.
 * Touches live in an insertion-ordered Map keyed by Touch.identifier; the most
 * recently added finger always wins. Keys (←/A, →/D) use the hold ramp.
 */
export class InputController {
  private touches = new Map<number, Pointer>();
  private ignored = new Set<number>();
  private keys = new Map<string, { dir: number; t0: number }>();
  private mouse: Pointer | null = null;
  private mouseIgnored = false;
  /** True once the player has used drag steering (for the hint text). */
  usedDrag = false;

  constructor(
    target: HTMLElement,
    private readonly onGesture: () => void,
  ) {
    const opts: AddEventListenerOptions = { passive: false };
    const newPointer = (x: number): Pointer => ({
      startX: x,
      x,
      t0: performance.now(),
      drag: false,
      anchor: x,
      value: 0,
    });

    target.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          this.touches.delete(t.identifier);
          this.touches.set(t.identifier, newPointer(t.clientX));
        }
        this.onGesture();
      },
      opts,
    );
    target.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          const p = this.touches.get(t.identifier);
          if (p) this.move(p, t.clientX);
        }
      },
      opts,
    );
    const end = (e: TouchEvent): void => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        this.touches.delete(t.identifier);
        this.ignored.delete(t.identifier);
      }
    };
    target.addEventListener('touchend', end, opts);
    target.addEventListener('touchcancel', end, opts);

    target.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.mouse = newPointer(e.clientX);
      this.mouseIgnored = false;
      this.onGesture();
    });
    window.addEventListener('mousemove', (e) => {
      if (this.mouse) this.move(this.mouse, e.clientX);
    });
    window.addEventListener('mouseup', () => {
      this.mouse = null;
      this.mouseIgnored = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLButtonElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = KEY_DIRS[e.code];
      if (dir !== undefined) {
        e.preventDefault();
        if (!e.repeat) {
          this.keys.delete(e.code);
          this.keys.set(e.code, { dir, t0: performance.now() });
        }
      }
      if (!e.repeat) this.onGesture();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.reset());
  }

  private move(p: Pointer, x: number): void {
    p.x = x;
    if (!p.drag && Math.abs(x - p.startX) > DRAG_THRESHOLD) {
      p.drag = true;
      this.usedDrag = true;
      p.anchor = x - p.value * DRAG_RANGE;
    }
    if (p.drag) {
      if (x - p.anchor > DRAG_RANGE) p.anchor = x - DRAG_RANGE;
      else if (x - p.anchor < -DRAG_RANGE) p.anchor = x + DRAG_RANGE;
    }
  }

  private pointerValue(p: Pointer, now: number): number {
    if (p.drag) p.value = Math.max(-1, Math.min(1, (p.x - p.anchor) / DRAG_RANGE));
    else p.value = holdValue(p.startX < window.innerWidth * 0.5 ? -1 : 1, p.t0, now);
    return p.value;
  }

  /** Current analogue steering input, −1…1. */
  get steer(): number {
    const now = performance.now();
    let active: Pointer | null = null;
    for (const [id, p] of this.touches) if (!this.ignored.has(id)) active = p;
    if (active) return this.pointerValue(active, now);
    if (this.mouse && !this.mouseIgnored) return this.pointerValue(this.mouse, now);
    let key: { dir: number; t0: number } | null = null;
    for (const k of this.keys.values()) key = k;
    return key ? holdValue(key.dir, key.t0, now) : 0;
  }

  /** Whether the player is actively steering right now. */
  get active(): boolean {
    for (const id of this.touches.keys()) if (!this.ignored.has(id)) return true;
    return (this.mouse !== null && !this.mouseIgnored) || this.keys.size > 0;
  }

  /** The gesture that starts a run should not also yank the wheel. */
  consumeActive(): void {
    for (const id of this.touches.keys()) this.ignored.add(id);
    if (this.mouse) this.mouseIgnored = true;
    this.keys.clear();
  }

  reset(): void {
    this.touches.clear();
    this.ignored.clear();
    this.keys.clear();
    this.mouse = null;
  }
}
