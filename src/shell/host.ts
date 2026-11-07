import { h } from '../lib/dom';
import type { Cleanup, PrototypeEntry } from '../types';

/** Renders the chrome around a prototype and manages its lifecycle. */
export function renderHost(root: HTMLElement, entry: PrototypeEntry) {
  const ac = new AbortController();
  let cleanup: Cleanup | void;

  const stage = h('div', { class: 'host-stage', 'data-prototype': entry.slug });
  const status = h('div', { class: 'host-status', role: 'status' }, h('span', { class: 'spinner' }), 'Loading…');

  root.append(
    h(
      'div',
      { class: 'host' },
      h(
        'nav',
        { class: 'host-bar' },
        h('a', { class: 'host-back', href: '#/', 'aria-label': 'Back to library' }, '← Library'),
        h('span', { class: 'host-title' }, h('span', { 'aria-hidden': 'true' }, entry.icon), ' ', entry.title),
      ),
      stage,
      status,
    ),
  );

  (async () => {
    try {
      const mod = await entry.load();
      if (ac.signal.aborted) return;
      cleanup = await mod.mount(stage, { slug: entry.slug, signal: ac.signal });
      if (ac.signal.aborted) {
        // Navigated away while mount was in flight.
        await cleanup?.();
        return;
      }
      status.remove();
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error(err);
      status.replaceChildren(
        h('strong', {}, 'This prototype failed to load.'),
        h('code', {}, err instanceof Error ? err.message : String(err)),
        h('button', { class: 'btn', onclick: () => location.reload() }, 'Retry'),
      );
      status.classList.add('is-error');
    }
  })();

  return async () => {
    ac.abort();
    const c = cleanup;
    cleanup = undefined;
    try {
      await c?.();
    } catch (err) {
      console.error(`[${entry.slug}] cleanup failed`, err);
    }
  };
}
