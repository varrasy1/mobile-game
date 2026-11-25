import { AudioEngine } from './audio';
import { BASE_SPEED, Car, InputController, TOP_SPEED, autopilotSteer, followSteer } from './car';
import { CARS, carById, drawCar as drawCarModel, type CarModel } from './cars';
import { Progress, emptyRun, type Mission, type RunStats } from './progress';
import { Renderer, type GhostPose } from './renderer';
import {
  GHOST_INTERVAL,
  GHOST_MAX_SAMPLES,
  loadBest,
  loadGhost,
  loadPrefs,
  saveBestRun,
  savePrefs,
  type GhostRun,
} from './storage';
import { Theme } from './theme';
import { Track, distToPolyline, type TrackQuery } from './track';

/**
 * TITLE → PLAYING → ENDING (time ran out, car eases off) → RESULTS → PLAYING …
 * The canvas, track and car are never reset: every run continues seamlessly.
 */
type GameState = 'TITLE' | 'PLAYING' | 'ENDING' | 'RESULTS';

// ───────────────────────── tuning ─────────────────────────

const SECTOR_LENGTH = 15000; // px → 1.5 km between checkpoints
const LANE_OVERHANG = 26;
const START_TIME = 30;
const MAX_TIME = 60;
const OFFROAD_DRAIN = 0.6; // extra seconds per second off the asphalt
const T_APEX = 0.8;
const T_PERFECT = 1.6;
const T_CHAIN = 1.5;
const T_PAD = 0.4;
const T_DRIFT = [0, 0.5, 1.2, 2.5];
const PERFECT_DIST = 15;
const APEX_DIST = 26;
const CHAIN_LENGTH = 11;
const BOOST_TIME = 1.4;
const BOOST_SPEED = 150;
const NITRO_SPEED = 150;
const NITRO_MIN = 0.25;
const DRIFT_TIERS = [0.7, 1.5, 2.5]; // seconds → GOOD / GREAT / INSANE
const DRIFT_NAMES = ['', 'GOOD DRIFT', 'GREAT DRIFT', 'INSANE DRIFT'];
const KMH = 0.6;

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
const multEl = $('mult');
const timeEl = $('time');
const timerEl = $('timer');
const cpFill = $('cp-fill');
const speedEl = $('speed');
const driftEl = $('drift');
const bannerEl = $('banner');
const hintEl = $('hint');
const resultsEl = $('results');
const nitroBtn = $<HTMLButtonElement>('nitro');
const nitroRing = $('nitro-ring');
const themeBtn = $<HTMLButtonElement>('btn-theme');
const audioBtn = $<HTMLButtonElement>('btn-audio');
const metaLevel = $('meta-level');
const metaXp = $('meta-xp-fill');
const metaCoins = $('meta-coins');
const missionsEl = $('missions');
const garageEl = $('garage');
const garageCanvas = $<HTMLCanvasElement>('garage-canvas');

// ───────────────────────── setup ─────────────────────────

const prefs = loadPrefs();
const theme = new Theme(prefs.theme);
const audio = new AudioEngine(prefs.muted);
const progress = new Progress();
const track = new Track((Math.random() * 2 ** 32) >>> 0);
const car = new Car();
const renderer = new Renderer(canvas, theme);

let model: CarModel = carById(progress.selected);
let speedBonus = 0;
let laneSpeed = 240;
let nitroFactor = 1;

function applyModel(m: CarModel): void {
  model = m;
  renderer.setModel(m);
  speedBonus = (m.stats.speed - 2) * 14;
  laneSpeed = 220 + (m.stats.handling - 2) * 28;
  car.handling = (m.stats.handling - 2) * 0.12;
  nitroFactor = 0.8 + m.stats.nitro * 0.12;
}
applyModel(model);

let state: GameState = 'TITLE';
let stateTime = 0;
let q: TrackQuery = track.nearest(car.x, car.y);
let time = 0;

