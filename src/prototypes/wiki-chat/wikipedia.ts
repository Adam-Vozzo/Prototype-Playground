export interface Sentence {
  text: string;
  section: number;
}

export interface Article {
  title: string;
  url: string;
  lang: string;
  thumbnail?: string;
  description?: string;
  sections: string[];
  sentences: Sentence[];
}

export interface ArticleRef {
  lang: string;
  title: string;
}

/**
 * Accepts full URLs (desktop/mobile, /wiki/ or ?title=), "lang:Title"
 * shorthand, or a bare article title.
 */
export function parseArticleRef(input: string): ArticleRef | null {
  const raw = input.trim();
  if (!raw) return null;

  if (/^(https?:\/\/|[\w-]+\.(m\.)?wikipedia\.org)/i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    const host = url.hostname.match(/^([\w-]+)\.(?:m\.)?wikipedia\.org$/i);
    if (!host) return null;
    const lang = host[1].toLowerCase() === 'www' ? 'en' : host[1].toLowerCase();
    let title = '';
    const wiki = url.pathname.match(/^\/wiki\/(.+)$/);
    if (wiki) title = wiki[1];
    else title = url.searchParams.get('title') ?? '';
    title = safeDecode(title).replace(/_/g, ' ').trim();
    return title ? { lang, title } : null;
  }

  const short = raw.match(/^([a-z]{2,3}(?:-[a-z]+)?):(.+)$/i);
  if (short) return { lang: short[1].toLowerCase(), title: short[2].trim() };
  return { lang: 'en', title: raw };
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Sections that are lists of links / citations rather than prose. */
const SKIP_SECTIONS = new Set(
  [
    'see also', 'references', 'external links', 'notes', 'further reading',
    'bibliography', 'sources', 'citations', 'footnotes', 'works cited',
    'notes and references', 'general and cited sources', 'explanatory notes',
    'cited sources', 'general references', 'gallery', 'selected works',
  ],
);

/*
 * Content comes from Wikipedia's REST API (/api/rest_v1). The older Action API
 * (/w/api.php) aggressively rate-limits anonymous cross-origin callers with
 * HTTP 429, which made every load fail; the REST endpoints are cached at the
 * edge, CORS-enabled for any origin, and are what Wikimedia recommends.
 */
const restBase = (lang: string) => `https://${lang}.wikipedia.org/api/rest_v1`;
const restTitle = (title: string) => encodeURIComponent(title.replace(/ /g, '_'));

/** Called before waiting to retry a throttled request. */
export type RetryNotice = (waitMs: number, attempt: number) => void;

const RETRY_WAITS = [1500, 4000, 8000];

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

async function wikiFetch(url: string, signal: AbortSignal | undefined, what: string, onRetry?: RetryNotice) {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new Error("Couldn't reach Wikipedia. Check your connection, or whether a content blocker is stopping requests to wikipedia.org.");
    }
    if (res.ok) return res;
    if (res.status === 404) throw new Error(`Couldn't find an article called “${what}”.`);
    if (res.status === 429 && attempt < RETRY_WAITS.length) {
      // Throttling is usually brief; honour Retry-After but don't make people wait 30s.
      const hinted = Number(res.headers.get('retry-after')) * 1000 || 0;
      const wait = Math.min(Math.max(RETRY_WAITS[attempt], hinted), RETRY_WAITS[attempt] * 2);
      onRetry?.(wait, attempt + 1);
      await sleep(wait, signal);
      continue;
    }
    if (res.status === 429) throw new Error('Wikipedia is rate-limiting requests right now. Give it a minute and try again.');
    throw new Error(`Wikipedia responded with an error (${res.status}).`);
  }
}

interface Summary {
  title: string;
  titles?: { canonical?: string };
  description?: string;
  extract?: string;
  thumbnail?: { source: string };
  originalimage?: { source: string };
  content_urls?: { desktop?: { page?: string } };
}

export async function fetchArticle(ref: ArticleRef, signal?: AbortSignal, onRetry?: RetryNotice): Promise<Article> {
  // Summary first: it resolves redirects ("Octopuses" → "Octopus") and gives
  // us the canonical title, short description and lead image.
  const summary: Summary = await (
    await wikiFetch(`${restBase(ref.lang)}/page/summary/${restTitle(ref.title)}`, signal, ref.title, onRetry)
  ).json();
  const canonical = summary.titles?.canonical ?? summary.title.replace(/ /g, '_');

  // Full article as Parsoid HTML (fetched by canonical title so it never redirects).
  const html = await (
    await wikiFetch(`${restBase(ref.lang)}/page/html/${encodeURIComponent(canonical)}`, signal, ref.title, onRetry)
  ).text();

  const title = canonical.replace(/_/g, ' ');
  let extract = htmlToExtract(html);
  if (!extract.trim()) extract = summary.extract ?? '';
  const { sections, sentences } = splitExtract(extract, ref.lang, title);
  if (!sentences.length) throw new Error('That article has no readable text.');

  return {
    title,
    url: summary.content_urls?.desktop?.page ?? `https://${ref.lang}.wikipedia.org/wiki/${encodeURIComponent(canonical)}`,
    lang: ref.lang,
    thumbnail: summary.originalimage?.source ?? summary.thumbnail?.source,
    description: summary.description,
    sections,
    sentences,
  };
}

