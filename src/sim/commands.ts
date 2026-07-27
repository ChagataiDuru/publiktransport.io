import { bumpLandValue, createLineCost, extendLineCost } from './economy.ts';
import { pushGameEvent } from './events.ts';
import { buildAdjacency } from './map.ts';
import { LIMITS, LINE_COLORS, PARAMS } from './params.ts';
import { getServiceStops, updateLineDerived } from './network.ts';
import type { Command, GameState, Id, Line, MapEdge, PlayerId } from './types.ts';

const adjacencyCache = new WeakMap<MapEdge[], Id[][]>();

export function getAdjacency(state: GameState): Id[][] {
  const cached = adjacencyCache.get(state.edges);
  if (cached) return cached;
  const adj = buildAdjacency(state.stations.length, state.edges);
  adjacencyCache.set(state.edges, adj);
  return adj;
}

export function areAdjacent(state: GameState, a: Id, b: Id): boolean {
  return getAdjacency(state)[a]?.includes(b) ?? false;
}

export function freePlatforms(state: GameState, s: Id): number {
  return state.stations[s].platforms - state.platformUsage[s];
}

export function findLine(state: GameState, player: PlayerId, lineId: Id): Line | undefined {
  return state.players[player].lines.find((l) => l.id === lineId);
}

export interface Validation {
  ok: boolean;
  code?: string;
  reason?: string;
  cost?: number;
  shortfall?: number;
}

const fail = (reason: string, code = 'invalid', cost?: number, cash?: number): Validation => ({
  ok: false,
  code,
  reason,
  cost,
  shortfall: cost === undefined || cash === undefined ? undefined : Math.max(0, cost - cash),
});

