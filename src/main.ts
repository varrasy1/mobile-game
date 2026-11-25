import { AudioEngine } from './audio';
import { BASE_SPEED, Car, InputController, TOP_SPEED, autopilotSteer, followSteer } from './car';
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
 * TITLE → PLAYING → ENDING (flow ran dry, car eases off) → RESULTS → PLAYING …
 * The canvas, track and car are never reset: every run continues seamlessly
 * from wherever the car is.
 */
type GameState = 'TITLE' | 'PLAYING' | 'ENDING' | 'RESULTS';

// ───────────────────────── tuning ─────────────────────────

const SECTOR_LENGTH = 15000; // px → 1.5 km
/** Lateral speed (px/s) at which a held input moves your line across the road. */
const LANE_SPEED = 240;
/** How far past the edge the line may be pushed (onto the gravel). */
const LANE_OVERHANG = 26;
const FLOW_DRAIN = 0.032; // per second (≈ 30 s from full with no rewards)
const FLOW_DRAIN_PER_SECTOR = 0.006;
const FLOW_OFFROAD_DRAIN = 0.05;
const FLOW_APEX = 0.065;
const FLOW_PERFECT = 0.11;
const FLOW_ORB = 0.004;
const FLOW_CHAIN = 0.05;
const FLOW_PAD = 0.05;
const FLOW_SECTOR = 0.3;
const PERFECT_DIST = 15;
const APEX_DIST = 26;
const CHAIN_LENGTH = 11;
const DRIFT_MIN_DEG = 8;
const DRIFT_END_DEG = 5;
const BOOST_TIME = 1.4;
const BOOST_SPEED = 150;

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
const flowFill = $('flow-fill');
const flowEl = $('flow');
const driftEl = $('drift');
const bannerEl = $('banner');
const hintEl = $('hint');
const resultsEl = $('results');
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
let stateTime = 0;
let q: TrackQuery = track.nearest(car.x, car.y);
let time = 0;

// Run state
let streak = 0;
let bestStreak = 0;
let bonus = 0;
let startS = 0;
let maxS = 0;
let runTime = 0;
let score = 0;
let flow = 1;
let sector = 0;
let perfects = 0;
let orbsTaken = 0;
let chainIdx = -1;
let chainCount = 0;
let drift = 0;
let driftCalm = 0;
let boostT = 0;
let glow = 0;
let newBest = false;
/** The player's chosen line: lateral offset from the centre line (+ = right). */
let lane = 0;

// Personal best + ghost
let bestScore = loadBest();
let ghostRun: GhostRun | null = loadGhost();
let recording: number[] = [];
let sampleClock = 0;
let dirtyBest = false;
let lastPersist = 0;

const fmt = (n: number): string => Math.floor(n).toLocaleString('en-US');
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function showBestOnTitle(): void {
  if (bestScore > 0) {
    bestEl.textContent = `BEST ${fmt(bestScore)}`;
    bestEl.hidden = false;
  }
}
showBestOnTitle();

// ───────────────────────── HUD ─────────────────────────

let shownScore = -1;
let shownStreak = -1;
let shownDrift = -1;
let bannerTimer: number | undefined;

function renderHud(): void {
  if (Math.floor(score) !== shownScore) {
    shownScore = Math.floor(score);
    scoreEl.textContent = fmt(score);
  }
  if (streak !== shownStreak) {
    shownStreak = streak;
    if (streak >= 2) {
      streakEl.textContent = `${streak}x FLOW`;
      streakEl.classList.add('show');
      streakEl.classList.remove('bump');
      void streakEl.offsetWidth; // restart the bump animation
      streakEl.classList.add('bump');
    } else {
      streakEl.classList.remove('show');
    }
  }
  flowFill.style.transform = `scaleX(${Math.max(0, flow).toFixed(4)})`;
  flowEl.classList.toggle('low', flow < 0.25 && state === 'PLAYING');

  const d = Math.floor(drift);
  if (d !== shownDrift) {
    shownDrift = d;
    if (d >= 30) {
      driftEl.textContent = `DRIFT ${fmt(d)}`;
      driftEl.classList.add('show');
    } else driftEl.classList.remove('show');
  }
}

function banner(text: string): void {
  bannerEl.textContent = text;
  bannerEl.classList.add('show');
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => bannerEl.classList.remove('show'), 1800);
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

