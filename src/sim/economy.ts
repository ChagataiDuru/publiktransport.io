import { dist } from './map.ts';
import { PARAMS } from './params.ts';
import type { GameState, Id, PlayerId } from './types.ts';

/**
 * A seat builds cheaper on its own doorstep. This is the whole point of home
 * districts: it makes each player's natural opening a different corridor.
 */
function homeFactor(state: GameState, player: PlayerId, district: Id): number {
  return state.players[player]?.homeDistrict === district ? PARAMS.HOME_DISCOUNT : 1;
}

/** Track is priced by the land it crosses, so contested ground gets expensive. */
export function trackCost(state: GameState, player: PlayerId, a: Id, b: Id): number {
  const sa = state.stations[a];
  const sb = state.stations[b];
  const priceA = state.landValue[sa.neighborhood] * homeFactor(state, player, sa.neighborhood);
  const priceB = state.landValue[sb.neighborhood] * homeFactor(state, player, sb.neighborhood);
  return dist(sa.pos, sb.pos) * PARAMS.TRACK_COST_PER_UNIT * ((priceA + priceB) / 2);
}

export function stationCost(state: GameState, player: PlayerId, s: Id): number {
  const district = state.stations[s].neighborhood;
  return PARAMS.STATION_COST * state.landValue[district] * homeFactor(state, player, district);
}

/** Cost of laying a fresh line through this exact station sequence. */
export function createLineCost(state: GameState, player: PlayerId, stations: Id[]): number {
  let total = PARAMS.TRAIN_COST; // every new line ships with one train
  for (const s of stations) total += stationCost(state, player, s);
  for (let i = 0; i + 1 < stations.length; i++) {
    total += trackCost(state, player, stations[i], stations[i + 1]);
  }
  return total;
}

export function extendLineCost(state: GameState, player: PlayerId, from: Id, to: Id): number {
  return stationCost(state, player, to) + trackCost(state, player, from, to);
}

/**
 * Land value relaxes back toward 1.0. Without this, the first service into a
 * district raised its price permanently and the opening advantage compounded
 * for the rest of the match — see NOTES.md §5.
 */
export function decayLandValue(state: GameState, dt: number): void {
  const k = Math.min(1, PARAMS.LAND_VALUE_DECAY * dt);
  for (let i = 0; i < state.landValue.length; i++) {
    state.landValue[i] += (1 - state.landValue[i]) * k;
  }
}

/**
 * The transit authority tops up whoever is behind. Bounded and proportional to
 * the gap, so it shortens a runaway without ever handing the lead over.
 */
export function subsidyFor(state: GameState, player: PlayerId): number {
  let leader = 0;
  for (const other of state.players) if (other.cityShare > leader) leader = other.cityShare;
  const behindPoints = Math.max(0, leader - state.players[player].cityShare) * 100;
  return Math.min(PARAMS.SUBSIDY_MAX, PARAMS.SUBSIDY_PER_POINT * behindPoints);
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
  decayLandValue(state, dt);
  for (let p = 0; p < state.players.length; p++) {
    const player = state.players[p];
    player.incomeRate = incomeFor(state, p);
    player.upkeepRate = upkeepFor(state, p);
    player.subsidyRate = subsidyFor(state, p);
    player.cash += (player.incomeRate + player.subsidyRate - player.upkeepRate) * dt;

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
