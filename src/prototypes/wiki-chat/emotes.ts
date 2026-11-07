/**
 * Third-party chat emotes: the global sets from 7TV, BetterTTV and FrankerFaceZ.
 * Fetched in the browser from their public APIs (CORS-enabled, no keys), cached
 * for a day, and rendered by swapping whole-word emote codes for images.
 *
 * Parsing is defensive: if a provider is down or changes shape, its emotes are
 * simply missing and the codes stay as text.
 */

export type Provider = '7TV' | 'BetterTTV' | 'FFZ';

export interface Emote {
  code: string;
  provider: Provider;
  src: string;
  srcset: string;
  animated: boolean;
  /** Still frame for animated emotes, when the provider has one (reduced motion). */
  staticSrc?: string;
  /** width / height when known, to reserve space before the image loads. */
  ratio?: number;
}

export type EmoteMap = Map<string, Emote>;

const CACHE_KEY = 'pp:wiki-chat:emotes:v1';
const CACHE_TTL = 24 * 60 * 60 * 1000;

const SOURCES: Array<[Provider, string, (json: unknown) => Emote[]]> = [
  ['7TV', 'https://7tv.io/v3/emote-sets/global', parse7tv],
  ['BetterTTV', 'https://api.betterttv.net/3/cached/emotes/global', parseBttv],
  ['FFZ', 'https://api.frankerfacez.com/v1/set/global', parseFfz],
];

/** Load every provider's global set. Resolves with whatever succeeded (possibly empty). */
export async function loadEmotes(signal: AbortSignal): Promise<{ emotes: EmoteMap; failed: Provider[] }> {
  const cached = readCache();
  if (cached) return { emotes: cached, failed: [] };

  const results = await Promise.allSettled(
    SOURCES.map(async ([provider, url, parse]) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`${provider} ${res.status}`);
      return parse(await res.json());
    }),
  );
  const emotes: EmoteMap = new Map();
  const failed: Provider[] = [];
  // Earlier sources win on name clashes (7TV, then BetterTTV, then FFZ).
  results.forEach((r, i) => {
    if (r.status === 'rejected') return void failed.push(SOURCES[i][0]);
    for (const e of r.value) if (!emotes.has(e.code)) emotes.set(e.code, e);
  });
  if (failed.length === 0 && emotes.size) writeCache(emotes);
  return { emotes, failed };
}

// ---------- provider parsers ----------

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null;
const https = (u: string) => (u.startsWith('//') ? `https:${u}` : u);
const validCode = (c: unknown): c is string => typeof c === 'string' && /^\S{2,40}$/.test(c);

/** 7TV v3: { emotes: [{ name, data: { animated, host: { url: '//cdn.7tv.app/emote/ID', files: [...] } } }] } */
function parse7tv(json: unknown): Emote[] {
  if (!isObj(json) || !Array.isArray(json.emotes)) return [];
  return json.emotes.flatMap((e: any): Emote[] => {
    const host = e?.data?.host;
    if (!validCode(e?.name) || typeof host?.url !== 'string') return [];
    const base = https(host.url);
    const files: any[] = Array.isArray(host.files) ? host.files : [];
    const webp = (n: string) => files.find((f) => f?.name === `${n}.webp`);
    const one = webp('1x');
    const ratio = one?.width && one?.height ? one.width / one.height : undefined;
    return [{
      code: e.name,
      provider: '7TV',
      src: `${base}/1x.webp`,
      srcset: `${base}/1x.webp 1x, ${base}/2x.webp 2x`,
      animated: !!e.data.animated,
      staticSrc: typeof one?.static_name === 'string' ? `${base}/${one.static_name}` : undefined,
      ratio,
    }];
  });
}

/** BetterTTV: [{ id, code, animated }] → https://cdn.betterttv.net/emote/ID/1x */
function parseBttv(json: unknown): Emote[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((e: any): Emote[] => {
    if (!validCode(e?.code) || typeof e?.id !== 'string') return [];
    const base = `https://cdn.betterttv.net/emote/${encodeURIComponent(e.id)}`;
    return [{ code: e.code, provider: 'BetterTTV', src: `${base}/1x`, srcset: `${base}/1x 1x, ${base}/2x 2x`, animated: !!e.animated }];
  });
}

/** FFZ: { default_sets: [3], sets: { 3: { emoticons: [{ name, width, height, urls: { 1, 2, 4 } }] } } } */
function parseFfz(json: unknown): Emote[] {
  if (!isObj(json) || !isObj(json.sets)) return [];
  const ids: string[] = Array.isArray(json.default_sets) ? json.default_sets.map(String) : Object.keys(json.sets);
  return ids.flatMap((id) => {
    const list = json.sets[id]?.emoticons;
    if (!Array.isArray(list)) return [];
    return list.flatMap((e: any): Emote[] => {
      const u1 = e?.urls?.['1'];
      if (!validCode(e?.name) || typeof u1 !== 'string') return [];
      const u2 = typeof e.urls['2'] === 'string' ? https(e.urls['2']) : https(u1);
      const ratio = e.width && e.height ? e.width / e.height : undefined;
      return [{ code: e.name, provider: 'FFZ', src: https(u1), srcset: `${https(u1)} 1x, ${u2} 2x`, animated: false, ratio }];
    });
  });
}

// ---------- cache ----------

function readCache(): EmoteMap | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (!raw || Date.now() - raw.t > CACHE_TTL || !Array.isArray(raw.emotes)) return null;
    return new Map((raw.emotes as Emote[]).map((e) => [e.code, e]));
  } catch {
    return null;
  }
}

function writeCache(emotes: EmoteMap) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), emotes: [...emotes.values()] }));
  } catch {}
}

// ---------- what chat posts ----------

/**
 * Well-known names chat should favour when they exist in the loaded sets.
 * Anything not present is skipped; if none are, any loaded emote is used.
 */
const FAVOURITES = [
  'monkaS', 'FeelsBadMan', 'FeelsGoodMan', 'FeelsStrongMan', 'FeelsWeirdMan', 'FeelsDankMan',
  'FeelsOkayMan', 'FeelsAmazingMan', 'LuL', 'KEKW', 'OMEGALUL', 'LULW', 'haHAA', 'Pog', 'PogU',
  'POGGERS', 'Sadge', 'PepeHands', 'peepoHappy', 'peepoSad', 'EZ', 'Clap', 'catJAM', 'PepePls',
  'SourPls', 'AlienDance', 'WAYTOODANK', 'Stare', 'NaM', 'KKona', 'D:', 'BBoomer', 'TeaTime',
  'RainTime', 'GuitarTime', 'PianoTime', 'RareParrot', 'PETPET', 'glorp', 'CiGrip', 'ShoopDaWhoop',
];

export function randomEmote(emotes: EmoteMap): string | null {
  if (!emotes.size) return null;
  const favs = FAVOURITES.filter((c) => emotes.has(c));
  if (favs.length && Math.random() < 0.75) return favs[Math.floor(Math.random() * favs.length)];
  const all = [...emotes.keys()];
  return all[Math.floor(Math.random() * all.length)];
}

/** An emote-only chat line: one emote, or the same one spammed a few times. */
export function emoteLine(emotes: EmoteMap): string | null {
  const e = randomEmote(emotes);
  if (!e) return null;
  const n = Math.random() < 0.55 ? 1 : 2 + Math.floor(Math.random() * 4);
  return Array.from({ length: n }, () => e).join(' ');
}