let hinted = false;
try {
  hinted = localStorage.getItem('flowline.hinted') === '1';
} catch {
  /* ignore */
}

function setState(next: GameState): void {
  state = next;
  stateTime = 0;
}

function startRun(): void {
  setState('PLAYING');
  startS = q.s;
  maxS = q.s;
  runTime = 0;
  streak = bestStreak = 0;
  bonus = 0;
  score = 0;
  flow = 1;
  sector = 0;
  perfects = orbsTaken = 0;
  chainIdx = -1;
  chainCount = 0;
  drift = 0;
  boostT = 0;
  newBest = false;
  recording = [];
  sampleClock = 0;
  shownStreak = -1;
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
    window.setTimeout(() => hintEl.classList.remove('show'), 5200);
    hinted = true;
    try {
      localStorage.setItem('flowline.hinted', '1');
    } catch {
      /* ignore */
    }
  }
}

function endRun(): void {
  setState('ENDING');
  bankDrift(false);
  streak = 0;
  audio.fadeOut();
  navigator.vibrate?.([20, 60, 20]);
  if (newBest) {
    persistBest(true);
    ghostRun = { score: bestScore, samples: recording.slice() };
  }
}

function showResults(): void {
  setState('RESULTS');
  const dist = Math.floor((maxS - startS) / 10);
  resultsEl.innerHTML = `
    <div class="r-label">${newBest ? '<span class="r-best">NEW BEST</span>' : 'FLOW FADED'}</div>
    <div class="r-score">${fmt(score)}</div>
    <div class="r-stats">
      <div><b>${fmt(dist)}</b><span>meters</span></div>
      <div><b>${bestStreak}x</b><span>best flow</span></div>
      <div><b>${perfects}</b><span>perfect</span></div>
      <div><b>${orbsTaken}</b><span>lights</span></div>
    </div>
    <div class="r-sub">${newBest ? '' : `best ${fmt(bestScore)}`}</div>
    <div class="r-prompt">Tap to drive again</div>`;
  resultsEl.classList.add('show');
  hudEl.classList.remove('playing');
}

const input = new InputController(canvas, () => {
  audio.unlock();
  if (state === 'TITLE') startRun();
  else if (state === 'RESULTS' && stateTime > 0.7) startRun();
});

function breakStreak(): void {
  if (streak > 0) streak = 0;
}

function addScore(pts: number): void {
  bonus += pts;
}

function addFlow(v: number): void {
  flow = Math.min(1, flow + v);
}

function bankDrift(clean: boolean): void {
  if (drift >= 30) {
    if (clean) {
      const pts = Math.floor(drift * (1 + streak * 0.2));
      addScore(pts);
      addFlow(Math.min(0.12, pts / 4000));
      renderer.popup(car.x, car.y - 26, `DRIFT +${fmt(pts)}`, false, 13);
      audio.blip(7, 0.05);
    } else {
      renderer.popup(car.x, car.y - 26, 'DRIFT LOST', false, 11);
    }
  }
  drift = 0;
  driftCalm = 0;
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
  bestStreak = Math.max(bestStreak, streak);
  const pts = 100 * streak * (perfect ? 2 : 1);
  addScore(pts);
  addFlow(perfect ? FLOW_PERFECT : FLOW_APEX);
  car.boost(perfect ? 40 : 25);
  renderer.spawnRipple(ap.mx, ap.my, perfect);
  renderer.popup(ap.mx, ap.my - 10, perfect ? `PERFECT +${fmt(pts)}` : `+${fmt(pts)}`, perfect, perfect ? 15 : 13);
  if (perfect) {
    perfects++;
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
      // Inside the zone: grade once the car starts pulling away (or the arc ends).
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
    if (dx * dx + dy * dy < 20 * 20) {
      o.taken = true;
      o.age = 0;
      orbsTaken++;
      chainCount = o.idx === chainIdx + 1 ? chainCount + 1 : o.idx === 0 ? 1 : 0;
      chainIdx = o.idx;
      addScore(10 * Math.max(1, streak));
      addFlow(FLOW_ORB);
      audio.blip(o.idx);
      if (chainCount === CHAIN_LENGTH) {
        const pts = 250 * Math.max(1, streak);
        addScore(pts);
        addFlow(FLOW_CHAIN);
        renderer.popup(car.x, car.y - 30, `CHAIN +${fmt(pts)}`, true, 14);
        navigator.vibrate?.(12);
      }
    } else if (o.s < q.s - 24) {
      o.taken = true; // missed — quietly retire
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
      addFlow(FLOW_PAD);
      addScore(50 * Math.max(1, streak));
      renderer.kick(0.5);
      renderer.popup(car.x, car.y - 28, 'BOOST', true, 14);
      audio.boost();
      navigator.vibrate?.(15);
    }
  }
}

