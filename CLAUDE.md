# Notes for Claude

- This repo is a library of lazily-loaded prototypes. Read README.md "Adding a prototype".
- New prototype = `npm run new <slug>`; never import a prototype's `index.ts` from shared code
  (that would pull it into the main bundle). Only `meta.ts` is eager, and it must stay import-free
  apart from types.
- Prototype CSS: `import css from './style.css?inline'` + `useStyles(css, signal)`, classes prefixed.
- Clean up everything in `mount`'s return value or via `signal`; the host mounts/unmounts on navigation.
- Verify with `npm run build` (runs `tsc --noEmit` then `vite build`) and check the chunk list:
  the main `index-*.js` should stay small.
