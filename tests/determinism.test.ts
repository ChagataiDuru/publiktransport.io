import { describe, expect, it } from 'vitest';
import { decide } from '../src/bot/greedy.ts';
import { PARAMS } from '../src/sim/params.ts';
import { createInitialState, hashState, tick } from '../src/sim/state.ts';
import type { Command, GameState } from '../src/sim/types.ts';

/** Scripted human input, replayed identically in every run. */
const SCRIPT: { atTick: number; cmd: Command }[] = [
  { atTick: 5, cmd: { type: 'CreateLine', player: 0, stations: [0, 1, 12, 13, 15] } },
  { atTick: 220, cmd: { type: 'BuyTrain', player: 0, line: 0 } },
  { atTick: 400, cmd: { type: 'ExtendLine', player: 0, line: 0, station: 16, end: 'tail' } },
  { atTick: 700, cmd: { type: 'CreateLine', player: 0, stations: [26, 27, 29, 30] } },
  { atTick: 1100, cmd: { type: 'BuyTrain', player: 0, line: 1 } },
  { atTick: 1600, cmd: { type: 'ExtendLine', player: 0, line: 1, station: 32, end: 'tail' } },
  { atTick: 2100, cmd: { type: 'SellTrain', player: 0, line: 0 } },
  { atTick: 2500, cmd: { type: 'BuyTrain', player: 0, line: 0 } },
];

function run(seed: number, ticks: number): GameState {
  let state = createInitialState(seed);
  for (let t = 0; t < ticks; t++) {
    const cmds: Command[] = SCRIPT.filter((s) => s.atTick === t).map((s) => s.cmd);
    const interval = PARAMS.BOT_DECISION_INTERVAL * PARAMS.TICK_HZ;
    if (state.tick - state.botLastDecisionTick >= interval) {
      state.botLastDecisionTick = state.tick;
      cmds.push(...decide(state, 1));
    }
    state = tick(state, cmds);
  }
  return state;
}

describe('determinism', () => {
  it('same seed and same commands produce the same state after 3000 ticks', () => {
    const a = run(42, 3000);
    const b = run(42, 3000);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.players[0].score).toBe(b.players[0].score);
    expect(a.players[1].cash).toBe(b.players[1].cash);
  });

  it('a different seed diverges (rush hour lands elsewhere)', () => {
    expect(hashState(run(42, 3000))).not.toBe(hashState(run(7, 3000)));
  });

  it('the bot is deterministic on its own', () => {
    const a = run(1, 1200);
    const b = run(1, 1200);
    expect(a.players[1].lines.map((l) => l.stations.join('-'))).toEqual(
      b.players[1].lines.map((l) => l.stations.join('-')),
    );
    expect(a.players[1].lines.length).toBeGreaterThan(0);
  });
});
