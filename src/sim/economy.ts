import { dist } from './map.ts';
import { PARAMS } from './params.ts';
import type { GameState, Id, PlayerId } from './types.ts';

/** Track is priced by the land it crosses, so contested ground gets expensive. */
export function trackCost(state: GameState, a: Id, b: Id): number {
  const sa = state.stations[a];
  const sb = state.stations[b];
  const avgLand = (state.landValue[sa.neighborhood] + state.landValue[sb.neighborhood]) / 2;
  return dist(sa.pos, sb.pos) * PARAMS.TRACK_COST_PER_UNIT * avgLand;
}

export function stationCost(state: GameState, s: Id): number {
  return PARAMS.STATION_COST * state.landValue[state.stations[s].neighborhood];
}

/** Cost of laying a fresh line through this exact station sequence. */
export function createLineCost(state: GameState, stations: Id[]): number {
  let total = PARAMS.TRAIN_COST; // every new line ships with one train
  for (const s of stations) total += stationCost(state, s);
  for (let i = 0; i + 1 < stations.length; i++) total += trackCost(state, stations[i], stations[i + 1]);
  return total;
}

export function extendLineCost(state: GameState, from: Id, to: Id): number {
  return stationCost(state, to) + trackCost(state, from, to);
}

/**
 * Every new service at a station lifts that district's land value for *both*
 * players. Claiming an area early makes the rival's entry cost more — passive
 * area control that never feels like a direct attack.
 */
export function bumpLandValue(state: GameState, station: Id): void {
  state.landValue[state.stations[station].neighborhood] += PARAMS.LAND_VALUE_STEP;
}

export function upkeepFor(state: GameState, player: PlayerId): number {
  let upkeep = 0;
  for (const line of state.players[player].lines) {
    upkeep += line.trains * PARAMS.TRAIN_UPKEEP;
    upkeep += line.trackLength * PARAMS.TRACK_UPKEEP;
  }
  return upkeep;
}

export function incomeFor(state: GameState, player: PlayerId): number {
  let income = 0;
  for (const line of state.players[player].lines) income += line.ridership * PARAMS.FARE;
  return income;
}

/**
 * Cash flow, then the bankruptcy valve: a player deep in the red is forced to
 * sell trains one at a time at the refund rate. Overexpansion has to actually
 * hurt, otherwise there is no reason ever to stop building.
 */
export function applyEconomy(state: GameState, dt: number): void {
  for (let p = 0 as PlayerId; p < 2; p = (p + 1) as PlayerId) {
    const player = state.players[p];
    player.incomeRate = incomeFor(state, p);
    player.upkeepRate = upkeepFor(state, p);
    player.cash += (player.incomeRate - player.upkeepRate) * dt;

    if (player.cash < 0) {
      const candidates = player.lines
        .filter((l) => l.trains > 0)
        .sort((a, b) => a.loadFactor - b.loadFactor || a.id - b.id);
      const victim = candidates[0];
      if (victim) {
        victim.trains -= 1;
        victim.investment = Math.max(0, victim.investment - PARAMS.TRAIN_COST);
        player.cash += PARAMS.TRAIN_COST * PARAMS.REFUND_RATE;
        state.netDirty[p] = true;
        pushEvent(state, p, `fire sale: train sold on Line ${victim.id + 1}`);
      } else {
        player.cash = 0; // nothing left to liquidate
      }
    }
  }
}

export function pushEvent(state: GameState, player: PlayerId | -1, text: string): void {
  state.events.push({ tick: state.tick, text, player });
  if (state.events.length > 24) state.events.splice(0, state.events.length - 24);
}
