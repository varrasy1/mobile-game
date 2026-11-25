import { BASE_SPEED, MAX_SPEED, TOP_SPEED, type Car } from './car';
import { CARS, drawCar as drawCarModel, type CarModel } from './cars';
import { drawHeadlights, drawProp, drawPropLight, type PropDrawOptions } from './props';
import { css, type Palette, type Theme } from './theme';
import { NODE_SPACING, type Track } from './track';

const DPR_CAP = 2.5;
const TRAIL_LIFE = 1.6;
const DUST_LIFE = 0.8;
const SMOKE_LIFE = 1.0;
const SPARK_LIFE = 0.45;
const RIPPLE_LIFE = 1.0;
const MAX_DUST = 140;
const POPUP_LIFE = 1.1;
const STREAK_COUNT = 28;

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
  smoke: boolean;
  spark?: boolean;
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
  big: boolean;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  age: number;
  accent: boolean;
  size: number;
}

interface Streak {
  x: number;
  y: number;
}

export interface FrameFx {
  /** 0…1 boost intensity. */
  boost: number;
  time: number;
  /** 0…1 nitro flame intensity. */
  nitro: number;
  /** Visual drift yaw added to the car's facing (radians). */
  drift: number;
  /** Ghost car model id. */
  ghostModel?: CarModel;
  /** 0…1 darkness of the current world zone. */
  night: number;
  /** 0…1 shield bubble strength. */
  shield: number;
  /** Magnet active (pulse ring). */
  magnet: boolean;

}

