import {
  ArrowDown, BookOpen, ChevronUp, Dices, ExternalLink, FastForward, Hourglass, Megaphone,
  Gauge, MessageSquare, MessageSquareOff, Pause, PartyPopper, Play, Radio, RotateCcw, Smile, Search, SkipForward, TriangleAlert, User,
} from 'lucide';
import { h, useStyles } from '../../lib/dom';
import { setBusy } from '../../lib/feedback';
import { icon, setIcon, type IconNode } from '../../lib/icon';
import type { MountFn } from '../../types';
import css from './style.css?inline';
import { BADGES, createCrowd, pick, type Badge, type Chatter } from './chatters';
import { CHANNEL, emoteLine, loadEmotes, randomEmote, type EmoteMap } from './emotes';
import { reaction } from './reactions';
import { fetchArticle, fetchRandomTitle, parseArticleRef, type Article } from './wikipedia';

const SPEEDS = [0.5, 1, 1.5, 2, 3, 5];
const CHATTER = [
  { label: 'Off', range: null },
  { label: 'Chill', range: [1800, 4500] },
  { label: 'Busy', range: [450, 1600] },
  { label: 'Chaos', range: [70, 380] },
] as const;
const MAX_MESSAGES = 250;
const EXAMPLES = ['Octopus', 'Great Emu War', 'Toast', 'Voyager 1', 'Honey badger', 'Tardigrade'];

interface Settings {
  speed: number;
  chatter: number;
  highlight: boolean;
  headings: boolean;
  emotes: boolean;
  panelOpen?: boolean;
}

