import { afterEach, describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands.ts';
import {
  applyEconomy,
  createLineCost,
  decayLandValue,
  subsidyFor,
} from '../src/sim/economy.ts';
import { PARAMS } from '../src/sim/params.ts';
import { createInitialState } from '../src/sim/state.ts';

const SNAPSHOT = { ...PARAMS };
afterEach(() => Object.assign(PARAMS, SNAPSHOT));

const BARE = { starterLines: false };

describe('economy', () => {
  it('charges a seat less on its own doorstep', () => {
    const state = createInitialState(1, 2, BARE);
    // Station 12/13 are Old Town, which is player 0's home and not player 1's.
    const home = createLineCost(state, 0, [12, 13]);
    const away = createLineCost(state, 1, [12, 13]);

    expect(state.players[0].homeDistrict).toBe(state.stations[12].neighborhood);
    expect(home).toBeLessThan(away);
    // Only the track and stations are discounted — the train in the price is not.
    expect(away - home).toBeCloseTo(
      (away - PARAMS.TRAIN_COST) * (1 - PARAMS.HOME_DISCOUNT),
      6,
    );
  });

  it('lets an early claim on a district wear off', () => {
    const state = createInitialState(1, 2, BARE);
    state.players[0].cash = 1e9;
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1, 2] });

    const claimed = state.landValue[0];
    expect(claimed).toBeGreaterThan(1);

    for (let second = 0; second < 120; second++) decayLandValue(state, 1);
    expect(state.landValue[0]).toBeLessThan(1 + (claimed - 1) * 0.5);
    expect(state.landValue[0]).toBeGreaterThan(1);
  });

  it('pays the trailing operator and nothing to the leader', () => {
    const state = createInitialState(1, 2, BARE);
    state.players[0].cityShare = 0.3;
    state.players[1].cityShare = 0.2;

    expect(subsidyFor(state, 0)).toBe(0);
    expect(subsidyFor(state, 1)).toBeCloseTo(PARAMS.SUBSIDY_PER_POINT * 10, 6);

    // However far behind, it is bounded — this shortens a runaway, it does not
    // hand the lead over.
    state.players[1].cityShare = 0;
    state.players[0].cityShare = 1;
    expect(subsidyFor(state, 1)).toBe(PARAMS.SUBSIDY_MAX);
  });

  it('folds the subsidy into cash flow', () => {
    const state = createInitialState(1, 2, BARE);
    state.players[0].cityShare = 0.25;
    state.players[1].cityShare = 0.05;
    const before = state.players[1].cash;

    applyEconomy(state, 1);

    expect(state.players[1].subsidyRate).toBeCloseTo(PARAMS.SUBSIDY_PER_POINT * 20, 6);
    expect(state.players[1].cash - before).toBeCloseTo(state.players[1].subsidyRate, 6);
  });
});