export function validate(state: GameState, cmd: Command): Validation {
  if (state.phase !== 'playing') return fail('match over');
  const player = state.players[cmd.player];
  if (!player) return fail('unknown player', 'unknown_player');

  switch (cmd.type) {
    case 'CreateLine': {
      if (player.lines.length >= LIMITS.MAX_LINES) return fail('line limit reached');
      const st = cmd.stations;
      if (st.length < 2) return fail('a line needs at least 2 stations');
      if (st.length > LIMITS.MAX_LINE_STATIONS) return fail('line too long');
      if (new Set(st).size !== st.length) return fail('a line cannot repeat a station');
      for (const s of st) {
        if (s < 0 || s >= state.stations.length) return fail('unknown station');
        if (freePlatforms(state, s) < 1) return fail(`${state.stations[s].name}: no free platform`);
      }
      for (let i = 0; i + 1 < st.length; i++) {
        if (!areAdjacent(state, st[i], st[i + 1])) return fail('no corridor between those stations');
      }
      const cost = createLineCost(state, cmd.player, st);
      if (player.cash < cost) return fail('not enough cash', 'insufficient_funds', cost, player.cash);
      return { ok: true, cost };
    }

    case 'ExtendLine': {
      const line = findLine(state, cmd.player, cmd.line);
      if (!line) return fail('no such line');
      if (line.stations.length >= LIMITS.MAX_LINE_STATIONS) return fail('line too long');
      if (line.stations.includes(cmd.station)) return fail('already on this line');
      if (freePlatforms(state, cmd.station) < 1) {
        return fail(`${state.stations[cmd.station].name}: no free platform`);
      }
      if (line.servicePlan === 'express') {
        const nextStations =
          cmd.end === 'head'
            ? [cmd.station, ...line.stations]
            : [...line.stations, cmd.station];
        const nextLine: Line = { ...line, stations: nextStations };
        const before = new Set(getServiceStops(line, state.stations));
        for (const station of getServiceStops(nextLine, state.stations)) {
          if (!before.has(station) && freePlatforms(state, station) < 1) {
            return fail(`${state.stations[station].name}: no free platform`);
          }
        }
      }
      const anchor = cmd.end === 'head' ? line.stations[0] : line.stations[line.stations.length - 1];
      if (!areAdjacent(state, anchor, cmd.station)) return fail('no corridor from that end');
      const cost = extendLineCost(state, cmd.player, anchor, cmd.station);
      if (player.cash < cost) return fail('not enough cash', 'insufficient_funds', cost, player.cash);
      return { ok: true, cost };
    }

    case 'DeleteLine': {
      const line = findLine(state, cmd.player, cmd.line);
      if (!line) return fail('no such line');
      return { ok: true, cost: -line.investment * PARAMS.REFUND_RATE };
    }

    case 'BuyTrain': {
      const line = findLine(state, cmd.player, cmd.line);
      if (!line) return fail('no such line');
      if (player.cash < PARAMS.TRAIN_COST) {
        return fail('not enough cash', 'insufficient_funds', PARAMS.TRAIN_COST, player.cash);
      }
      return { ok: true, cost: PARAMS.TRAIN_COST };
    }

    case 'SellTrain': {
      const line = findLine(state, cmd.player, cmd.line);
      if (!line) return fail('no such line');
      if (line.trains <= 0) return fail('no trains left');
      return { ok: true, cost: -PARAMS.TRAIN_COST * PARAMS.REFUND_RATE };
    }

    case 'DispatchRapidService': {
      const line = findLine(state, cmd.player, cmd.line);
      if (!line) return fail('no such line');
      if (line.dispatchEndsAtTick > state.tick) return fail('rapid service already active');
      if (player.dispatchReadyAtTick > state.tick) return fail('rapid service cooling down');
      if (player.cash < PARAMS.RAPID_DISPATCH_COST) {
        return fail(
          'not enough cash',
          'insufficient_funds',
          PARAMS.RAPID_DISPATCH_COST,
          player.cash,
        );
      }
      return { ok: true, cost: PARAMS.RAPID_DISPATCH_COST };
    }

    case 'SetServicePlan': {
      const line = findLine(state, cmd.player, cmd.line);
      if (!line) return fail('no such line');
      if (line.servicePlan === cmd.servicePlan) return fail('service plan unchanged');
      if (cmd.servicePlan === 'express' && line.stations.length < PARAMS.EXPRESS_MIN_STATIONS) {
        return fail(`express needs ${PARAMS.EXPRESS_MIN_STATIONS} stations`);
      }
      if (cmd.servicePlan === 'local') {
        const currentlyServed = new Set(getServiceStops(line, state.stations));
        for (const station of line.stations) {
          if (!currentlyServed.has(station) && freePlatforms(state, station) < 1) {
            return fail(`${state.stations[station].name}: no free platform`);
          }
        }
      }
      return { ok: true };
    }
  }
}

function nextColor(state: GameState, player: PlayerId): string {
  const palette = LINE_COLORS[player % LINE_COLORS.length];
  const used = new Set(state.players[player].lines.map((l) => l.color));
  return palette.find((c) => !used.has(c)) ?? palette[palette.length - 1];
}

