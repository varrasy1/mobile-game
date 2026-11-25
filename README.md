# FLOWLINE

Minimalist, chill endless driving PWA — Vite + strict TypeScript + vanilla Canvas, zero runtime dependencies.

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build → dist/
```

**Controls:** hold the left / right half of the screen to steer into a drift; release to grip up and drive straight (drag works too for finer control). Desktop: `←/A` `→/D`, `Space` for nitro. The drift radius is the same at every speed — corners are about timing: turn in at the right moment, release when the nose points down the next straight.

**Loop (arcade):** a track-up course of straights and crisp 90° corners with kerbs. Every corner is graded — PERFECT (drifted, straight exit), CLEAN or SLOPPY (touched the wall). Clean corners build a combo up to ×9 that multiplies all points; touching the barrier costs the combo, leaving the course ends the run (a shield saves you once). Each 1 km zone is faster.

**World:** zones cycle through Coast, Desert Dusk, Pine Forest, Neon City (night), Snowfield and Volcano.

**Progression:** XP/levels, coins (lights, zones, missions, level-ups), three rotating missions, five cars with speed/handling/nitro tuning and a paint shop.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main` (Pages source: GitHub Actions).