// Run state
let run: RunStats = emptyRun();
let streak = 0;
let bonus = 0;
let distPts = 0;
let startS = 0;
let maxS = 0;
let runTime = 0;
let score = 0;
let timeLeft = START_TIME;
let sector = 0;
let chainIdx = -1;
let chainCount = 0;
let boostT = 0;
let glow = 0;
let newBest = false;
let lane = 0;
let lastTick = 0;

// Drift + nitro
let drifting = false;
let driftSide = 0;
let driftT = 0;
let driftPts = 0;
let driftTier = 0;
let driftGrace = 0;
let driftRelease = 0;
let driftAngle = 0;
let nitro = 0; // charge 0…1
let nitroT = 0; // seconds of burn left
let nitroDur = 1;

// Personal best + ghost
let bestScore = loadBest();
let ghostRun: GhostRun | null = loadGhost();
let recording: number[] = [];
let sampleClock = 0;
let dirtyBest = false;
let lastPersist = 0;

const fmt = (n: number): string => Math.floor(n).toLocaleString('en-US');
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const COIN = '◈';

// ───────────────────────── meta UI ─────────────────────────

function missionLine(m: Mission, current?: number): string {
  const prog = current !== undefined && !m.done ? `<em>${fmt(Math.min(current, m.goal))}/${fmt(m.goal)}</em>` : '';
  return `<li class="${m.done ? 'done' : ''}"><span class="m-check">${m.done ? '✓' : ''}</span><span class="m-text">${m.text}</span>${prog}<span class="m-reward">${COIN} ${m.reward}</span></li>`;
}

function renderMeta(): void {
  metaLevel.textContent = `LV ${progress.level}`;
  metaXp.style.transform = `scaleX(${progress.levelProgress.toFixed(3)})`;
  metaCoins.textContent = `${COIN} ${fmt(progress.coins)}`;
  missionsEl.innerHTML = progress.missions.map((m) => missionLine(m)).join('');
  if (bestScore > 0) {
    bestEl.textContent = `BEST ${fmt(bestScore)}`;
    bestEl.hidden = false;
  }
}
renderMeta();

// ───────────────────────── HUD ─────────────────────────

let shown = { score: -1, mult: -1, time: -1, speed: -1, drift: '', nitro: -1 };
let bannerTimer: number | undefined;
let driftTimer: number | undefined;

function renderHud(): void {
  if (score !== shown.score) {
    shown.score = score;
    scoreEl.textContent = fmt(score);
  }
  if (streak !== shown.mult) {
    shown.mult = streak;
    if (streak >= 2) {
      multEl.textContent = `${streak}x FLOW`;
      multEl.classList.add('show');
      multEl.classList.remove('bump');
      void multEl.offsetWidth;
      multEl.classList.add('bump');
    } else multEl.classList.remove('show');
  }
  const t = Math.ceil(Math.max(0, timeLeft));
  if (t !== shown.time) {
    shown.time = t;
    timeEl.textContent = String(t);
  }
  timerEl.classList.toggle('low', state === 'PLAYING' && timeLeft < 8);
  cpFill.style.transform = `scaleX(${(((maxS - startS) % SECTOR_LENGTH) / SECTOR_LENGTH).toFixed(4)})`;
  const kmh = Math.round(car.speed * KMH);
  if (kmh !== shown.speed) {
    shown.speed = kmh;
    speedEl.innerHTML = `${kmh}<small>km/h</small>`;
  }
  const n = Math.round(nitro * 100);
  if (n !== shown.nitro || nitroT > 0) {
    shown.nitro = n;
    const v = nitroT > 0 ? nitroT / nitroDur : nitro;
    nitroRing.style.strokeDashoffset = String((1 - v) * 163.4);
    nitroBtn.classList.toggle('ready', nitro >= NITRO_MIN && nitroT <= 0);
    nitroBtn.classList.toggle('burning', nitroT > 0);
  }
}

