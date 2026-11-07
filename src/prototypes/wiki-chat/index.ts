import { h, useStyles } from '../../lib/dom';
import type { MountFn } from '../../types';
import css from './style.css?inline';
import { BADGE_GLYPH, createCrowd, pick, type Chatter } from './chatters';
import { reaction } from './reactions';
import { fetchArticle, fetchRandomTitle, parseArticleRef, type Article } from './wikipedia';

const SPEEDS = [0.5, 1, 1.5, 2, 3, 5];
const CHATTER = [
  { label: 'Off', icon: '🔇', range: null },
  { label: 'Chill', icon: '💬', range: [1800, 4500] },
  { label: 'Busy', icon: '🗨️', range: [450, 1600] },
  { label: 'Chaos', icon: '🔥', range: [70, 380] },
] as const;
const MAX_MESSAGES = 250;
const EXAMPLES = ['Octopus', 'Great Emu War', 'Toast', 'Voyager 1', 'Honey badger', 'Tardigrade'];

interface Settings {
  speed: number;
  chatter: number;
  highlight: boolean;
  headings: boolean;
  panelOpen?: boolean;
}

export const mount: MountFn = (root, { slug, signal }) => {
  useStyles(css, signal);

  // ---------- persisted settings ----------
  const storeKey = `pp:${slug}:settings`;
  const settings: Settings = { speed: 1, chatter: 2, highlight: true, headings: true };
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

  // ---------- DOM ----------
  // Chat fills the screen. On top: stream info + article box, then a transport row
  // with what you need right now (play/pause, next, position) and a labelled
  // "Controls" disclosure that expands in place to every other action (DESIGN.md §4).
  const iconBtn = (icon: string, label: string, disabled = false) =>
    h('button', { class: 'wc-icon', type: 'button', title: label, 'aria-label': label, disabled }, icon);
  const setIcon = (btn: HTMLElement, icon: string, label: string) => {
    btn.textContent = icon;
    btn.title = label;
    btn.setAttribute('aria-label', label);
  };
  /** Text button with a leading glyph – used inside the controls panel. */
  const labelBtn = (icon: string, label: string, title?: string) =>
    h('button', { class: 'wc-btn wc-btn-labelled', type: 'button', title },
      h('span', { 'aria-hidden': 'true' }, icon), label);
  /** Native radio group styled as a segmented control: every option visible, arrow keys work. */
  const segmented = <T extends string | number>(legend: string, options: { value: T; label: string }[], hintKeys?: string) => {
    const name = `wc-${legend.replace(/\W+/g, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`;
    const inputs = options.map((o) => h('input', { type: 'radio', name, value: o.value }));
    const el = h(
      'fieldset',
      { class: 'wc-field wc-seg-field' },
      h('legend', { class: 'wc-field-label' }, legend, hintKeys ? h('span', { class: 'wc-keyhint' }, hintKeys) : null),
      h('div', { class: 'wc-seg' }, ...options.map((o, i) => h('label', { class: 'wc-seg-opt' }, inputs[i], h('span', {}, o.label)))),
    );
    const set = (v: T) => inputs.forEach((inp) => (inp.checked = inp.value === String(v)));
    const onChange = (fn: (v: string) => void) =>
      el.addEventListener('change', (e) => fn((e.target as HTMLInputElement).value), { signal });
    return { el, set, onChange };
  };
  /** Checkbox rendered as a labelled switch. */
  const switchCtl = (label: string) => {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'wc-switch-input' });
    const el = h('label', { class: 'wc-switch' }, h('span', { class: 'wc-switch-text' }, label), input, h('span', { class: 'wc-switch-track', 'aria-hidden': 'true' }));
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
  const loadBtn = h('button', { class: 'wc-btn wc-primary', type: 'submit' }, 'Go live');
  const form = h('form', { class: 'wc-form' }, urlInput, loadBtn);

  const avatar = h('div', { class: 'wc-avatar', 'aria-hidden': 'true' }, '📖');
  const liveBadge = h('span', { class: 'wc-live' }, 'OFFLINE');
  const viewerEl = h('span', { class: 'wc-viewers' });
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
  const playBtn = iconBtn('▶', 'Play (Space)', true);
  playBtn.classList.add('wc-play');
  const stepBtn = iconBtn('⏭', 'Next sentence (→)', true);
  const seek = h('input', { class: 'wc-seek', type: 'range', min: 0, max: 0, value: 0, 'aria-label': 'Article position', disabled: true });
  const progressLabel = h('span', { class: 'wc-progress-label', 'aria-hidden': 'true' }, '0 / 0');
  const panelId = `wc-panel-${Math.random().toString(36).slice(2, 7)}`;
  const moreSummary = h('span', { class: 'wc-more-summary' });
  const moreBtn = h(
    'button',
    { class: 'wc-more', type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
    h('span', {}, 'Controls'),
    moreSummary,
    h('span', { class: 'wc-chevron', 'aria-hidden': 'true' }),
  );

  // --- one tap away: labelled controls panel ---
  const restartBtn = labelBtn('↺', 'Restart', 'Restart from the top (R)');
  restartBtn.disabled = true;
  const sectionSelect = h('select', { class: 'wc-select', disabled: true });
  const sectionField = h('label', { class: 'wc-field' }, h('span', { class: 'wc-field-label' }, 'Jump to section'), sectionSelect);
  const speedCtl = segmented('Reading speed', SPEEDS.map((v) => ({ value: v, label: `${v}×` })), '[ ]');
  const chatterCtl = segmented('Chat activity', CHATTER.map((c, i) => ({ value: i, label: c.label })));
  const highlightCtl = switchCtl('Highlight article lines');
  const headingsCtl = switchCtl('Announce new sections');
  const randomBtn = labelBtn('🎲', 'Random article');
  const sourceLink = h('a', { class: 'wc-btn wc-btn-labelled', target: '_blank', rel: 'noopener', hidden: true },
    h('span', { 'aria-hidden': 'true' }, '↗'), 'Open on Wikipedia');

  const group = (title: string, ...children: HTMLElement[]) =>
    h('section', { class: 'wc-group' }, h('h3', { class: 'wc-group-title' }, title), ...children);
  const panelBody = h(
    'div',
    { class: 'wc-panel-body' },
    group('Playback', h('div', { class: 'wc-row wc-row-end' }, restartBtn, sectionField)),
    group('Pace', speedCtl.el, chatterCtl.el),
    group('Display', highlightCtl.el, headingsCtl.el),
    group('Article', h('div', { class: 'wc-row' }, randomBtn, sourceLink)),
  );
  // panel (grid rows 0fr↔1fr) > clip (min-height 0, clips) > body (padding, layout)
  const panel = h('div', { class: 'wc-panel', id: panelId }, h('div', { class: 'wc-panel-clip' }, panelBody));

  const toolbar = h(
    'header',
    { class: 'wc-top' },
    h('div', { class: 'wc-bar' }, stream, form),
    h(
      'div',
      { class: 'wc-transport', role: 'group', 'aria-label': 'Playback' },
      playBtn,
      stepBtn,
      h('div', { class: 'wc-progress' }, seek, progressLabel),
      moreBtn,
    ),
    panel,
  );

  const log = h('ol', { class: 'wc-log', role: 'log', 'aria-label': 'Chat messages' });
  const resumeBtn = h('button', { class: 'wc-resume', type: 'button', hidden: true }, 'Chat paused · jump to latest ↓');
  const chatInput = h('input', { class: 'wc-chat-input', type: 'text', enterkeyhint: 'send', placeholder: 'Send a message', maxlength: 300, 'aria-label': 'Send a message' });
  const chatForm = h('form', { class: 'wc-chat-form' }, chatInput, h('button', { class: 'wc-btn wc-primary', type: 'submit' }, 'Chat'));

  root.append(
    h(
      'div',
      { class: 'wc' },
      toolbar,
      h('main', { class: 'wc-chat' }, h('div', { class: 'wc-log-wrap' }, log, resumeBtn), chatForm),
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
  // Open by default where there's room; remember the person's choice after that.
  setPanelOpen(settings.panelOpen ?? matchMedia('(min-width: 900px)').matches, false);

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
          ...EXAMPLES.map((t) => h('button', { class: 'wc-chip', type: 'button', onclick: () => load(t) }, t)),
          h('button', { class: 'wc-chip wc-chip-random', type: 'button', onclick: () => randomBtn.click() }, '🎲 Surprise me'),
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

  log.addEventListener(
    'scroll',
    () => {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      stickToBottom = atBottom;
      resumeBtn.hidden = atBottom;
    },
    { signal, passive: true },
  );
  resumeBtn.addEventListener('click', () => {
    stickToBottom = true;
    resumeBtn.hidden = true;
    scrollToBottom();
  }, { signal });

  function post(who: Chatter, text: string, kind: 'chat' | 'article' | 'mine' = 'chat') {
    const badges = who.badges.map((b) =>
      h('span', { class: `wc-badge wc-badge-${b}`, title: BADGE_GLYPH[b].label }, BADGE_GLYPH[b].glyph),
    );
    const li = h(
      'li',
      { class: `wc-msg wc-msg--${kind}${kind === 'article' ? ' is-hl' : ''}` },
      ...badges,
      h('span', { class: 'wc-name', style: `color:${who.color}` }, who.name),
      h('span', { class: 'wc-colon' }, ': '),
      h('span', { class: 'wc-text' }, text),
    );
    append(li);
  }

  function system(text: string, tone: 'info' | 'section' = 'info') {
    append(h('li', { class: `wc-system wc-system-${tone}` }, text));
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
      system(`📢 Now reading: ${article.sections[s.section]}`, 'section');
    }
    post(nextChatter(), s.text, 'article');
    lastSentence = s.text;
    cursor++;
    updateProgress();
    if (cursor >= article.sentences.length) finish();
  }

  function finish() {
    setPlaying(false);
    if (!article) return;
    system(`🎉 That's the whole article! ${article.sentences.length} messages of pure knowledge.`);
    for (let i = 0; i < 4; i++) setTimeout(() => !signal.aborted && post(nextChatter(), pick(['GG', 'gg', 'GG WP', 'o7', 'W stream', 'again!!', 'that was beautiful 😭'])), 150 + i * 180);
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
      post(who, reaction(lastSentence, other.name === who.name ? undefined : other.name));
      scheduleChatter();
    }, delay);
  }

  function driftViewers() {
    clearTimeout(viewerTimer);
    if (!playing) return;
    viewers = Math.max(12, Math.round(viewers * (0.985 + Math.random() * 0.035)));
    viewerEl.textContent = `👤 ${viewers.toLocaleString()}`;
    viewerTimer = window.setTimeout(driftViewers, 2500);
  }

  function setPlaying(on: boolean) {
    if (on && article && cursor >= article.sentences.length) {
      cursor = 0; // play after the end restarts
      system('↺ Restarting from the top');
    }
    playing = on && !!article;
    setIcon(playBtn, playing ? '⏸' : '▶', playing ? 'Pause (Space)' : 'Play (Space)');
    playBtn.classList.toggle('is-on', playing);
    liveBadge.textContent = article ? (playing ? 'LIVE' : 'PAUSED') : 'OFFLINE';
    liveBadge.classList.toggle('is-live', playing);
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
    if (announce) system(`⏩ Jumped to “${article.sections[article.sentences[cursor].section]}”`);
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
    system(`⏳ Wikipedia is busy, retrying in ${Math.round(ms / 1000)}s…`);

  async function load(input: string) {
    const ref = parseArticleRef(input);
    if (!ref) {
      system('⚠️ That doesn’t look like a Wikipedia link.');
      return;
    }
    loadCtl?.abort();
    const ctl = (loadCtl = new AbortController());
    const onAbort = () => ctl.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    setPlaying(false);
    form.classList.add('is-loading');
    loadBtn.disabled = true;
    system(`🔎 Fetching “${ref.title}”…`);
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
      avatar.textContent = a.thumbnail ? '' : '📖';
      sourceLink.href = a.url;
      sourceLink.hidden = false;
      viewers = 300 + Math.round(Math.random() * 400 + a.sentences.length * 6);
      viewerEl.textContent = `👤 ${viewers.toLocaleString()}`;

      sectionSelect.replaceChildren(
        ...a.sections.map((name, i) => h('option', { value: i }, i === 0 ? 'Introduction' : name)),
      );
      for (const el of [playBtn, stepBtn, restartBtn, sectionSelect, seek]) el.disabled = false;
      updateProgress();

      history.replaceState(null, '', `#/${slug}?article=${encodeURIComponent(`${a.lang}:${a.title}`)}`);
      log.replaceChildren();
      stickToBottom = true;
      resumeBtn.hidden = true;
      system(`Welcome to the chat room! Today's stream: ${a.title}`);
      setPlaying(true);
    } catch (err) {
      if (ctl.signal.aborted) return;
      system(`⚠️ ${err instanceof Error ? err.message : 'Something went wrong.'}`);
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (loadCtl === ctl) {
        form.classList.remove('is-loading');
        loadBtn.disabled = false;
        loadCtl = null;
      }
    }
  }

  // ---------- wiring ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    load(urlInput.value);
  }, { signal });

  randomBtn.addEventListener('click', async () => {
    try {
      const lang = parseArticleRef(urlInput.value)?.lang ?? article?.lang ?? 'en';
      load(`${lang}:${await fetchRandomTitle(lang, signal, retryNotice)}`);
    } catch (err) {
      if (!signal.aborted) system(`⚠️ ${err instanceof Error ? err.message : 'Random failed.'}`);
    }
  }, { signal });

  playBtn.addEventListener('click', () => setPlaying(!playing), { signal });
  stepBtn.addEventListener('click', () => {
    step();
    if (playing) scheduleSentence(readDelay(lastSentence));
  }, { signal });
  restartBtn.addEventListener('click', () => {
    log.replaceChildren();
    jumpTo(0, false);
    system('↺ Restarting from the top');
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

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    post(me, text, 'mine');
    stickToBottom = true;
    scrollToBottom();
    // Chat occasionally notices you.
    if (Math.random() < 0.6) {
      setTimeout(() => {
        if (!signal.aborted) post(nextChatter(), `@you ${pick(['real', 'W take', 'L take', 'true', '?', 'hi!!', 'no shot', 'agreed', 'ratio', '💀', 'based'])}`);
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
