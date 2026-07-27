import { decide } from '../src/bot/greedy.ts';
import { validate } from '../src/sim/commands.ts';
import { PARAMS } from '../src/sim/params.ts';
import { createInitialState, tick } from '../src/sim/state.ts';
import type { Command, GameState } from '../src/sim/types.ts';

Object.assign(PARAMS, JSON.parse(process.env.P ?? '{}'));

const seeds = (process.env.SEEDS ?? '1,7,42,99,123,777,2024,9001,31415,65537')
  .split(',')
  .map(Number)
  .filter(Number.isFinite);

interface Result {
  car: number;
  shares: number[];
  lines: number;
  trains: number;
  stations: number;
  districts: number;
  firstLineSeconds: number[];
  secondLineSeconds: number[];
  rejectedHumanActions: string[];
}

interface ScheduledAction {
  earliestTick: number;
  make: (state: GameState) => Command | null;
}

function botCommands(
  state: GameState,
  players: number[],
  seconds = PARAMS.BOT_DECISION_INTERVAL,
): Command[] {
  const commands: Command[] = [];
  const interval = seconds * PARAMS.TICK_HZ;
  for (const player of players) {
    if (state.tick - state.botLastDecisionTick[player] < interval) continue;
    state.botLastDecisionTick[player] = state.tick;
    commands.push(...decide(state, player));
  }
  return commands;
}

function measure(
  state: GameState,
  first: number[],
  second: number[],
  rejectedHumanActions: string[],
): Result {
  const stationIds = new Set(state.players.flatMap((player) => player.lines.flatMap((line) => line.stations)));
  const districts = new Set([...stationIds].map((station) => state.stations[station].neighborhood));
  return {
    car: state.cityShare[0],
    shares: state.players.map((player) => player.cityShare),
    lines: state.players.reduce((sum, player) => sum + player.lines.length, 0),
    trains: state.players.reduce(
      (sum, player) => sum + player.lines.reduce((lineSum, line) => lineSum + line.trains, 0),
      0,
    ),
    stations: stationIds.size,
    districts: districts.size,
    firstLineSeconds: first,
    secondLineSeconds: second,
    rejectedHumanActions,
  };
}

function run(
  seed: number,
  mode: 'bots' | 'script' | 'paced' = 'bots',
  playerCount = 2,
): Result {
  let state = createInitialState(seed, playerCount);
  const first = new Array<number>(playerCount).fill(Infinity);
  const second = new Array<number>(playerCount).fill(Infinity);
  const rejectedHumanActions: string[] = [];
  const scripted = mode === 'script' ? humanScript() : [];

  for (let tickIndex = 0; tickIndex < PARAMS.MATCH_SECONDS * PARAMS.TICK_HZ; tickIndex++) {
    const commands =
      mode === 'bots'
        ? botCommands(state, state.players.map((player) => player.id))
        : mode === 'paced'
          ? [...botCommands(state, [0], 10), ...botCommands(state, [1])]
          : botCommands(state, [1]);
    const next = scripted[0];
    const action = next && state.tick >= next.earliestTick ? next.make(state) : null;
    if (action && next) {
      const result = validate(state, action);
      if (result.ok) {
        commands.unshift(action);
        scripted.shift();
      } else if (result.reason !== 'not enough cash') {
        rejectedHumanActions.push(`${state.tick / PARAMS.TICK_HZ}s ${action.type}: ${result.reason}`);
        scripted.shift();
      }
    }
    state = tick(state, commands);
    for (const player of state.players) {
      if (player.lines.length >= 1 && !Number.isFinite(first[player.id])) {
        first[player.id] = state.tick / PARAMS.TICK_HZ;
      }
      if (player.lines.length >= 2 && !Number.isFinite(second[player.id])) {
        second[player.id] = state.tick / PARAMS.TICK_HZ;
      }
    }
  }
  return measure(state, first, second, rejectedHumanActions);
}

function humanScript(): ScheduledAction[] {
  const at = (seconds: number): number => seconds * PARAMS.TICK_HZ;
  const action = (
    seconds: number,
    make: (state: GameState) => Command | null,
  ): ScheduledAction => ({ earliestTick: at(seconds), make });
  return [
    action(2, () => ({ type: 'CreateLine', player: 0, stations: [0, 1, 12, 13, 15] })),
    action(18, (state) => ownLine(state, 0, 0, 'BuyTrain')),
    action(35, (state) => extend(state, 0, 0, 16)),
    action(60, () => ({ type: 'CreateLine', player: 0, stations: [24, 26, 27, 29, 30] })),
    action(90, (state) => ownLine(state, 0, 1, 'BuyTrain')),
    action(120, (state) => extend(state, 0, 1, 32)),
    action(160, (state) => ownLine(state, 0, 0, 'BuyTrain')),
    action(210, (state) => ownLine(state, 0, 1, 'BuyTrain')),
  ];
}

function ownLine(
  state: GameState,
  player: number,
  index: number,
  type: 'BuyTrain',
): Command | null {
  const line = state.players[player].lines[index];
  return line ? { type, player, line: line.id } : null;
}

function extend(
  state: GameState,
  player: number,
  index: number,
  station: number,
): Command | null {
  const line = state.players[player].lines[index];
  return line ? { type: 'ExtendLine', player, line: line.id, station, end: 'tail' } : null;
}

function average(results: Result[], pick: (result: Result) => number): number {
  return results.reduce((sum, result) => sum + pick(result), 0) / results.length;
}

function finiteAverage(results: Result[], pick: (result: Result) => number): number {
  const values = results.map(pick).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Infinity;
}

function print(label: string, results: Result[]): void {
  console.log(
    `${label.padEnd(18)} car ${(average(results, (r) => r.car) * 100).toFixed(1)}%` +
      ` · lines ${average(results, (r) => r.lines).toFixed(1)}` +
      ` · trains ${average(results, (r) => r.trains).toFixed(1)}` +
      ` · stations ${average(results, (r) => r.stations).toFixed(1)}/36` +
      ` · districts ${average(results, (r) => r.districts).toFixed(1)}/14` +
      ` · 2nd line ${finiteAverage(results, (r) => Math.min(...r.secondLineSeconds)).toFixed(0)}s`,
  );
}

const bots = seeds.map((seed) => run(seed));
const fourBots = seeds.map((seed) => run(seed, 'bots', 4));
const paced = seeds.map((seed) => run(seed, 'paced'));
print('BOT VS BOT', bots);
print('FOUR BOTS', fourBots);
print('PACED VS BOT', paced);
const pacedWins = paced.filter((result) => result.shares[0] > result.shares[1]).length;
console.log(`paced planner wins ${pacedWins}/${paced.length} seeds`);
if (process.env.VERBOSE === '1') {
  const human = seeds.map((seed) => run(seed, 'script'));
  print('STATIC ROUTE', human);
  bots.forEach((result, index) => {
    console.log(
      `bot seed ${seeds[index]} shares ${result.shares.map((share) => `${(share * 100).toFixed(1)}%`).join('/')}` +
        ` · ${result.lines} lines · ${result.stations} stations · ${result.trains} trains`,
    );
  });
  human.forEach((result, index) => {
    console.log(
      `seed ${seeds[index]} shares ${result.shares.map((share) => `${(share * 100).toFixed(1)}%`).join('/')}` +
        ` · rejected ${result.rejectedHumanActions.join(', ') || 'none'}`,
    );
  });
}