function banner(text: string, sub = ''): void {
  bannerEl.innerHTML = sub ? `${text}<small>${sub}</small>` : text;
  bannerEl.classList.add('show');
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => bannerEl.classList.remove('show'), 1900);
}

function showDrift(text: string, hold = false): void {
  if (text === shown.drift && hold) return;
  shown.drift = text;
  driftEl.textContent = text;
  driftEl.classList.add('show');
  window.clearTimeout(driftTimer);
  if (!hold) driftTimer = window.setTimeout(() => driftEl.classList.remove('show'), 1100);
}

function hideDrift(): void {
  shown.drift = '';
  driftEl.classList.remove('show');
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

// ───────────────────────── garage ─────────────────────────

let garageOpen = false;
let garageIdx = Math.max(0, CARS.findIndex((c) => c.id === model.id));

function statBars(v: number): string {
  return Array.from({ length: 5 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('');
}

function renderGarage(): void {
  const c = CARS[garageIdx];
  const owned = progress.owned.includes(c.id);
  const selected = progress.selected === c.id;
  const levelOk = progress.level >= c.level;
  $('g-coins').textContent = `${COIN} ${fmt(progress.coins)}`;
  $('g-level').textContent = `LV ${progress.level}`;
  $('g-name').textContent = c.name;
  $('g-tag').textContent = c.tagline;
  $('g-count').textContent = `${garageIdx + 1} / ${CARS.length}`;
  $('g-stats').innerHTML = `
    <div><span>SPEED</span><b>${statBars(c.stats.speed)}</b></div>
    <div><span>HANDLING</span><b>${statBars(c.stats.handling)}</b></div>
    <div><span>NITRO</span><b>${statBars(c.stats.nitro)}</b></div>`;
  const btn = $<HTMLButtonElement>('g-action');
  btn.disabled = false;
  btn.className = '';
  if (selected) {
    btn.textContent = 'SELECTED';
    btn.disabled = true;
  } else if (owned) btn.textContent = 'SELECT';
  else if (!levelOk) {
    btn.textContent = `UNLOCKS AT LV ${c.level}`;
    btn.disabled = true;
    btn.className = 'locked';
  } else if (progress.coins < c.price) {
    btn.textContent = `${COIN} ${fmt(c.price)}`;
    btn.disabled = true;
    btn.className = 'locked';
  } else {
    btn.textContent = `BUY ${COIN} ${fmt(c.price)}`;
    btn.className = 'buy';
  }
}

function openGarage(): void {
  if (state === 'PLAYING' || state === 'ENDING') return;
  garageOpen = true;
  garageIdx = Math.max(0, CARS.findIndex((c) => c.id === model.id));
  renderGarage();
  garageEl.classList.add('show');
  audio.unlock();
}

function closeGarage(): void {
  garageOpen = false;
  garageEl.classList.remove('show');
  renderMeta();
}

document.querySelectorAll<HTMLButtonElement>('.garage-open').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    openGarage();
    b.blur();
  }),
);
$('g-close').addEventListener('click', closeGarage);
$('g-prev').addEventListener('click', () => {
  garageIdx = (garageIdx + CARS.length - 1) % CARS.length;
  renderGarage();
  audio.blip(2, 0.03);
});
$('g-next').addEventListener('click', () => {
  garageIdx = (garageIdx + 1) % CARS.length;
  renderGarage();
  audio.blip(4, 0.03);
});
$('g-action').addEventListener('click', () => {
  const c = CARS[garageIdx];
  if (progress.owned.includes(c.id)) progress.select(c.id);
  else if (progress.level >= c.level && progress.buy(c.id, c.price)) {
    audio.chord();
    navigator.vibrate?.([12, 40, 12]);
  } else return;
  applyModel(c);
  renderGarage();
});

