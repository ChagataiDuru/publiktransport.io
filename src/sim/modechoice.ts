import { PARAMS } from './params.ts';

export type Split = [number, number, number];

/**
 * Multinomial logit over {car, p1, p2}.
 *   utility_m = -BETA * time_m
 *   share_m   = exp(utility_m) / sum_k exp(utility_k)
 * An unreachable mode passes Infinity and gets exactly zero share.
 */
export function logitShares(carT: number, p1T: number, p2T: number): Split {
  const t: Split = [carT, p1T, p2T];
  const u: Split = [0, 0, 0];
  let best = -Infinity;
  for (let m = 0; m < 3; m++) {
    u[m] = isFinite(t[m]) ? -PARAMS.BETA * t[m] : -Infinity;
    if (u[m] > best) best = u[m];
  }
  if (!isFinite(best)) return [1, 0, 0]; // nothing is reachable — everyone drives
  let sum = 0;
  const e: Split = [0, 0, 0];
  for (let m = 0; m < 3; m++) {
    e[m] = isFinite(u[m]) ? Math.exp(u[m] - best) : 0;
    sum += e[m];
  }
  if (sum <= 0) return [1, 0, 0];
  return [e[0] / sum, e[1] / sum, e[2] / sum];
}

/**
 * Ease the observed split toward the logit target instead of snapping to it.
 * Stops oscillation, and makes conversion visibly *flow* across the map —
 * which is the most satisfying thing on screen.
 */
export function lerpSplit(current: Split, target: Split, alpha: number): void {
  current[0] += (target[0] - current[0]) * alpha;
  current[1] += (target[1] - current[1]) * alpha;
  current[2] += (target[2] - current[2]) * alpha;
  const s = current[0] + current[1] + current[2];
  if (s > 0) {
    current[0] /= s;
    current[1] /= s;
    current[2] /= s;
  }
}
