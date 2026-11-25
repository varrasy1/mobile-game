import { AudioEngine } from './audio';
import { Car, InputController, LATERAL_GRIP, TOP_SPEED, autopilotSteer } from './car';
import { CARS, carById, drawCar as drawCarModel, type CarModel } from './cars';
import {
  PAINTS,
  Progress,
  TUNE_MAX,
  TUNE_STATS,
  TUNE_STEP,
  emptyRun,
  paintById,
  tuneCost,
  type Mission,
  type RunStats,
} from './progress';
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
import { BIOMES, Theme } from './theme';
import { Track, ZONE_LENGTH, distToPolyline, type TrackQuery } from './track';

/**
 * TITLE → PLAYING → ENDING (time ran out, car eases off) → RESULTS → PLAYING …
 * The canvas, track and car are never reset: every run continues seamlessly.
 */
type GameState = 'TITLE' | 'PLAYING' | 'ENDING' | 'RESULTS';

// ───────────────────────── tuning ─────────────────────────

const SECTOR_LENGTH = ZONE_LENGTH; // px → 1 km per world zone
/** Grip while steering hard: the tail lets go. */
const DRIFT_GRIP = 3.6;
/** Slip angle (deg) that counts as a drift. */
const DRIFT_SLIP = 12;
/** Heading snap on release: straightens small misalignments (deg). */
const SNAP_DEG = 9;
/** Wall contact starts here (car centre to road centre, px) … */
const WALL_TOUCH = 58;
/** … and beyond this the car is off the course: crash. */
const WALL_CRASH = 80;
const START_SPEED = 300;
const ZONE_SPEED = 40;
const PERFECT_DIST = 15;
const APEX_DIST = 26;
const CHAIN_LENGTH = 11;
const BOOST_TIME = 1.4;
const BOOST_SPEED = 150;
const NITRO_SPEED = 150;
const NITRO_MIN = 0.25;
const DRIFT_TIERS = [0.5, 1.1, 1.8]; // seconds → GOOD / GREAT / INSANE
const DRIFT_NAMES = ['', 'GOOD DRIFT', 'GREAT DRIFT', 'INSANE DRIFT'];
const KMH = 0.6;
const POWER_NAMES = ['MAGNET', 'SHIELD', 'NITRO FILL', '2× POINTS'];

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
const powersEl = $('powers');

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
let gripBonus = 0;
let nitroFactor = 1;

/** Factory stats plus garage tuning. */
function effectiveStats(m: CarModel): { speed: number; handling: number; nitro: number } {
  const t = progress.tune(m.id);
  return {
    speed: m.stats.speed + t.speed * TUNE_STEP,
    handling: m.stats.handling + t.handling * TUNE_STEP,
    nitro: m.stats.nitro + t.nitro * TUNE_STEP,
  };
}

