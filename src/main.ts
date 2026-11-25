import { AudioEngine } from './audio';
import { BASE_SPEED, Car, InputController, MAX_SPEED, autopilotSteer } from './car';
import { Renderer, type GhostPose } from './renderer';
import {
  GHOST_INTERVAL,
  GHOST_MAX_SAMPLES,
  loadBest,
  loadGhost,
  loadPrefs,
  saveBestRun,
  savePrefs,
} from './storage';
import { Theme } from './theme';
import { Track, distToPolyline, type TrackQuery } from './track';

type GameState = 'TITLE' | 'PLAYING';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('game');
const titleEl = $('title');
const bestEl = $('best');
const hudEl = $('hud');
const scoreEl = $('score');
const streakEl = $('streak');
const themeBtn = $<HTMLButtonElement>('btn-theme');
const audioBtn = $<HTMLButtonElement>('btn-audio');

// ───────────────────────── setup ─────────────────────────

const prefs = loadPrefs();
const theme = new Theme(prefs.theme);
const audio = new AudioEngine(prefs.muted);
const track = new Track((Math.random() * 2 ** 32) >>> 0);
const car = new Car();
const renderer = new Renderer(canvas, theme);

let state: GameState = 'TITLE';
let q: TrackQuery = track.nearest(car.x, car.y);
let time = 0;

// Run state
let streak = 0;
let bonus = 0;
let startS = 0;
let maxS = 0;
let runTime = 0;
let score = 0;
let glow = 0;

// Personal best + ghost
let bestScore = loadBest();
const ghostRun = loadGhost();
const recording: number[] = [];
let sampleClock = 0;
let dirtyBest = false;
let lastPersist = 0;

const fmt = (n: number): string => n.toLocaleString('en-US');

if (bestScore > 0) {
  bestEl.textContent = `BEST ${fmt(bestScore)}`;
  bestEl.hidden = false;
}

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

// ───────────────────────── HUD ─────────────────────────

let shownScore = -1;
let shownStreak = -1;

function renderHud(): void {
  if (score !== shownScore) {
    shownScore = score;
    scoreEl.textContent = fmt(score);
  }
  if (streak !== shownStreak) {
    shownStreak = streak;
    if (streak >= 2) {
      streakEl.textContent = `${streak}x FLOW`;
      streakEl.classList.add('show');
    } else {
      // Text stays during the 300ms fade-out.
      streakEl.classList.remove('show');
    }
  }
}

function syncButtons(): void {
  themeBtn.dataset.state = theme.name;
  themeBtn.setAttribute('aria-label', theme.name === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  audioBtn.dataset.state = audio.isMuted ? 'off' : 'on';
  audioBtn.setAttribute('aria-label', audio.isMuted ? 'Unmute audio' : 'Mute audio');
}
syncButtons();

themeBtn.addEventListener('click', () => {
  theme.toggle();
  prefs.theme = theme.name;
  savePrefs(prefs);
  syncButtons();
  themeBtn.blur();
});

audioBtn.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.isMuted);
  prefs.muted = audio.isMuted;
  savePrefs(prefs);
  syncButtons();
  audioBtn.blur();
});

// ───────────────────────── state machine ─────────────────────────

function startRun(): void {
  state = 'PLAYING';
  startS = q.s;
  maxS = q.s;
  runTime = 0;
  streak = 0;
  bonus = 0;
  score = 0;
  for (const ap of track.apexes) if (ap.s < q.s + 30) ap.passed = true;
  input.consumeActive();
  titleEl.classList.add('hidden');
  hudEl.classList.add('playing');
}

const input = new InputController(canvas, () => {
  audio.unlock();
  if (state === 'TITLE') startRun();
});

function breakStreak(): void {
  if (streak > 0) streak = 0;
}

function persistBest(force = false): void {
  if (!dirtyBest) return;
  if (!force && time - lastPersist < 3) return;
  lastPersist = time;
  dirtyBest = false;
  saveBestRun(bestScore, recording);
}

// ───────────────────────── ghost ─────────────────────────

function ghostPose(): GhostPose | null {
  if (state !== 'PLAYING' || !ghostRun) return null;
  const s = ghostRun.samples;
  const count = s.length / 3;
  const f = runTime / GHOST_INTERVAL;
  const i = Math.floor(f);
  if (i + 1 >= count) return null;
  const t = f - i;
  const ds = s[i * 3] + (s[i * 3 + 3] - s[i * 3]) * t;
  const lat = s[i * 3 + 1] + (s[i * 3 + 4] - s[i * 3 + 1]) * t;
  const rel = (s[i * 3 + 2] + (s[i * 3 + 5] - s[i * 3 + 2]) * t) / 1000;
  const p = track.poseAt(startS + ds);
  if (!p) return null;
  // Fade in at start and out near the end of the recording.
  const remain = (count - 1 - f) * GHOST_INTERVAL;
  const alpha = 0.18 * Math.min(1, runTime / 0.8, remain / 0.8);
  return { x: p.x + p.nx * lat, y: p.y + p.ny * lat, angle: p.angle + rel, alpha };
}

