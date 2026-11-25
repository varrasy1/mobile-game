# FLOWLINE

Minimalist, chill endless driving PWA — Vite + strict TypeScript + vanilla Canvas, zero runtime dependencies.

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build → dist/
```

**Controls:** hold **into** a corner to drift (left/right half of the screen, or drag) — the car follows the bend while the tail steps out; release to catch it. Hands off, a lane assist keeps your line but can't take real corners. A short hold on a straight changes lanes. **N₂O** (or `Space`) fires nitro. Desktop: `←/A` `→/D`.

**Loop (arcade):** the clock counts down; checkpoints every 1 km add time. Earn time and points with drifts (GOOD → GREAT → INSANE, chained drifts multiply), PERFECT apexes, light chains, close calls in traffic and power-ups (magnet, shield, +time, 2×). Crashing costs 3 s — unless you're on nitro or shielded: then it's a takedown.

**World:** every checkpoint drives into a new zone — Coast, Desert Dusk, Pine Forest, Neon City (night, headlights, street lamps), Snowfield, Volcano.

**Progression:** XP/levels, coins, three rotating missions, a garage of five cars (Aero, Vector, Apex, Torque, Zenith) with speed/handling/nitro tuning (5 levels each) and a paint shop.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main` (Pages source: GitHub Actions).