function applyModel(m: CarModel): void {
  model = m;
  const st = effectiveStats(m);
  renderer.setModel(m, paintById(progress.tune(m.id).paint)?.hex ?? null);
  speedBonus = (st.speed - 2) * 14;
  gripBonus = (st.handling - 2) * 0.35;
  car.minRadius = 122 - (st.handling - 2) * 5;
  nitroFactor = 0.8 + st.nitro * 0.12;
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
let combo = 1;
let wallT = 0;
let crashed = false;
let nextCorner = 0;
let sector = 0;
let chainIdx = -1;
let chainCount = 0;
let boostT = 0;
let glow = 0;
let newBest = false;

// Drift + nitro
let drifting = false;
let driftChain = 0;
let chainWindow = 0;
let driftT = 0;
let driftPts = 0;
let driftTier = 0;
let driftCalm = 0;
let driftAngle = 0;
let nitro = 0; // charge 0…1
let nitroT = 0; // seconds of burn left
let nitroDur = 1;

// Traffic, power-ups, juice
let magnetT = 0;
let shieldT = 0;
let doubleT = 0;
let slowT = 0;
let timeScale = 1;
let shownPowers = '';

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
  if (combo !== shown.time) {
    const up = combo > shown.time && shown.time > 0;
    shown.time = combo;
    timeEl.textContent = `×${combo}`;
    if (up) {
      timerEl.classList.remove('pop');
      void timerEl.offsetWidth;
      timerEl.classList.add('pop');
    }
  }
  timerEl.classList.toggle('low', state === 'PLAYING' && wallT > 0);
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

/** Garage paint preview: undefined = car's current paint, null = factory. */
let previewPaint: string | null | undefined;

function tunePips(level: number): string {
  return Array.from({ length: TUNE_MAX }, (_, i) => `<u class="${i < level ? 'on' : ''}"></u>`).join('');
}

function statBars(v: number): string {
  return Array.from({ length: 5 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('');
}

function renderGarage(): void {
  const c = CARS[garageIdx];
  const owned = progress.owned.includes(c.id);
  const selected = progress.selected === c.id;
  const levelOk = progress.level >= c.level;
  const t = progress.tune(c.id);
  $('g-coins').textContent = `${COIN} ${fmt(progress.coins)}`;
  $('g-level').textContent = `LV ${progress.level}`;
  $('g-name').textContent = c.name;
  $('g-tag').textContent = c.tagline;
  $('g-count').textContent = `${garageIdx + 1} / ${CARS.length}`;
  const labels = { speed: 'SPEED', handling: 'HANDLING', nitro: 'NITRO' } as const;
  $('g-stats').innerHTML = TUNE_STATS.map((stat) => {
    const lvl = t[stat];
    let btn = '';
    if (owned) {
      if (lvl >= TUNE_MAX) btn = '<button type="button" class="g-up max" disabled>MAX</button>';
      else {
        const cost = tuneCost(lvl);
        btn = `<button type="button" class="g-up${progress.coins >= cost ? '' : ' poor'}" data-stat="${stat}">▲ ${COIN}${fmt(cost)}</button>`;
      }
    }
    return `<div><span>${labels[stat]}</span><b>${statBars(c.stats[stat])}</b><em>${tunePips(lvl)}</em>${btn}</div>`;
  }).join('');

  const current = previewPaint === undefined ? t.paint : previewPaint;
  const swatches = [
    `<button type="button" class="sw factory${current === null ? ' sel' : ''}" data-paint="" aria-label="Factory paint"></button>`,
    ...PAINTS.map(
      (p) =>
        `<button type="button" class="sw${current === p.id ? ' sel' : ''}${progress.paints.includes(p.id) ? '' : ' lockedp'}" data-paint="${p.id}" style="--c:${p.hex}" aria-label="${p.name}"></button>`,
    ),
  ];
  const paintsEl = $('g-paints');
  paintsEl.innerHTML = owned ? swatches.join('') : '';
  const pDef = paintById(current ?? null);
  $('g-paint-name').textContent = owned ? (pDef ? pDef.name : 'Factory paint') : '';

  const btn = $<HTMLButtonElement>('g-action');
  btn.disabled = false;
  btn.className = '';
  btn.dataset.mode = '';
  if (owned && pDef && !progress.paints.includes(pDef.id)) {
    btn.dataset.mode = 'paint';
    if (progress.coins >= pDef.price) {
      btn.textContent = `BUY PAINT ${COIN} ${fmt(pDef.price)}`;
      btn.className = 'buy';
    } else {
      btn.textContent = `PAINT ${COIN} ${fmt(pDef.price)}`;
      btn.disabled = true;
      btn.className = 'locked';
    }
  } else if (selected) {
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
  previewPaint = undefined;
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
  previewPaint = undefined;
  renderGarage();
  audio.blip(2, 0.03);
});
$('g-next').addEventListener('click', () => {
  garageIdx = (garageIdx + 1) % CARS.length;
  previewPaint = undefined;
  renderGarage();
  audio.blip(4, 0.03);
});
$('g-stats').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.g-up');
  const stat = b?.dataset.stat as (typeof TUNE_STATS)[number] | undefined;
  if (!stat) return;
  const c = CARS[garageIdx];
  if (progress.upgrade(c.id, stat)) {
    audio.blip(4 + progress.tune(c.id)[stat], 0.07);
    navigator.vibrate?.(12);
    if (progress.selected === c.id) applyModel(c);
  } else audio.blip(-3, 0.04);
  renderGarage();
});
$('g-paints').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.sw');
  if (!b) return;
  const c = CARS[garageIdx];
  const id = b.dataset.paint || null;
  if (id === null || progress.paints.includes(id)) {
    progress.setPaint(c.id, id);
    previewPaint = undefined;
    if (progress.selected === c.id) applyModel(c);
  } else previewPaint = id;
  audio.blip(3, 0.03);
  renderGarage();
});
$('g-action').addEventListener('click', () => {
  const c = CARS[garageIdx];
  const btn = $<HTMLButtonElement>('g-action');
  if (btn.dataset.mode === 'paint' && typeof previewPaint === 'string') {
    if (progress.buyPaint(previewPaint)) {
      progress.setPaint(c.id, previewPaint);
      previewPaint = undefined;
      audio.chord();
      navigator.vibrate?.([12, 40, 12]);
      if (progress.selected === c.id) applyModel(c);
    }
    renderGarage();
    return;
  }
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
    ...(previewHex(c) ? { paint: previewHex(c) as string } : {}),
  });
}

