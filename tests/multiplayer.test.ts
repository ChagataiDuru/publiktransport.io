import { describe, expect, it } from 'vitest';
import { decide } from '../src/bot/greedy.ts';
import { applyCommand } from '../src/sim/commands.ts';
import { PARAMS } from '../src/sim/params.ts';
import { parseNetwork, stringifyNetwork } from '../src/sim/serialize.ts';
import { createInitialState, hashState, tick } from '../src/sim/state.ts';

function runFourBots(seed: number, ticks: number) {
  let state = createInitialState(seed, 4);
  const interval = PARAMS.BOT_DECISION_INTERVAL * PARAMS.TICK_HZ;
  for (let i = 0; i < ticks; i++) {
    for (let player = 0; player < state.players.length; player++) {
      if (state.tick - state.botLastDecisionTick[player] < interval) continue;
      state.botLastDecisionTick[player] = state.tick;
      for (const command of decide(state, player)) applyCommand(state, command);
    }
    state = tick(state, []);
  }
  return state;
}

describe('multiplayer simulation', () => {
  it('creates only supported player counts', () => {
    expect(() => createInitialState(1, 1)).toThrow(/playerCount/);
    expect(() => createInitialState(1, 5)).toThrow(/playerCount/);
    expect(createInitialState(1, 3).players).toHaveLength(3);
    expect(createInitialState(1, 4).cityShare).toHaveLength(5);
  });

  it('runs a deterministic four-player bot match', () => {
    const a = runFourBots(42, 800);
    const b = runFourBots(42, 800);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.players.every((player) => player.lines.length > 0)).toBe(true);
    expect(a.cityShare.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 9);
    for (const neighborhood of a.neighborhoods) {
      expect(neighborhood.share).toHaveLength(5);
      expect(neighborhood.share.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 9);
    }
  });

  it('round-trips Infinity and preserves the state hash', () => {
    const state = createInitialState(7, 4);
    const restored = parseNetwork<typeof state>(stringifyNetwork(state));
    expect(restored.routes[0].time[0][1]).toBe(Infinity);
    expect(hashState(restored)).toBe(hashState(state));
  });
});
