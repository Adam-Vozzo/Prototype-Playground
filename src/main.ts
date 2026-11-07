import './shell/shell.css';
import { findPrototype, prefetch, prototypes } from './registry';
import { renderHome } from './shell/home';
import { renderHost } from './shell/host';

const root = document.getElementById('app')!;

/** Routes: `#/` → library, `#/<slug>` → prototype. Hash routing works on any static host. */
const parseRoute = () => decodeURIComponent(location.hash.replace(/^#\/?/, '').split(/[?#]/)[0]);

let teardown: (() => Promise<void> | void) | null = null;
let navId = 0;

async function route() {
  const id = ++navId;
  const prev = teardown;
  teardown = null;
  await prev?.();
  if (id !== navId) return; // a newer navigation started while we were tearing down

  root.replaceChildren();
  const slug = parseRoute();
  const entry = slug ? findPrototype(slug) : undefined;

  if (!slug) {
    document.title = 'Prototype Playground';
    teardown = renderHome(root, prototypes, prefetch);
  } else if (!entry) {
    document.title = 'Not found · Prototype Playground';
    teardown = renderHome(root, prototypes, prefetch, `No prototype called “${slug}”.`);
  } else {
    document.title = `${entry.title} · Prototype Playground`;
    teardown = renderHost(root, entry);
  }
}

addEventListener('hashchange', route);
route();
