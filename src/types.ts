/**
 * Contract every prototype implements.
 *
 * A prototype lives in `src/prototypes/<slug>/` and provides two files:
 *
 *   meta.ts   – `export default { ... } satisfies PrototypeMeta`
 *               Tiny, loaded eagerly so the library index can list it.
 *               MUST NOT import anything heavy.
 *
 *   index.ts  – `export const mount: MountFn = (el, ctx) => { ...; return cleanup }`
 *               Loaded lazily (its own chunk) only when the prototype is opened.
 *               Put all heavy imports (three.js, big data, CSS) here.
 */

export interface PrototypeMeta {
  /** Display name in the library. */
  title: string;
  /** One-line pitch shown on the card. */
  description: string;
  /** Emoji / short glyph used as the card icon. */
  icon: string;
  /** Free-form tags for filtering. */
  tags?: string[];
  /** CSS colour (or gradient) used for the card accent. */
  accent?: string;
  /** Sort order in the library; lower first. Defaults to 100. */
  order?: number;
  /** Hide from the library index (still reachable by URL). */
  hidden?: boolean;
  /** ISO date string, shown on the card. */
  created?: string;
}

export interface PrototypeContext {
  /** Slug from the folder name; useful for namespacing storage keys. */
  slug: string;
  /** Aborted when the prototype is unmounted – pass to fetch / addEventListener. */
  signal: AbortSignal;
}

/** Cleanup returned from mount. May be async. */
export type Cleanup = () => void | Promise<void>;

export type MountFn = (
  container: HTMLElement,
  ctx: PrototypeContext,
) => Cleanup | void | Promise<Cleanup | void>;

export interface PrototypeModule {
  mount: MountFn;
}

export interface PrototypeEntry extends PrototypeMeta {
  slug: string;
  load: () => Promise<PrototypeModule>;
}
