import { ROAD_HALF_WIDTH, type Track, type TrackQuery } from './track';

export const BASE_SPEED = 280;
export const MAX_SPEED = 460;

const STEER_SMOOTHING = 14;
const LATERAL_GRIP = 5.2;
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

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  get turnRate(): number {
    const hi = Math.min(1, Math.max(0, (this.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)));
    return 2.7 - 0.55 * hi; // slightly gentler at ultra-high speed
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
    vL *= Math.exp(-LATERAL_GRIP * dt);

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

/** Title-screen autopilot: pure pursuit toward a racing line that hugs apexes. */
export function autopilotSteer(car: Car, track: Track, q: TrackQuery): number {
  const v = car.speed;
  const look = 70 + v * 0.42;
  const kAhead = track.curvatureAt(q.s + look * 0.6);
  const offset = Math.max(-1, Math.min(1, kAhead / 0.004)) * (ROAD_HALF_WIDTH - 26);
  const p = track.poseAt(q.s + look);
  if (!p) return 0;
  const tx = p.x + p.nx * offset;
  const ty = p.y + p.ny * offset;
  const desired = Math.atan2(ty - car.y, tx - car.x);
  const velAngle = Math.atan2(car.vy, car.vx);
  const err = wrap(desired - velAngle);
  const ff = (track.curvatureAt(q.s) * v) / car.turnRate;
  return Math.max(-1, Math.min(1, ff + err * 2.2));
}

// ───────────────────────── input ─────────────────────────

const KEY_DIRS: Record<string, number> = {
  ArrowLeft: -1,
  KeyA: -1,
  ArrowRight: 1,
  KeyD: 1,
};

/**
 * Touch: every active touch lives in an insertion-ordered Map keyed by
 * Touch.identifier, so the most recently added finger always wins.
 * Desktop: arrow keys / A-D (most recent key wins) plus mouse halves.
 */
export class InputController {
  private touches = new Map<number, number>();
  private ignored = new Set<number>();
  private keys = new Map<string, number>();
  private mouseX: number | null = null;
  private mouseIgnored = false;

  constructor(
    target: HTMLElement,
    private readonly onGesture: () => void,
  ) {
    const opts: AddEventListenerOptions = { passive: false };

    target.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          this.touches.delete(t.identifier);
          this.touches.set(t.identifier, t.clientX);
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
          if (this.touches.has(t.identifier)) this.touches.set(t.identifier, t.clientX);
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
      this.mouseX = e.clientX;
      this.mouseIgnored = false;
      this.onGesture();
    });
    window.addEventListener('mousemove', (e) => {
      if (this.mouseX !== null) this.mouseX = e.clientX;
    });
    window.addEventListener('mouseup', () => {
      this.mouseX = null;
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
          this.keys.set(e.code, dir);
        }
      }
      if (!e.repeat) this.onGesture();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.reset());
  }

  /** Current raw steering input: −1, 0 or +1. */
  get steer(): number {
    let touchX: number | null = null;
    for (const [id, x] of this.touches) if (!this.ignored.has(id)) touchX = x;
    if (touchX !== null) return touchX < window.innerWidth * 0.5 ? -1 : 1;

    if (this.mouseX !== null && !this.mouseIgnored) return this.mouseX < window.innerWidth * 0.5 ? -1 : 1;

    let dir = 0;
    for (const d of this.keys.values()) dir = d;
    return dir;
  }

  /** The gesture that starts a run should not also yank the wheel. */
  consumeActive(): void {
    for (const id of this.touches.keys()) this.ignored.add(id);
    if (this.mouseX !== null) this.mouseIgnored = true;
    this.keys.clear();
  }

  reset(): void {
    this.touches.clear();
    this.ignored.clear();
    this.keys.clear();
    this.mouseX = null;
  }
}
