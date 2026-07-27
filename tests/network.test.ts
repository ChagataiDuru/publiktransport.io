import { afterEach, describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands.ts';
import { dist } from '../src/sim/map.ts';
import { PARAMS } from '../src/sim/params.ts';
import { buildRoutes } from '../src/sim/network.ts';
import { createInitialState } from '../src/sim/state.ts';
import type { GameState } from '../src/sim/types.ts';

const SNAPSHOT = { ...PARAMS };
afterEach(() => Object.assign(PARAMS, SNAPSHOT));

/** walk + wait + (ride + dwell per stop), computed independently of network.ts */
function handTime(state: GameState, opts: {
  origin: number;
  accessStation: number;
  chain: number[];
  headway: number;
  destination: number;
  egressStation: number;
}): number {
  const walkIn = dist(state.neighborhoods[opts.origin].centroid, state.stations[opts.accessStation].pos) / PARAMS.WALK_SPEED;
  const walkOut = dist(state.neighborhoods[opts.destination].centroid, state.stations[opts.egressStation].pos) / PARAMS.WALK_SPEED;
  let ride = 0;
  for (let i = 0; i + 1 < opts.chain.length; i++) {
    ride += dist(state.stations[opts.chain[i]].pos, state.stations[opts.chain[i + 1]].pos) / PARAMS.TRAIN_SPEED;
    ride += PARAMS.STATION_DWELL;
  }
  return walkIn + opts.headway / 2 + ride + walkOut;
}

describe('line-expanded routing', () => {
  it('matches a hand-computed single-line trip', () => {
    // Only station 1 is inside walking range of Westport, and only station 12
    // is inside walking range of Old Town — so the route is forced.
    PARAMS.MAX_WALK_TIME = 30;
    const state = createInitialState(1);
    expect(applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1, 12] })).toBe(true);

    const line = state.players[0].lines[0];
    const routes = buildRoutes(state, 0);

    const expected = handTime(state, {
      origin: 0,
      accessStation: 1,
      chain: [1, 12],
      headway: line.headway,
      destination: 5,
      egressStation: 12,
    });

    expect(routes.time[0][5]).toBeCloseTo(expected, 6);
    expect(routes.transfers[0][5]).toBe(0);
    // Two ride hops recorded: station 1 -> 12 is segment index 1 of the line.
    expect(routes.path[0][5]).toEqual([{ line: line.id, seg: 1, forward: true }]);
  });

  it('charges the transfer penalty once when changing lines', () => {
    // At a 10s walking budget only station 1 is in reach of Westport and only
    // station 13 is in reach of Old Town, so changing lines at Old Town Gate
    // is the only way through.
    PARAMS.MAX_WALK_TIME = 10;
    const state = createInitialState(1);
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1, 12] });
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [12, 13] });

    const before = buildRoutes(state, 0);
    expect(before.transfers[0][5]).toBe(1);
    expect(Number.isFinite(before.time[0][5])).toBe(true);

    PARAMS.TRANSFER_PENALTY += 25;
    const after = buildRoutes(state, 0);
    expect(after.time[0][5] - before.time[0][5]).toBeCloseTo(25, 6);
  });

  it('reports unreachable districts as Infinity', () => {
    PARAMS.MAX_WALK_TIME = 30;
    const state = createInitialState(1);
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1] });
    const routes = buildRoutes(state, 0);
    // Southferry is on the far side of the map with no service at all.
    expect(routes.time[0][13]).toBe(Infinity);
  });

  it('an express chord beats the all-stops route it flies over', () => {
    const state = createInitialState(1);
    // Local: Union Square -> Lantern Street -> Quayside (2 stops, one dwell more)
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [15, 18, 29] });
    // Express: Union Square -> Quayside direct, using the hub-to-hub chord.
    applyCommand(state, { type: 'CreateLine', player: 1, stations: [15, 29] });

    const local = state.players[0].lines[0];
    const express = state.players[1].lines[0];
    // Same trains on both, so the comparison is about stops, not frequency.
    expect(express.roundTripTime).toBeLessThan(local.roundTripTime);
  });
});
