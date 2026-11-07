# Notes for Claude

- This repo is a library of lazily-loaded prototypes. Read README.md "Adding a prototype".
- New prototype = `npm run new <slug>`; never import a prototype's `index.ts` from shared code
  (that would pull it into the main bundle). Only `meta.ts` is eager, and it must stay import-free
  apart from types.
- Prototype CSS: `import css from './style.css?inline'` + `useStyles(css, signal)`, classes prefixed.
- **UI work follows `DESIGN.md`** (touch targets ≥ 24px, ideally 40px; visible labels over icon-only
  rows; motion tokens; reduced motion). Run its §11 checklist before merging any UI change.
- **Icons are Lucide** (`import { X } from 'lucide'` + `icon()` from `src/lib/icon.ts`), never emoji or
  Unicode symbols in UI chrome. Emoji are only for content (chat text, `meta.ts` card icons).
- Clean up everything in `mount`'s return value or via `signal`; the host mounts/unmounts on navigation.
- Verify with `npm run build` (runs `tsc --noEmit` then `vite build`) and check the chunk list:
  the main `index-*.js` should stay small.

## Workflow (owner's standing instruction)

- **Always merge changes to `main`.** Work on the session branch, open a PR, and once CI is green
  merge it into `main` yourself — don't leave PRs waiting for review.
- Merging to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`:
  https://adam-vozzo.github.io/Prototype-Playground/ (prototype links: `#/<slug>`).