export async function fetchRandomTitle(lang = 'en', signal?: AbortSignal, onRetry?: RetryNotice): Promise<string> {
  const summary: Summary = await (
    await wikiFetch(`${restBase(lang)}/page/random/summary`, signal, 'a random article', onRetry)
  ).json();
  return (summary.titles?.canonical ?? summary.title).replace(/_/g, ' ');
}

/** Things in article HTML that aren't running prose. */
const NON_PROSE = [
  'style', 'script', 'link', 'meta', 'table', 'figure', 'figcaption', 'audio', 'video',
  'sup.reference', '.mw-ref', '.noprint', '.mw-empty-elt', '.infobox', '.navbox', '.hatnote',
  '.sidebar', '.metadata', '.thumb', '.gallery', '.reflist', '.mw-references-wrap', '.mw-cite-backlink',
].join(',');

/**
 * Parsoid HTML → the plain-text shape splitExtract() expects:
 * one paragraph per line, headings as `== Name ==` (more `=` = deeper).
 */
export function htmlToExtract(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const m of doc.querySelectorAll('.mwe-math-element')) {
    m.replaceWith(m.querySelector('math')?.getAttribute('alttext') ?? '');
  }
  for (const el of doc.querySelectorAll(NON_PROSE)) el.remove();

  const lines: string[] = [];
  for (const el of doc.body.querySelectorAll('h2, h3, h4, h5, h6, p')) {
    const text = cleanText(el.textContent ?? '');
    if (!text) continue;
    if (el.tagName === 'P') {
      lines.push(text);
    } else {
      const eq = '='.repeat(Number(el.tagName[1]));
      lines.push(`${eq} ${text} ${eq}`);
    }
  }
  return lines.join('\n');
}

const cleanText = (s: string) =>
  s
    .replace(/\[\s*(?:\d+|[a-z]|note \d+|citation needed|clarification needed|when\?|who\?|according to whom\?)\s*\]/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?)])/g, '$1')
    .trim();

/** Plain-text extract → sections + sentences. Headings look like `== Name ==`. */
export function splitExtract(extract: string, lang: string, title: string) {
  const sections: string[] = [title];
  const sentences: Sentence[] = [];
  const segmenter =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter(lang, { granularity: 'sentence' })
      : null;

  let current = 0;
  let skipLevel = 0; // heading level that started a skipped section; 0 = not skipping

  for (const line of extract.split('\n')) {
    const heading = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/);
    if (heading) {
      const level = heading[1].length;
      const name = heading[2];
      if (skipLevel && level > skipLevel) continue; // sub-heading of a skipped section
      skipLevel = SKIP_SECTIONS.has(name.toLowerCase()) ? level : 0;
      if (!skipLevel) {
        sections.push(name);
        current = sections.length - 1;
      }
      continue;
    }
    if (skipLevel) continue;
    const para = line.trim();
    if (!para) continue;

    const parts = segmenter
      ? Array.from(segmenter.segment(para), (s) => s.segment.trim())
      : para.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((s) => s.trim());

    let carry = '';
    for (const part of parts) {
      if (!part) continue;
      const text = carry ? `${carry} ${part}` : part;
      // Re-join fragments produced by abbreviations like "c." or initials ("J. R.").
      if (text.length < 12 || /\b(?:[A-Z]|c|ca|St|Dr|Mr|Mrs|Ms|Jr|Sr|vs|No|Vol|approx|e\.g|i\.e)\.$/.test(text)) {
        carry = text;
        continue;
      }
      carry = '';
      sentences.push({ text, section: current });
    }
    if (carry) sentences.push({ text: carry, section: current });
  }

  // Drop sections that ended up with no sentences, remapping indices.
  const used = [...new Set(sentences.map((s) => s.section))];
  const remap = new Map(used.map((old, i) => [old, i]));
  return {
    sections: used.map((i) => sections[i]),
    sentences: sentences.map((s) => ({ ...s, section: remap.get(s.section)! })),
  };
}