function previewHex(c: CarModel): string | undefined {
  const id = previewPaint === undefined ? progress.tune(c.id).paint : previewPaint;
  return paintById(id)?.hex;
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
  combo = 1;
  wallT = 0;
  crashed = false;
  nextCorner = 0;
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
  magnetT = shieldT = doubleT = 0;
  track.setZoneOrigin(q.s, q.s + 160);
  for (const u of track.powerups) if (u.s < q.s + 160) u.taken = true;
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
  banner('CRASHED', `${fmt(score)} PTS`);
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
    <div class="r-label">${newBest ? '<span class="r-best">NEW BEST</span>' : `ZONE ${run.sector}`}</div>
    <div class="r-score">${fmt(score)}</div>
    <div class="r-stats">
      <div><b>${fmt(dist)}</b><span>meters</span></div>
      <div><b>×${run.streak}</b><span>best combo</span></div>
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
  bonus += pts * combo * (nitroT > 0 ? 2 : 1) * (doubleT > 0 ? 2 : 1);
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
    let dx = o.x - car.x;
    let dy = o.y - car.y;
    if (magnetT > 0 && dx * dx + dy * dy < 170 * 170) {
      const k = Math.min(1, dt * 9);
      o.x -= dx * k;
      o.y -= dy * k;
      dx = o.x - car.x;
      dy = o.y - car.y;
    }
    if (dx * dx + dy * dy < (magnetT > 0 ? 30 : 21) ** 2) {
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
        addCoins(5);
        run.chains++;
        renderer.popup(car.x, car.y - 30, `CHAIN +${fmt(pts)}  ${COIN}5`, true, 14);
        navigator.vibrate?.(12);
      }
    } else if (o.s < q.s - 24 && magnetT <= 0) {
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
      run.bestDrift = Math.max(run.bestDrift, pts);
      if (driftTier === 3) run.insane++;
      chainWindow = 1.3;
      showDrift(`${DRIFT_NAMES[driftTier]}${driftChain > 0 ? ` ×${driftChain + 1}` : ''} +${fmt(pts)}`);
      audio.blip(5 + driftTier * 2, 0.06);
      navigator.vibrate?.(10);
    } else {
      showDrift('DRIFT LOST');
      driftChain = 0;
      chainWindow = 0;
    }
  } else hideDrift();
  driftT = driftPts = 0;
  driftTier = 0;
}

/** Drift = real slip: the car's facing and travel direction disagree. */
function updateDrift(dt: number, onRoad: boolean): void {
  const slipDeg = (Math.abs(Math.atan2(car.vLateral, Math.max(1, car.vForward))) * 180) / Math.PI;
  chainWindow = Math.max(0, chainWindow - dt);
  if (!onRoad) {
    endDrift(false);
    return;
  }
  if (!drifting) {
    if (slipDeg > DRIFT_SLIP && car.speed > 150) {
      drifting = true;
      driftChain = chainWindow > 0 ? driftChain + 1 : 0;
      driftT = driftPts = 0;
      driftTier = 0;
      driftCalm = 0;
    }
    return;
  }
  driftCalm = slipDeg < DRIFT_SLIP * 0.6 ? driftCalm + dt : 0;
  if (driftCalm > 0.22) {
    endDrift(true);
    return;
  }
  driftT += dt;
  const tier = driftT >= DRIFT_TIERS[2] ? 3 : driftT >= DRIFT_TIERS[1] ? 2 : driftT >= DRIFT_TIERS[0] ? 1 : 0;
  const angleFactor = Math.min(2, slipDeg / 25);
  driftPts += 160 * angleFactor * Math.max(1, tier) * (1 + driftChain * 0.5) * (1 + streak * 0.1) * dt;
  if (driftT > 0.3) nitro = Math.min(1, nitro + 0.22 * nitroFactor * dt);
  if (tier > driftTier) {
    driftTier = tier;
    audio.blip(3 + tier * 2, 0.05);
    if (tier === 3) renderer.kick(0.25);
  }
  if (tier > 0) showDrift(`${DRIFT_NAMES[tier]}${driftChain > 0 ? ` ×${driftChain + 1}` : ''} ${fmt(driftPts)}`, true);
}

