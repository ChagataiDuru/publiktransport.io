import { carTime, effectiveDemand } from './demand.ts';
import { buildRoutes } from './network.ts';
import type { GameState, Id, PlayerId } from './types.ts';

/**
 * One district pair where people still drive because this player's network is
 * not a credible alternative. Pure and cheap (14x14), so both the bot and the
 * HUD read the same ranking rather than each inventing its own.
 */
export interface Pressure {
  i: Id;
  j: Id;
  /** Trips per minute, both directions, rush hour included. */
  demand: number;
  /** Fraction of those trips currently driving. */
  carShare: number;
  carSeconds: number;
  /** Best door-to-door transit time this player offers, Infinity if none. */
  transitSeconds: number;
  /** Drivers per minute — the ranking key. */
  value: number;
}

/**
 * Pairs this player is not already competitive on, worst first.
 * `slack` is how much slower than driving still counts as competitive.
 */
export function pressureList(state: GameState, player: PlayerId, slack = 1.15): Pressure[] {
  const n = state.neighborhoods.length;
  // Authoritative snapshots intentionally omit the large route-table cache.
  // The HUD can cheaply derive this player's table from the serialized lines;
  // bots running in the simulation continue to use the existing cache.
  const routes = state.routes[player] ?? buildRoutes(state, player);
  const out: Pressure[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const demand = effectiveDemand(state, i, j) + effectiveDemand(state, j, i);
      if (demand <= 0) continue;
      const carShare = (state.odShare[i][j][0] + state.odShare[j][i][0]) / 2;
      const carSeconds = carTime(state, i, j, carShare);
      const transitSeconds = Math.min(routes.time[i][j], routes.time[j][i]);
      if (transitSeconds < carSeconds * slack) continue; // already competitive here
      out.push({ i, j, demand, carShare, carSeconds, transitSeconds, value: demand * carShare });
    }
  }
  out.sort((a, b) => b.value - a.value || a.i - b.i || a.j - b.j);
  return out;
}

export function topPressure(state: GameState, player: PlayerId, limit: number): Pressure[] {
  return pressureList(state, player).slice(0, limit);
}
