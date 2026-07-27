/**
 * mulberry32 — small, fast, fully deterministic PRNG.
 * The sim never touches Math.random; every stochastic decision goes through
 * an Rng instance whose state lives in GameState so it serialises cleanly.
 */
export interface RngState {
  s: number;
}

export function createRng(seed: number): RngState {
  // Force to uint32 so identical seeds behave identically across platforms.
  return { s: seed >>> 0 };
}

export function next(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(rng: RngState, maxExclusive: number): number {
  return Math.floor(next(rng) * maxExclusive);
}

export function nextRange(rng: RngState, lo: number, hi: number): number {
  return lo + next(rng) * (hi - lo);
}

export function cloneRng(rng: RngState): RngState {
  return { s: rng.s };
}
