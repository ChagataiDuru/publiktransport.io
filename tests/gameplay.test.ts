import { afterEach, describe, expect, it } from 'vitest';
import { applyCommand, validate } from '../src/sim/commands.ts';
import { effectiveDemand } from '../src/sim/demand.ts';
import { pushTextEvent } from '../src/sim/events.ts';
import { rankStrategicCorridors, updateGameplay } from '../src/sim/gameplay.ts';
import { effectiveTrainCount, getServiceStops, lineCapacityPerHour } from '../src/sim/network.ts';
import { PARAMS } from '../src/sim/params.ts';
import { districtFrontline } from '../src/sim/rivalry.ts';
import { createInitialState, hashState, tick } from '../src/sim/state.ts';
import type { CivicContract, Command, GameState } from '../src/sim/types.ts';

const BARE = { starterLines: false };
const originalParams = { ...PARAMS };

afterEach(() => Object.assign(PARAMS, originalParams));

function richState(seed = 1): GameState {
  const state = createInitialState(seed, 2, BARE);
  for (const player of state.players) player.cash = 1e9;
  return state;
}

function activeContract(overrides: Partial<CivicContract> = {}): CivicContract {
  return {
    id: 1,
    phase: 'active',
    originId: 0,
    destinationId: 1,
    announcedAtTick: 0,
    startsAtTick: 0,
    endsAtTick: 100,
    baselineShares: [0, 0],
    currentGains: [0, 0],
    targetGain: 0.1,
    reward: 3000,
    demandMultiplier: 2,
    winner: null,
    resolvedAtTick: null,
    ...overrides,
  };
}

describe('structured events', () => {
  it('uses stable increasing ids, remains bounded, and describes builds', () => {
    const state = richState();
    expect(applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1] })).toBe(true);
    expect(
      applyCommand(state, { type: 'ExtendLine', player: 0, line: 0, station: 12, end: 'tail' }),
    ).toBe(true);
    expect(state.events[0]).toMatchObject({ id: 1, kind: 'serviceOpened', lineId: 0 });
    expect(state.events[1]).toMatchObject({ id: 2, kind: 'lineExtended', stationId: 12 });
    for (let i = 0; i < 40; i++) pushTextEvent(state, -1, `event ${i}`);
    expect(state.events).toHaveLength(32);
    expect(state.events.at(-1)?.id).toBe(42);
    expect(state.nextEventId).toBe(43);
  });
});