function recordGhost(dt: number): void {
  sampleClock += dt;
  while (sampleClock >= GHOST_INTERVAL) {
    sampleClock -= GHOST_INTERVAL;
    if (recording.length / 3 >= GHOST_MAX_SAMPLES) return;
    const p = track.poseAt(q.s);
    const rel = p ? wrapAngle(car.angle - p.angle) : 0;
    recording.push(Math.round(q.s - startS), Math.round(q.lateral), Math.round(rel * 1000));
  }
}

// ───────────────────────── loop ─────────────────────────

let last = performance.now();

// Dev-only hook for automated testing (stripped from production builds).
let debugAutopilot = false;
if (import.meta.env.DEV) {
  Object.assign(window, {
    __flow: {
      car,
      track,
      get state() {
        return { state, streak, score, bestScore, samples: recording.length / 3 };
      },
      autopilot(on: boolean) {
        debugAutopilot = on;
      },
    },
  });
}

function frame(now: number): void {
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
  last = now;
  time += dt;

  track.update(q.s);
  const onRoadBefore = Math.abs(q.lateral) <= track.halfWidth;
  const steer = state === 'TITLE' || debugAutopilot ? autopilotSteer(car, track, q) : input.steer;
  let target = Math.min(MAX_SPEED, BASE_SPEED + streak * 14);
  if (!onRoadBefore) target *= 0.72;
  car.update(dt, steer, target);

  q = track.nearest(car.x, car.y);
  const onRoad = Math.abs(q.lateral) <= track.halfWidth;

  // Soft cushion: off the asphalt, a gentle pull grows with distance so the
  // road never leaves the screen and nobody gets lost in the void.
  if (!onRoad) {
    const p = track.poseAt(q.s);
    if (p) {
      const excess = Math.abs(q.lateral) - track.halfWidth;
      const pull = Math.min(60 + excess * 2.4, 320) * dt * Math.sign(q.lateral);
      car.vx -= p.nx * pull;
      car.vy -= p.ny * pull;
    }
  }

  // Apex zones (sorted by s).
  for (const ap of track.apexes) {
    if (ap.fade >= 0) ap.fade += dt;
    if (ap.collected || ap.passed) continue;
    if (ap.s > q.s + 90) break;
    if (state === 'PLAYING' && distToPolyline(car.x, car.y, ap.pts) < 26) {
      ap.collected = true;
      ap.fade = 0;
      streak += 1;
      bonus += 100 * streak;
      car.boost(25);
      renderer.spawnRipple(ap.mx, ap.my);
      audio.chime(streak - 1);
      navigator.vibrate?.(8);
    } else if (q.s > ap.s + 70) {
      ap.passed = true;
      if (state === 'PLAYING') breakStreak();
    }
  }

  if (state === 'PLAYING') {
    runTime += dt;
    if (!onRoad) breakStreak();
    maxS = Math.max(maxS, q.s);
    score = Math.floor((maxS - startS) / 10) + bonus;
    recordGhost(dt);
    if (score > bestScore) {
      bestScore = score;
      dirtyBest = true;
    }
    persistBest();
  }

  // Effects
  const slip = Math.abs(car.vLateral);
  renderer.addTrail(car, onRoad && slip > 24, time);
  if (!onRoad && car.speed > 60) renderer.spawnDust(car);
  glow += ((slip > 28 ? 1 : 0) - glow) * (1 - Math.exp(-8 * dt));
  renderer.updateEffects(dt, time);
  renderer.updateCamera(dt, car);
  theme.update(dt);

  const speedNorm = Math.min(1, Math.max(0, (car.speed - BASE_SPEED * 0.7) / (MAX_SPEED - BASE_SPEED * 0.7)));
  audio.update(speedNorm, slip, onRoad);

  renderer.render(car, track, ghostPose(), glow);
  if (state === 'PLAYING') renderHud();

  requestAnimationFrame(frame);
}

requestAnimationFrame((t) => {
  last = t;
  frame(t);
});

// ───────────────────────── platform ─────────────────────────

let resizeQueued = false;
const onResize = (): void => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    renderer.resize();
  });
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    persistBest(true);
    audio.suspend();
    input.reset();
  } else {
    last = performance.now();
    if (state === 'PLAYING') audio.unlock();
  }
});
window.addEventListener('pagehide', () => persistBest(true));

// Block iOS pinch / double-tap zoom gestures.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is best-effort */
    });
  });
}
