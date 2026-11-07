# Design standards

The bar for interaction design, UX and motion in this repo. Prototypes are
quick, but they're played with on real phones, so these rules apply to every
prototype and the shell. A **must** is a hard rule. A **should** is the default,
and you need a reason to skip it. Each section explains why.

Shared tokens live in `src/shell/shell.css` (`:root`). Prototype CSS is
injected into the same document, so use `var(--tap)`, `var(--dur-2)` and
`var(--ease-out)` directly instead of hard-coding numbers.

---

## 1. Principles

1. **Content first, chrome second.** The experience is the point. Controls get
   out of the way but are never hidden behind guesswork.
2. **Clear beats compact.** Never save a row of space by making people guess
   what an icon does. If space is tight, use progressive disclosure (§4), not
   ambiguity.
3. **Every action answers back.** Each press, drag or keypress gives visible
   feedback within 100 ms (§5).
4. **Design for thumbs, then cursors.** Start at 360 px wide with touch. Hover
   and keyboard are extra layers on top, never something touch users need.
5. **Motion explains, it doesn't decorate.** Animate to show where something
   came from, what changed, or that the app heard you (§7).
6. **Respect the person's settings.** Reduced motion, text size, safe areas and
   their saved preferences all win over our defaults.

---

## 2. Touch & pointer targets

| Rule | Value | Token |
| --- | --- | --- |
| Absolute minimum hit area (WCAG 2.2 AA, 2.5.8) | **24 × 24 px**, must | `--tap-min` |
| Default for any control on touch | **40 × 40 px**, should | `--tap` |
| Primary / frequent actions (play, send, main toggle) | **44–48 px** | `--tap-lg` |
| Gap between adjacent targets | ≥ 8 px, or a 24 px hit circle that overlaps nothing | `--gap-tap` |

- **The hit area is not the visual size.** A 20 px icon is fine if its button is
  40 px. Grow the hit area with padding, `min-height`, or an absolutely
  positioned `::after` and keep the visual compact.
- **Sliders:** the thumb is ≥ 24 px and the input's box is ≥ `--tap` tall, so
  you don't have to land exactly on a 4 px track. Show the current value next to
  it if the number matters.
- **Links in body text** are exempt from the size rule (WCAG allows it). Links
  used as navigation are not: the "← Library" back link is a 40 px target.
- **Drag surfaces** (canvases, sliders, maps) **must** set `touch-action` so the
  page doesn't scroll or zoom under the gesture. Keep that to the surface itself.
- **Edges:** keep targets at least 8 px from the screen edge, plus the safe-area
  inset (§6). Gestures that start at the edge conflict with OS back-swipe.
- **Hover is an extra, never the only way.** Nothing should be reachable *only*
  by hover. Wrap hover styles in `@media (hover: hover)` so phones don't get a
  hover state that sticks after a tap.
- **Coarse pointers get bigger targets:** use `@media (pointer: coarse)` to
  move frequent controls from `--tap` to `--tap-lg` on touch screens, while
  keeping desktop compact.
- **Thumb reach:** on phones, frequent controls belong at the bottom or the
  middle. The top of the screen is for status and rare actions.

**Check:** run the target audit in §11 at 390 × 844. Nothing interactive
should come in under 40 px without a written reason, and nothing under 24 px at
all.

---

## 3. Labels, icons & toggles

- **An icon-only control must be universally understood:** play/pause, close,
  back, send, search. Anything else gets a **visible text label**. A tooltip
  or `title` is not a label: touch users never see it.
- Every icon-only control **must** have an `aria-label`. Decorative icons get
  `aria-hidden="true"`.