function updateDrift(dt: number, onRoad: boolean): void {
  const slipDeg = (Math.abs(Math.atan2(car.vLateral, Math.max(1, car.vForward))) * 180) / Math.PI;
  if (!onRoad) {
    if (drift > 0) bankDrift(false);
    return;
  }
  if (slipDeg > DRIFT_MIN_DEG && car.speed > 180) {
    drift += slipDeg * car.speed * 0.02 * dt;
    driftCalm = 0;
  } else if (drift > 0) {
    if (slipDeg < DRIFT_END_DEG) driftCalm += dt;
    if (driftCalm > 0.3) bankDrift(true);
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
      get state() {
        return { state, streak, score, bestScore, flow, sector, perfects, orbsTaken, lane, samples: recording.length / 3 };
      },
      autopilot(on: boolean) {
        debugAutopilot = on;
      },
      setFlow(v: number) {
        flow = v;
      },
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
  if (!playing || debugAutopilot) {
    steer = autopilotSteer(car, track, q);
    lane = q.lateral;
  } else {
    const bot = (window as { __botSteer?: () => number }).__botSteer;
    const cmd = import.meta.env.DEV && bot ? bot() : input.steer;
    const limit = track.halfWidth + LANE_OVERHANG;
    lane = Math.max(-limit, Math.min(limit, lane + cmd * LANE_SPEED * dt));
    steer = followSteer(car, track, q, lane);
  }

  boostT = Math.max(0, boostT - dt);
  const boostAmt = boostT / BOOST_TIME;
  let target: number;
  if (state === 'ENDING' || state === 'RESULTS') target = 150;
  else target = Math.min(TOP_SPEED, BASE_SPEED + streak * 12 + sector * 22) + BOOST_SPEED * boostAmt;
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
    updateDrift(dt, onRoad);
    maxS = Math.max(maxS, q.s);

    const nextSector = Math.floor((maxS - startS) / SECTOR_LENGTH);
    if (nextSector > sector) {
      sector = nextSector;
      theme.setMood(sector);
      addFlow(FLOW_SECTOR);
      addScore(1000 * sector);
      banner(`SECTOR ${sector + 1}`);
      audio.chord();
      navigator.vibrate?.([12, 50, 12]);
    }

    flow -= (FLOW_DRAIN + sector * FLOW_DRAIN_PER_SECTOR + (onRoad ? 0 : FLOW_OFFROAD_DRAIN)) * dt;
    score = Math.floor((maxS - startS) / 10) + bonus;
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
    if (flow <= 0) {
      flow = 0;
      endRun();
    }
  } else if (state === 'ENDING' && stateTime > 1.4) {
    showResults();
  }

  // Effects
  const slip = Math.abs(car.vLateral);
  renderer.addTrail(car, onRoad && slip > 24, time);
  if (!onRoad && car.speed > 60) renderer.spawnDust(car);
  glow += ((slip > 28 || boostAmt > 0.1 ? 1 : 0) - glow) * (1 - Math.exp(-8 * dt));
  renderer.updateEffects(dt, time);
  renderer.updateCamera(dt, car, boostAmt);
  theme.update(dt);

  const speedNorm = Math.min(1, Math.max(0, (car.speed - BASE_SPEED * 0.7) / (TOP_SPEED - BASE_SPEED * 0.7)));
  audio.update(speedNorm, slip, onRoad);

  renderer.render(car, track, ghostPose(), glow, { boost: boostAmt, time });
  if (state !== 'TITLE') renderHud();
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
    if (state !== 'TITLE') audio.unlock();
  }
});
window.addEventListener('pagehide', () => persistBest(true));

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is best-effort */
    });
  });
}