/** Applies one command. Invalid commands are dropped silently, state untouched. */
export function applyCommand(state: GameState, cmd: Command): boolean {
  const v = validate(state, cmd);
  if (!v.ok) return false;
  const player = state.players[cmd.player];

  switch (cmd.type) {
    case 'CreateLine': {
      const cost = createLineCost(state, cmd.player, cmd.stations);
      player.cash -= cost;
      const line: Line = {
        id: state.nextLineId++,
        owner: cmd.player,
        stations: [...cmd.stations],
        trains: 1,
        color: nextColor(state, cmd.player),
        roundTripTime: 0,
        headway: Infinity,
        loadFactor: 0,
        ridership: 0,
        segmentFlow: [],
        trackLength: 0,
        investment: cost,
        servicePlan: 'local',
        dispatchEndsAtTick: 0,
      };
      for (const s of cmd.stations) {
        state.platformUsage[s] += 1;
        bumpLandValue(state, s);
      }
      updateLineDerived(state.stations, line);
      player.lines.push(line);
      state.netDirty[cmd.player] = true;
      pushGameEvent(state, {
        kind: 'serviceOpened',
        player: cmd.player,
        lineId: line.id,
        stationIds: [...cmd.stations],
      });
      return true;
    }

    case 'ExtendLine': {
      const line = findLine(state, cmd.player, cmd.line)!;
      const servedBefore = new Set(getServiceStops(line, state.stations));
      const anchor = cmd.end === 'head' ? line.stations[0] : line.stations[line.stations.length - 1];
      const cost = extendLineCost(state, cmd.player, anchor, cmd.station);
      player.cash -= cost;
      line.investment += cost;
      if (cmd.end === 'head') line.stations.unshift(cmd.station);
      else line.stations.push(cmd.station);
      const servedAfter = new Set(getServiceStops(line, state.stations));
      for (const station of servedBefore) {
        if (!servedAfter.has(station)) state.platformUsage[station] -= 1;
      }
      for (const station of servedAfter) {
        if (!servedBefore.has(station)) state.platformUsage[station] += 1;
      }
      bumpLandValue(state, cmd.station);
      updateLineDerived(state.stations, line);
      state.netDirty[cmd.player] = true;
      pushGameEvent(state, {
        kind: 'lineExtended',
        player: cmd.player,
        lineId: line.id,
        stationId: cmd.station,
        end: cmd.end,
      });
      return true;
    }

    case 'DeleteLine': {
      const idx = player.lines.findIndex((l) => l.id === cmd.line);
      const line = player.lines[idx];
      for (const s of getServiceStops(line, state.stations)) state.platformUsage[s] -= 1;
      player.cash += line.investment * PARAMS.REFUND_RATE;
      player.lines.splice(idx, 1);
      state.netDirty[cmd.player] = true;
      pushGameEvent(state, {
        kind: 'lineDeleted',
        player: cmd.player,
        lineId: line.id,
      });
      return true;
    }

    case 'BuyTrain': {
      const line = findLine(state, cmd.player, cmd.line)!;
      player.cash -= PARAMS.TRAIN_COST;
      line.investment += PARAMS.TRAIN_COST;
      line.trains += 1;
      updateLineDerived(state.stations, line);
      state.netDirty[cmd.player] = true;
      pushGameEvent(state, {
        kind: 'capacityAdded',
        player: cmd.player,
        lineId: line.id,
        trainDelta: 1,
      });
      return true;
    }

    case 'SellTrain': {
      const line = findLine(state, cmd.player, cmd.line)!;
      line.trains -= 1;
      line.investment = Math.max(0, line.investment - PARAMS.TRAIN_COST);
      player.cash += PARAMS.TRAIN_COST * PARAMS.REFUND_RATE;
      updateLineDerived(state.stations, line);
      state.netDirty[cmd.player] = true;
      pushGameEvent(state, {
        kind: 'capacityAdded',
        player: cmd.player,
        lineId: line.id,
        trainDelta: -1,
      });
      return true;
    }

    case 'DispatchRapidService': {
      const line = findLine(state, cmd.player, cmd.line)!;
      player.cash -= PARAMS.RAPID_DISPATCH_COST;
      line.dispatchEndsAtTick =
        state.tick + Math.round(PARAMS.RAPID_DISPATCH_DURATION * PARAMS.TICK_HZ);
      player.dispatchReadyAtTick =
        state.tick + Math.round(PARAMS.RAPID_DISPATCH_COOLDOWN * PARAMS.TICK_HZ);
      updateLineDerived(state.stations, line);
      state.netDirty[cmd.player] = true;
      pushGameEvent(state, { kind: 'dispatchStarted', player: cmd.player, lineId: line.id });
      return true;
    }

    case 'SetServicePlan': {
      const line = findLine(state, cmd.player, cmd.line)!;
      const before = new Set(getServiceStops(line, state.stations));
      line.servicePlan = cmd.servicePlan;
      const after = new Set(getServiceStops(line, state.stations));
      for (const station of before) if (!after.has(station)) state.platformUsage[station] -= 1;
      for (const station of after) if (!before.has(station)) state.platformUsage[station] += 1;
      updateLineDerived(state.stations, line);
      state.netDirty[cmd.player] = true;
      pushGameEvent(state, {
        kind: 'servicePlanChanged',
        player: cmd.player,
        lineId: line.id,
        servicePlan: cmd.servicePlan,
      });
      return true;
    }
  }
}