type View = { l: number; r: number; t: number; b: number };

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
  /** Camera rotation (radians) and screen anchor of the camera point. */
  private rot = 0;
  private ax = 0;
  private ay = 0;
  private cameraReady = false;

  private grain: CanvasPattern | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private glow: HTMLCanvasElement | null = null;
  private glowKey = '';
  private time = 0;

  private trailL: TrailPoint[] = [];
  private trailR: TrailPoint[] = [];
  private trailing = false;
  private dust: Dust[] = [];
  private ripples: Ripple[] = [];
  private popups: Popup[] = [];
  private streaks: Streak[] = [];
  private shake = 0;
  private model: CarModel = CARS[0];

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
    this.vignette = this.makeVignette();
  }

  /** Accent-coloured radial glow sprite, re-rendered only when the accent changes. */
  private glowSprite(pal: Palette): HTMLCanvasElement {
    const key = `${pal.accent[0] | 0},${pal.accent[1] | 0},${pal.accent[2] | 0}`;
    if (this.glow && key === this.glowKey) return this.glow;
    const c = this.glow ?? document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      g.clearRect(0, 0, 64, 64);
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, `rgba(${key},1)`);
      grad.addColorStop(1, `rgba(${key},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
    this.glow = c;
    this.glowKey = key;
    return c;
  }

  /** Soft radial vignette, rendered once per resize at low resolution. */
  private makeVignette(): HTMLCanvasElement | null {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = Math.max(64, Math.round((256 * this.vh) / Math.max(1, this.vw)));
    const g = c.getContext('2d');
    if (!g) return null;
    const grad = g.createRadialGradient(c.width / 2, c.height * 0.52, c.height * 0.22, c.width / 2, c.height * 0.52, c.height * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    return c;
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

  /** Track-up chase camera: the road ahead always points up the screen. */
  updateCamera(dt: number, car: Car, boost: number, track: Track, s: number): void {
    const p = track.poseAt(s + 50) ?? track.poseAt(s);
    const roadAngle = p ? p.angle : Math.atan2(car.vy, car.vx);
    const look = 70 + car.speed * 0.16;
    const tx = car.x + Math.cos(roadAngle) * look;
    const ty = car.y + Math.sin(roadAngle) * look;
    const speed = car.speed;
    const base = Math.min(1.04, Math.max(0.88, 1.04 - ((speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)) * 0.14));
    const beyond = Math.max(0, Math.min(1, (speed - MAX_SPEED) / (TOP_SPEED - MAX_SPEED)));
    const targetZoom = base - beyond * 0.08 - boost * 0.05;
    const targetRot = -Math.PI / 2 - roadAngle;
    this.shake = Math.max(0, this.shake - dt * 3);

    if (!this.cameraReady) {
      this.cx = tx;
      this.cy = ty;
      this.zoom = targetZoom;
      this.rot = targetRot;
      this.cameraReady = true;
    }
    // Critically damped spring.
    const w = 5.2;
    this.cvx += (w * w * (tx - this.cx) - 2 * w * this.cvx) * dt;
    this.cvy += (w * w * (ty - this.cy) - 2 * w * this.cvy) * dt;
    this.cx += this.cvx * dt;
    this.cy += this.cvy * dt;
    const dr = Math.atan2(Math.sin(targetRot - this.rot), Math.cos(targetRot - this.rot));
    this.rot += dr * Math.min(1, dt * 3.2);
    this.zoom += (targetZoom - this.zoom) * (1 - Math.exp(-2 * dt));
    this.scale = (Math.min(this.vw, 520) / 390) * this.zoom;
  }

  /** World → CSS-pixel screen position (for overlays). */
  private toScreen(x: number, y: number): [number, number] {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const c = Math.cos(this.rot);
    const sn = Math.sin(this.rot);
    return [this.ax + (dx * c - dy * sn) * this.scale, this.ay + (dx * sn + dy * c) * this.scale];
  }


  // ───────────────────────── effects ─────────────────────────

  private paint: string | null = null;

  setModel(model: CarModel, paint: string | null = null): void {
    this.model = model;
    this.paint = paint;
  }

  /** World position of a local-frame point (x right, y rearward) on the car body incl. drift yaw. */
  private bodyPoint(car: Car, drift: number, lx: number, ly: number): [number, number] {
    const a = car.angle + drift;
    const fx = Math.cos(a);
    const fy = Math.sin(a);
    return [car.x - fy * lx - fx * ly, car.y + fx * lx - fy * ly];
  }

  addTrail(car: Car, active: boolean, time: number, drift = 0): void {
    if (active) {
      const start = !this.trailing;
      const [l, r] = this.model.rearWheels;
      const [lx, ly] = this.bodyPoint(car, drift, l[0], l[1]);
      const [rx, ry] = this.bodyPoint(car, drift, r[0], r[1]);
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
        smoke: false,
        x,
        y,
        vx: Math.cos(a) * sp - car.vx * 0.08,
        vy: Math.sin(a) * sp - car.vy * 0.08,
        age: 0,
        size: 1 + Math.random() * 2.2,
      });
    }
  }

  /** Bright sparks (crashes, takedowns). */
  spawnSparks(x: number, y: number, vx: number, vy: number, count: number): void {
    for (let i = 0; i < count && this.dust.length < MAX_DUST + 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 260;
      this.dust.push({
        smoke: false,
        spark: true,
        x,
        y,
        vx: Math.cos(a) * sp + vx * 0.4,
        vy: Math.sin(a) * sp + vy * 0.4,
        age: 0,
        size: 1 + Math.random() * 1.5,
      });
    }
  }

  /** Tyre smoke from the rear wheels while drifting. */
  spawnSmoke(car: Car, drift: number, amount: number): void {
    if (this.dust.length >= MAX_DUST) return;
    for (const w of this.model.rearWheels) {
      if (Math.random() > amount) continue;
      const [x, y] = this.bodyPoint(car, drift, w[0], w[1]);
      const a = Math.random() * Math.PI * 2;
      const sp = 8 + Math.random() * 18;
      this.dust.push({
        smoke: true,
        x,
        y,
        vx: Math.cos(a) * sp - car.vx * 0.12,
        vy: Math.sin(a) * sp - car.vy * 0.12,
        age: 0,
        size: 3 + Math.random() * 3,
      });
    }
  }

  spawnRipple(x: number, y: number, big = false): void {
    this.ripples.push({ x, y, age: 0, big });
    if (big) this.ripples.push({ x, y, age: -0.12, big: false });
  }

  popup(x: number, y: number, text: string, accent = false, size = 13): void {
    this.popups.push({ x, y, text, age: 0, accent, size });
  }

  kick(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Clears transient effects (new run). */
  clearEffects(): void {
    this.popups.length = 0;
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
      if (p.age > (p.spark ? SPARK_LIFE : p.smoke ? SMOKE_LIFE : DUST_LIFE)) this.dust.splice(i, 1);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].age += dt;
      if (this.ripples[i].age > RIPPLE_LIFE) this.ripples.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].age += dt;
      if (this.popups[i].age > POPUP_LIFE) this.popups.splice(i, 1);
    }
  }

  // ───────────────────────── frame ─────────────────────────

  render(car: Car, track: Track, ghost: GhostPose | null, glow: number, fx: FrameFx): void {
    const { ctx, dpr, vw, vh } = this;
    const pal = this.theme.palette;
    const s = this.scale;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(pal.bg);
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // World transform: camera centre sits slightly below screen centre.
    const sh = this.shake * this.shake * 5;
    this.ax = vw * 0.5 + (sh ? (Math.random() - 0.5) * sh : 0);
    this.ay = vh * 0.5 + (sh ? (Math.random() - 0.5) * sh : 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.ax, this.ay);
    ctx.rotate(this.rot);
    ctx.scale(s, s);
    ctx.translate(-this.cx, -this.cy);

    // Rotated view: cull against a square that covers the whole screen.
    const half = Math.hypot(vw, vh) / 2 / s + 120;
    const view = { l: this.cx - half, r: this.cx + half, t: this.cy - half, b: this.cy + half };

    const popts: PropDrawOptions = { pal, night: fx.night, time: fx.time, pxScale: dpr * s };
    this.drawProps(track, popts, view);
    this.drawRoad(track, pal, view);
    this.drawPads(track, pal, view, fx.time);
    this.drawTrails(pal);
    this.drawDust(pal);
    this.drawApexes(track, pal, view);
    this.drawOrbs(track, pal, view, fx.time);
    this.drawPowerups(track, pal, view, fx.time);
    this.drawRipples(pal);
    if (ghost && ghost.alpha > 0.002) this.drawGhost(ghost, pal, fx);
    this.drawCar(car, pal, glow, fx);
    if (fx.shield > 0.01 || fx.magnet) this.drawAura(car, pal, fx);

    // Night: darken the world, then add light sources on top.
    if (fx.night > 0.05) this.drawNight(car, track, popts, view, fx);

    this.drawSparks(pal);
    this.drawStreaks(car, pal, view, Math.max(fx.boost, fx.nitro));
    this.drawPopups(pal);

    // Vignette
    if (this.vignette) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const lightness = (pal.bg[0] + pal.bg[1] + pal.bg[2]) / 765;
      ctx.globalAlpha = 0.42 - lightness * 0.3 + fx.night * 0.12;
      ctx.drawImage(this.vignette, 0, 0, this.canvas.width, this.canvas.height);
      ctx.globalAlpha = 1;
    }

    // Grain, anchored to the world so it reads as asphalt/paper texture.
    if (this.grain) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = this.grain;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private drawProps(track: Track, o: PropDrawOptions, v: View): void {
    const { ctx } = this;
    for (const p of track.props) {
      const m = p.r + 40;
      if (p.x < v.l - m || p.x > v.r + m || p.y < v.t - m || p.y > v.b + m) continue;
      drawProp(ctx, p.kind, p.x, p.y, p.r, p.seed, o, p.angle);
    }
  }

  private drawPowerups(track: Track, pal: Palette, v: View, time: number): void {
    const { ctx } = this;
    for (const u of track.powerups) {
      if (u.x < v.l || u.x > v.r || u.y < v.t || u.y > v.b) continue;
      if (u.taken && (u.age < 0 || u.age > 0.4)) continue;
      const t = u.taken ? u.age / 0.4 : 0;
      const bob = 1 + Math.sin(time * 4 + u.s) * 0.06;
      const r = 11 * bob * (1 + t * 1.2);
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.globalAlpha = 1 - t;
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
      halo.addColorStop(0, css(pal.accent, 0.35));
      halo.addColorStop(1, css(pal.accent, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(-r * 2.4, -r * 2.4, r * 4.8, r * 4.8);
      ctx.fillStyle = css(pal.road);
      ctx.strokeStyle = css(pal.accent);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + time * 0.8;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = css(pal.accent);
      ctx.fillStyle = css(pal.accent);
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const k = r / 11;
      ctx.scale(k, k);
      ctx.beginPath();
      if (u.kind === 0) {
        // Magnet
        ctx.moveTo(-4, -4);
        ctx.lineTo(-4, 1);
        ctx.arc(0, 1, 4, Math.PI, 0, true);
        ctx.lineTo(4, -4);
        ctx.stroke();
      } else if (u.kind === 1) {
        // Shield
        ctx.moveTo(0, -5.5);
        ctx.lineTo(4.5, -3.5);
        ctx.quadraticCurveTo(4.2, 3, 0, 5.5);
        ctx.quadraticCurveTo(-4.2, 3, -4.5, -3.5);
        ctx.closePath();
        ctx.stroke();
      } else if (u.kind === 2) {
        // Clock
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.moveTo(0, -3);
        ctx.lineTo(0, 0);
        ctx.lineTo(2.5, 1.5);
        ctx.stroke();
      } else {
        ctx.font = '700 8px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('2×', 0, 0.5);
      }
      ctx.restore();
    }
  }

  private drawAura(car: Car, pal: Palette, fx: FrameFx): void {
    const { ctx } = this;
    if (fx.shield > 0.01) {
      const pulse = 0.85 + 0.15 * Math.sin(fx.time * 6);
      ctx.strokeStyle = css(pal.accent, 0.55 * fx.shield * pulse);
      ctx.fillStyle = css(pal.accent, 0.08 * fx.shield);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(car.x, car.y, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (fx.magnet) {
      const t = (fx.time * 1.4) % 1;
      ctx.strokeStyle = css(pal.accent, 0.35 * (1 - t));
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(car.x, car.y, 30 + t * 90, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawSparks(pal: Palette): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of this.dust) {
      if (!p.spark) continue;
      const life = 1 - p.age / SPARK_LIFE;
      ctx.globalAlpha = life;
      ctx.strokeStyle = life > 0.5 ? 'rgba(255,240,210,1)' : css(pal.accent);
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawNight(car: Car, track: Track, o: PropDrawOptions, v: View, fx: FrameFx): void {
    const { ctx } = this;
    const pal = o.pal;
    ctx.save();
    // Darkness wash (deep blue-black), strength by zone darkness.
    ctx.fillStyle = `rgba(4,6,14,${(0.5 * fx.night).toFixed(3)})`;
    ctx.fillRect(v.l, v.t, v.r - v.l, v.b - v.t);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of track.props) {
      if (p.x < v.l - 80 || p.x > v.r + 80 || p.y < v.t - 80 || p.y > v.b + 80) continue;
      drawPropLight(ctx, p.kind, p.x, p.y, p.r, p.seed, o, p.angle);
    }
    // Orbs and apex arcs glow in the dark.
    const sprite = this.glowSprite(pal);
    for (const orb of track.orbs) {
      if (orb.taken || orb.x < v.l || orb.x > v.r || orb.y < v.t || orb.y > v.b) continue;
      ctx.globalAlpha = 0.35 * fx.night;
      ctx.drawImage(sprite, orb.x - 16, orb.y - 16, 32, 32);
    }
    ctx.globalAlpha = 1;
    // Player headlights.
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle + fx.drift + Math.PI / 2);
    drawHeadlights(ctx, Math.min(1, fx.night * 1.3), this.dpr * this.scale);
    ctx.restore();
  }

  private drawPads(track: Track, pal: Palette, v: View, time: number): void {
    const { ctx } = this;
    for (const pad of track.pads) {
      if (pad.x < v.l || pad.x > v.r || pad.y < v.t || pad.y > v.b) continue;
      ctx.save();
      ctx.translate(pad.x, pad.y);
      ctx.rotate(pad.angle + Math.PI / 2);
      const dim = pad.used ? 0.3 : 1;
      ctx.fillStyle = css(pal.accent, 0.09 * dim);
      ctx.beginPath();
      ctx.roundRect(-20, -34, 40, 68, 10);
      ctx.fill();
      ctx.strokeStyle = css(pal.accent);
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < 3; i++) {
        const y = 16 - i * 16;
        const wave = Math.max(0, Math.sin(time * 9 - i * 1.3));
        ctx.globalAlpha = (0.28 + 0.72 * wave) * dim;
        ctx.beginPath();
        ctx.moveTo(-11, y + 7);
        ctx.lineTo(0, y - 4);
        ctx.lineTo(11, y + 7);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawOrbs(track: Track, pal: Palette, v: View, time: number): void {
    const { ctx } = this;
    for (const o of track.orbs) {
      if (o.x < v.l || o.x > v.r || o.y < v.t || o.y > v.b) continue;
      if (o.taken) {
        if (o.age < 0 || o.age > 0.45) continue;
        const t = o.age / 0.45;
        ctx.strokeStyle = css(pal.accent, 0.7 * (1 - t));
        ctx.lineWidth = 1.6 * (1 - t) + 0.4;
        ctx.beginPath();
        ctx.arc(o.x, o.y, 4 + t * 18, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      const pulse = 0.5 + 0.5 * Math.sin(time * 4 - o.idx * 0.7);
      ctx.globalAlpha = 0.28 + 0.12 * pulse;
      ctx.drawImage(this.glowSprite(pal), o.x - 13, o.y - 13, 26, 26);
      ctx.globalAlpha = 1;
      ctx.fillStyle = css(pal.orb);
      ctx.beginPath();
      ctx.arc(o.x, o.y, 3.2 + pulse * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStreaks(car: Car, pal: Palette, v: View, boost: number): void {
    const speed = car.speed;
    const intensity = Math.min(1, Math.max(0, (speed - 400) / 200) + boost);
    if (intensity <= 0.01) return;
    const { ctx } = this;
    const w = v.r - v.l;
    const h = v.b - v.t;
    while (this.streaks.length < STREAK_COUNT) {
      this.streaks.push({ x: v.l + Math.random() * w, y: v.t + Math.random() * h });
    }
    ctx.strokeStyle = css(pal.edge);
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    const k = 0.07 + boost * 0.05;
    for (const st of this.streaks) {
      if (st.x < v.l || st.x > v.r || st.y < v.t || st.y > v.b) {
        // Respawn ahead of the car so lines stream past.
        st.x = car.x + car.vx * (0.6 + Math.random() * 0.9) + (Math.random() - 0.5) * w;
        st.y = car.y + car.vy * (0.6 + Math.random() * 0.9) + (Math.random() - 0.5) * h * 0.6;
      }
      ctx.globalAlpha = 0.11 * intensity;
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(st.x - car.vx * k, st.y - car.vy * k);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawPopups(pal: Palette): void {
    if (!this.popups.length) return;
    const { ctx, dpr } = this;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const t = p.age / POPUP_LIFE;
      const rise = (1 - Math.pow(1 - t, 3)) * 34;
      const pop = t < 0.12 ? 0.8 + (t / 0.12) * 0.25 : 1.05 - Math.min(0.05, (t - 0.12) * 0.2);
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.font = `600 ${(p.size * pop).toFixed(1)}px -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif`;
      ctx.fillStyle = p.accent ? css(pal.accent) : css(pal.edge, 0.9);
      const [sx, sy] = this.toScreen(p.x, p.y);
      ctx.fillText(p.text, sx, sy - rise);
    }
    ctx.restore();
  }

  private drawRoad(track: Track, pal: Palette, v: View): void {
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
    ctx.lineWidth = 3 / this.scale;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    spline(ctx, lx, ly, true, false);
    ctx.stroke();
    ctx.beginPath();
    spline(ctx, rx, ry, true, false);
    ctx.stroke();

    // Corner kerbs: red/white blocks on both edges of every corner.
    const n0 = nodes[0].s;
    ctx.lineCap = 'butt';
    ctx.lineWidth = 6;
    for (const c of track.corners) {
      const i0 = Math.max(a, Math.round((c.s0 - n0) / NODE_SPACING) - 1);
      const i1 = Math.min(b, Math.round((c.s1 - n0) / NODE_SPACING) + 1);
      if (i1 <= i0) continue;
      for (const side of [-1, 1]) {
        const off = side * (hw - 4);
        for (let i = i0; i < i1; i++) {
          const p = nodes[i];
          const q2 = nodes[i + 1];
          ctx.strokeStyle = i % 2 === 0 ? css(pal.accent) : css(pal.edge, 0.9);
          ctx.beginPath();
          ctx.moveTo(p.x + p.nx * off, p.y + p.ny * off);
          ctx.lineTo(q2.x + q2.nx * off, q2.y + q2.ny * off);
          ctx.stroke();
        }
      }
    }
    ctx.lineCap = 'round';

    // Reflector posts every 140px — strong, cheap sense of speed.
    ctx.fillStyle = css(pal.edge, 0.4);
    const off = hw + 10;
    for (let i = a; i <= b; i++) {
      const n = nodes[i];
      if (Math.round(n.s / NODE_SPACING) % 10 !== 0) continue;
      ctx.beginPath();
      ctx.arc(n.x - n.nx * off, n.y - n.ny * off, 1.7, 0, Math.PI * 2);
      ctx.moveTo(n.x + n.nx * off + 1.7, n.y + n.ny * off);
      ctx.arc(n.x + n.nx * off, n.y + n.ny * off, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
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
      if (p.spark) continue;
      const life = 1 - p.age / (p.smoke ? SMOKE_LIFE : DUST_LIFE);
      ctx.globalAlpha = p.smoke ? pal.dust[3] * 0.9 * life * life : pal.dust[3] * life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + (1 - life) * (p.smoke ? 3.2 : 1.5)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawApexes(track: Track, pal: Palette, v: View): void {
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
      if (r.age < 0) continue;
      const t = r.age / RIPPLE_LIFE;
      const e = 1 - Math.pow(1 - t, 3);
      ctx.strokeStyle = css(pal.accent, 0.55 * (1 - t));
      ctx.lineWidth = 0.6 + 2.2 * (1 - t);
      ctx.beginPath();
      ctx.arc(r.x, r.y, 6 + (r.big ? 96 : 64) * e, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawGhost(g: GhostPose, pal: Palette, fx: FrameFx): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle + Math.PI / 2);
    ctx.globalAlpha = g.alpha;
    drawCarModel(ctx, fx.ghostModel ?? this.model, {
      pal,
      steer: 0,
      glow: 0,
      nitro: 0,
      time: fx.time,
      worldAngle: g.angle,
      pxScale: this.dpr * this.scale,
      ghost: true,
    });
    ctx.restore();
  }

  private drawCar(car: Car, pal: Palette, glow: number, fx: FrameFx): void {
    const { ctx } = this;
    const angle = car.angle + fx.drift;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(angle + Math.PI / 2);
    drawCarModel(ctx, this.model, {
      pal,
      steer: car.steer - fx.drift * 1.2,
      glow,
      nitro: fx.nitro,
      time: fx.time,
      worldAngle: angle,
      pxScale: this.dpr * this.scale,
      ...(this.paint ? { paint: this.paint } : {}),
    });
    ctx.restore();
  }
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

