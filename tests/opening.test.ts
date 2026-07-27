import { describe, expect, it } from 'vitest';
import { HOME_SEATS } from '../src/sim/map.ts';
import { PARAMS } from '../src/sim/params.ts';
import { pressureList } from '../src/sim/pressure.ts';
import { createInitialState, tick } from '../src/sim/state.ts';

describe('openings', () => {
  it('gives every seat a different home and a line already running in it', () => {
    const state = createInitialState(1, 4);
    const homes = state.players.map((player) => player.homeDistrict);

    expect(new Set(homes).size).toBe(4);
    for (const player of state.players) {
      expect(player.lines).toHaveLength(1);
      const line = player.lines[0];
      expect(line.trains).toBe(1);
      expect(line.stations).toEqual([...HOME_SEATS[player.id].starter]);
      for (const station of line.stations) {
        expect(state.stations[station].neighborhood).toBe(player.homeDistrict);
      }
    }
  });

  it('hands the stub over free but keeps it worth a refund', () => {
    const state = createInitialState(1, 2);
    for (const player of state.players) {
      expect(player.lines[0].investment).toBeGreaterThan(PARAMS.TRAIN_COST);
    }
    // Cash is only ever moved by the compensation below, never by the stub.
    expect(state.players[0].cash).toBeGreaterThan(PARAMS.STARTING_CASH * 0.8);
    expect(state.players[0].cash).toBeLessThan(PARAMS.STARTING_CASH * 1.7);
  });

  it('opens a weaker home with more cash than a stronger one', () => {
    const state = createInitialState(1, 4);
    const catchment = (player: (typeof state.players)[number]): number =>
      state.neighborhoods[player.homeDistrict].population;
    const richest = [...state.players].sort((a, b) => catchment(b) - catchment(a))[0];
    const poorest = [...state.players].sort((a, b) => catchment(a) - catchment(b))[0];

    expect(poorest.cash).toBeGreaterThan(richest.cash);
  });

  it('leaves no seat idle on its stub alone', () => {
    const state = createInitialState(1, 4);
    for (let t = 0; t < 30 * PARAMS.TICK_HZ; t++) tick(state, []);
    const shares = state.players.map((player) => player.cityShare);

    for (const share of shares) expect(share).toBeGreaterThan(0.01);
    // The stubs are not equally productive — Old Town's catchment is twice
    // Foundry's — and this is the gap the opening cash is there to pay for.
    // Measured at ~5.2 points; the guard is against it widening, not at zero.
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThan(0.07);
  });
});

describe('pressure', () => {
  it('ranks the pairs still driving, worst first, and drops the ones served', () => {
    const state = createInitialState(1, 2);
    for (let t = 0; t < 20 * PARAMS.TICK_HZ; t++) tick(state, []);

    const rows = pressureList(state, 0);
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].value).toBeGreaterThanOrEqual(rows[i].value);
    }
    // A pair the network already beats the car on must not be listed.
    for (const row of rows) {
      expect(row.transitSeconds).toBeGreaterThanOrEqual(row.carSeconds * 1.15);
    }
    // The stub line serves its own district, so its own pair is not the worst.
    expect(rows[0].value).toBeGreaterThan(0);
  });

  it('reads the same on identical states', () => {
    const a = createInitialState(7, 3);
    const b = createInitialState(7, 3);
    for (let t = 0; t < 100; t++) {
      tick(a, []);
      tick(b, []);
    }
    expect(pressureList(a, 1)).toEqual(pressureList(b, 1));
  });
});

describe('rush hour', () => {
  it('surges a car-heavy district together with its busiest neighbour', () => {
    const state = createInitialState(11, 2);
    let seen = 0;
    while (state.tick < PARAMS.MATCH_SECONDS * PARAMS.TICK_HZ && seen < 2) {
      tick(state, []);
      const rush = state.rushHour;
      if (!rush || !rush.active) continue;
      seen += 1;
      expect(rush.secondary).toBeGreaterThanOrEqual(0);
      expect(rush.secondary).not.toBe(rush.neighborhood);
      // It lands where people are still driving, not on a solved corridor.
      expect(state.neighborhoods[rush.neighborhood].share[0]).toBeGreaterThan(0.2);
      while (state.rushHour) tick(state, []);
    }
    expect(seen).toBe(2);
  });
});
