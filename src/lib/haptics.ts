/**
 * Best-effort haptic tick.
 *
 * iOS has no Vibration API, but since iOS 18 Safari ticks the Taptic Engine when a
 * native `<input type="checkbox" switch>` toggles, including via a label click.
 * This is an unofficial trick: one light tick, no intensity, and in practice it
 * only fires inside a user gesture (tap). Android uses navigator.vibrate.
 */
export function hapticTick(): void {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(12);
    return;
  }
  try {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.append(input);
    document.head.append(label);
    label.click();
    label.remove();
  } catch {
    /* no haptics here */
  }
}
