import { applyCommand } from './commands.ts';
import { assignFlows, updateLoadFactors } from './crowding.ts';
import { buildOdMatrix, carTime, effectiveDemand } from './demand.ts';
import { applyEconomy, createLineCost, pushEvent } from './economy.ts';
import {
  buildDistrictAdjacency,
  buildEdges,
  buildNeighborhoods,
  buildStations,
} from './map.ts';
import { defaultMapId, getMap, isMapId, type MapId } from './maps.ts';
import { logitShares, lerpSplit } from './modechoice.ts';
import { buildRoutes } from './network.ts';
import { pushGameEvent } from './events.ts';
import { updateGameplay } from './gameplay.ts';
import { PARAMS } from './params.ts';
import { createRng, nextInt } from './rng.ts';
import type { Command, GameState, Id, MapEdge, Player, PlayerId, RouteTable } from './types.ts';

function emptyRoutes(n: number): RouteTable {
  return {
    time: Array.from({ length: n }, () => new Array<number>(n).fill(Infinity)),
    path: Array.from({ length: n }, () => Array.from({ length: n }, () => [])),
    transfers: Array.from({ length: n }, () => new Array<number>(n).fill(0)),
  };
}

function makePlayer(id: PlayerId, homeDistrict: Id): Player {
  return {
    id,
    cash: PARAMS.STARTING_CASH,
    lines: [],
    score: 0,
    incomeRate: 0,
    upkeepRate: 0,
    subsidyRate: 0,
    dispatchReadyAtTick: 0,
    cityShare: 0,
    homeDistrict,
  };
}

export interface InitOptions {
  /**
   * Every seat opens with a free two-stop stub in its home district. Tests that
   * assert on a bare map turn this off; the game never does.
   */
  starterLines?: boolean;
  /** Explicit development/test override. Invalid values safely fall back by player count. */
  mapId?: MapId | string;
}

export function createInitialState(
  seed: number,
  playerCount = 2,
  options: InitOptions = {},
): GameState {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4) {
    throw new RangeError('playerCount must be an integer from 2 to 4');
  }
  const requestedMap = options.mapId;
  const map = getMap(isMapId(requestedMap) ? requestedMap : defaultMapId(playerCount));
  const stations = buildStations(map);
  const neighborhoods = buildNeighborhoods(map);
  const edges = buildEdges(map);
  const n = neighborhoods.length;
  const emptyShare = (): number[] => [1, ...new Array<number>(playerCount).fill(0)];
  for (const neighborhood of neighborhoods) neighborhood.share = emptyShare();

  const state: GameState = {
    tick: 0,
    seed,
    mapId: map.id,
    worldWidth: map.worldWidth,
    worldHeight: map.worldHeight,
    rng: createRng(seed),
    matchLengthTicks: Math.round((map.tuning?.matchSeconds ?? PARAMS.MATCH_SECONDS) * PARAMS.TICK_HZ),
    phase: 'playing',
    players: Array.from({ length: playerCount }, (_, id) =>
      makePlayer(id, map.homeSeats[id % map.homeSeats.length].district)),
    stations,
    neighborhoods,
    edges,
    landValue: new Array<number>(n).fill(1),
    odMatrix: buildOdMatrix(neighborhoods),
    odShare: Array.from({ length: n }, () => Array.from({ length: n }, emptyShare)),
    rushHour: null,
    lastRushTick: 0,
    platformUsage: new Array<number>(stations.length).fill(0),
    routes: Array.from({ length: playerCount }, () => emptyRoutes(n)),
    netDirty: new Array<boolean>(playerCount).fill(true),
    nextLineId: 0,
    totalPopulation: neighborhoods.reduce((a, b) => a + b.population, 0),
    cityShare: emptyShare(),
    botLastDecisionTick: new Array<number>(playerCount).fill(-1e9),
    events: [],
    nextEventId: 1,
    civicContract: null,
    nextContractTick: Math.round(PARAMS.CIVIC_CONTRACT_FIRST_DELAY * PARAMS.TICK_HZ),
    nextContractId: 1,
    finalMandate: null,
    districtLeaders: new Array<number>(n).fill(-1),
  };

  // The classic seats intentionally retain their historical catchment
  // compensation. Greater Publik City is reflectively balanced in geometry and
  // starts all four seats equally rather than hiding bias with seat bonuses.
  if (map.id === 'classic') balanceOpeningCash(state);
  if (options.starterLines !== false) grantStarterLines(state, map);
  return state;
}

/**
 * Home districts are not equally good — Foundry's catchment is half Exchange's.
 * A seat drawing a weaker home opens with proportionally more cash, so the
 * draw shapes the opening without deciding the match.
 */