function drawGaragePreview(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = garageCanvas.clientWidth;
  const h = garageCanvas.clientHeight;
  if (garageCanvas.width !== Math.round(w * dpr)) {
    garageCanvas.width = Math.round(w * dpr);
    garageCanvas.height = Math.round(h * dpr);
  }
  const g = garageCanvas.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, garageCanvas.width, garageCanvas.height);
  const c = CARS[garageIdx];
  const scale = Math.min(w / 34, h / 52);
  const angle = -Math.PI / 2 + Math.sin(time * 0.6) * 0.5;
  g.setTransform(dpr * scale, 0, 0, dpr * scale, (dpr * w) / 2, (dpr * h) / 2);
  g.rotate(angle + Math.PI / 2);
  const locked = !progress.owned.includes(c.id);
  g.globalAlpha = locked ? 0.55 : 1;
  drawCarModel(g, c, {
    pal: theme.palette,
    steer: Math.sin(time * 1.3) * 0.6,
    glow: 0.5 + 0.5 * Math.sin(time * 2),
    nitro: locked ? 0 : 0.6 + 0.4 * Math.sin(time * 5),
    time,
    worldAngle: angle,
    pxScale: dpr * scale,
  });
}

// ───────────────────────── state machine ─────────────────────────

let hinted = false;
try {
  hinted = localStorage.getItem('flowline.hinted.v2') === '1';
} catch {
  /* ignore */
}

function setState(next: GameState): void {
  state = next;
  stateTime = 0;
}

function startRun(): void {
  setState('PLAYING');
  run = emptyRun();
  startS = maxS = q.s;
  runTime = 0;
  streak = 0;
  bonus = distPts = score = 0;
  timeLeft = START_TIME;
  sector = 0;
  chainIdx = -1;
  chainCount = 0;
  boostT = 0;
  drifting = false;
  driftAngle = 0;
  nitro = 0;
  nitroT = 0;
  newBest = false;
  recording = [];
  sampleClock = 0;
  shown = { score: -1, mult: -1, time: -1, speed: -1, drift: '', nitro: -1 };
  lane = q.lateral;
  theme.setMood(0);
  for (const ap of track.apexes) if (ap.s < q.s + 30) ap.passed = true;
  for (const o of track.orbs) if (o.s < q.s + 30) o.taken = true;
  input.consumeActive();
  renderer.clearEffects();
  titleEl.classList.add('hidden');
  resultsEl.classList.remove('show');
  hudEl.classList.add('playing');
  if (!hinted) {
    hintEl.classList.add('show');
    window.setTimeout(() => hintEl.classList.remove('show'), 6500);
    hinted = true;
    try {
      localStorage.setItem('flowline.hinted.v2', '1');
    } catch {
      /* ignore */
    }
  }
}

function endRun(): void {
  setState('ENDING');
  endDrift(false);
  nitroT = 0;
  streak = 0;
  hideDrift();
  banner('TIME UP');
  audio.fadeOut();
  navigator.vibrate?.([20, 60, 20]);
  if (newBest) {
    persistBest(true);
    ghostRun = { score: bestScore, samples: recording.slice() };
  }
}

function showResults(): void {
  setState('RESULTS');
  run.score = score;
  const levelBefore = progress.level;
  const missionsThisRun = progress.missions.map((m) => ({ ...m }));
  const missionCoins = missionsThisRun.filter((m) => m.done).reduce((a, m) => a + m.reward, 0);
  const res = progress.finishRun(run);
  const dist = Math.floor((maxS - startS) / 10);
  const earned = run.coins + missionCoins + res.levelCoins;
  resultsEl.innerHTML = `
    <div class="r-label">${newBest ? '<span class="r-best">NEW BEST</span>' : `SECTOR ${run.sector}`}</div>
    <div class="r-score">${fmt(score)}</div>
    <div class="r-stats">
      <div><b>${fmt(dist)}</b><span>meters</span></div>
      <div><b>${run.streak}x</b><span>best flow</span></div>
      <div><b>${run.perfects}</b><span>perfect</span></div>
      <div><b>${fmt(run.bestDrift)}</b><span>best drift</span></div>
    </div>
    <div class="r-xp">
      <div class="r-xp-row"><span>LV ${progress.level}${res.levelsGained ? ' <b class="r-up">LEVEL UP!</b>' : ''}</span><span>+${fmt(res.xpGained)} XP</span></div>
      <div class="xp-bar"><div style="transform:scaleX(${progress.levelProgress.toFixed(3)})"></div></div>
    </div>
    <div class="r-coins">+${COIN} ${fmt(earned)}</div>
    <ul class="r-missions">${missionsThisRun.map((m) => missionLine(m, run[m.stat])).join('')}</ul>
    <div class="r-actions"><button type="button" class="garage-btn garage-open-r">GARAGE${unlockable() ? ' <i class="dot"></i>' : ''}</button></div>
    <div class="r-prompt">Tap to drive again</div>`;
  resultsEl.querySelector('.garage-open-r')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openGarage();
  });
  resultsEl.classList.add('show');
  hudEl.classList.remove('playing');
  if (progress.level > levelBefore) {
    audio.chord();
    navigator.vibrate?.([15, 50, 15, 50, 25]);
  }
  renderMeta();
}

