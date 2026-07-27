import { dist } from './map.ts';
import { PARAMS } from './params.ts';
import type { GameState, Id, Neighborhood } from './types.ts';

/**
 * Deterministic gravity model, built once per match.
 * demand[i][j] = k * pop_i * pop_j / dist(i,j)^GRAVITY_EXPONENT, normalised so
 * the whole matrix sums to TOTAL_TRIPS_PER_MIN.
 */
export function buildOdMatrix(neighborhoods: Neighborhood[]): number[][] {
  const n = neighborhoods.length;
  const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = Math.max(1, dist(neighborhoods[i].centroid, neighborhoods[j].centroid));
      const v =
        (neighborhoods[i].population * neighborhoods[j].population) /
        Math.pow(d, PARAMS.GRAVITY_EXPONENT);
      m[i][j] = v;
      total += v;
    }
  }
  const k = total > 0 ? PARAMS.TOTAL_TRIPS_PER_MIN / total : 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m[i][j] *= k;
  return m;
}

/** Base demand with the current rush-hour surge folded in. */
export function effectiveDemand(state: GameState, i: Id, j: Id): number {
  const base = state.odMatrix[i][j];
  const rush = state.rushHour;
  if (rush && rush.active && (rush.neighborhood === i || rush.neighborhood === j)) {
    return base * PARAMS.RUSH_MULTIPLIER;
  }
  return base;
}

/** Straight-line car travel time before congestion is applied. */
export function freeFlowCarTime(state: GameState, i: Id, j: Id): number {
  const d = dist(state.neighborhoods[i].centroid, state.neighborhoods[j].centroid);
  return d / PARAMS.CAR_SPEED;
}

/**
 * Roads clear as people leave them. This is the deliberate balancing loop:
 * the more riders you win, the more attractive driving becomes again.
 */
export function congestionFactor(carShare: number): number {
  const c = 1 + PARAMS.CONGESTION_K * carShare;
  return Math.min(PARAMS.CONGESTION_MAX, Math.max(PARAMS.CONGESTION_MIN, c));
}

export function carTime(state: GameState, i: Id, j: Id, carShare: number): number {
  return freeFlowCarTime(state, i, j) * congestionFactor(carShare);
}
