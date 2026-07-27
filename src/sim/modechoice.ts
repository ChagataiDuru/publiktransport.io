import { PARAMS } from './params.ts';

export type Split = number[];

/**
 * Multinomial logit over {car, ...players}.
 *   utility_m = -BETA * time_m
 *   share_m   = exp(utility_m) / sum_k exp(utility_k)
 * An unreachable mode passes Infinity and gets exactly zero share.
 */
export function logitShares(...t: number[]): Split {
  const u: Split = new Array<number>(t.length).fill(0);
  let best = -Infinity;
  for (let m = 0; m < t.length; m++) {
    u[m] = isFinite(t[m]) ? -PARAMS.BETA * t[m] : -Infinity;
    if (u[m] > best) best = u[m];
  }
  if (!isFinite(best)) return [1, ...new Array<number>(Math.max(0, t.length - 1)).fill(0)];
  let sum = 0;
  const e: Split = new Array<number>(t.length).fill(0);
  for (let m = 0; m < t.length; m++) {
    e[m] = isFinite(u[m]) ? Math.exp(u[m] - best) : 0;
    sum += e[m];
  }
  if (sum <= 0) return [1, ...new Array<number>(Math.max(0, t.length - 1)).fill(0)];
  return e.map((v) => v / sum);
}

/**
 * Ease the observed split toward the logit target instead of snapping to it.
 * Stops oscillation, and makes conversion visibly *flow* across the map —
 * which is the most satisfying thing on screen.
 */
export function lerpSplit(current: Split, target: Split, alpha: number): void {
  for (let i = 0; i < current.length; i++) current[i] += (target[i] - current[i]) * alpha;
  const s = current.reduce((a, b) => a + b, 0);
  if (s > 0) {
    for (let i = 0; i < current.length; i++) current[i] /= s;
  }
}
