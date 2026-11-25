# FLOWLINE

Minimalist, chill endless driving PWA — Vite + strict TypeScript + vanilla Canvas, zero runtime dependencies.

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build → dist/
```

**Controls:** hold the left/right half of the screen (steering ramps in), or drag sideways for analogue control · `←/A` `→/D` on desktop. A light steering assist follows the road.

**Loop:** your flow meter drains over time. Refill it by clipping apex arcs (PERFECT inside 12px), collecting light chains on the racing line, banking clean drifts, hitting boost pads and reaching new sectors (every 1.5 km). When flow runs dry the car eases off and the run is scored.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main` (Pages source: GitHub Actions).
