/**
 * Interaction feedback helpers (DESIGN.md §5). Shared by prototypes; keep tiny.
 *
 *   setBusy(button, true);   // spinner replaces the icon, aria-busy, no double-submits
 *   setBusy(button, false);  // restores the original icon
 */
import { LoaderCircle } from 'lucide';
import { icon } from './icon';

const saved = new WeakMap<HTMLElement, { icon: Element | null; disabled: boolean }>();

/**
 * Put a control into (or out of) its busy state. The spinner takes the icon's
 * place (or is prepended if there's none) so the label – and the button's width –
 * stay put. The control is disabled while busy so it can't be triggered twice.
 */
export function setBusy(el: HTMLElement & { disabled?: boolean }, busy: boolean): void {
  if (busy) {
    if (saved.has(el)) return;
    const current = el.querySelector(':scope > svg.icon');
    saved.set(el, { icon: current, disabled: !!el.disabled });
    const spinner = icon(LoaderCircle, current ? Number(current.getAttribute('width')) || 18 : 16, 'icon-spin');
    if (current) current.replaceWith(spinner);
    else el.prepend(spinner);
    el.classList.add('is-busy');
    el.setAttribute('aria-busy', 'true');
    if ('disabled' in el) el.disabled = true;
  } else {
    const s = saved.get(el);
    if (!s) return;
    saved.delete(el);
    const spinner = el.querySelector(':scope > svg.icon-spin');
    if (spinner) s.icon ? spinner.replaceWith(s.icon) : spinner.remove();
    el.classList.remove('is-busy');
    el.removeAttribute('aria-busy');
    if ('disabled' in el) el.disabled = s.disabled;
  }
}