function balanceOpeningCash(state: GameState): void {
  const adjacency = getDistrictAdjacency(state);
  const weight = (district: Id): number => {
    let total = state.neighborhoods[district].population;
    for (const other of adjacency[district] ?? []) {
      total += 0.5 * state.neighborhoods[other].population;
    }
    return total;
  };
  const weights = state.players.map((player) => weight(player.homeDistrict));
  const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
  for (const player of state.players) {
    const ratio = Math.pow(mean / weights[player.id], PARAMS.HOME_COMPENSATION);
    player.cash = PARAMS.STARTING_CASH * Math.max(0.85, Math.min(1.6, ratio));
  }
}

/**
 * Hand each seat the stub line in its home district, free. It is granted through
 * the ordinary command path — platform locks, land value and refunds all behave
 * exactly as if the player had built it — the money is simply advanced first.
 */
function grantStarterLines(state: GameState, map = getMap(state.mapId)): void {
  for (const player of state.players) {
    const stations = map.homeSeats[player.id % map.homeSeats.length].starter;
    player.cash += createLineCost(state, player.id, [...stations]);
    applyCommand(state, { type: 'CreateLine', player: player.id, stations: [...stations] });
  }
  state.events.length = 0;
}
export function tick(state: GameState, commands: Command[]): GameState {
  if (state.phase === 'ended') return state;

  const dt = 1 / PARAMS.TICK_HZ;

  // 5.1 — commands
  for (const cmd of commands) applyCommand(state, cmd);

  // 5.2 — rebuild the route tables when a network changed, so the HUD and the
  // preview react to a build on the very next frame.
  for (let p = 0; p < state.players.length; p++) {
    if (state.netDirty[p]) {
      state.routes[p] = buildRoutes(state, p);
      state.netDirty[p] = false;
    }
  }

  // 5.7 — rush hour schedule
  updateRushHour(state);

  // 5.3 / 5.4 / 5.8 — the heavy cycle
  const period = Math.max(1, Math.round(PARAMS.TICK_HZ / PARAMS.DEMAND_RECALC_HZ));
  if (state.tick % period === 0) {
    for (let p = 0; p < state.players.length; p++) state.routes[p] = buildRoutes(state, p);
    updateModeChoice(state);
    assignFlows(state);
    updateLoadFactors(state);
    updateScores(state);
    updateGameplay(state);
  }

  // 5.5 — economy
  applyEconomy(state, dt);

  state.tick += 1;
  if (state.tick >= state.matchLengthTicks) {
    state.phase = 'ended';
    pushEvent(state, -1, 'match over');
  }
  return state;
}

function updateRushHour(state: GameState): void {
  const hz = PARAMS.TICK_HZ;
  const rush = state.rushHour;
  if (rush) {
    if (!rush.active && state.tick >= rush.startsAtTick) {
      rush.active = true;
      pushGameEvent(state, {
        kind: 'rushStarted',
        player: -1,
        originId: rush.neighborhood,
        destinationId: rush.secondary,
      });
    }
    if (state.tick >= rush.endsAtTick) {
      state.rushHour = null;
      state.lastRushTick = state.tick;
    }
    return;
  }
  const due = state.lastRushTick + PARAMS.RUSH_INTERVAL * hz;
  if (state.tick >= due && state.tick > 0) {
    const nb = pickRushDistrict(state);
    const starts = state.tick + Math.round(PARAMS.RUSH_TELEGRAPH * hz);
    state.rushHour = {
      active: false,
      neighborhood: nb,
      secondary: pickRushNeighbour(state, nb),
      telegraphedAtTick: state.tick,
      startsAtTick: starts,
      endsAtTick: starts + Math.round(PARAMS.RUSH_DURATION * hz),
    };
  }
}

const districtAdjacencyCache = new WeakMap<MapEdge[], Id[][]>();

export function getDistrictAdjacency(state: GameState): Id[][] {
  const cached = districtAdjacencyCache.get(state.edges);
  if (cached) return cached;
  const adj = buildDistrictAdjacency(state.stations, state.neighborhoods.length, state.edges);
  districtAdjacencyCache.set(state.edges, adj);
  return adj;
}

/**
 * Rush hour lands on one of the districts still most stuck in cars, drawn at
 * random from the worst few. Surging a district somebody already serves well
 * just pays the leader; surging one nobody serves is an opening.
 */
function pickRushDistrict(state: GameState): Id {
  const ranked = state.neighborhoods
    .map((nb) => ({ id: nb.id, weight: nb.population * nb.share[0] }))
    .sort((a, b) => b.weight - a.weight || a.id - b.id);
  const pool = ranked.slice(0, Math.max(1, Math.round(PARAMS.RUSH_CANDIDATES)));
  return pool[nextInt(state.rng, pool.length)].id;
}

/** The neighbour that trades the most trips with it, so the surge is a corridor. */
function pickRushNeighbour(state: GameState, nb: Id): Id {
  let best = -1;
  let bestFlow = 0;
  for (const other of getDistrictAdjacency(state)[nb] ?? []) {
    const flow = state.odMatrix[nb][other] + state.odMatrix[other][nb];
    if (flow > bestFlow) {
      bestFlow = flow;
      best = other;
    }
  }
  return best;
}

