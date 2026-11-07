/**
 * Small helpers shared by prototypes. Keep this file dependency-free:
 * anything imported here may end up in the initial bundle.
 */

/**
 * Inject a stylesheet for the lifetime of a prototype.
 * Use with Vite's `?inline` CSS imports so styles are removed on unmount
 * instead of leaking into the next prototype:
 *
 *   import css from './style.css?inline';
 *   useStyles(css, ctx.signal);
 */
export function useStyles(css: string, signal: AbortSignal): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  signal.addEventListener('abort', () => style.remove(), { once: true });
}

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Tiny hyperscript: h('button', { class: 'x', onclick: fn }, 'Label') */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}
