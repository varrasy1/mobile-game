import { PALETTES } from './src/theme';
import type { Palette, RGBA } from './src/theme';
import { css } from './src/theme';
import { drawProp, drawPropLight, drawTraffic, drawTrafficLights, drawHeadlights, TRAFFIC_STYLES, TRAFFIC_PAINTS } from './src/props';
import type { PropKind } from './src/props';

const KINDS: PropKind[] = ['tree', 'rock', 'bush', 'pine', 'snowpine', 'cactus', 'palm', 'building', 'lamp', 'ember'];
const dpr = 2;
const root = document.getElementById('root')!;
const T = Number(new URLSearchParams(location.search).get('t') ?? '1.3');

function canvas(id: string, w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.id = id; c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
  root.appendChild(c);
  const ctx = c.getContext('2d')!;
  return ctx;
}
const sizeOf = (k: PropKind, i: number): number => k === 'building' ? [16, 22, 28, 34, 40, 26][i]! : k === 'lamp' ? [8, 8, 7, 9, 10, 8][i]! : k === 'palm' ? [14, 18, 20, 16, 22, 12][i]! : [8, 11, 14, 17, 20, 12][i]!;
const seeds = [0.03, 0.27, 0.52, 0.78, 0.94, 0.61];

function tint(p: Palette, prop: RGBA, alt: RGBA, bg?: RGBA): Palette {
  return { ...p, prop, propAlt: alt, ...(bg ? { bg } : {}) };
}

// Grid of every kind on a ground.
function grid(id: string, pal: Palette, zoom: number) {
  const cell = 70;
  const W = cell * 6 * zoom + 20, H = cell * KINDS.length * zoom + 20;
  const ctx = canvas(id, W, H);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css(pal.bg); ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 10 * dpr, 10 * dpr);
  KINDS.forEach((k, row) => {
    for (let i = 0; i < 6; i++) {
      const x = cell * i + cell / 2, y = cell * row + cell / 2;
      drawProp(ctx, k, x, y, sizeOf(k, i), seeds[i]!, { pal, night: 0, time: T, pxScale: dpr * zoom }, i * 1.1);
    }
    ctx.fillStyle = css(pal.edge, 0.5); ctx.font = '7px sans-serif'; ctx.fillText(k, 2, cell * row + 8);
  });
}

const D = PALETTES.dark, L = PALETTES.light;
grid('dark', D, 1.5);
grid('light', L, 1.5);

// Biomes: tinted palettes.
function biome(id: string, pal: Palette, kinds: PropKind[], night = 0) {
  const W = 700, H = 160;
  const ctx = canvas(id, W, H);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css(pal.bg); ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * 2, 0, 0, dpr * 2, 0, 0);
  let x = 25;
  for (let i = 0; i < 12; i++) {
    const k = kinds[i % kinds.length]!;
    drawProp(ctx, k, x, 25 + (i % 2) * 30, sizeOf(k, i % 6) * 0.9, seeds[i % 6]!, { pal, night, time: T, pxScale: dpr * 2 }, Math.PI / 2);
    x += 28;
  }
}
biome('forest-d', tint(D, [24, 40, 32, 1], [32, 52, 40, 1], [16, 22, 20, 1]), ['tree', 'pine', 'bush', 'rock']);
biome('forest-l', tint(L, [196, 210, 186, 1], [180, 198, 170, 1], [226, 230, 216, 1]), ['tree', 'pine', 'bush', 'rock']);
biome('desert-d', tint(D, [44, 36, 28, 1], [56, 46, 34, 1], [26, 22, 18, 1]), ['cactus', 'rock', 'cactus', 'palm']);
biome('desert-l', tint(L, [222, 204, 172, 1], [212, 190, 154, 1], [240, 228, 206, 1]), ['cactus', 'rock', 'cactus', 'palm']);
biome('snow-l', tint(L, [214, 222, 228, 1], [200, 210, 218, 1], [240, 243, 246, 1]), ['snowpine', 'snowpine', 'rock', 'pine']);
biome('snow-d', tint(D, [26, 32, 40, 1], [34, 42, 52, 1], [18, 22, 28, 1]), ['snowpine', 'snowpine', 'rock', 'pine']);
biome('city-d', D, ['building', 'lamp', 'building', 'tree']);
biome('city-l', L, ['building', 'lamp', 'building', 'tree']);
biome('volcano-d', tint(D, [34, 26, 26, 1], [44, 34, 32, 1], [20, 16, 16, 1]), ['ember', 'rock', 'ember', 'ember']);
biome('volcano-l', tint(L, [200, 186, 180, 1], [186, 170, 164, 1], [228, 220, 214, 1]), ['ember', 'rock', 'ember', 'ember']);

