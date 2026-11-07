#!/usr/bin/env node
// Scaffold a new prototype:  npm run new my-idea "My Idea"
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [slug, ...titleParts] = process.argv.slice(2);
if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('Usage: npm run new <kebab-case-slug> ["Display Title"]');
  process.exit(1);
}
const title = titleParts.join(' ') || slug.replace(/(^|-)(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase());
const prefix = slug.split('-').map((w) => w[0]).join('').slice(0, 3);

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'prototypes', slug);
if (existsSync(dir)) {
  console.error(`src/prototypes/${slug} already exists.`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

writeFileSync(join(dir, 'meta.ts'), `import type { PrototypeMeta } from '../../types';

// Keep this file tiny – it's bundled into the library index.
export default {
  title: ${JSON.stringify(title)},
  description: 'One-line pitch for the library card.',
  icon: '✨',
  tags: [],
  created: '${new Date().toISOString().slice(0, 10)}',
} satisfies PrototypeMeta;
`);

writeFileSync(join(dir, 'index.ts'), `import { h, useStyles } from '../../lib/dom';
import type { MountFn } from '../../types';
import css from './style.css?inline';

// Everything imported from this file is code-split and loaded only when
// the prototype is opened. UI follows DESIGN.md (targets, labels, motion).
export const mount: MountFn = (root, { signal }) => {
  useStyles(css, signal); // removed automatically on unmount

  root.append(h('div', { class: '${prefix}' }, h('h2', {}, ${JSON.stringify(title)})));

  // Pass \`signal\` to addEventListener / fetch and they clean themselves up.
  // Return a function for anything else (timers, WebGL, workers…).
  return () => {};
};
`);

writeFileSync(join(dir, 'style.css'), `/* Prefix classes with "${prefix}-" – styles live only while this prototype is mounted.
   Use the shared tokens from DESIGN.md: var(--tap), var(--dur-2), var(--ease-out)… */
.${prefix} {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
`);

console.log(`Created src/prototypes/${slug}/ → open http://localhost:5173/#/${slug}`);