export const mount: MountFn = (root, { slug, signal }) => {
  useStyles(css, signal);

  // ---------- persisted settings ----------
  const storeKey = `pp:${slug}:settings`;
  const settings: Settings = { speed: 1, chatter: 2, highlight: true, headings: true, emotes: true };
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(storeKey) ?? '{}'));
  } catch {}
  const save = () => localStorage.setItem(storeKey, JSON.stringify(settings));

  // ---------- state ----------
  let article: Article | null = null;
  let cursor = 0;
  let playing = false;
  let lastSentence = '';
  let sentenceTimer = 0;
  let chatterTimer = 0;
  let viewerTimer = 0;
  let viewers = 0;
  let loadCtl: AbortController | null = null;
  const nextChatter = createCrowd();
  const me: Chatter = { name: 'you', color: '#bf94ff', badges: [] };
  /** Every article line comes from the same broadcaster, so it never reads as crowd chat. */
  const narrator: Chatter = { name: 'WikiReader', color: '#ffb547', badges: ['host'] };
  const chatOn = () => CHATTER[settings.chatter]?.range != null;

  // ---------- DOM ----------
  // Top: what's on air + the article box. Middle: chat. Bottom (thumb reach): the chat
  // box, then a player dock – play/pause, next, position and a labelled "Controls"
  // button that expands a settings list upward, right above the dock (DESIGN.md §2, §4).
  const iconBtn = (node: IconNode, label: string, disabled = false) =>
    h('button', { class: 'wc-icon', type: 'button', title: label, 'aria-label': label, disabled }, icon(node, 20));
  const relabel = (btn: HTMLElement, node: IconNode, label: string) => {
    setIcon(btn, node, 20);
    btn.title = label;
    btn.setAttribute('aria-label', label);
  };
  /** Text button with a leading Lucide icon – used inside the controls panel. */
  const labelBtn = (node: IconNode, label: string | Node, title?: string) =>
    h('button', { class: 'wc-btn wc-btn-labelled', type: 'button', title }, icon(node), label);
  /** Words dropped on phones so the action row fits on one line ("Random article" → "Random"). */
  const wide = (text: string) => h('span', { class: 'wc-wide-only' }, text);
  let uid = 0;
  const nextId = (p: string) => `wc-${p}-${++uid}-${Math.random().toString(36).slice(2, 6)}`;
  /** A settings-list row label (with optional keyboard hint). */
  const settingLabel = (text: string, hintKeys?: string, id?: string) =>
    h('span', { class: 'wc-setting-label', id }, text, hintKeys ? h('kbd', { class: 'wc-keyhint' }, hintKeys) : null);
  /** Native radio group styled as a segmented control: every option visible, arrow keys work. */
  const segmented = <T extends string | number>(label: string, options: { value: T; label: string }[], hintKeys?: string) => {
    const name = nextId('seg');
    const labelId = nextId('lbl');
    const inputs = options.map((o) => h('input', { type: 'radio', name, value: o.value }));
    const el = h(
      'div',
      { class: 'wc-setting wc-setting--wide', role: 'radiogroup', 'aria-labelledby': labelId },
      settingLabel(label, hintKeys, labelId),
      h('div', { class: 'wc-seg wc-setting-control' }, ...options.map((o, i) => h('label', { class: 'wc-seg-opt' }, inputs[i], h('span', {}, o.label)))),
    );
    const set = (v: T) => inputs.forEach((inp) => (inp.checked = inp.value === String(v)));
    const onChange = (fn: (v: string) => void) =>
      el.addEventListener('change', (e) => fn((e.target as HTMLInputElement).value), { signal });
    return { el, set, onChange };
  };
  /** Checkbox rendered as a labelled switch row. */
  const switchCtl = (label: string, description?: HTMLElement) => {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'wc-switch-input' });
    const text = description
      ? h('span', { class: 'wc-setting-text' }, settingLabel(label), description)
      : settingLabel(label);
    if (description) {
      description.id = nextId('desc');
      input.setAttribute('aria-describedby', description.id);
    }
    const el = h('label', { class: 'wc-setting wc-switch' }, text, input, h('span', { class: 'wc-switch-track', 'aria-hidden': 'true' }));
    return { el, input };
  };

  const urlInput = h('input', {
    class: 'wc-url',
    type: 'text',
    inputmode: 'url',
    enterkeyhint: 'go',
    placeholder: 'Paste a Wikipedia link or type a title…',
    'aria-label': 'Wikipedia URL or article title',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  });
  const loadBtn = h('button', { class: 'wc-btn wc-primary', type: 'submit' }, icon(Radio), 'Go live');
  const form = h('form', { class: 'wc-form' }, urlInput, loadBtn);

  const avatar = h('div', { class: 'wc-avatar', 'aria-hidden': 'true' }, icon(BookOpen, 18));
  const liveBadge = h('span', { class: 'wc-live' }, 'OFFLINE');
  const viewerCount = h('span', {});
  const viewerEl = h('span', { class: 'wc-viewers', hidden: true }, icon(User, 14), viewerCount);
  const titleEl = h('h2', { class: 'wc-title' }, 'Nothing on air');
  const sectionEl = h('span', { class: 'wc-section' });
  const subProgress = h('span', { class: 'wc-sub-progress' });
  const descEl = h('span', { class: 'wc-desc' }, 'Paste a Wikipedia link and chat will read it to you');
  const stream = h(
    'div',
    { class: 'wc-stream' },
    avatar,
    h(
      'div',
      { class: 'wc-stream-text' },
      h('div', { class: 'wc-stream-line' }, liveBadge, titleEl, viewerEl),
      h('div', { class: 'wc-stream-sub' }, sectionEl, subProgress, descEl),
    ),
  );

  // --- always visible: transport ---
  const playBtn = iconBtn(Play, 'Play (Space)', true);
  playBtn.classList.add('wc-play');
  const stepBtn = iconBtn(SkipForward, 'Next sentence (→)', true);
  const seek = h('input', { class: 'wc-seek', type: 'range', min: 0, max: 0, value: 0, 'aria-label': 'Article position', disabled: true });
  const progressLabel = h('span', { class: 'wc-progress-label', 'aria-hidden': 'true' }, '0 / 0');
  const panelId = `wc-panel-${Math.random().toString(36).slice(2, 7)}`;
  const moreSummary = h('span', { class: 'wc-more-summary' });
  const moreBtn = h(
    'button',
    { class: 'wc-more', type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
    h('span', {}, 'Controls'),
    moreSummary,
    icon(ChevronUp, 18, 'wc-chevron'),
  );

  // --- one tap away: settings list + actions, expanding upward above the dock ---
  const sectionSelect = h('select', { class: 'wc-select wc-setting-control', disabled: true });
  const sectionField = h('label', { class: 'wc-setting wc-setting--wide' }, settingLabel('Section'), sectionSelect);
  const speedCtl = segmented('Speed', SPEEDS.map((v) => ({ value: v, label: `${v}×` })), '[ ]');
  const chatterCtl = segmented('Chat activity', CHATTER.map((c, i) => ({ value: i, label: c.label })));
  const highlightCtl = switchCtl('Highlight article lines');
  const headingsCtl = switchCtl('Announce new sections');
  const emoteStatus = h('span', { class: 'wc-setting-desc' }, `${CHANNEL.name}’s chat · 7TV · BetterTTV · FFZ`);
  const emotesCtl = switchCtl('Show emotes', emoteStatus);
  const restartBtn = labelBtn(RotateCcw, 'Restart', 'Restart from the top (R)');
  restartBtn.disabled = true;
  const randomBtn = labelBtn(Dices, h('span', {}, 'Random', wide(' article')), 'Load a random article');
  const sourceLink = h('a', { class: 'wc-btn wc-btn-labelled', target: '_blank', rel: 'noopener', hidden: true, title: 'Open this article on Wikipedia' },
    icon(ExternalLink), h('span', {}, wide('Open on '), 'Wikipedia'));

  const panelBody = h(
    'div',
    { class: 'wc-panel-body' },
    h(
      'div',
      { class: 'wc-settings' },
      h('div', { class: 'wc-settings-col' }, sectionField, speedCtl.el, chatterCtl.el),
      h('div', { class: 'wc-settings-col' }, highlightCtl.el, headingsCtl.el, emotesCtl.el),
    ),
    h('div', { class: 'wc-actions' }, restartBtn, randomBtn, sourceLink),
  );
  // panel (grid rows 0fr↔1fr) > clip (min-height 0, clips) > body (padding, layout)
  const panel = h('div', { class: 'wc-panel', id: panelId, role: 'region', 'aria-label': 'Controls' }, h('div', { class: 'wc-panel-clip' }, panelBody));

  const header = h('header', { class: 'wc-top' }, stream, form);

  const log = h('ol', { class: 'wc-log', role: 'log', 'aria-label': 'Chat messages' });
  const toastEl = h('div', { class: 'wc-toast', role: 'status', 'aria-live': 'polite' });
  const resumeBtn = h('button', { class: 'wc-resume', type: 'button', hidden: true }, 'Chat paused · jump to latest', icon(ArrowDown, 16));
  const chatInput = h('input', { class: 'wc-chat-input', type: 'text', enterkeyhint: 'send', placeholder: 'Send a message', maxlength: 300, 'aria-label': 'Send a message' });
  const chatForm = h('form', { class: 'wc-chat-form' }, chatInput, h('button', { class: 'wc-btn wc-primary', type: 'submit' }, 'Chat'));

  const dock = h(
    'footer',
    { class: 'wc-dock' },
    panel,
    h(
      'div',
      { class: 'wc-transport', role: 'group', 'aria-label': 'Playback' },
      playBtn,
      stepBtn,
      h('div', { class: 'wc-progress' }, seek, progressLabel),
      moreBtn,
    ),
  );

  root.append(
    h(
      'div',
      { class: 'wc' },
      header,
      h('main', { class: 'wc-chat' }, h('div', { class: 'wc-log-wrap' }, log, resumeBtn, toastEl), chatForm),
      dock,
    ),
  );

  // ---------- controls disclosure ----------
  const setPanelOpen = (open: boolean, persist = true) => {
    moreBtn.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('is-open', open);
    panel.inert = !open;
    if (persist) {
      settings.panelOpen = open;
      save();
    }
  };
  moreBtn.addEventListener('click', () => setPanelOpen(!panel.classList.contains('is-open')), { signal });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    setPanelOpen(false);
    moreBtn.focus();
  }, { signal });
  const syncSummary = () => {
    moreSummary.textContent = `${settings.speed}× · ${CHATTER[settings.chatter]?.label ?? ''}`;
  };
  // Closed by default so chat gets the room; remember the person's choice after that.
  setPanelOpen(settings.panelOpen ?? false, false);

  /** Empty-state welcome with clickable example articles. */
  function showWelcome() {
    append(
      h(
        'li',
        { class: 'wc-system wc-welcome' },
        h('span', {}, 'Welcome! Paste a Wikipedia link up top, or try one of these:'),
        h(
          'span',
          { class: 'wc-examples' },
          ...EXAMPLES.map((t) => {
            const chip: HTMLButtonElement = h('button', { class: 'wc-chip', type: 'button', onclick: () => load(t, chip) }, t);
            return chip;
          }),
          (() => {
            const chip: HTMLButtonElement = h('button', { class: 'wc-chip wc-chip-random', type: 'button', onclick: () => loadRandom(chip) }, icon(Dices, 16), 'Surprise me');
            return chip;
          })(),
        ),
        h('span', { class: 'wc-keys' }, 'Space play/pause · → next · [ ] speed · R restart'),
      ),
    );
  }

  // ---------- chat log ----------
  let stickToBottom = true;
  let scrollQueued = false;

  const scrollToBottom = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      log.scrollTop = log.scrollHeight;
    });
  };

  // Only *you* can pause chat. Scroll events also fire when layout shifts under us
  // (emotes finish loading, old messages are trimmed, a long message lands before
  // the next frame), so a scroll away from the bottom only counts as "paused"
  // if it follows real input; otherwise we re-pin to the bottom.
  let lastUserInput = -Infinity;
  const markInput = () => (lastUserInput = performance.now());
  for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const) {
    log.addEventListener(type, markInput, { signal, passive: true });
  }
  log.addEventListener(
    'scroll',
    () => {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      if (atBottom) {
        stickToBottom = true;
        resumeBtn.hidden = true;
      } else if (performance.now() - lastUserInput < 800) {
        stickToBottom = false;
        resumeBtn.hidden = false;
      } else if (stickToBottom) {
        scrollToBottom(); // layout moved, not you – stay pinned
      }
    },
    { signal, passive: true },
  );
  resumeBtn.addEventListener('click', () => {
    stickToBottom = true;
    resumeBtn.hidden = true;
    scrollToBottom();
  }, { signal });

  function badge(b: Badge) {
    return h('span', { class: `wc-badge wc-badge-${b}`, title: BADGES[b].label, role: 'img', 'aria-label': BADGES[b].label }, icon(BADGES[b].icon, 12));
  }

  // ---------- emotes ----------
  let emotes: EmoteMap = new Map();
  let emotesLoading: Promise<void> | null = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function ensureEmotes() {
    if (emotes.size || emotesLoading) return;
    emoteStatus.textContent = `Loading ${CHANNEL.name}’s emotes…`;
    emotesLoading = loadEmotes(signal)
      .then(({ emotes: loaded, channelCount, failed }) => {
        if (signal.aborted) return;
        emotes = loaded;
        const globals = loaded.size - channelCount;
        emoteStatus.textContent = loaded.size
          ? `${channelCount} from ${CHANNEL.name}’s chat + ${globals} global${failed.length ? ' · some sources offline' : ''}`
          : 'Couldn’t reach 7TV, BetterTTV or FFZ – emotes show as text';
        rerenderEmotes();
      })
      .catch(() => {})
      .finally(() => (emotesLoading = null));
  }

  /** Whole-word emote codes become images; everything else stays text. */
  function richText(text: string): (string | HTMLElement)[] {
    if (!settings.emotes || !emotes.size) return [text];
    return text.split(/(\s+)/).map((tok) => {
      const e = emotes.get(tok);
      if (!e) return tok;
      const still = e.animated && reducedMotion.matches;
      if (still && !e.staticSrc) return tok; // can't freeze it: show the code instead
      const img = h('img', {
        class: 'wc-emote',
        src: still ? e.staticSrc : e.src,
        srcset: still ? undefined : e.srcset,
        alt: e.code,
        title: `${e.code} · ${e.provider}${e.scope === 'channel' ? ` · ${CHANNEL.name}` : ''}`,
        height: 28,
        loading: 'lazy',
        decoding: 'async',
        referrerpolicy: 'no-referrer',
      });
      if (e.ratio) img.style.aspectRatio = String(e.ratio);
      // If the CDN fails, fall back to the code rather than a broken image.
      img.addEventListener('error', () => img.replaceWith(e.code), { once: true });
      img.addEventListener('load', () => stickToBottom && scrollToBottom(), { once: true });
      return img;
    });
  }

  function rerenderEmotes() {
    for (const el of log.querySelectorAll<HTMLElement>('.wc-text[data-raw]')) el.replaceChildren(...richText(el.dataset.raw!));
  }

  function post(who: Chatter, text: string, kind: 'chat' | 'article' | 'mine' = 'chat') {
    const badges = who.badges.map(badge);
    // Article lines are Wikipedia's words – never turn them into emotes.
    const body = kind === 'article'
      ? h('span', { class: 'wc-text' }, text)
      : h('span', { class: 'wc-text', 'data-raw': text }, ...richText(text));
    const li = h(
      'li',
      { class: `wc-msg wc-msg--${kind}${kind === 'article' ? ' is-hl' : ''}` },
      // Badges + name + colon share one line-tall flex box, so they're centred on
      // each other whatever the font's metrics; the message text flows after it.
      h(
        'span',
        { class: 'wc-who' },
        ...badges,
        h('span', { class: 'wc-name', style: `color:${who.color}` }, who.name),
        h('span', { class: 'wc-colon' }, ':'),
      ),
      ' ',
      body,
    );
    append(li);
  }

  function system(node: IconNode, text: string, tone: 'info' | 'section' | 'warn' = 'info') {
    append(h('li', { class: `wc-system wc-system-${tone}` }, icon(node, 16), h('span', {}, text)));
  }

  function append(li: HTMLElement) {
    log.append(li);
    // Don't trim while the user is scrolled up reading – it would shift their view.
    if (stickToBottom) {
      while (log.childElementCount > MAX_MESSAGES) log.firstElementChild!.remove();
      scrollToBottom();
    } else if (log.childElementCount > MAX_MESSAGES * 4) {
      log.firstElementChild!.remove();
    }
  }

  // ---------- playback ----------
  const readDelay = (text: string) => (650 + text.length * 30) / settings.speed;

  function step() {
    if (!article) return;
    if (cursor >= article.sentences.length) return finish();
    const s = article.sentences[cursor];
    const prevSection = cursor > 0 ? article.sentences[cursor - 1].section : -1;
    if (s.section !== prevSection && s.section > 0 && settings.headings) {
      system(Megaphone, `Now reading: ${article.sections[s.section]}`, 'section');
    }
    post(narrator, s.text, 'article');
    lastSentence = s.text;
    cursor++;
    updateProgress();
    if (cursor >= article.sentences.length) finish();
  }

  function finish() {
    setPlaying(false);
    if (!article) return;
    system(PartyPopper, `That's the whole article! ${article.sentences.length} messages of pure knowledge.`);
    if (!chatOn()) return;
    for (let i = 0; i < 4; i++) setTimeout(() => !signal.aborted && chatOn() && post(nextChatter(), pick(['GG', 'gg', 'GG WP', 'o7', 'W stream', 'again!!', 'that was beautiful 😭'])), 150 + i * 180);
  }

  function scheduleSentence(delay: number) {
    clearTimeout(sentenceTimer);
    sentenceTimer = window.setTimeout(() => {
      if (!playing) return;
      step();
      if (playing) scheduleSentence(readDelay(lastSentence));
    }, delay);
  }

  function scheduleChatter() {
    clearTimeout(chatterTimer);
    const range = CHATTER[settings.chatter]?.range;
    if (!playing || !range) return;
    const [lo, hi] = range;
    const delay = (lo + Math.random() * (hi - lo)) / Math.sqrt(settings.speed);
    chatterTimer = window.setTimeout(() => {
      if (!playing) return;
      const who = nextChatter();
      let other = nextChatter();
      if (other.name === who.name) other = nextChatter();
      const r = Math.random();
      if (emotes.size && r < 0.04) emoteWall();
      else if (emotes.size && r < 0.2) post(who, emoteLine(emotes)!);
      else {
        let line = reaction(lastSentence, other.name === who.name ? undefined : other.name);
        if (emotes.size && r > 0.88) line += ` ${randomEmote(emotes)}`;
        post(who, line);
      }
      scheduleChatter();
    }, delay);
  }

  /** Several chatters spam the same emote in a burst, like a real chat. */
  function emoteWall() {
    const e = randomEmote(emotes);
    if (!e) return;
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        if (signal.aborted || !playing || !chatOn()) return;
        post(nextChatter(), Math.random() < 0.3 ? `${e} ${e}` : e);
      }, i * (90 + Math.random() * 120));
    }
  }

  function driftViewers() {
    clearTimeout(viewerTimer);
    if (!playing) return;
    viewers = Math.max(12, Math.round(viewers * (0.985 + Math.random() * 0.035)));
    viewerCount.textContent = viewers.toLocaleString();
    viewerTimer = window.setTimeout(driftViewers, 2500);
  }

  function setPlaying(on: boolean) {
    if (on && article && cursor >= article.sentences.length) {
      cursor = 0; // play after the end restarts
      system(RotateCcw, 'Restarting from the top');
    }
    playing = on && !!article;
    relabel(playBtn, playing ? Pause : Play, playing ? 'Pause (Space)' : 'Play (Space)');
    playBtn.classList.toggle('is-on', playing);
    syncLive();
    clearTimeout(sentenceTimer);
    clearTimeout(chatterTimer);
    clearTimeout(viewerTimer);
    if (playing) {
      scheduleSentence(250);
      scheduleChatter();
      driftViewers();
    }
  }

  function jumpTo(index: number, announce = true) {
    if (!article) return;
    cursor = Math.max(0, Math.min(index, article.sentences.length - 1));
    if (announce) system(FastForward, `Jumped to “${article.sections[article.sentences[cursor].section]}”`);
    updateProgress();
    if (playing) scheduleSentence(300);
  }

  function updateProgress() {
    if (!article) return;
    const total = article.sentences.length;
    seek.max = String(total);
    seek.value = String(cursor);
    progressLabel.textContent = subProgress.textContent = `${cursor} / ${total}`;
    seek.setAttribute('aria-valuetext', `Sentence ${cursor} of ${total}`);
    const sec = article.sentences[Math.max(0, Math.min(cursor, total) - 1)]?.section ?? 0;
    sectionEl.textContent = sec === 0 ? 'Introduction' : article.sections[sec];
    sectionSelect.value = String(sec);
  }

  // ---------- loading ----------
  const retryNotice = (ms: number) =>
    system(Hourglass, `Wikipedia is busy, retrying in ${Math.round(ms / 1000)}s…`);

  // ---------- feedback: tuning state, toasts ----------
  let tuning = false;
  const busyTriggers = new Set<HTMLElement>();
  const wc = root.querySelector<HTMLElement>('.wc')!;

  function syncLive() {
    liveBadge.textContent = tuning ? 'TUNING IN' : article ? (playing ? 'LIVE' : 'PAUSED') : 'OFFLINE';
    liveBadge.classList.toggle('is-live', playing && !tuning);
    // Re-trigger the badge's little pop so state changes are noticed.
    liveBadge.classList.remove('is-changed');
    void liveBadge.offsetWidth;
    liveBadge.classList.add('is-changed');
  }

  /** The header and the control you pressed both show we're working on it, instantly. */
  function startTuning(label: string, trigger?: HTMLElement) {
    tuning = true;
    if (trigger) {
      setBusy(trigger, true);
      busyTriggers.add(trigger);
    }
    wc.classList.add('is-tuning');
    titleEl.textContent = label;
    syncLive();
  }
  function stopTuning(ok: boolean) {
    tuning = false;
    for (const t of busyTriggers) setBusy(t, false);
    busyTriggers.clear();
    wc.classList.remove('is-tuning');
    if (!ok) titleEl.textContent = article?.title ?? 'Nothing on air';
    syncLive();
  }

  let toastTimer = 0;
  /** Brief confirmation for changes made where you can't see the control (keyboard shortcuts). */
  function toast(node: IconNode, text: string) {
    toastEl.replaceChildren(icon(node, 16), text);
    toastEl.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('is-shown'), 1400);
  }
  const panelIsOpen = () => panel.classList.contains('is-open');

  async function loadRandom(trigger: HTMLElement = randomBtn) {
    if (tuning && busyTriggers.has(trigger)) return;
    loadCtl?.abort();
    const ctl = (loadCtl = new AbortController());
    const onAbort = () => ctl.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    setPlaying(false);
    startTuning('Picking a random article…', trigger);
    if (trigger !== randomBtn) {
      setBusy(randomBtn, true);
      busyTriggers.add(randomBtn);
    }
    system(Dices, 'Rolling the dice for a random article…');
    try {
      const lang = parseArticleRef(urlInput.value)?.lang ?? article?.lang ?? 'en';
      const title = await fetchRandomTitle(lang, ctl.signal, retryNotice);
      if (ctl.signal.aborted) return;
      signal.removeEventListener('abort', onAbort);
      loadCtl = null;
      await load(`${lang}:${title}`, trigger, true);
    } catch (err) {
      if (ctl.signal.aborted) return;
      stopTuning(false);
      system(TriangleAlert, err instanceof Error ? err.message : 'Random failed.', 'warn');
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async function load(input: string, trigger: HTMLElement = loadBtn, keepTuning = false) {
    const ref = parseArticleRef(input);
    if (!ref) {
      system(TriangleAlert, 'That doesn’t look like a Wikipedia link.', 'warn');
      if (keepTuning) stopTuning(false);
      return;
    }
    loadCtl?.abort();
    const ctl = (loadCtl = new AbortController());
    const onAbort = () => ctl.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    setPlaying(false);
    if (!keepTuning) {
      // A new load replaces any in flight: release the old triggers first.
      for (const t of busyTriggers) setBusy(t, false);
      busyTriggers.clear();
    }
    startTuning(`Tuning in to “${ref.title}”…`, trigger);
    form.classList.add('is-loading');
    system(Search, `Fetching “${ref.title}”…`);
    let ok = false;
    try {
      const a = await fetchArticle(ref, ctl.signal, retryNotice);
      if (ctl.signal.aborted) return;
      article = a;
      cursor = 0;
      lastSentence = '';
      urlInput.value = a.url;
      titleEl.textContent = a.title;
      descEl.textContent = a.description ?? `${a.sentences.length} sentences across ${a.sections.length} sections`;
      avatar.style.backgroundImage = a.thumbnail ? `url("${a.thumbnail}")` : '';
      avatar.replaceChildren(...(a.thumbnail ? [] : [icon(BookOpen, 18)]));
      sourceLink.href = a.url;
      sourceLink.hidden = false;
      viewers = 300 + Math.round(Math.random() * 400 + a.sentences.length * 6);
      viewerCount.textContent = viewers.toLocaleString();

      sectionSelect.replaceChildren(
        ...a.sections.map((name, i) => h('option', { value: i }, i === 0 ? 'Introduction' : name)),
      );
      for (const el of [playBtn, stepBtn, restartBtn, sectionSelect, seek]) el.disabled = false;
      updateProgress();

      history.replaceState(null, '', `#/${slug}?article=${encodeURIComponent(`${a.lang}:${a.title}`)}`);
      log.replaceChildren();
      stickToBottom = true;
      resumeBtn.hidden = true;
      system(Radio, `Welcome to the chat room! Today's stream: ${a.title}`);
      ok = true;
      // New stream arrives: header content animates in.
      stream.classList.remove('is-fresh');
      void stream.offsetWidth;
      stream.classList.add('is-fresh');
    } catch (err) {
      if (ctl.signal.aborted) return;
      system(TriangleAlert, err instanceof Error ? err.message : 'Something went wrong.', 'warn');
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (loadCtl === ctl) {
        form.classList.remove('is-loading');
        loadCtl = null;
        stopTuning(ok);
        if (ok) setPlaying(true);
      }
    }
  }

  // ---------- wiring ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    load(urlInput.value);
  }, { signal });

  randomBtn.addEventListener('click', () => loadRandom(randomBtn), { signal });

  playBtn.addEventListener('click', () => setPlaying(!playing), { signal });
  stepBtn.addEventListener('click', () => {
    step();
    if (playing) scheduleSentence(readDelay(lastSentence));
  }, { signal });
  restartBtn.addEventListener('click', () => {
    log.replaceChildren();
    jumpTo(0, false);
    system(RotateCcw, 'Restarting from the top');
    if (!playing) setPlaying(true);
  }, { signal });
  sectionSelect.addEventListener('change', () => {
    if (!article) return;
    const i = article.sentences.findIndex((s) => s.section === Number(sectionSelect.value));
    if (i >= 0) jumpTo(i);
  }, { signal });
  seek.addEventListener('input', () => {
    progressLabel.textContent = subProgress.textContent = `${seek.value} / ${seek.max}`;
  }, { signal });
  seek.addEventListener('change', () => jumpTo(Number(seek.value)), { signal });

  speedCtl.set(settings.speed);
  chatterCtl.set(settings.chatter);
  highlightCtl.input.checked = settings.highlight;
  headingsCtl.input.checked = settings.headings;
  log.classList.toggle('no-hl', !settings.highlight);
  syncSummary();

  const setSpeed = (s: number) => {
    settings.speed = s;
    speedCtl.set(s);
    if (!panelIsOpen()) toast(Gauge, `Speed ${s}×`);
    syncSummary();
    save();
    if (playing) {
      scheduleSentence(readDelay(lastSentence) * 0.5);
      scheduleChatter();
    }
  };
  speedCtl.onChange((v) => setSpeed(Number(v)));
  chatterCtl.onChange((v) => {
    settings.chatter = Number(v);
    // Chat answers in its own channel, so the change is felt where it happens.
    system(settings.chatter === 0 ? MessageSquareOff : MessageSquare, settings.chatter === 0
      ? 'Chat muted – just WikiReader and you now'
      : `Chat activity: ${CHATTER[settings.chatter].label}`);
    syncSummary();
    save();
    scheduleChatter();
  });
  highlightCtl.input.addEventListener('change', () => {
    settings.highlight = highlightCtl.input.checked;
    log.classList.toggle('no-hl', !settings.highlight);
    save();
  }, { signal });
  headingsCtl.input.addEventListener('change', () => {
    settings.headings = headingsCtl.input.checked;
    save();
  }, { signal });
  emotesCtl.input.checked = settings.emotes;
  emotesCtl.input.addEventListener('change', () => {
    settings.emotes = emotesCtl.input.checked;
    save();
    if (!panelIsOpen()) toast(Smile, settings.emotes ? 'Emotes on' : 'Emotes off');
    if (settings.emotes) ensureEmotes();
    rerenderEmotes();
  }, { signal });
  // Only contact the emote services when emotes are on.
  if (settings.emotes) ensureEmotes();

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    post(me, text, 'mine');
    stickToBottom = true;
    scrollToBottom();
    // Chat occasionally notices you.
    if (chatOn() && Math.random() < 0.6) {
      setTimeout(() => {
        if (!signal.aborted && chatOn()) post(nextChatter(), `@you ${pick(['real', 'W take', 'L take', 'true', '?', 'hi!!', 'no shot', 'agreed', 'ratio', '💀', 'based'])}`);
      }, 600 + Math.random() * 1400);
    }
  }, { signal });

  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input:not([type=range]), textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && !t.closest('button')) {
      e.preventDefault();
      setPlaying(!playing);
    } else if (e.key === 'ArrowRight' && !t.closest('input[type=range]')) {
      stepBtn.click();
    } else if (e.key === ']' || e.key === '[') {
      const i = SPEEDS.indexOf(settings.speed);
      const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + (e.key === ']' ? 1 : -1)))];
      setSpeed(next);
    } else if (e.key.toLowerCase() === 'r' && article) {
      restartBtn.click();
    }
  }, { signal });

  // Deep link: #/wiki-chat?article=en:Octopus  (or ?url=https://…)
  const query = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const initial = query.get('article') ?? query.get('url');
  if (initial) load(initial);
  else showWelcome();

  return () => {
    playing = false;
    clearTimeout(sentenceTimer);
    clearTimeout(chatterTimer);
    clearTimeout(viewerTimer);
    loadCtl?.abort();
  };
};
