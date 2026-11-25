import { BASE_SPEED, MAX_SPEED, type Car } from './car';
import { css, type Palette, type Theme } from './theme';
import type { Track } from './track';

const DPR_CAP = 2.5;
const TRAIL_LIFE = 1.6;
const DUST_LIFE = 0.8;
const RIPPLE_LIFE = 1.0;
const MAX_DUST = 140;

export interface GhostPose {
  x: number;
  y: number;
  angle: number;
  alpha: number;
}

interface TrailPoint {
  x: number;
  y: number;
  t: number;
  /** First point of a new strip (not connected to its predecessor). */
  start: boolean;
}

interface Dust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  size: number;
}

interface Ripple {
  x: number;
  y: number;
  age: number;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  /** CSS px per world px. */
  private scale = 1;

  private cx = 0;
  private cy = 0;
  private cvx = 0;
  private cvy = 0;
  private zoom = 1.04;
  private cameraReady = false;

  private grain: CanvasPattern | null = null;
  private time = 0;

  private trailL: TrailPoint[] = [];
  private trailR: TrailPoint[] = [];
  private trailing = false;
  private dust: Dust[] = [];
  private ripples: Ripple[] = [];

  // Scratch buffers for the visible road strip.
  private lx: number[] = [];
  private ly: number[] = [];
  private rx: number[] = [];
  private ry: number[] = [];
  private mx: number[] = [];
  private my: number[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly theme: Theme,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.grain = this.makeGrain();
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
    this.canvas.style.width = `${this.vw}px`;
    this.canvas.style.height = `${this.vh}px`;
  }

