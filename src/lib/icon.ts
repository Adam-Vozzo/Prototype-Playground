/**
 * Lucide icons for UI chrome (DESIGN.md §3 "Icons").
 *
 *   import { Play } from 'lucide';
 *   import { icon } from '../../lib/icon';
 *   button.append(icon(Play));
 *
 * Import icons by name so only the ones you use are bundled (lucide is
 * tree-shakeable). Icons are decorative: the control they sit in carries the
 * accessible label.
 */
import { createElement, type IconNode } from 'lucide';

export type { IconNode };

/** Default sizes: 16 dense rows / badges, 18 buttons, 20 primary, 24 hero. */
export function icon(node: IconNode, size = 18, className = ''): SVGElement {
  return createElement(node, {
    width: size,
    height: size,
    class: className ? `icon ${className}` : 'icon',
    'aria-hidden': 'true',
    focusable: 'false',
  });
}

/** Swap the icon inside an element (e.g. play ↔ pause) without touching its other children. */
export function setIcon(el: Element, node: IconNode, size = 18): void {
  const next = icon(node, size, el.querySelector('svg.icon')?.getAttribute('class')?.replace(/^icon\s*/, '') ?? '');
  const prev = el.querySelector('svg.icon');
  if (prev) prev.replaceWith(next);
  else el.prepend(next);
}