/** True if any car can be bought right now (shows a dot on the garage button). */
function unlockable(): boolean {
  return CARS.some((c) => !progress.owned.includes(c.id) && progress.level >= c.level && progress.coins >= c.price);
}

const input = new InputController(canvas, () => {
  audio.unlock();
  if (garageOpen) return;
  if (state === 'TITLE') startRun();
  else if (state === 'RESULTS' && stateTime > 0.8) startRun();
});

function fireNitro(): void {
  if (state !== 'PLAYING' || nitroT > 0 || nitro < NITRO_MIN) return;
  nitroDur = (0.8 + 2.6 * nitro) * nitroFactor;
  nitroT = nitroDur;
  nitro = 0;
  run.nitros++;
  car.boost(90);
  renderer.kick(0.6);
  audio.boost();
  banner('NITRO');
  navigator.vibrate?.(25);
}

nitroBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  e.stopPropagation();
  audio.unlock();
  fireNitro();
});
nitroBtn.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  fireNitro();
});
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    if (state === 'PLAYING') {
      e.preventDefault();
      fireNitro();
    }
  }
  if (e.code === 'Escape' && garageOpen) closeGarage();
});

function breakStreak(): void {
  streak = 0;
}

function addScore(pts: number): void {
  bonus += pts * (nitroT > 0 ? 2 : 1);
}

function addTime(t: number): void {
  timeLeft = Math.min(MAX_TIME, timeLeft + t);
}