// ── Course: walls, crashes and corner grading ──

function slowMo(seconds: number): void {
  slowT = Math.max(slowT, seconds);
}

/** Leaving the course ends the run — unless a shield bounces you back. */
function crashOut(): void {
  const p = track.poseAt(q.s);
  if (shieldT > 0 && p) {
    shieldT = 0;
    const side = Math.sign(q.lateral);
    const back = side * (WALL_TOUCH - 14);
    car.x = p.x + p.nx * back;
    car.y = p.y + p.ny * back;
    car.angle = p.angle;
    const v = car.speed * 0.7;
    car.vx = Math.cos(p.angle) * v;
    car.vy = Math.sin(p.angle) * v;
    renderer.spawnSparks(car.x, car.y, 0, 0, 20);
    renderer.kick(0.6);
    renderer.popup(car.x, car.y - 26, 'SHIELD SAVE', true, 15);
    audio.crash();
    navigator.vibrate?.(40);
    combo = 1;
    return;
  }
  crashed = true;
  run.score = score;
  driftAngle = (Math.random() < 0.5 ? -1 : 1) * 1.4;
  renderer.spawnSparks(car.x, car.y, car.vx, car.vy, 34);
  renderer.kick(1);
  slowMo(0.5);
  audio.crash();
  navigator.vibrate?.([60, 40, 80]);
  endRun();
}

/** Grades each corner once the car has left it. */
function gradeCorner(slipPeak: number, touched: boolean): void {
  const p = track.poseAt(q.s);
  const velAngle = Math.atan2(car.vy, car.vx);
  const exitErr = p ? Math.abs(wrapAngle(velAngle - p.angle)) * (180 / Math.PI) : 90;
  let label: string;
  let pts: number;
  if (touched) {
    label = 'SLOPPY';
    pts = 0;
    combo = 1;
  } else if (slipPeak > DRIFT_SLIP && exitErr < 7) {
    label = 'PERFECT CORNER';
    pts = 400;
    combo = Math.min(9, combo + 1);
    run.perfects++;
    nitro = Math.min(1, nitro + 0.15 * nitroFactor);
    renderer.kick(0.25);
    audio.chime(combo + 2);
    navigator.vibrate?.([8, 30, 12]);
  } else {
    label = 'CLEAN';
    pts = 200;
    combo = Math.min(9, combo + 1);
    audio.blip(combo, 0.05);
  }
  run.streak = Math.max(run.streak, combo);
  if (pts) addScore(pts);
  renderer.popup(car.x, car.y - 30, pts ? `${label} +${fmt(pts * combo)}` : label, label !== 'CLEAN', label === 'SLOPPY' ? 12 : 14);
}

let cornerPeak = 0;
let cornerTouched = false;

function updateCorners(slipDeg: number): void {
  const list = track.corners;
  for (const c of list) {
    if (c.s1 + 50 < startS) continue;
    if (c.s0 > q.s + 10) break;
    if (q.s >= c.s0 - 30 && q.s <= c.s1 + 50) {
      cornerPeak = Math.max(cornerPeak, slipDeg);
      if (wallT > 0) cornerTouched = true;
    }
    if (q.s > c.s1 + 50 && c.s1 > nextCorner) {
      nextCorner = c.s1;
      gradeCorner(cornerPeak, cornerTouched);
      cornerPeak = 0;
      cornerTouched = false;
    }
  }
}

