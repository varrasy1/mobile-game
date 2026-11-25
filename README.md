# FLOWLINE

Minimalist, chill endless driving PWA — Vite + strict TypeScript + vanilla Canvas, zero runtime dependencies.

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build → dist/
```

**Controls:** hold the left/right half of the screen to shift your line (drag works too) · `←/A` `→/D` on desktop. Hold *into* a bend to throw the car into a drift. Tap **N₂O** (or `Space`) to fire nitro.

**Loop (arcade):** the clock counts down. Buy time by clipping apex arcs (PERFECT inside 15px), completing light chains, banking drifts (GOOD → GREAT → INSANE) and reaching checkpoints every 1.5 km. Drifts charge nitro; nitro doubles points. Time runs out → results, XP and coins.

**Progression:** player level (XP from score), coins (lights, chains, checkpoints, missions, level-ups), three rotating missions with escalating goals, and a garage of five cars (Aero, Vector, Apex, Torque, Zenith) with distinct speed / handling / nitro stats.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main` (Pages source: GitHub Actions).
