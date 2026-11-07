import { h } from '../lib/dom';
import type { PrototypeEntry } from '../types';

export function renderHome(
  root: HTMLElement,
  entries: PrototypeEntry[],
  prefetch: (slug: string) => void,
  notice?: string,
) {
  const visible = entries.filter((e) => !e.hidden);
  const ac = new AbortController();

  const search = h('input', {
    type: 'search',
    class: 'home-search',
    placeholder: `Search ${visible.length} prototype${visible.length === 1 ? '' : 's'}…`,
    'aria-label': 'Search prototypes',
  });

  const grid = h('ul', { class: 'home-grid', role: 'list' });
  const empty = h('p', { class: 'home-empty', hidden: true }, 'Nothing matches that search.');

  const cards = visible.map((e) => {
    const link = h(
      'a',
      { class: 'card', href: `#/${e.slug}`, style: e.accent ? `--accent:${e.accent}` : undefined },
      h('span', { class: 'card-icon', 'aria-hidden': 'true' }, e.icon),
      h('span', { class: 'card-title' }, e.title),
      h('span', { class: 'card-desc' }, e.description),
      e.tags?.length
        ? h('span', { class: 'card-tags' }, ...e.tags.map((t) => h('span', { class: 'tag' }, t)))
        : null,
    );
    // Warm the chunk on intent so opening feels instant, without loading
    // every prototype up front.
    const warm = () => prefetch(e.slug);
    link.addEventListener('pointerenter', warm, { once: true, signal: ac.signal });
    link.addEventListener('focus', warm, { once: true, signal: ac.signal });
    link.addEventListener('touchstart', warm, { once: true, passive: true, signal: ac.signal });
    const li = h('li', {}, link);
    grid.append(li);
    return { li, haystack: [e.title, e.description, e.slug, ...(e.tags ?? [])].join(' ').toLowerCase() };
  });

  search.addEventListener(
    'input',
    () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const c of cards) {
        const match = !q || q.split(/\s+/).every((w) => c.haystack.includes(w));
        c.li.hidden = !match;
        if (match) shown++;
      }
      empty.hidden = shown > 0;
    },
    { signal: ac.signal },
  );

  root.append(
    h(
      'main',
      { class: 'home' },
      h(
        'header',
        { class: 'home-header' },
        h('h1', {}, 'Prototype Playground'),
        h('p', {}, 'A shelf of small experiments. Each one loads only when you open it.'),
        search,
      ),
      notice ? h('p', { class: 'home-notice', role: 'alert' }, notice) : null,
      grid,
      empty,
    ),
  );

  return () => ac.abort();
}