function updatePowerups(): void {
  for (const u of track.powerups) {
    if (u.taken) continue;
    if (u.s > q.s + 60) break;
    const dx = u.x - car.x;
    const dy = u.y - car.y;
    if (dx * dx + dy * dy < 24 * 24) {
      u.taken = true;
      u.age = 0;
      if (u.kind === 0) magnetT = 8;
      else if (u.kind === 1) shieldT = 15;
      else if (u.kind === 2) nitro = 1;
      else doubleT = 8;
      renderer.popup(u.x, u.y - 20, POWER_NAMES[u.kind], true, 14);
      renderer.spawnRipple(u.x, u.y);
      audio.pickup();
      navigator.vibrate?.(12);
    }
  }
}

function renderPowers(): void {
  const chips: string[] = [];
  if (magnetT > 0) chips.push(`MAGNET ${Math.ceil(magnetT)}`);
  if (shieldT > 0) chips.push('SHIELD');
  if (doubleT > 0) chips.push(`2× ${Math.ceil(doubleT)}`);
  const html = chips.map((c) => `<span>${c}</span>`).join('');
  if (html !== shownPowers) {
    shownPowers = html;
    powersEl.innerHTML = html;
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
      Car,
      Track,
      progress,
      get state() {
        return { state, combo, score, bestScore, sector, nitro, drifting, driftTier, run, wallT, crashed, samples: recording.length / 3 };
      },
      autopilot(on: boolean) {
        debugAutopilot = on;
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
  const realDt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
  last = now;
  slowT = Math.max(0, slowT - realDt);
  timeScale += ((slowT > 0 ? 0.3 : 1) - timeScale) * Math.min(1, realDt * 14);
  const dt = realDt * timeScale;
  time += dt;
  stateTime += dt;
  const playing = state === 'PLAYING';

  track.update(q.s);

  // ── Steering ──
  let steer: number;
  if (!playing || debugAutopilot) {
    steer = autopilotSteer(car, track, q);
    car.grip = LATERAL_GRIP;
  } else {
    let cmd = input.steer;
    if (import.meta.env.DEV) {
      const bot = (window as { __botSteer?: () => number }).__botSteer;
      if (bot) cmd = bot();
    }
    if (crashed) cmd = 0;
    // Direct control: what you hold is what the car does. Holding at speed
    // breaks the rear loose; letting go grips up and drives straight.
    steer = cmd;
    const g = LATERAL_GRIP + gripBonus;
    const target = Math.abs(cmd) > 0.05 ? g + (DRIFT_GRIP + gripBonus * 0.4 - g) * Math.min(1, Math.abs(cmd)) : g;
    car.grip += (target - car.grip) * Math.min(1, dt * (Math.abs(cmd) > 0.05 ? 12 : 5));
    if (Math.abs(cmd) <= 0.05) {
      // Small heading snap on release so a nearly-straight exit becomes straight.
      const p = track.poseAt(q.s + 40);
      if (p) {
        const err = wrapAngle(p.angle - car.angle);
        if (Math.abs(err) < (SNAP_DEG * Math.PI) / 180) car.angle += err * Math.min(1, dt * 6);
      }
    }
  }

  // ── Speed ──
  boostT = Math.max(0, boostT - dt);
  nitroT = Math.max(0, nitroT - dt);
  const boostAmt = boostT / BOOST_TIME;
  const nitroAmt = nitroT > 0 ? Math.min(1, nitroT / 0.4, 0.6 + 0.4 * (nitroT / nitroDur)) : 0;
  let target: number;
  if (state === 'ENDING') target = 0;
  else if (state === 'RESULTS') target = 150;
  else if (state === 'TITLE') target = 230;
  else
    target =
      Math.min(TOP_SPEED + speedBonus, START_SPEED + speedBonus + sector * ZONE_SPEED + combo * 4) +
      BOOST_SPEED * boostAmt +
      (nitroT > 0 ? NITRO_SPEED : 0);
  if (drifting) target *= 1 - 0.12 * Math.min(1, Math.abs(car.vLateral) / Math.max(1, car.speed) / 0.6);
  if (wallT > 0) target *= 0.8;
  car.update(dt, steer, target);
  if (state === 'ENDING') car.angle += driftAngle * dt * 6;

  q = track.nearest(car.x, car.y);
  const lat = Math.abs(q.lateral);
  const slipDeg = (Math.abs(Math.atan2(car.vLateral, Math.max(1, car.vForward))) * 180) / Math.PI;

  // Off-course outside of a run: keep the demo car on the road.
  if (!playing && lat > WALL_TOUCH) {
    const p = track.poseAt(q.s);
    if (p) {
      const pull = Math.min(60 + (lat - WALL_TOUCH) * 3, 320) * dt * Math.sign(q.lateral);
      car.vx -= p.nx * pull;
      car.vy -= p.ny * pull;
    }
  }

  updateApexes(dt, playing);
  updateOrbs(dt, playing);
  updatePads(playing);
  if (playing) updatePowerups();
  magnetT = Math.max(0, magnetT - dt);
  shieldT = Math.max(0, shieldT - dt);
  doubleT = Math.max(0, doubleT - dt);
  for (const u of track.powerups) if (u.taken && u.age >= 0) u.age += dt;

  // World zone follows the road position (title + runs).
  const zone = track.zoneAt(q.s);
  if (zone !== theme.biomeIndex) {
    theme.setBiome(zone);
    theme.setMood(zone);
  }

  if (playing) {
    runTime += dt;

    // Walls: scraping costs the combo, leaving the course ends the run.
    if (lat > WALL_CRASH) crashOut();
    else if (lat > WALL_TOUCH) {
      if (wallT <= 0) {
        combo = 1;
        renderer.popup(car.x, car.y - 24, 'WALL', false, 12);
        audio.crash();
        navigator.vibrate?.(20);
      }
      wallT = 0.25;
      if (Math.random() < 0.6) renderer.spawnSparks(car.x, car.y, car.vx * 0.3, car.vy * 0.3, 2);
      // Lean the car back off the barrier.
      const p = track.poseAt(q.s);
      if (p) {
        const push = (lat - WALL_TOUCH) * 9 * dt * Math.sign(q.lateral);
        car.vx -= p.nx * push;
        car.vy -= p.ny * push;
      }
    }
    wallT = Math.max(0, wallT - dt);

    if (state === 'PLAYING') {
      updateDrift(dt, lat <= WALL_TOUCH);
      updateCorners(slipDeg);
      if (q.s > maxS) {
        distPts += ((q.s - maxS) / 10) * (nitroT > 0 ? 2 : 1);
        maxS = q.s;
      }
      const nextSector = Math.floor((maxS - startS) / SECTOR_LENGTH);
      if (nextSector > sector) {
        sector = nextSector;
        run.sector = sector + 1;
        addScore(500 * sector);
        addCoins(10 * sector);
        banner(`ZONE ${sector + 1}`, BIOMES[track.zoneAt(q.s + 200)].name);
        audio.chord();
        navigator.vibrate?.([12, 50, 12]);
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
    }
  } else if (state === 'ENDING' && stateTime > 1.3) {
    showResults();
  }

  // Crash spin decays.
  driftAngle *= Math.exp(-3 * dt);

  // Effects
  const onRoad = lat <= WALL_TOUCH + 6;
  const slip = Math.abs(car.vLateral);
  renderer.addTrail(car, onRoad && slip > 24, time, 0);
  if (onRoad && slipDeg > 13) renderer.spawnSmoke(car, 0, Math.min(1, slipDeg / 30));
  if (!onRoad && car.speed > 60) renderer.spawnDust(car);
  glow += ((slip > 28 || boostAmt > 0.1 || nitroT > 0 ? 1 : 0) - glow) * (1 - Math.exp(-8 * dt));
  renderer.updateEffects(dt, time);
  renderer.updateCamera(dt, car, Math.max(boostAmt, nitroAmt), track, q.s);
  theme.update(dt);

  const speedNorm = Math.min(1, Math.max(0, (car.speed - 200) / (TOP_SPEED - 200)));
  audio.update(speedNorm, slip, onRoad);
  audio.engine(car.speed, state !== 'TITLE', nitroT > 0);

  renderer.render(car, track, ghostPose(), glow, {
    boost: boostAmt,
    time,
    nitro: nitroAmt,
    drift: 0,
    night: theme.night,
    shield: Math.min(1, shieldT),
    magnet: magnetT > 0,
  });
  if (state !== 'TITLE') {
    renderHud();
    renderPowers();
  }
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

