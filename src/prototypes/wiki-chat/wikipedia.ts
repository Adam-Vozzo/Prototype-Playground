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

export async function fetchArticle(ref: ArticleRef, signal?: AbortSignal): Promise<Article> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*', // anonymous CORS
    redirects: '1',
    prop: 'extracts|pageimages|info|description',
    explaintext: '1',
    exsectionformat: 'wikitext',
    piprop: 'thumbnail',
    pithumbsize: '800',
    inprop: 'url',
    titles: ref.title,
  });
  const res = await fetch(`https://${ref.lang}.wikipedia.org/w/api.php?${params}`, { signal });
  if (!res.ok) throw new Error(`Wikipedia responded ${res.status}`);
  const data = await res.json();
  const page = data?.query?.pages?.[0];
  if (!page || page.missing || page.invalid) {
    throw new Error(`Couldn't find an article called “${ref.title}”.`);
  }
  const extract: string = page.extract ?? '';
  if (!extract.trim()) throw new Error('That article has no readable text.');

  const { sections, sentences } = splitExtract(extract, ref.lang, page.title);
  if (!sentences.length) throw new Error('That article has no readable text.');

  return {
    title: page.title,
    url: page.fullurl ?? `https://${ref.lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    lang: ref.lang,
    thumbnail: page.thumbnail?.source,
    description: page.description,
    sections,
    sentences,
  };
}

export async function fetchRandomTitle(lang = 'en', signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    list: 'random',
    rnnamespace: '0',
    rnlimit: '1',
  });
  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, { signal });
  if (!res.ok) throw new Error(`Wikipedia responded ${res.status}`);
  const data = await res.json();
  const title = data?.query?.random?.[0]?.title;
  if (!title) throw new Error('No random article came back.');
  return title;
}

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
