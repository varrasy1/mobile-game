# FLOWLINE

Minimalist, chill endless driving PWA — Vite + strict TypeScript + vanilla Canvas, zero runtime dependencies.

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build → dist/
```

**Controls:** hold the left / right half of the screen to steer into a drift; release to grip up and drive straight (drag works too for finer control). Desktop: `←/A` `→/D`, `Space` for nitro. The drift radius is the same at every speed — corners are about timing: turn in at the right moment, release when the nose points down the next straight.

**Loop (arcade):** a track-up course that is generated fresh every run: straights, quick kinks, 90° corners, tight 140° bends and 180° hairpins with random radii, chained into esses — every candidate segment is simulated and checked for clearance first, so the course can wander in any direction without ever overlapping. Chevron markers show where to turn in (they move with your speed). Every corner is graded PERFECT / CLEAN / SLOPPY; clean corners build a ×9 combo. Kerb-riding drifts pay extra, jump ramps launch you, gravel costs the combo after 0.35 s and beyond it you crash (a shield saves you once). Each 1 km zone is faster.

**Modes:** ENDLESS, or DAILY — the same seeded course for everyone each day, with its own best.

**World:** zones cycle through Coast, Desert Dusk, Pine Forest, Neon City (night), Snowfield and Volcano.

**Garage:** eight cars (Aero, Vector, Apex, Torque, Zenith, Gravel, Umbra, Afterburn), each with a signature perk, speed/handling/nitro tuning, paint shop, neon underglow and tyre-smoke colours. XP/levels, coins and three rotating missions.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main` (Pages source: GitHub Actions).
