import type { Track } from './track';

/**
 * Civilian traffic: slower cars in three lanes that the player weaves
 * through. They keep distance, signal and change lanes, and get launched as
 * wrecks on a nitro takedown.
 */

export const LANES = [-40, 0, 40];

export interface TrafficCar {
  s: number;
  lat: number;
  targetLat: number;
  v: number;
  cruise: number;
  style: number;
  paint: string;
  brake: number;
  indicator: -1 | 0 | 1;
  /** Seconds left of signalling before the lane change starts. */
  signalT: number;
  x: number;
  y: number;
  angle: number;
  // Interaction bookkeeping (owned by the game loop)
  minGap: number;
  resolved: boolean;
  // Wreck state
  wreck: boolean;
  wreckT: number;
  wvx: number;
  wvy: number;
  spin: number;
}

export interface TrafficSpec {
  styles: { length: number; width: number }[];
  paints: string[];
}

export class Traffic {
  readonly cars: TrafficCar[] = [];
  private nextS = 0;
  private enabled = false;

  constructor(private readonly spec: TrafficSpec) {}

  /** Clears traffic and starts spawning ahead of `s`. */
  start(s: number): void {
    this.cars.length = 0;
    this.nextS = s + 950;
    this.enabled = true;
  }

  stop(): void {
    this.enabled = false;
  }

  dims(c: TrafficCar): { length: number; width: number } {
    return this.spec.styles[c.style] ?? { length: 40, width: 20 };
  }

  update(dt: number, track: Track, playerS: number, level: number): void {
    // Spawn ahead, density grows with level.
    if (this.enabled) {
      while (this.nextS < playerS + 1700) {
        if (this.nextS > playerS + 800) this.spawn(this.nextS, level);
        const gap = Math.max(210, 560 - level * 55) * (0.7 + Math.random() * 0.7);
        this.nextS += gap;
      }
    }

    const laneChangeRate = 0.05 + level * 0.025;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.wreck) {
        c.wreckT += dt;
        c.wvx *= Math.exp(-1.6 * dt);
        c.wvy *= Math.exp(-1.6 * dt);
        c.spin *= Math.exp(-1.2 * dt);
        c.x += c.wvx * dt;
        c.y += c.wvy * dt;
        c.angle += c.spin * dt;
        if (c.wreckT > 2.6) this.cars.splice(i, 1);
        continue;
      }

      // Keep distance to the car ahead in (roughly) the same lane.
      let target = c.cruise;
      for (const o of this.cars) {
        if (o === c || o.wreck) continue;
        const ds = o.s - c.s;
        if (ds > 0 && ds < 90 && Math.abs(o.lat - c.lat) < 24) target = Math.min(target, o.v - 10);
      }
      c.brake += ((target < c.v - 5 ? 1 : 0) - c.brake) * Math.min(1, dt * 8);
      c.v += (target - c.v) * Math.min(1, dt * 1.5);

      // Lane changes: signal first, then drift across.
      if (c.indicator === 0 && Math.random() < laneChangeRate * dt) {
        const li = LANES.indexOf(c.targetLat);
        const options = [li - 1, li + 1].filter((x) => x >= 0 && x < LANES.length);
        const ni = options[Math.floor(Math.random() * options.length)];
        const nl = LANES[ni];
        const blocked = this.cars.some((o) => o !== c && !o.wreck && Math.abs(o.s - c.s) < 80 && Math.abs(o.lat - nl) < 22);
        if (!blocked) {
          c.indicator = nl > c.lat ? 1 : -1;
          c.signalT = 0.9;
          c.targetLat = nl;
        }
      }
      if (c.signalT > 0) c.signalT -= dt;
      const moving = c.signalT <= 0 && Math.abs(c.targetLat - c.lat) > 0.5;
      if (moving) c.lat += Math.sign(c.targetLat - c.lat) * Math.min(Math.abs(c.targetLat - c.lat), 46 * dt);
      else if (c.signalT <= 0) c.indicator = 0;

      c.s += c.v * dt;
      const p = track.poseAt(c.s);
      if (!p || c.s < playerS - 700) {
        this.cars.splice(i, 1);
        continue;
      }
      const yaw = moving ? Math.atan2(Math.sign(c.targetLat - c.lat) * 46, c.v) : 0;
      c.x = p.x + p.nx * c.lat;
      c.y = p.y + p.ny * c.lat;
      c.angle = p.angle + yaw;
    }
  }

  /** Launches a car as a spinning wreck (nitro takedown). */
  wreck(c: TrafficCar, pvx: number, pvy: number, side: number): void {
    c.wreck = true;
    c.wreckT = 0;
    const nx = Math.cos(c.angle + Math.PI / 2) * side;
    const ny = Math.sin(c.angle + Math.PI / 2) * side;
    c.wvx = pvx * 0.85 + nx * 160;
    c.wvy = pvy * 0.85 + ny * 160;
    c.spin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4);
    c.indicator = 0;
  }

  private spawn(s: number, level: number): void {
    const lane = LANES[Math.floor(Math.random() * LANES.length)];
    if (this.cars.some((o) => !o.wreck && Math.abs(o.s - s) < 110 && Math.abs(o.lat - lane) < 22)) return;
    const big = Math.random() < 0.12 + level * 0.02;
    const styles = this.spec.styles;
    // Box truck is the longest style; pick it only on "big" rolls.
    const longest = styles.reduce((m, st, i) => (st.length > styles[m].length ? i : m), 0);
    let style = Math.floor(Math.random() * styles.length);
    if (style === longest && !big) style = (style + 1) % styles.length;
    if (big) style = longest;
    const cruise = (big ? 140 : 165) + Math.random() * 70 + level * 6;
    this.cars.push({
      s,
      lat: lane,
      targetLat: lane,
      v: cruise,
      cruise,
      style,
      paint: this.spec.paints[Math.floor(Math.random() * this.spec.paints.length)],
      brake: 0,
      indicator: 0,
      signalT: 0,
      x: 0,
      y: 0,
      angle: 0,
      minGap: Infinity,
      resolved: false,
      wreck: false,
      wreckT: 0,
      wvx: 0,
      wvy: 0,
      spin: 0,
    });
  }
}
