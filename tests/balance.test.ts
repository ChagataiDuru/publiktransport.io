import { describe, expect, it } from 'vitest';
import { decide } from '../src/bot/greedy.ts';
import { applyCommand } from '../src/sim/commands.ts';
import { extendLineCost } from '../src/sim/economy.ts';
import { PARAMS } from '../src/sim/params.ts';
import { createInitialState, tick } from '../src/sim/state.ts';
import type { Command, GameState } from '../src/sim/types.ts';

function runBotMatch(seed: number): GameState {
  let state = createInitialState(seed);
  const interval = PARAMS.BOT_DECISION_INTERVAL * PARAMS.TICK_HZ;

  while (state.phase === 'playing') {
    const commands: Command[] = [];
    for (const player of state.players) {
      if (state.tick - state.botLastDecisionTick[player.id] < interval) continue;
      state.botLastDecisionTick[player.id] = state.tick;
      commands.push(...decide(state, player.id));
    }
    state = tick(state, commands);
  }
  return state;
}

describe('balance guardrails', () => {
  it('leaves room to improve a representative opening immediately', () => {
    const state = createInitialState(1);
    const opening = [0, 1, 12, 13, 15];

    expect(applyCommand(state, { type: 'CreateLine', player: 0, stations: opening })).toBe(true);
    const extension = extendLineCost(state, 15, 16);

    expect(state.players[0].cash).toBeGreaterThan(extension + PARAMS.TRAIN_COST * 2);
  });

  it('gives the player a grace period before the bot builds', () => {
    const state = createInitialState(1);
    state.tick = PARAMS.BOT_OPENING_DELAY * PARAMS.TICK_HZ - 1;
    expect(decide(state, 1)).toEqual([]);

    state.tick += 1;
    expect(decide(state, 1)[0]?.type).toBe('CreateLine');
  });

  it.each([1, 42, 777])('fills the map without a mirror-match runaway (seed %i)', (seed) => {
    const state = runBotMatch(seed);
    const lines = state.players.reduce((sum, player) => sum + player.lines.length, 0);
    const stations = new Set(
      state.players.flatMap((player) => player.lines.flatMap((line) => line.stations)),
    );
    const districts = new Set([...stations].map((station) => state.stations[station].neighborhood));
    const shareGap = Math.abs(state.players[0].cityShare - state.players[1].cityShare);

    expect(lines).toBeGreaterThanOrEqual(4);
    expect(stations.size).toBeGreaterThanOrEqual(16);
    expect(districts.size).toBeGreaterThanOrEqual(10);
    expect(shareGap).toBeLessThan(0.08);
  });
});