function addCoins(n: number): void {
  run.coins += n;
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

// ───────────────────────── gameplay ─────────────────────────

function collectApex(ap: (typeof track.apexes)[number]): void {
  const perfect = ap.best < PERFECT_DIST;
  ap.collected = true;
  ap.fade = 0;
  streak += 1;
  run.streak = Math.max(run.streak, streak);
  const pts = 100 * streak * (perfect ? 2 : 1);
  addScore(pts);
  addTime(perfect ? T_PERFECT : T_APEX);
  car.boost(perfect ? 40 : 25);
  renderer.spawnRipple(ap.mx, ap.my, perfect);
  renderer.popup(ap.mx, ap.my - 10, perfect ? `PERFECT +${fmt(pts)}` : `+${fmt(pts)}`, perfect, perfect ? 15 : 13);
  if (perfect) {
    run.perfects++;
    nitro = Math.min(1, nitro + 0.12 * nitroFactor);
    renderer.kick(0.35);
    navigator.vibrate?.([10, 40, 14]);
  } else navigator.vibrate?.(8);
  audio.chime(streak - 1);
}

/** Apex zones: track the closest approach while inside, grade on exit. */
function updateApexes(dt: number, playing: boolean): void {
  for (const ap of track.apexes) {
    if (ap.fade >= 0) ap.fade += dt;
    if (ap.collected || ap.passed) continue;
    if (ap.s > q.s + 90) break;
    const d = playing ? distToPolyline(car.x, car.y, ap.pts) : Infinity;
    if (d < APEX_DIST) {
      ap.best = Math.min(ap.best, d);
      if (d > ap.best + 4 || q.s > ap.s + 56) collectApex(ap);
    } else if (ap.best < APEX_DIST) {
      collectApex(ap);
    } else if (q.s > ap.s + 70) {
      ap.passed = true;
      if (playing) breakStreak();
    }
  }
}

function updateOrbs(dt: number, playing: boolean): void {
  for (const o of track.orbs) {
    if (o.taken) {
      if (o.age >= 0) o.age += dt;
      continue;
    }
    if (o.s > q.s + 60) break;
    if (!playing) {
      if (o.s < q.s - 20) o.taken = true;
      continue;
    }
    const dx = o.x - car.x;
    const dy = o.y - car.y;
    if (dx * dx + dy * dy < 21 * 21) {
      o.taken = true;
      o.age = 0;
      chainCount = o.idx === chainIdx + 1 ? chainCount + 1 : o.idx === 0 ? 1 : 0;
      chainIdx = o.idx;
      addScore(10 * Math.max(1, streak));
      addCoins(1);
      audio.blip(o.idx);
      if (chainCount === CHAIN_LENGTH) {
        const pts = 250 * Math.max(1, streak);
        addScore(pts);
        addTime(T_CHAIN);
        addCoins(5);
        run.chains++;
        renderer.popup(car.x, car.y - 30, `CHAIN +${fmt(pts)}  ${COIN}5`, true, 14);
        navigator.vibrate?.(12);
      }
    } else if (o.s < q.s - 24) {
      o.taken = true;
      chainIdx = -1;
      chainCount = 0;
    }
  }
}

function updatePads(playing: boolean): void {
  if (!playing) return;
  for (const pad of track.pads) {
    if (pad.used) continue;
    if (pad.s > q.s + 40) break;
    if (Math.abs(pad.s - q.s) < 34 && Math.abs(q.lateral - pad.lat) < 26) {
      pad.used = true;
      boostT = BOOST_TIME;
      car.boost(110);
      addTime(T_PAD);
      addScore(50 * Math.max(1, streak));
      nitro = Math.min(1, nitro + 0.08 * nitroFactor);
      renderer.kick(0.5);
      renderer.popup(car.x, car.y - 28, 'BOOST', true, 14);
      audio.boost();
      navigator.vibrate?.(15);
    }
  }
}

// ── Drift: hold toward the inside of a bend to throw the tail out ──

function endDrift(clean: boolean): void {
  if (!drifting) return;
  drifting = false;
  if (driftTier > 0) {
    if (clean) {
      const pts = Math.floor(driftPts);
      addScore(pts);
      addTime(T_DRIFT[driftTier]);
      run.bestDrift = Math.max(run.bestDrift, pts);
      if (driftTier === 3) run.insane++;
      showDrift(`${DRIFT_NAMES[driftTier]} +${fmt(pts)}`);
      audio.blip(5 + driftTier * 2, 0.06);
      navigator.vibrate?.(10);
    } else {
      showDrift('DRIFT LOST');
    }
  } else hideDrift();
  driftT = driftPts = 0;
  driftTier = 0;
}

function updateDrift(dt: number, cmd: number, onRoad: boolean): void {
  const kAhead = track.curvatureAt(q.s + car.speed * 0.15);
  const bendSide = Math.abs(kAhead) > 0.0011 ? Math.sign(kAhead) : 0;
  if (!onRoad) {
    endDrift(false);
    return;
  }
  if (!drifting) {
    if (bendSide !== 0 && cmd * bendSide > 0.25 && car.speed > 200) {
      drifting = true;
      driftSide = bendSide;
      driftT = driftPts = 0;
      driftTier = 0;
      driftGrace = driftRelease = 0;
    }
    return;
  }
  // Keep drifting while held into the bend; brief straights are forgiven.
  driftGrace = bendSide === driftSide ? 0 : driftGrace + dt;
  driftRelease = cmd * driftSide > 0.1 ? 0 : driftRelease + dt;
  if (driftGrace > 0.35 || driftRelease > 0.12) {
    endDrift(true);
    return;
  }
  driftT += dt;
  const tier = driftT >= DRIFT_TIERS[2] ? 3 : driftT >= DRIFT_TIERS[1] ? 2 : driftT >= DRIFT_TIERS[0] ? 1 : 0;
  driftPts += 150 * Math.max(1, tier) * (1 + streak * 0.1) * dt;
  nitro = Math.min(1, nitro + 0.32 * nitroFactor * dt);
  if (tier > driftTier) {
    driftTier = tier;
    audio.blip(3 + tier * 2, 0.05);
    if (tier === 3) renderer.kick(0.25);
  }
  if (tier > 0) showDrift(`${DRIFT_NAMES[tier]} ${fmt(driftPts)}`, true);
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
      Car,
      Track,
      progress,
      get state() {
        return {
          state,
          streak,
          score,
          bestScore,
          timeLeft,
          sector,
          lane,
          nitro,
          drifting,
          driftTier,
          run,
          samples: recording.length / 3,
        };
      },
      autopilot(on: boolean) {
        debugAutopilot = on;
      },
      setTime(v: number) {
        timeLeft = v;
      },
      fireNitro,
    },
  });
}