  /** 128×128 monochrome noise, alpha ≤ 7/255, rendered once. */
  private makeGrain(): CanvasPattern | null {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (!g) return null;
    const img = g.createImageData(128, 128);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = Math.floor(Math.random() * 8);
    }
    g.putImageData(img, 0, 0);
    return this.ctx.createPattern(c, 'repeat');
  }

  // ───────────────────────── camera ─────────────────────────

  updateCamera(dt: number, car: Car): void {
    const tx = car.x + car.vx * 0.32;
    const ty = car.y + car.vy * 0.32;
    const speed = car.speed;
    const targetZoom = Math.min(1.04, Math.max(0.88, 1.04 - ((speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)) * 0.14));

    if (!this.cameraReady) {
      this.cx = tx;
      this.cy = ty;
      this.zoom = targetZoom;
      this.cameraReady = true;
    }
    // Critically damped spring.
    const w = 5.2;
    this.cvx += (w * w * (tx - this.cx) - 2 * w * this.cvx) * dt;
    this.cvy += (w * w * (ty - this.cy) - 2 * w * this.cvy) * dt;
    this.cx += this.cvx * dt;
    this.cy += this.cvy * dt;
    this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-2 * dt));
    this.scale = (Math.min(this.vw, 520) / 390) * this.zoom;
  }

  // ───────────────────────── effects ─────────────────────────

  addTrail(car: Car, active: boolean, time: number): void {
    if (active) {
      const start = !this.trailing;
      const [lx, ly] = car.local(-8.6, 13);
      const [rx, ry] = car.local(8.6, 13);
      this.trailL.push({ x: lx, y: ly, t: time, start });
      this.trailR.push({ x: rx, y: ry, t: time, start });
    }
    this.trailing = active;
  }

  spawnDust(car: Car): void {
    if (this.dust.length >= MAX_DUST) return;
    for (const side of [-1, 1]) {
      if (Math.random() < 0.35) continue;
      const [x, y] = car.local(side * 9, 14);
      const a = Math.random() * Math.PI * 2;
      const sp = 10 + Math.random() * 28;
      this.dust.push({
        x,
        y,
        vx: Math.cos(a) * sp - car.vx * 0.08,
        vy: Math.sin(a) * sp - car.vy * 0.08,
        age: 0,
        size: 1 + Math.random() * 2.2,
      });
    }
  }

  spawnRipple(x: number, y: number): void {
    this.ripples.push({ x, y, age: 0 });
  }

  updateEffects(dt: number, time: number): void {
    this.time = time;
    const cut = time - TRAIL_LIFE;
    while (this.trailL.length && this.trailL[0].t < cut) this.trailL.shift();
    while (this.trailR.length && this.trailR[0].t < cut) this.trailR.shift();
    if (this.trailL.length) this.trailL[0].start = true;
    if (this.trailR.length) this.trailR[0].start = true;

    const drag = Math.exp(-3 * dt);
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const p = this.dust[i];
      p.age += dt;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age > DUST_LIFE) this.dust.splice(i, 1);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].age += dt;
      if (this.ripples[i].age > RIPPLE_LIFE) this.ripples.splice(i, 1);
    }
  }

  // ───────────────────────── frame ─────────────────────────

  render(car: Car, track: Track, ghost: GhostPose | null, glow: number): void {
    const { ctx, dpr, vw, vh } = this;
    const pal = this.theme.palette;
    const s = this.scale;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(pal.bg);
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // World transform: camera centre sits slightly below screen centre.
    const ox = vw * 0.5 - this.cx * s;
    const oy = vh * 0.55 - this.cy * s;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);

    const pad = 120;
    const view = {
      l: -ox / s - pad,
      r: (vw - ox) / s + pad,
      t: -oy / s - pad,
      b: (vh - oy) / s + pad,
    };

    this.drawRoad(track, pal, view);
    this.drawTrails(pal);
    this.drawDust(pal);
    this.drawApexes(track, pal, view);
    this.drawRipples(pal);
    if (ghost && ghost.alpha > 0.002) this.drawGhost(ghost, pal);
    this.drawCar(car, pal, glow);

    // Grain, anchored to the world so it reads as asphalt/paper texture.
    if (this.grain) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const gx = (((ox * dpr) % 128) + 128) % 128;
      const gy = (((oy * dpr) % 128) + 128) % 128;
      this.grain.setTransform(new DOMMatrix([1, 0, 0, 1, gx, gy]));
      ctx.fillStyle = this.grain;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private drawRoad(track: Track, pal: Palette, v: { l: number; r: number; t: number; b: number }): void {
    const { ctx } = this;
    const nodes = track.nodes;
    const hw = track.halfWidth;
    const margin = hw + 10;

    let a = -1;
    let b = -1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.x > v.l - margin && n.x < v.r + margin && n.y > v.t - margin && n.y < v.b + margin) {
        if (a < 0) a = i;
        b = i;
      }
    }
    if (a < 0) return;
    a = Math.max(0, a - 1);
    b = Math.min(nodes.length - 1, b + 1);

    const lx = this.lx, ly = this.ly, rx = this.rx, ry = this.ry, mx = this.mx, my = this.my;
    const count = b - a + 1;
    lx.length = ly.length = rx.length = ry.length = mx.length = my.length = count;
    for (let i = 0; i < count; i++) {
      const n = nodes[a + i];
      lx[i] = n.x - n.nx * hw;
      ly[i] = n.y - n.ny * hw;
      rx[i] = n.x + n.nx * hw;
      ry[i] = n.y + n.ny * hw;
      mx[i] = n.x;
      my[i] = n.y;
    }

    // Ribbon with soft ambient drop shadow (shadow params are in device px).
    ctx.save();
    ctx.shadowColor = css(pal.roadShadow);
    ctx.shadowBlur = 24 * this.dpr;
    ctx.shadowOffsetY = 10 * this.dpr;
    ctx.fillStyle = css(pal.road);
    ctx.beginPath();
    spline(ctx, lx, ly, true, false);
    spline(ctx, rx, ry, false, true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Centre guide dashes, anchored to arc length so they never slide.
    const period = 30;
    ctx.save();
    ctx.strokeStyle = css(pal.dash);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([12, period - 12]);
    ctx.lineDashOffset = nodes[a].s % period;
    ctx.beginPath();
    spline(ctx, mx, my, true, false);
    ctx.stroke();
    ctx.restore();

    // Crisp 2px (screen) edge lines.
    ctx.strokeStyle = css(pal.edge);
    ctx.lineWidth = 2 / this.scale;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    spline(ctx, lx, ly, true, false);
    ctx.stroke();
    ctx.beginPath();
    spline(ctx, rx, ry, true, false);
    ctx.stroke();
  }

  private drawTrails(pal: Palette): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = css(pal.trail, 1 / pal.trail[3]);
    ctx.lineCap = 'round';
    const base = pal.trail[3];
    for (const trail of [this.trailL, this.trailR]) {
      for (let i = 1; i < trail.length; i++) {
        const p = trail[i];
        if (p.start) continue;
        const q = trail[i - 1];
        const life = 1 - (this.time - p.t) / TRAIL_LIFE;
        if (life <= 0) continue;
        ctx.globalAlpha = base * life * life;
        ctx.lineWidth = 1 + 2.4 * life;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawDust(pal: Palette): void {
    if (!this.dust.length) return;
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = css(pal.dust, 1 / pal.dust[3]);
    for (const p of this.dust) {
      const life = 1 - p.age / DUST_LIFE;
      ctx.globalAlpha = pal.dust[3] * life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + (1 - life) * 1.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawApexes(track: Track, pal: Palette, v: { l: number; r: number; t: number; b: number }): void {
    const { ctx } = this;
    for (const ap of track.apexes) {
      if (ap.mx < v.l || ap.mx > v.r || ap.my < v.t || ap.my > v.b) continue;
      const strength = ap.fade < 0 ? 1 : Math.max(0.22, 1 - ap.fade / 0.6);
      // Missed apexes stay visible, just quieter.
      const alpha = ap.passed && !ap.collected ? 0.45 : strength;

      // Faint inner radial glow.
      const glow = ctx.createRadialGradient(ap.gx, ap.gy, 0, ap.gx, ap.gy, 52);
      glow.addColorStop(0, css(pal.accent, 0.13 * alpha));
      glow.addColorStop(1, css(pal.accent, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(ap.gx - 52, ap.gy - 52, 104, 104);

      // Sleek rounded arc.
      ctx.strokeStyle = css(pal.accent, alpha);
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const p = ap.pts;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < p.length; i += 2) {
        xs.push(p[i]);
        ys.push(p[i + 1]);
      }
      spline(ctx, xs, ys, true, false);
      ctx.stroke();
    }
  }

  private drawRipples(pal: Palette): void {
    const { ctx } = this;
    for (const r of this.ripples) {
      const t = r.age / RIPPLE_LIFE;
      const e = 1 - Math.pow(1 - t, 3);
      ctx.strokeStyle = css(pal.accent, 0.55 * (1 - t));
      ctx.lineWidth = 0.6 + 2.2 * (1 - t);
      ctx.beginPath();
      ctx.arc(r.x, r.y, 6 + 64 * e, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawGhost(g: GhostPose, pal: Palette): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle + Math.PI / 2);
    ctx.globalAlpha = g.alpha;
    ctx.fillStyle = css(pal.carBody);
    bodyPath(ctx);
    ctx.fill();
    ctx.fillStyle = css(pal.accent);
    ctx.fillRect(-6.5, 18.6, 13, 1.6);
    ctx.restore();
  }

  private drawCar(car: Car, pal: Palette, glow: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle + Math.PI / 2);

    // Soft contact shadow.
    ctx.save();
    ctx.shadowColor = css(pal.carShadow);
    ctx.shadowBlur = 7 * this.dpr * this.scale;
    ctx.shadowOffsetY = 2 * this.dpr * this.scale;
    ctx.fillStyle = css(pal.carShadow);
    ctx.beginPath();
    ctx.roundRect(-9.5, -18, 19, 38, 8);
    ctx.fill();
    ctx.restore();

    // Wheels — fronts pivot with steering.
    ctx.fillStyle = css(pal.wheel);
    const steerAngle = car.steer * 0.35;
    for (const sx of [-1, 1]) {
      ctx.save();
      ctx.translate(sx * 8.9, -11);
      ctx.rotate(steerAngle);
      ctx.beginPath();
      ctx.roundRect(-2.3, -4.2, 4.6, 8.4, 1.6);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.roundRect(sx * 9.1 - 2.5, 11.5 - 4.6, 5, 9.2, 1.7);
      ctx.fill();
    }

    // Sculpted body.
    ctx.fillStyle = css(pal.carBody);
    bodyPath(ctx);
    ctx.fill();

    // Rear wing + diffuser detail.
    ctx.strokeStyle = css(pal.canopy, 0.28);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-8.6, 15.2);
    ctx.lineTo(8.6, 15.2);
    for (const dx of [-3, 0, 3]) {
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
    // Glass reflection.
    ctx.strokeStyle = css(pal.carBody, 0.18);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-2.6, -5.2);
    ctx.quadraticCurveTo(0, -6.1, 2.6, -5.2);
    ctx.stroke();

    // LED taillight bar — glows brighter while drifting.
    ctx.save();
    ctx.shadowColor = css(pal.accent);
    ctx.shadowBlur = (3 + glow * 12) * this.dpr * this.scale;
    ctx.fillStyle = css(pal.accent, 0.78 + 0.22 * glow);
    ctx.beginPath();
    ctx.roundRect(-6.5, 18.7, 13, 1.7, 0.85);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }
}

/** Car silhouette, nose at −y, 20 × 40. */
function bodyPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.quadraticCurveTo(5.6, -20, 7.2, -16.2);
  ctx.bezierCurveTo(9.8, -13.5, 10, -8.5, 8.4, -4.5);
  ctx.quadraticCurveTo(7.2, 0, 8.2, 4.5);
  ctx.bezierCurveTo(10, 8.5, 10.2, 14.5, 9.2, 18);
  ctx.quadraticCurveTo(8.6, 20, 6.4, 20);
  ctx.lineTo(-6.4, 20);
  ctx.quadraticCurveTo(-8.6, 20, -9.2, 18);
  ctx.bezierCurveTo(-10.2, 14.5, -10, 8.5, -8.2, 4.5);
  ctx.quadraticCurveTo(-7.2, 0, -8.4, -4.5);
  ctx.bezierCurveTo(-10, -8.5, -9.8, -13.5, -7.2, -16.2);
  ctx.quadraticCurveTo(-5.6, -20, 0, -20);
  ctx.closePath();
}

/**
 * Appends a uniform Catmull-Rom spline through the points (as cubic Béziers).
 * `move` starts a new sub-path; `reverse` walks the points backwards.
 */
function spline(
  ctx: CanvasRenderingContext2D,
  xs: readonly number[],
  ys: readonly number[],
  move: boolean,
  reverse: boolean,
): void {
  const n = xs.length;
  if (n < 2) return;
  const X = (i: number): number => xs[reverse ? n - 1 - clampI(i, n) : clampI(i, n)];
  const Y = (i: number): number => ys[reverse ? n - 1 - clampI(i, n) : clampI(i, n)];
  if (move) ctx.moveTo(X(0), Y(0));
  else ctx.lineTo(X(0), Y(0));
  for (let i = 0; i < n - 1; i++) {
    const c1x = X(i) + (X(i + 1) - X(i - 1)) / 6;
    const c1y = Y(i) + (Y(i + 1) - Y(i - 1)) / 6;
    const c2x = X(i + 1) - (X(i + 2) - X(i)) / 6;
    const c2y = Y(i + 1) - (Y(i + 2) - Y(i)) / 6;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, X(i + 1), Y(i + 1));
  }
}

function clampI(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

