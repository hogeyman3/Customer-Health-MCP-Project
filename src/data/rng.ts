/**
 * Small deterministic PRNG so the whole dataset is reproducible from a single
 * seed (string or number) without pulling in a dependency. Not cryptographic.
 */

// xmur3: hashes an arbitrary string down to a 32-bit int for seeding.
function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

// mulberry32: fast, small, decent-quality 32-bit PRNG.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function makeRng(seed: string | number): Rng {
  const numericSeed = typeof seed === "number" ? seed >>> 0 : xmur3(seed);
  return mulberry32(numericSeed);
}

export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function randFloat(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min;
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Weighted pick: entries is [item, weight][]. Weights need not sum to 1. */
export function weightedPick<T>(rng: Rng, entries: readonly [T, number][]): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [item, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return entries[entries.length - 1][0];
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