describe('civic contracts and final mandate', () => {
  it('ranks targets deterministically', () => {
    const a = createInitialState(42);
    const b = createInitialState(42);
    expect(rankStrategicCorridors(a).slice(0, 8)).toEqual(rankStrategicCorridors(b).slice(0, 8));
  });

  it('captures baselines, resolves an immediate winner, and pays once', () => {
    const state = richState();
    state.civicContract = activeContract({ phase: 'announced', startsAtTick: 0 });
    state.odShare[0][1] = [0.8, 0.12, 0.08];
    state.odShare[1][0] = [0.8, 0.12, 0.08];
    updateGameplay(state);
    expect(state.civicContract.baselineShares).toEqual([0.12, 0.08]);

    state.odShare[0][1] = [0.65, 0.27, 0.08];
    state.odShare[1][0] = [0.65, 0.27, 0.08];
    const cash = state.players[0].cash;
    updateGameplay(state);
    expect(state.civicContract.winner).toBe(0);
    expect(state.players[0].cash).toBe(cash + state.civicContract.reward);
    updateGameplay(state);
    expect(state.players[0].cash).toBe(cash + state.civicContract.reward);
  });

  it('resolves deadline ties by player id and allows no-winner expiry', () => {
    const tied = richState();
    tied.tick = 100;
    tied.civicContract = activeContract({
      endsAtTick: 100,
      baselineShares: [0.1, 0.1],
    });
    tied.odShare[0][1] = [0.7, 0.15, 0.15];
    tied.odShare[1][0] = [0.7, 0.15, 0.15];
    updateGameplay(tied);
    expect(tied.civicContract.winner).toBe(0);

    const empty = richState();
    empty.tick = 100;
    empty.civicContract = activeContract({
      endsAtTick: 100,
      baselineShares: [0.1, 0.1],
    });
    empty.odShare[0][1] = [0.798, 0.101, 0.101];
    empty.odShare[1][0] = [0.798, 0.101, 0.101];
    updateGameplay(empty);
    expect(empty.civicContract.winner).toBeNull();
    expect(empty.civicContract.phase).toBe('resolved');
  });

  it('multiplies only its corridor and caps overlap with rush hour', () => {
    const state = richState();
    state.civicContract = activeContract();
    const base = state.odMatrix[0][1];
    expect(effectiveDemand(state, 0, 1)).toBeCloseTo(base * 2);
    expect(effectiveDemand(state, 0, 2)).toBeCloseTo(state.odMatrix[0][2]);
    state.rushHour = {
      active: true,
      neighborhood: 0,
      secondary: 1,
      telegraphedAtTick: 0,
      startsAtTick: 0,
      endsAtTick: 100,
    };
    expect(effectiveDemand(state, 0, 1)).toBeCloseTo(base * PARAMS.MAX_DEMAND_MULTIPLIER);
  });

  it('announces one deterministic final mandate and suppresses later contracts', () => {
    const state = createInitialState(9);
    state.tick =
      state.matchLengthTicks -
      Math.round(
        (PARAMS.FINAL_MANDATE_START_SECONDS + PARAMS.FINAL_MANDATE_TELEGRAPH_SECONDS) *
          PARAMS.TICK_HZ,
      );
    updateGameplay(state);
    expect(state.finalMandate).not.toBeNull();
    const pair = [state.finalMandate?.originId, state.finalMandate?.destinationId];
    state.tick = state.finalMandate!.startsAtTick;
    updateGameplay(state);
    expect(state.finalMandate?.active).toBe(true);
    state.civicContract = null;
    state.nextContractTick = 0;
    updateGameplay(state);
    expect(state.civicContract).toBeNull();
    expect([state.finalMandate?.originId, state.finalMandate?.destinationId]).toEqual(pair);
  });
});

describe('rapid dispatch', () => {
  it('validates ownership/cash/cooldown, raises capacity, then expires', () => {
    const state = richState();
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 1, 12] });
    const line = state.players[0].lines[0];
    const permanentInvestment = line.investment;
    expect(
      validate(state, { type: 'DispatchRapidService', player: 1, line: line.id }).ok,
    ).toBe(false);
    state.players[0].cash = PARAMS.RAPID_DISPATCH_COST - 1;
    expect(
      validate(state, { type: 'DispatchRapidService', player: 0, line: line.id }).code,
    ).toBe('insufficient_funds');
    state.players[0].cash = 1e9;
    const capacity = lineCapacityPerHour(line);
    expect(applyCommand(state, { type: 'DispatchRapidService', player: 0, line: line.id })).toBe(
      true,
    );
    expect(effectiveTrainCount(line)).toBe(line.trains + PARAMS.RAPID_DISPATCH_EXTRA_TRAINS);
    expect(lineCapacityPerHour(line)).toBeGreaterThan(capacity);
    expect(line.investment).toBe(permanentInvestment);
    expect(
      validate(state, { type: 'DispatchRapidService', player: 0, line: line.id }).ok,
    ).toBe(false);
    state.tick = line.dispatchEndsAtTick;
    updateGameplay(state);
    expect(line.dispatchEndsAtTick).toBe(0);
    expect(effectiveTrainCount(line)).toBe(line.trains);
    expect(line.investment).toBe(permanentInvestment);
  });
});

