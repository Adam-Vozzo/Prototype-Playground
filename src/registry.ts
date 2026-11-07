import type { PrototypeEntry, PrototypeMeta, PrototypeModule } from './types';

/**
 * Prototypes are auto-discovered from the folder structure – adding a new
 * folder under src/prototypes/ is all it takes to register one.
 *
 * - meta.ts files are bundled eagerly (they are a few hundred bytes each).
 * - index.ts files become separate chunks, fetched only when opened.
 */
const metas = import.meta.glob<PrototypeMeta>('./prototypes/*/meta.ts', {
  eager: true,
  import: 'default',
});

const loaders = import.meta.glob<PrototypeModule>('./prototypes/*/index.ts');

const slugOf = (path: string) => path.split('/').at(-2)!;

const loaderBySlug = new Map(Object.entries(loaders).map(([p, l]) => [slugOf(p), l]));

/** Memoise so repeated opens / hover-prefetches share one request. */
const cache = new Map<string, Promise<PrototypeModule>>();

export const prototypes: PrototypeEntry[] = Object.entries(metas)
  .map(([path, meta]) => {
    const slug = slugOf(path);
    const loader = loaderBySlug.get(slug);
    if (!loader) {
      console.warn(`[registry] ${slug} has meta.ts but no index.ts – skipping`);
      return null;
    }
    const load = () => {
      let p = cache.get(slug);
      if (!p) {
        p = loader().catch((err) => {
          cache.delete(slug); // allow retry after a network failure
          throw err;
        });
        cache.set(slug, p);
      }
      return p;
    };
    return { ...meta, slug, load };
  })
  .filter((e): e is PrototypeEntry => e !== null)
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));

export const findPrototype = (slug: string) => prototypes.find((p) => p.slug === slug);

/** Warm a prototype's chunk (e.g. on hover) without mounting it. */
export const prefetch = (slug: string) => {
  findPrototype(slug)?.load().catch(() => {});
};
