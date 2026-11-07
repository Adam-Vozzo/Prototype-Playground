# Prototype Playground

A library of small, self-contained prototype apps and experiences. The home
page lists every prototype; each one is code-split and **only downloaded when
you open it** (or hover its card, as a prefetch), so adding the 50th prototype
costs the home page a few hundred bytes, not another copy of three.js.

| Prototype | What it is |
| --- | --- |
| 💬 **Wiki Chat** (`#/wiki-chat`) | Paste a Wikipedia URL and a hyperactive stream chat reads the article to you, one sentence per message. Play/pause, step, restart, seek, jump to section, speed, chatter level, highlight & section toggles, and you can chat back. Deep-linkable: `#/wiki-chat?article=en:Octopus`. |
| 🪴 **Glass Garden** (`#/glass-garden`) | A three.js garden under a frosted glass dome. Orbit and zoom, wipe the frost off the glass, lift the dome, switch to night for fireflies, adjust the frost. |

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

The build uses a relative base and hash routing, so `dist/` can be dropped on
any static host (GitHub Pages, Netlify, S3…) under any path.

## Adding a prototype

```bash
npm run new my-idea "My Idea"
```

That creates `src/prototypes/my-idea/` and it appears in the library
immediately — there is no central list to edit. A prototype is a folder with:

| File | Loaded | Purpose |
| --- | --- | --- |
| `meta.ts` | eagerly, in the main bundle | Title, description, icon, tags, accent, order. **Keep it tiny and import nothing heavy.** |
| `index.ts` | lazily, as its own chunk | `export const mount: MountFn = (container, { slug, signal }) => cleanup` |
| `style.css` | with `index.ts` | Imported with `?inline` and injected via `useStyles(css, signal)` so it is removed on unmount. |

The `mount` contract (`src/types.ts`):

- `container` is a positioned, full-size element below the top bar.
- `signal` aborts when the user leaves — pass it to `addEventListener`,
  `fetch`, and `useStyles` and those clean themselves up.
- Return a cleanup function for anything else (timers, animation loops,
  WebGL contexts, workers). It may be async.
- Prefix CSS classes per prototype (`wc-`, `gg-`, …) to avoid collisions.

## How it's put together

```
index.html
src/
  main.ts            hash router: #/ → library, #/<slug> → prototype
  registry.ts        auto-discovers prototypes with import.meta.glob
                     (meta eager, index lazy, memoised + prefetchable)
  types.ts           PrototypeMeta / MountFn contract
  lib/dom.ts         tiny h() helper + useStyles()
  shell/             library page, prototype host chrome, global CSS
  prototypes/
    wiki-chat/       Wikipedia → stream-chat reader
    glass-garden/    three.js frosted-dome garden
scripts/new-prototype.mjs
```

Stack: Vite + TypeScript, no UI framework in the shell. Individual
prototypes can pull in whatever they like (three.js, a framework, etc.) —
it all lands in that prototype's chunk.