describe('district frontlines', () => {
  it('distinguishes controlled, contested, and car-dominated districts for four players', () => {
    const state = createInitialState(1, 4, BARE);
    state.neighborhoods[0].share = [0.4, 0.3, 0.18, 0.08, 0.04];
    expect(districtFrontline(state, 0)).toMatchObject({ leader: 0, runnerUp: 1, contested: false });
    state.neighborhoods[0].share = [0.5, 0.22, 0.2, 0.05, 0.03];
    expect(districtFrontline(state, 0)).toMatchObject({ leader: null, contested: true });
    state.neighborhoods[0].share = [0.9, 0.04, 0.03, 0.02, 0.01];
    expect(districtFrontline(state, 0)).toMatchObject({ leader: null, contested: false });
  });

  it('emits one takeover event and not another while unchanged', () => {
    const state = richState();
    state.neighborhoods[0].share = [0.5, 0.35, 0.15];
    updateGameplay(state);
    const firstCount = state.events.filter((event) => event.kind === 'districtChanged').length;
    expect(firstCount).toBe(1);
    updateGameplay(state);
    expect(state.events.filter((event) => event.kind === 'districtChanged')).toHaveLength(firstCount);
  });
});

describe('local and express service plans', () => {
  it('enforces eligibility, derives stable stops, releases platforms, and restores local service', () => {
    const state = richState();
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 3, 4, 5, 7] });
    const line = state.players[0].lines[0];
    const localRoundTrip = line.roundTripTime;
    const localUsage = [...state.platformUsage];
    expect(
      applyCommand(state, {
        type: 'SetServicePlan',
        player: 0,
        line: line.id,
        servicePlan: 'express',
      }),
    ).toBe(true);
    const stops = getServiceStops(line, state.stations);
    expect(stops[0]).toBe(line.stations[0]);
    expect(stops.at(-1)).toBe(line.stations.at(-1));
    expect(stops.length).toBeLessThan(line.stations.length);
    expect(line.roundTripTime).toBeLessThan(localRoundTrip);
    for (const station of line.stations) {
      expect(state.platformUsage[station]).toBe(
        stops.includes(station) ? localUsage[station] : localUsage[station] - 1,
      );
    }
    expect(
      applyCommand(state, {
        type: 'SetServicePlan',
        player: 0,
        line: line.id,
        servicePlan: 'local',
      }),
    ).toBe(true);
    expect(state.platformUsage).toEqual(localUsage);
  });

  it('rejects short express lines and local platform reacquisition conflicts', () => {
    const state = richState();
    applyCommand(state, { type: 'CreateLine', player: 0, stations: [0, 3, 4, 5, 7] });
    const line = state.players[0].lines[0];
    applyCommand(state, {
      type: 'SetServicePlan',
      player: 0,
      line: line.id,
      servicePlan: 'express',
    });
    const skipped = line.stations.find((station) => !getServiceStops(line, state.stations).includes(station))!;
    state.platformUsage[skipped] = state.stations[skipped].platforms;
    expect(
      validate(state, {
        type: 'SetServicePlan',
        player: 0,
        line: line.id,
        servicePlan: 'local',
      }).ok,
    ).toBe(false);

    const short = richState(2);
    applyCommand(short, { type: 'CreateLine', player: 0, stations: [0, 1] });
    expect(
      validate(short, {
        type: 'SetServicePlan',
        player: 0,
        line: 0,
        servicePlan: 'express',
      }).ok,
    ).toBe(false);
  });
});

describe('expanded determinism', () => {
  it('replays contracts, dispatch, and service plans identically', () => {
    const run = (): GameState => {
      let state = createInitialState(77, 2, BARE);
      state.players[0].cash = state.players[1].cash = 1e9;
      const script: Array<{ tick: number; command: Command }> = [
        { tick: 0, command: { type: 'CreateLine', player: 0, stations: [0, 1, 12, 13, 15] } },
        { tick: 1, command: { type: 'CreateLine', player: 1, stations: [19, 20, 22, 23, 34] } },
        { tick: 20, command: { type: 'DispatchRapidService', player: 0, line: 0 } },
        { tick: 30, command: { type: 'SetServicePlan', player: 0, line: 0, servicePlan: 'express' } },
      ];
      PARAMS.CIVIC_CONTRACT_FIRST_DELAY = 2;
      state.nextContractTick = 20;
      for (let step = 0; step < 500; step++) {
        state = tick(
          state,
          script.filter((entry) => entry.tick === step).map((entry) => entry.command),
        );
      }
      return state;
    };
    expect(hashState(run())).toBe(hashState(run()));
  });
});
