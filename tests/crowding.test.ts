import { afterEach, describe, expect, it } from 'vitest';
import { updateLoadFactors } from '../src/sim/crowding.ts';
import { applyCommand } from '../src/sim/commands.ts';
import { PARAMS } from '../src/sim/params.ts';
import { crowdPenalty, lineCapacityPerHour } from '../src/sim/network.ts';
import { createInitialState, tick } from '../src/sim/state.ts';
import type { GameState } from '../src/sim/types.ts';

const SNAPSHOT = { ...PARAMS };
afterEach(() => Object.assign(PARAMS, SNAPSHOT));

const CORRIDOR = [0, 1, 12, 13, 15, 16];

function runSolo(trains: number, seconds: number): GameState {
  const state = createInitialState(3, 2, BARE);
  // Take money out of the equation: this test is about capacity, not cash.
  state.players[0].cash = 1e9;
  applyCommand(state, { type: 'CreateLine', player: 0, stations: CORRIDOR });
  for (let i = 1; i < trains; i++) applyCommand(state, { type: 'BuyTrain', player: 0, line: 0 });
  let s = state;
  for (let t = 0; t < seconds * PARAMS.TICK_HZ; t++) s = tick(s, []);
  return s;
}

/** These are unit tests of one mechanism at a time, so they start from an
 * empty map rather than the stub lines every seat opens with. */
const BARE = { starterLines: false };

describe('crowding', () => {
  it('flow at twice capacity reads as a load factor of 2', () => {
    const state = createInitialState(1, 2, BARE);
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1, 12] });
    const line = state.players[0].lines[0];

    const capacityPerMinute = lineCapacityPerHour(line) / 60;
    line.segmentFlow = [capacityPerMinute * 2, capacityPerMinute * 0.5];
    updateLoadFactors(state);

    expect(line.loadFactor).toBeCloseTo(2, 6);
    expect(crowdPenalty(line)).toBeCloseTo(1 + PARAMS.CROWD_PENALTY_K, 6);
  });

  it('an uncrowded line carries no penalty', () => {
    const state = createInitialState(1, 2, BARE);
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1, 12] });
    const line = state.players[0].lines[0];
    line.segmentFlow = [lineCapacityPerHour(line) / 60 / 4];
    updateLoadFactors(state);
    expect(line.loadFactor).toBeLessThan(1);
    expect(crowdPenalty(line)).toBe(1);
  });

  it('a line with no trains runs no service', () => {
    const state = createInitialState(1, 2, BARE);
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1, 12] });
    applyCommand(state, { type: 'SellTrain', player: 0, line: 0 });
    const line = state.players[0].lines[0];
    expect(line.trains).toBe(0);
    expect(line.headway).toBe(Infinity);
  });

  it('adding trains to a crowded line wins share back', () => {
    const thin = runSolo(1, 90);
    const thick = runSolo(8, 90);

    expect(thin.players[0].lines[0].loadFactor).toBeGreaterThan(1);
    expect(thick.players[0].lines[0].loadFactor).toBeLessThan(
      thin.players[0].lines[0].loadFactor,
    );
    expect(thick.players[0].score).toBeGreaterThan(thin.players[0].score);
  });

  it('overcrowding drags the share back down over the following cycles', () => {
    // Rush hour would surge this very corridor mid-test; this is a test of the
    // crowding valve on its own, so hold demand still.
    PARAMS.RUSH_MULTIPLIER = 1;
    const state = createInitialState(5, 2, BARE);
    state.players[0].cash = 1e9;
    applyCommand(state, { type: 'CreateLine', player: 0, stations: CORRIDOR });
    for (let i = 0; i < 10; i++) applyCommand(state, { type: 'BuyTrain', player: 0, line: 0 });

    let s = state;
    for (let t = 0; t < 60 * PARAMS.TICK_HZ; t++) s = tick(s, []);
    const uncrowdedScore = s.players[0].score;
    expect(s.players[0].lines[0].loadFactor).toBeLessThan(1);

    // Strip the line back to a single train. The riders are still there for
    // one more cycle, so the line is immediately far over capacity...
    for (let i = 0; i < 10; i++) applyCommand(s, { type: 'SellTrain', player: 0, line: 0 });
    for (let t = 0; t < PARAMS.TICK_HZ; t++) s = tick(s, []);
    const crunch = s.players[0].lines[0].loadFactor;
    expect(crunch).toBeGreaterThan(1);

    // ...and over the following cycles the crowding penalty pushes them off,
    // which is exactly the anti-snowball valve doing its job.
    for (let t = 0; t < 60 * PARAMS.TICK_HZ; t++) s = tick(s, []);
    expect(s.players[0].score).toBeLessThan(uncrowdedScore * 0.75);
    expect(s.players[0].lines[0].loadFactor).toBeLessThan(crunch);
  });
});