function frame(now: number): void {
  // Schedule first so one bad frame can never freeze the game.
  requestAnimationFrame(frame);
  try {
    step(now);
  } catch (err) {
    if (import.meta.env.DEV) console.error(err);
  }
}

function step(now: number): void {
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
  last = now;
  time += dt;
  stateTime += dt;
  const playing = state === 'PLAYING';

  track.update(q.s);
  const onRoadBefore = Math.abs(q.lateral) <= track.halfWidth;

  let steer: number;
  let cmd = 0;
  if (!playing || debugAutopilot) {
    steer = autopilotSteer(car, track, q);
    lane = q.lateral;
  } else {
    cmd = input.steer;
    if (import.meta.env.DEV) {
      const bot = (window as { __botSteer?: () => number }).__botSteer;
      if (bot) cmd = bot();
    }
    const limit = track.halfWidth + LANE_OVERHANG;
    const rate = laneSpeed * (drifting ? 0.3 : 1);
    lane = Math.max(-limit, Math.min(limit, lane + cmd * rate * dt));
    steer = followSteer(car, track, q, lane);
  }

  boostT = Math.max(0, boostT - dt);
  nitroT = Math.max(0, nitroT - dt);
  const boostAmt = boostT / BOOST_TIME;
  const nitroAmt = nitroT > 0 ? Math.min(1, nitroT / 0.4, 0.6 + 0.4 * (nitroT / nitroDur)) : 0;
  let target: number;
  if (state === 'ENDING' || state === 'RESULTS') target = 150;
  else
    target =
      Math.min(TOP_SPEED + speedBonus, BASE_SPEED + speedBonus + streak * 12 + sector * 22) +
      BOOST_SPEED * boostAmt +
      (nitroT > 0 ? NITRO_SPEED : 0);
  if (drifting) target *= 0.97;
  if (!onRoadBefore) target *= 0.72;
  car.update(dt, steer, target);

  q = track.nearest(car.x, car.y);
  const onRoad = Math.abs(q.lateral) <= track.halfWidth;

  // Soft cushion: off the asphalt, a gentle pull grows with distance.
  if (!onRoad) {
    const p = track.poseAt(q.s);
    if (p) {
      const excess = Math.abs(q.lateral) - track.halfWidth;
      const pull = Math.min(60 + excess * 2.4, 320) * dt * Math.sign(q.lateral);
      car.vx -= p.nx * pull;
      car.vy -= p.ny * pull;
    }
  }

  updateApexes(dt, playing);
  updateOrbs(dt, playing);
  updatePads(playing);

  if (playing) {
    runTime += dt;
    if (!onRoad) breakStreak();
    updateDrift(dt, cmd, onRoad);

    if (q.s > maxS) {
      distPts += ((q.s - maxS) / 10) * (nitroT > 0 ? 2 : 1);
      maxS = q.s;
    }

    const nextSector = Math.floor((maxS - startS) / SECTOR_LENGTH);
    if (nextSector > sector) {
      sector = nextSector;
      run.sector = sector + 1;
      theme.setMood(sector);
      const extra = Math.max(10, 22 - 2 * sector);
      addTime(extra);
      addScore(1000 * sector);
      addCoins(10 * sector);
      banner('CHECKPOINT', `+${extra}s · SECTOR ${sector + 1}`);
      audio.chord();
      navigator.vibrate?.([12, 50, 12]);
    }

    timeLeft -= (1 + (onRoad ? 0 : OFFROAD_DRAIN)) * dt;
    if (timeLeft < 5.5 && Math.ceil(timeLeft) !== lastTick && timeLeft > 0) {
      lastTick = Math.ceil(timeLeft);
      audio.blip(-5, 0.05);
    }
    score = Math.floor(distPts + bonus);
    run.score = score;
    run.topKmh = Math.max(run.topKmh, Math.round(car.speed * KMH));
    recordGhost(dt);
    if (score > bestScore) {
      if (!newBest && bestScore > 0) {
        renderer.popup(car.x, car.y - 40, 'NEW BEST', true, 13);
        audio.blip(9, 0.06);
      }
      newBest = true;
      bestScore = score;
      dirtyBest = true;
    }
    persistBest();
    if (Math.floor(runTime * 4) !== Math.floor((runTime - dt) * 4)) {
      for (const m of progress.checkMissions(run)) {
        banner('MISSION COMPLETE', `${m.text} · ${COIN} ${m.reward}`);
        audio.chord();
        navigator.vibrate?.([10, 30, 10]);
      }
    }
    if (timeLeft <= 0) {
      timeLeft = 0;
      endRun();
    }
  } else if (state === 'ENDING' && stateTime > 1.6) {
    showResults();
  }

  // Drift visuals: tail swings out toward the outside of the bend.
  const driftTarget = drifting ? driftSide * (0.42 + 0.22 * Math.min(1, Math.abs(track.curvatureAt(q.s)) / 0.004)) : 0;
  driftAngle += (driftTarget - driftAngle) * (1 - Math.exp(-7 * dt));

  // Effects
  const slip = Math.abs(car.vLateral);
  const visualSlip = slip + Math.abs(driftAngle) * 140;
  renderer.addTrail(car, onRoad && visualSlip > 24, time, driftAngle);
  if (Math.abs(driftAngle) > 0.15 && onRoad) renderer.spawnSmoke(car, driftAngle, Math.min(1, Math.abs(driftAngle) * 1.6));
  if (!onRoad && car.speed > 60) renderer.spawnDust(car);
  glow += ((visualSlip > 28 || boostAmt > 0.1 || nitroT > 0 ? 1 : 0) - glow) * (1 - Math.exp(-8 * dt));
  renderer.updateEffects(dt, time);
  renderer.updateCamera(dt, car, Math.max(boostAmt, nitroAmt));
  theme.update(dt);

  const speedNorm = Math.min(1, Math.max(0, (car.speed - BASE_SPEED * 0.7) / (TOP_SPEED - BASE_SPEED * 0.7)));
  audio.update(speedNorm, visualSlip, onRoad);

  renderer.render(car, track, ghostPose(), glow, { boost: boostAmt, time, nitro: nitroAmt, drift: driftAngle });
  if (state !== 'TITLE') renderHud();
  if (garageOpen) drawGaragePreview();
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
    progress.save();
    audio.suspend();
    input.reset();
  } else {
    last = performance.now();
    if (state !== 'TITLE') audio.unlock();
  }
});
window.addEventListener('pagehide', () => {
  persistBest(true);
  progress.save();
});

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is best-effort */
    });
  });
}