- **A toggle is either an action or a state, never both:**
  - *Action button:* the label says what will happen ("Lift dome", then "Lower
    dome"). It has **no** "on" styling.
  - *State toggle:* the label is fixed ("Night", "Auto-rotate"), it carries
    `aria-pressed` (or is a `role="switch"` checkbox), and it has clear on and
    off styling.
  - ❌ A button that flips its label to describe the action *and* lights up as
    "on". People can't tell whether a sun icon means "it is day" or "make it
    day".
- **Off must not look disabled.** Show off with a neutral surface and on with
  the accent colour. Fading to ~50% opacity is reserved for `:disabled`.
- **Pick the right control for choosing one value:** 2–6 options use a
  segmented control (radio group) so every option is visible. 7 or more, or
  options with dynamic names, use a native `<select>` with a visible label.
- Buttons use verbs ("Go live", "Restart") in sentence case. Labels describe
  results, not mechanisms.
- **Keyboard shortcuts** are optional extras. Show them where people look
  (a hint line, the `title`, or after the label on desktop), and never let them
  fire while focus is in a text field.

### Icons: Lucide, not emoji

- **Every icon in UI chrome must be a [Lucide](https://lucide.dev/icons) icon.**
  That covers buttons, menus, toolbars, tabs, badges, status and system notices,
  empty states and inputs. Use the `lucide` package with the shared helper:

  ```ts
  import { Play } from 'lucide';
  import { icon, setIcon } from '../../lib/icon';
  button.append(icon(Play));        // decorative: aria-hidden, class="icon"
  setIcon(button, Pause);           // swap in place (play ↔ pause)
  ```

- **No emoji or Unicode symbols as UI icons** (▶ ⏭ ↺ ↗ ⬆ ⚙ 🎲 …). They look
  different on every platform, ignore `currentColor`, sit on the text baseline
  instead of centring, can't be sized or stroked consistently, and some turn
  into colour emoji without warning.
- **Emoji are fine as content:** things people or characters "type" (chat
  messages), a prototype's identity in `meta.ts` (the library card icon), and
  playful copy. The test: if it's part of the interface, it's Lucide; if it's
  part of what the interface shows, emoji are allowed.
- **Sizes:** 16 px in dense rows, badges and inline notices; 18 px in buttons
  (the helper's default); 20 px for primary or icon-only controls; 24 px for
  hero or empty states. Keep the default 2 px stroke; use 2.5 px at 12–14 px so
  thin lines don't vanish.
- **Colour** comes from `currentColor`, so icons follow the text and state
  colour of their control. Don't hard-code a fill or stroke. The one exception:
  media transport icons (play, pause, skip) use `fill: currentColor` to give
  them weight, as media players do.
- **Alignment:** put icon and label in an `inline-flex` box with
  `align-items: center` and a 6–8 px gap. Never nudge with `vertical-align` or
  margins.
- **Motion:** to show state, rotate or swap the icon itself (a chevron turns
  180°, play swaps to pause). Don't draw arrows with CSS borders or text.
- Import icons by name from `'lucide'` (it's tree-shakeable). Never import the
  whole set or use `createIcons()` on the document.

---

## 4. Progressive disclosure

When the controls won't fit, **don't** shrink them into an unlabeled icon
strip. Split them:

1. **Always visible:** the 2–4 controls people need *right now* (for a player:
   play/pause, step, position). These are full-size targets.
2. **One tap away:** everything else, behind a clearly labelled disclosure
   ("Controls ▾") that expands *in place* (an accordion) or opens a bottom sheet
   on mobile. Inside, every control has a text label and is grouped under a
   heading.

Disclosure rules:

- The trigger is a `<button>` with `aria-expanded` and `aria-controls`, and a
  chevron that rotates to show its state. It has visible text, not just ▾.
- The collapsed trigger **should** summarise state when that helps
  (e.g. "Controls · 1.5× · Busy").
- Expand and collapse take `--dur-3` with `--ease-out` (§7). Content doesn't
  jump: animate the container's height (the `grid-template-rows: 0fr → 1fr`
  trick), not each child.
- The collapsed content is `inert`, so it can't be tabbed into or read by
  screen readers.
- `Esc` collapses it when focus is inside, and focus goes back to the trigger.
- Remember open/closed per prototype in `localStorage` when people are likely to
  want it the same way every time.
- **One disclosure open at a time** in the same area. Opening one closes its
  neighbour, so the bottom of a phone screen never stacks two panels.
- **Buttons inside fields** (clear, paste, send) are ≥ 40 px on touch. Clear
  only appears when there's something to clear, and send is disabled until
  there's something to send. The field's border is its focus indicator.

---

## 5. Feedback & state

**The system talks back.** Every action gets an answer people can see, and
every state the system is in is visible. Sometimes the answer is literal
("Fetching Octopus…"). More often it's visual: a pressed button, a spinner where
the icon was, a header that says "Tuning in", content animating into place.
Silence is a bug. If someone taps and nothing changes for even half a second,
they'll tap again or assume it's broken.

### Every control has a full set of states

| State | When | Must look like |
| --- | --- | --- |
| Rest | Default | Clearly interactive: shape, fill or underline; not just colour |
| Hover | Pointer over it, `@media (hover: hover)` only | A slight lift: lighter fill or accent border, over `--dur-1` |
| Pressed | `:active`, while the finger or button is down | Darker fill and/or `scale(0.96)`, over `--dur-1`. On touch this is the *only* proof a tap registered |
| Focus | `:focus-visible` | The 2 px `--focus` ring (§8) |
| Selected / on | `aria-pressed`, `:checked`, `aria-current`, `aria-expanded` | Accent fill or accent border, plus a non-colour cue (filled icon, check, thumb position, rotated chevron) |
| Busy | The action is running | `setBusy(el, true)` from `src/lib/feedback.ts`: a spinner replaces the icon, the label and width stay put, `aria-busy`, and it can't be triggered twice |
| Disabled | Not available right now | ~45% opacity, `cursor: default`, no hover. Say why nearby if it isn't obvious |
| Success / error | The result | Shown where the result is: content appears, or an inline message with a way to recover |

Hover is never the only signal (touch has none), and busy is never shown as
disabled (busy means "working on it", not "unavailable").

### Timing: how soon, and what

| Delay | What the user should see |
| --- | --- |
| 0–100 ms | Pressed style, and the state change itself if it's local (toggle flips, panel opens) |
| 100 ms – 1 s | The control goes busy *immediately* (don't wait to see if it'll be slow), and the cursor shows progress |
| > 1 s | Say what's happening in words, where people are looking: "Picking a random article…", a header status, a skeleton |
| > 10 s | Progress with an estimate, retry status ("Wikipedia is busy, retrying in 8 s…") or a way to cancel |

### The system talks through content and context

- **Narrate long operations** in the product's own voice and channel. In a chat
  prototype that's a system message; elsewhere a status line or caption. Name
  the thing ("Fetching “Octopus”…"), not the mechanism ("Loading…").
- **Show state where it lives.** If something is loading, the area it will fill
  shows it (header "Tuning in", pulsing avatar), not just the button.
- **Acknowledge changes whose effect isn't visible yet.** If turning chat off
  only shows as an absence later, say so now ("Chat muted"). If a keyboard
  shortcut changes a hidden setting, flash a short toast ("Speed 1.5×").
- **Arrivals animate in.** New content (a message, a loaded article, a revealed
  panel) enters with a short fade and slide or scale (§7), so the eye catches
  what changed.
- **Ambient signals for ongoing state:** a pulsing "live" dot while running, a
  breathing placeholder while loading. Under reduced motion these become static
  but stay visually distinct.

### Microinteractions

Small, fast animations that confirm an action. Use them generously, as long as
each has a purpose (§7):

- Press: `scale(0.96)` on `:active`.
- Toggle: thumb slides, fill cross-fades.
- Swap: the new icon pops in (`scale(0.7)` → 1, `--dur-2`) when play becomes
  pause.
- Status change: the badge pops (`scale(0.85)` → 1) when LIVE becomes PAUSED.
- Disclosure: the chevron rotates 180°.

Keep each under `--dur-3`, use the motion tokens, and never block input.

### Other rules

- Turn off the grey iOS tap flash (`-webkit-tap-highlight-color: transparent`)
  **only** where you provide your own `:active` style. The shell does this
  globally for that reason.
- **Empty states** say what to do next and offer a one-tap way to start
  (example chips, "Random").
- **Errors** appear where the problem is, in plain language, with a way to
  recover (Retry, an example). Never fail silently.
- **Layout stays stable.** Reserve space for things that load in, such as
  thumbnails, counters and labels with changing text (use `tabular-nums`).
  Busy states swap the icon rather than adding width. Content shouldn't jump
  under your finger.
- **Never take control away.** Auto-behaviour (auto-scroll, auto-advance) only
  stops for a real user action, never because of a layout shift. If you can't
  tell the two apart, keep going.
- Prefer **undo over confirm**. Don't stop people with dialogs for actions that
  are cheap to reverse.

---

## 6. Mobile specifics

- **`text-size-adjust: 100%`** is set in the shell. Without it, iOS Safari
  enlarges some text runs but not flex items, so inline layouts fall out of
  line (a username ends up smaller than, and above, its message). Size text
  deliberately instead; pinch-zoom and Safari's text-size setting still work.
- **Text inputs ≥ 16 px font size.** Smaller text makes iOS Safari zoom the page
  on focus. This one is a must.
- Set `inputmode`, `enterkeyhint`, `autocomplete` and `spellcheck` to suit each
  field ("go" for a URL bar, "send" for a chat box).
- **Safe areas:** the viewport uses `viewport-fit=cover`. Anything fixed to an
  edge pads with `env(safe-area-inset-*)`, especially bottom bars (home
  indicator) and the sides in landscape.
- Test at **320, 360, 390 and 430 px** wide, in landscape, and with browser text
  zoom at 200%. Nothing important may be clipped or overlapping.
- Scrolling containers inside the page use `overscroll-behavior: contain`, so
  reaching the end doesn't scroll or refresh the page behind them.
- **Double-tap-to-zoom is off** (`touch-action: manipulation`, set globally in
  the shell). It swallows quick repeated taps on controls (next, next, next) and
  causes accidental zooms. **Pinch-zoom must keep working.** Never use
  `user-scalable=no` or `maximum-scale`. Drag surfaces (canvases) use
  `touch-action: none` on themselves only.

---

## 7. Motion

### Purpose

Animate only to do one of these:

- **Feedback:** confirm a press or a state change.
- **Continuity:** show where something came from or went (expand, open, move).
- **Orientation:** draw attention to one new thing (a new message, a hint).
- **Ambience:** scenes and generative pieces, where the motion *is* the content.

If an animation does none of these, delete it.

### Duration

| Token | Value | Use |
| --- | --- | --- |
| `--dur-1` | 100 ms | Press, colour/opacity change on hover and active |
| `--dur-2` | 160 ms | Small elements: chips, toggles, tooltips, list items entering |
| `--dur-3` | 240 ms | Medium: accordions, popovers, bottom sheets |
| `--dur-4` | 360 ms | Large: full-screen transitions, scene-level UI changes |

- UI motion **must not** exceed ~400 ms. Longer is for ambient or scene
  animation only (a 1.4 s dome lift is fine; a 1.4 s menu is not).
- **Exits are faster than entrances** (about 70–80% of the duration). Once
  something's gone, nobody needs to watch it leave.
- **Larger distance means longer duration,** within the table above.
- **Stagger** lists 20–40 ms per item and cap the total at ~200 ms. Never make
  people wait for a cascade.

### Easing

| Token | Curve | Use |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Default. Anything entering or responding to input |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Things leaving the screen |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Things moving from A to B while staying on screen |

Never use `linear` for UI movement. It's only for spinners, progress and
continuous ambient loops.

### Mechanics

- Animate only `transform` and `opacity` (plus `grid-template-rows` for
  disclosures). Never animate `width`, `height`, `top` or `left`: they cause
  layout and jank on phones.
- **Use transitions for state changes,** not keyframes, so they can be
  interrupted. Toggling twice quickly should reverse smoothly, not restart.
- **Never block input with animation.** You can act during a transition.
- Things that pop in start from `scale(0.95)` and `opacity: 0`, never from
  `scale(0)`. They slide in from 4–8 px away, not across the screen.
- Canvas and WebGL loops are frame-rate independent (use delta time), pause
  while the tab is hidden, and clamp `dt` after a long pause.
- **60 fps on a mid-range phone.** If it drops, simplify the effect rather than
  shipping jank.

### Reduced motion

`prefers-reduced-motion: reduce` **must** be respected:

- The shell sets the `--dur-*` tokens to `0ms`, so UI built on them reacts
  instantly. Keyframe animations need their own `@media` block.
- Replace movement with a fade or nothing. Keep essential feedback such as
  state colours.
- Ambient or decorative auto-motion (auto-rotate, drifting particles) slows or
  stops by default. People can still turn it on.

---

## 8. Focus & keyboard

- Everything interactive is reachable with Tab, in reading order, and works with
  Enter/Space. Use real `<button>`, `<a>`, `<input>` and `<select>`, not `div`s
  with click handlers.
- **Focus must be visible:** the shell's global `:focus-visible` ring
  (2 px, `--focus`, offset 2 px). Don't use `outline: none` without a
  replacement of equal contrast.
- Radio groups move with the arrow keys, which native radios do for free.
- `Esc` closes or collapses the most recent overlay or disclosure.

---

## 9. Accessibility baseline

- Contrast: body text ≥ 4.5:1, large text and UI boundaries/icons ≥ 3:1,
  against the actual background (including over canvases and glass panels).
- Don't use colour alone to carry meaning. Pair it with text, an icon or shape.
- Dynamic regions announce politely (`role="status"`, `role="log"`) and don't
  steal focus.
- Every form field has a label: visible where possible, `aria-label` at least.
- Group related controls with `fieldset` + `legend` or `role="group"` +
  `aria-label`.

---

## 10. Layout & visual rhythm

- Spacing comes from a 4 px scale (4, 8, 12, 16, 24, 32…).
- Corner radii: 6–8 px for controls, 10–14 px for cards and panels, `999px` for
  pills.
- Align to a few edges. Group related controls with proximity and a heading,
  not boxes inside boxes.
- One primary (accent-filled) action per view. Everything else is secondary.
- Text: 14–16 px for UI, 16 px minimum for reading content on mobile, and line
  length ≤ 75 characters.

---

## 11. Review checklist

Run before merging any UI change.

- [ ] At 390 × 844: every target ≥ 40 px (or a written exception), none < 24 px.
- [ ] At 320 px wide: nothing clipped, overlapping or horizontally scrolling.
- [ ] No icon-only control except play/pause, close, back, send, search.
- [ ] Every UI icon is Lucide via `src/lib/icon.ts`; no emoji or Unicode symbols in chrome.
- [ ] Toggles are action-style *or* state-style (§3), never both.
- [ ] Every control has rest, hover (behind `(hover: hover)`), pressed, focus, selected (if it has one), disabled and busy states (§5).
- [ ] Every action answers within 100 ms; anything async shows busy at once and narrates if it takes over 1 s.
- [ ] Quick repeated taps don't zoom the page; pinch-zoom still works.
- [ ] Text inputs are ≥ 16 px; bottom and edge bars respect safe areas.
- [ ] Motion uses the tokens; nothing in the UI is over ~400 ms; it can be interrupted.
- [ ] Reduced motion checked (DevTools → Rendering → Emulate `prefers-reduced-motion`).
- [ ] Tab through the whole prototype: logical order, focus always visible.
- [ ] Empty, loading and error states all exist and offer a next step.

Quick target audit, pasted into the DevTools console:

```js
[...document.querySelectorAll('button, a[href], input, select, [role=button], [role=switch]')]
  .filter((e) => e.checkVisibility?.())
  .map((e) => [e, e.getBoundingClientRect()])
  .filter(([, r]) => r.width < 40 || r.height < 40)
  .forEach(([e, r]) => console.log(Math.round(r.width), '×', Math.round(r.height), e));
```

Native radios and checkboxes used as visually-hidden inputs inside a larger
`<label>` are measured by their label. Check that the label is the 40 px
target.