function updateModeChoice(state: GameState): void {
  const n = state.neighborhoods.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const share = state.odShare[i][j];
      const ct = carTime(state, i, j, share[0]);
      const target = logitShares(ct, ...state.routes.map((route) => route.time[i][j]));
      lerpSplit(share, target, PARAMS.SHARE_LERP);
    }
  }
}

function updateScores(state: GameState): void {
  const n = state.neighborhoods.length;
  let cityCar = 0;
  const city = new Array<number>(state.players.length).fill(0);
  const scores = new Array<number>(state.players.length).fill(0);

  for (let i = 0; i < n; i++) {
    let w = 0;
    let car = 0;
    const playerShares = new Array<number>(state.players.length).fill(0);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = effectiveDemand(state, i, j);
      if (d <= 0) continue;
      const s = state.odShare[i][j];
      w += d;
      car += d * s[0];
      for (let p = 0; p < state.players.length; p++) playerShares[p] += d * s[p + 1];
    }
    const nb = state.neighborhoods[i];
    if (w > 0) nb.share = [car / w, ...playerShares.map((share) => share / w)];
    cityCar += nb.population * nb.share[0];
    for (let p = 0; p < state.players.length; p++) {
      city[p] += nb.population * nb.share[p + 1];
      scores[p] += nb.population * nb.share[p + 1];
    }
  }

  const total = state.totalPopulation || 1;
  state.cityShare = [cityCar / total, ...city.map((value) => value / total)];
  for (let p = 0; p < state.players.length; p++) {
    state.players[p].score = scores[p];
    state.players[p].cityShare = city[p] / total;
  }
}

export function secondsLeft(state: GameState): number {
  return Math.max(0, (state.matchLengthTicks - state.tick) / PARAMS.TICK_HZ);
}

// ---------------------------------------------------------------------------
// Determinism hash — folds every mutable number into an FNV-1a digest.
// ---------------------------------------------------------------------------

const scratch = new Float64Array(1);
const scratchU32 = new Uint32Array(scratch.buffer);

export function hashState(state: GameState): string {
  let h = 0x811c9dc5;
  const byte = (b: number): void => {
    h ^= b & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const num = (v: number): void => {
    if (!isFinite(v)) {
      byte(v > 0 ? 254 : 253);
      return;
    }
    scratch[0] = v;
    const lo = scratchU32[0];
    const hi = scratchU32[1];
    byte(lo);
    byte(lo >>> 8);
    byte(lo >>> 16);
    byte(lo >>> 24);
    byte(hi);
    byte(hi >>> 8);
    byte(hi >>> 16);
    byte(hi >>> 24);
  };

  num(state.tick);
  for (let i = 0; i < state.mapId.length; i++) byte(state.mapId.charCodeAt(i));
  num(state.worldWidth);
  num(state.worldHeight);
  num(state.rng.s);
  num(state.players.length);
  byte(state.phase === 'ended' ? 1 : 0);
  for (const v of state.landValue) num(v);
  for (const v of state.platformUsage) num(v);
  for (const row of state.odShare) for (const split of row) for (const value of split) num(value);
  for (const neighborhood of state.neighborhoods) for (const value of neighborhood.share) num(value);
  for (const p of state.players) {
    num(p.cash);
    num(p.score);
    num(p.incomeRate);
    num(p.upkeepRate);
    for (const l of p.lines) {
      num(l.id);
      num(l.trains);
      num(l.roundTripTime);
      num(l.headway);
      num(l.loadFactor);
      num(l.ridership);
      num(l.dispatchEndsAtTick);
      byte(l.servicePlan === 'express' ? 1 : 0);
      for (const s of l.stations) num(s);
      for (const f of l.segmentFlow) num(f);
    }
  }
  for (const tick of state.botLastDecisionTick) num(tick);
  num(state.nextEventId);
  num(state.nextContractTick);
  num(state.nextContractId);
  for (const leader of state.districtLeaders) num(leader);
  if (state.civicContract) {
    num(state.civicContract.id);
    num(state.civicContract.originId);
    num(state.civicContract.destinationId);
    num(state.civicContract.startsAtTick);
    num(state.civicContract.endsAtTick);
    num(state.civicContract.winner ?? -1);
    for (const value of state.civicContract.baselineShares) num(value);
    for (const value of state.civicContract.currentGains) num(value);
  } else byte(201);
  if (state.finalMandate) {
    num(state.finalMandate.originId);
    num(state.finalMandate.destinationId);
    num(state.finalMandate.startsAtTick);
    byte(state.finalMandate.active ? 1 : 0);
  } else byte(202);
  if (state.rushHour) {
    num(state.rushHour.neighborhood);
    num(state.rushHour.secondary);
    num(state.rushHour.startsAtTick);
    num(state.rushHour.endsAtTick);
    byte(state.rushHour.active ? 1 : 0);
  } else byte(200);

  return (h >>> 0).toString(16).padStart(8, '0');
}
