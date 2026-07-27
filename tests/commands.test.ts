import { describe, expect, it } from 'vitest';
import { applyCommand, freePlatforms, validate } from '../src/sim/commands.ts';
import { createLineCost } from '../src/sim/economy.ts';
import { PARAMS } from '../src/sim/params.ts';
import { createInitialState } from '../src/sim/state.ts';

/** These are unit tests of one mechanism at a time, so they start from an
 * empty map rather than the stub lines every seat opens with. */
const BARE = { starterLines: false };

describe('commands', () => {
  it('rejects a line whose stations are not joined by a corridor', () => {
    const state = createInitialState(1, 2, BARE);
    // Westport North and Southferry are on opposite corners with no corridor.
    const v = validate(state, { type: 'CreateLine', player: 0, stations: [0, 34] });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/corridor/);
  });

  it('rejects a line shorter than two stations', () => {
    const state = createInitialState(1, 2, BARE);
    expect(validate(state, { type: 'CreateLine', player: 0, stations: [0] }).ok).toBe(false);
  });

  it('platforms are shared, so a third line cannot enter a two-platform station', () => {
    const state = createInitialState(1, 2, BARE);
    state.players[0].cash = 1e9;
    state.players[1].cash = 1e9;

    // Northgate (station 3) has two platforms.
    expect(state.stations[3].platforms).toBe(2);
    expect(applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 3] })).toBe(true);
    // The rival takes the second and last platform.
    expect(applyCommand(state, { type: 'CreateLine', player: 1, stations: [3, 4] })).toBe(true);
    expect(freePlatforms(state, 3)).toBe(0);

    const blocked = validate(state, { type: 'CreateLine', player: 0, stations: [3, 12] });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/platform/);

    // Closing the rival's line hands the platform back.
    applyCommand(state, { type: 'DeleteLine', player: 1, line: state.players[1].lines[0].id });
    expect(freePlatforms(state, 3)).toBe(1);
    expect(validate(state, { type: 'CreateLine', player: 0, stations: [3, 12] }).ok).toBe(true);
  });

  it('a line cannot be built without the cash for it', () => {
    const state = createInitialState(1, 2, BARE);
    const stations = [0, 1, 12, 13];
    state.players[0].cash = createLineCost(state, 0, stations) - 1;
    const rejected = validate(state, { type: 'CreateLine', player: 0, stations });
    expect(rejected.code).toBe('insufficient_funds');
    expect(rejected.shortfall).toBeCloseTo(1, 6);
    expect(applyCommand(state, { type: 'CreateLine', player: 0, stations })).toBe(false);
    expect(state.players[0].lines).toHaveLength(0);

    state.players[0].cash += 1;
    expect(applyCommand(state, { type: 'CreateLine', player: 0, stations })).toBe(true);
    expect(state.players[0].cash).toBeCloseTo(0, 6);
  });

  it('land value rises for both players when a district gets served', () => {
    const state = createInitialState(1, 2, BARE);
    state.players[0].cash = 1e9;
    const before = state.landValue[0];
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1] });
    // Two stations in Westport, so two steps.
    expect(state.landValue[0]).toBeCloseTo(before + 2 * PARAMS.LAND_VALUE_STEP, 6);
    // ...and the rival now pays more to build there too.
    const nowCost = createLineCost(state, 1, [1, 2]);
    state.landValue[0] = before;
    expect(nowCost).toBeGreaterThan(createLineCost(state, 1, [1, 2]));
  });

  it('closing a line refunds half of everything sunk into it', () => {
    const state = createInitialState(1, 2, BARE);
    state.players[0].cash = 1e9;
    const stations = [0, 1, 12];
    const cost = createLineCost(state, 0, stations);
    applyCommand(state, { type: 'CreateLine', player: 0, stations });
    applyCommand(state, { type: 'BuyTrain', player: 0, line: 0 });

    const cashBefore = state.players[0].cash;
    applyCommand(state, { type: 'DeleteLine', player: 0, line: 0 });
    const invested = cost + PARAMS.TRAIN_COST;
    expect(state.players[0].cash - cashBefore).toBeCloseTo(invested * PARAMS.REFUND_RATE, 6);
    expect(state.platformUsage[1]).toBe(0);
  });

  it('extending puts the new station on the end that was asked for', () => {
    const state = createInitialState(1, 2, BARE);
    state.players[0].cash = 1e9;
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [1, 12] });
    applyCommand(state, { type: 'ExtendLine', player: 0, line: 0, station: 0, end: 'head' });
    applyCommand(state, { type: 'ExtendLine', player: 0, line: 0, station: 13, end: 'tail' });
    expect(state.players[0].lines[0].stations).toEqual([0, 1, 12, 13]);
  });

  it('nothing can be built once the match is over', () => {
    const state = createInitialState(1, 2, BARE);
    state.phase = 'ended';
    expect(applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1] })).toBe(false);
  });
});
