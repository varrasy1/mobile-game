# FLOWLINE

Minimalist, chill endless driving PWA — Vite + strict TypeScript + vanilla Canvas, zero runtime dependencies.

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build → dist/
```

**Controls:** touch left/right half of the screen (most recent finger wins) · `←/A` `→/D` on desktop.
Clip the coral apex arcs on the inside of each bend to build your flow streak.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys `main` on every push. If `main` is not the repo's default branch, the run hands itself over to the default branch (the `github-pages` environment only accepts deployments from there) and still deploys `main`.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions** (done). Recommended: set `main` as default branch.
