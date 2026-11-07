/** Fake chat population: names, colours, badges and filler reactions. */

export type Badge = 'host' | 'mod' | 'vip' | 'sub' | 'founder' | 'prime';

export interface Chatter {
  name: string;
  color: string;
  badges: Badge[];
}

/**
 * Badge icons as 16×16 SVG paths rather than text glyphs: symbol characters sit on
 * the font's baseline (and some render as emoji), so they never centre reliably.
 */
export const BADGES: Record<Badge, { path: string; label: string }> = {
  host: { path: 'M5.5 3.5v9l7-4.5z', label: 'Broadcaster' },
  mod: { path: 'M8 1.5l5.5 2v4.2c0 3.1-2.3 5.6-5.5 6.8-3.2-1.2-5.5-3.7-5.5-6.8V3.5z', label: 'Moderator' },
  vip: { path: 'M8 1.5L14.5 8 8 14.5 1.5 8z', label: 'VIP' },
  sub: { path: 'M8 1.5l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.2l-4 2.3 1-4.4-3.4-3 4.5-.5z', label: 'Subscriber' },
  founder: { path: 'M2 4.5l3 3L8 3l3 4.5 3-3-1.2 6.5H3.2zM3.2 12h9.6v1.5H3.2z', label: 'Founder' },
  prime: { path: 'M8 14S2.5 10.6 2.5 6.7A3 3 0 0 1 8 4.6a3 3 0 0 1 5.5 2.1C13.5 10.6 8 14 8 14z', label: 'Supporter' },
};

const COLORS = [
  '#ff4f4f', '#4f8bff', '#3ccf6e', '#b46bff', '#ff7f50', '#9acd32', '#ff4500',
  '#2e8b57', '#daa520', '#d2691e', '#5f9ea0', '#1e90ff', '#ff69b4', '#8a2be2',
  '#00c2b2', '#e6b800', '#f06292', '#7cb342', '#29b6f6', '#ff8a65',
];

const ADJ = [
  'sleepy', 'feral', 'cosmic', 'lowkey', 'tiny', 'chunky', 'quiet', 'spicy', 'goblin', 'crispy',
  'turbo', 'mild', 'salty', 'soggy', 'lucky', 'cursed', 'shy', 'grumpy', 'neon', 'retro',
  'fuzzy', 'atomic', 'humble', 'wobbly', 'sneaky', 'big', 'smol', 'ancient', 'chill', 'loud',
];
const NOUN = [
  'otter', 'toast', 'wizard', 'pigeon', 'gremlin', 'noodle', 'falcon', 'potato', 'moth', 'raccoon',
  'llama', 'kettle', 'bean', 'frog', 'cactus', 'waffle', 'yeti', 'badger', 'pixel', 'comet',
  'pickle', 'walrus', 'nugget', 'shrimp', 'goose', 'biscuit', 'squid', 'ferret', 'lemon', 'crab',
];
const STYLE = [
  (a: string, n: string) => `${a}${cap(n)}`,
  (a: string, n: string) => `${a}_${n}`,
  (a: string, n: string, d: number) => `${a}${n}${d}`,
  (a: string, n: string) => `${cap(a)}${cap(n)}`,
  (_: string, n: string, d: number) => `xx${n}xx${d % 100}`,
  (a: string, n: string) => `the${cap(a)}${cap(n)}`,
  (_a: string, n: string, d: number) => `${n}_enjoyer${d % 1000}`,
];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

function makeChatter(): Chatter {
  const name = pick(STYLE)(pick(ADJ), pick(NOUN), Math.floor(Math.random() * 9999));
  const roll = Math.random();
  const badges: Badge[] = [];
  if (roll < 0.04) badges.push('mod');
  else if (roll < 0.08) badges.push('vip');
  if (Math.random() < 0.02) badges.push('founder');
  else if (Math.random() < 0.45) badges.push('sub');
  else if (Math.random() < 0.06) badges.push('prime');
  return { name, color: pick(COLORS), badges };
}

/** A fixed pool so the same regulars keep showing up, like a real chat. */
export function createCrowd(size = 80) {
  const pool = Array.from({ length: size }, makeChatter);
  // A few chatters talk far more than the rest.
  const regulars = pool.slice(0, 8);
  return () => (Math.random() < 0.35 ? pick(regulars) : pick(pool));
}