// Traffic day sheet.
function trafficSheet(id: string, pal: Palette, zoom: number) {
  const W = 6 * 40 * zoom + 20, H = 100 * zoom + 20;
  const ctx = canvas(id, W, H);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css(pal.bg); ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = css(pal.road); ctx.fillRect(10, 0, W - 20, H);
  TRAFFIC_STYLES.forEach((_, i) => {
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, (10 + (i * 40 + 20) * zoom) * dpr, (10 + 50 * zoom) * dpr);
    if (i === 2) ctx.rotate(0.25);
    drawTraffic(ctx, i, { pal, night: 0, time: 0.1, pxScale: dpr * zoom, paint: TRAFFIC_PAINTS[(i * 3) % TRAFFIC_PAINTS.length]!, brake: i === 1 ? 1 : 0, indicator: i === 3 ? 1 : i === 4 ? -1 : 0, ghost: i === 5 && zoom < 2 });
  });
}
trafficSheet('traffic-d', D, 3);
trafficSheet('traffic-l', L, 3);
function paintsSheet(id: string, pal: Palette) {
  const W = 10 * 34 + 20, H = 70;
  const ctx = canvas(id, W, H);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css(pal.road); ctx.fillRect(0, 0, W, H);
  TRAFFIC_PAINTS.forEach((p, i) => {
    ctx.setTransform(dpr, 0, 0, dpr, (20 + i * 34) * dpr, 35 * dpr);
    drawTraffic(ctx, i % 6, { pal, night: 0, time: 0.1, pxScale: dpr, paint: p, brake: 0, indicator: 0, ghost: i === 9 });
  });
}
paintsSheet('paints-d', D); paintsSheet('paints-l', L);

// Night scene: road strip with lamps, traffic, player headlights.
function night(id: string, pal: Palette, zoom: number, nf: number) {
  const W = 520, H = 640;
  const ctx = canvas(id, W, H);
  const o = { pal, night: nf, time: T, pxScale: dpr * zoom };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css(pal.bg); ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, (W / 2) * dpr, (H / 2) * dpr);
  const vh = H / zoom / 2, vw = W / zoom / 2;
  ctx.fillStyle = css(pal.road); ctx.fillRect(-68, -vh, 136, vh * 2);
  ctx.strokeStyle = css(pal.edge, 0.5); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-66, -vh); ctx.lineTo(-66, vh); ctx.moveTo(66, -vh); ctx.lineTo(66, vh); ctx.stroke();
  const props: [PropKind, number, number, number, number, number?][] = [];
  for (let y = -vh + 30; y < vh; y += 110) {
    props.push(['lamp', -78, y, 8, (y * 0.37 + 5) % 1, 0]);
    props.push(['lamp', 78, y + 55, 8, (y * 0.71 + 7) % 1, Math.PI]);
  }
  for (let y = -vh + 20; y < vh; y += 70) {
    props.push(['building', -78 - 50, y + 10, 30 + (y % 3) * 2, ((y * 0.013) % 1 + 1) % 1]);
    props.push([y % 140 === 0 ? 'ember' : 'tree', 110, y + 25, 12, ((y * 0.031) % 1 + 1) % 1]);
    props.push(['palm', 150, y + 50, 16, ((y * 0.057) % 1 + 1) % 1]);
  }
  void vw;
  for (const [k, x, y, r, s, a] of props) drawProp(ctx, k, x, y, r, s, o, a);
  const cars: [number, number, number, number, number, -1 | 0 | 1][] = [
    [0, -35, -150, 0, 0, 0], [1, 35, -60, 0, 1, 0], [2, -35, 40, 0.15, 0, -1], [3, 35, 150, 0, 0.5, 1], [4, -35, -270, 0, 0, 0], [5, 35, 260, 0, 0, 0],
  ];
  for (const [st, x, y, rot, br, ind] of cars) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    drawTraffic(ctx, st, { ...o, paint: TRAFFIC_PAINTS[(st * 2) % 10]!, brake: br, indicator: ind });
    ctx.restore();
  }
  // Player placeholder.
  ctx.save(); ctx.translate(0, 210);
  ctx.fillStyle = css(pal.carBody); ctx.beginPath(); ctx.roundRect(-10, -20, 20, 40, 7); ctx.fill();
  ctx.restore();
  // Darken + additive lights.
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(4,6,14,${0.62 * nf})`; ctx.fillRect(0, 0, W * dpr, H * dpr); ctx.restore();
  if (nf > 0.05) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [k, x, y, r, s, a] of props) drawPropLight(ctx, k, x, y, r, s, o, a);
    for (const [st, x, y, rot, br, ind] of cars) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      drawTrafficLights(ctx, st, { ...o, paint: '#888', brake: br, indicator: ind });
      ctx.restore();
    }
    ctx.save(); ctx.translate(0, 210); drawHeadlights(ctx, 1, dpr * zoom); ctx.restore();
    ctx.restore();
  }
}
night('night-d-1x', D, 1, 1);
night('night-l-1x', L, 1, 1);
night('night-d-3x', D, 2.4, 1);
night('day-d-1x', D, 1, 0);
night('dusk-l-1x', L, 1, 0.5);
document.title = 'ready';
