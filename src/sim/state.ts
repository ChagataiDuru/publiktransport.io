import { applyCommand } from './commands.ts';
import { assignFlows, updateLoadFactors } from './crowding.ts';
import { buildOdMatrix, carTime, effectiveDemand } from './demand.ts';
import { applyEconomy, pushEvent } from './economy.ts';
import { buildEdges, buildNeighborhoods, buildStations } from './map.ts';
import { logitShares, lerpSplit } from './modechoice.ts';
import { buildRoutes } from './network.ts';
import { PARAMS } from './params.ts';
import { createRng, nextInt } from './rng.ts';
import type { Command, GameState, Player, PlayerId, RouteTable } from './types.ts';

function emptyRoutes(n: number): RouteTable {
  return {
    time: Array.from({ length: n }, () => new Array<number>(n).fill(Infinity)),
    path: Array.from({ length: n }, () => Array.from({ length: n }, () => [])),
    transfers: Array.from({ length: n }, () => new Array<number>(n).fill(0)),
  };
}

function makePlayer(id: PlayerId): Player {
  return {
    id,
    cash: PARAMS.STARTING_CASH,
    lines: [],
    score: 0,
    incomeRate: 0,
    upkeepRate: 0,
    cityShare: 0,
  };
}

export function createInitialState(seed: number, playerCount = 2): GameState {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4) {
    throw new RangeError('playerCount must be an integer from 2 to 4');
  }
  const stations = buildStations();
  const neighborhoods = buildNeighborhoods();
  const edges = buildEdges();
  const n = neighborhoods.length;
  const emptyShare = (): number[] => [1, ...new Array<number>(playerCount).fill(0)];
  for (const neighborhood of neighborhoods) neighborhood.share = emptyShare();

  const state: GameState = {
    tick: 0,
    seed,
    rng: createRng(seed),
    matchLengthTicks: Math.round(PARAMS.MATCH_SECONDS * PARAMS.TICK_HZ),
    phase: 'playing',
    players: Array.from({ length: playerCount }, (_, id) => makePlayer(id)),
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
  };

  return state;
}

/** The single entry point. Mutates and returns `state` for speed. */
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
      pushEvent(state, -1, `rush hour: ${state.neighborhoods[rush.neighborhood].name}`);
    }
    if (state.tick >= rush.endsAtTick) {
      state.rushHour = null;
      state.lastRushTick = state.tick;
    }
    return;
  }
  const due = state.lastRushTick + PARAMS.RUSH_INTERVAL * hz;
  if (state.tick >= due && state.tick > 0) {
    const nb = nextInt(state.rng, state.neighborhoods.length);
    const starts = state.tick + Math.round(PARAMS.RUSH_TELEGRAPH * hz);
    state.rushHour = {
      active: false,
      neighborhood: nb,
      telegraphedAtTick: state.tick,
      startsAtTick: starts,
      endsAtTick: starts + Math.round(PARAMS.RUSH_DURATION * hz),
    };
  }
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
      for (const s of l.stations) num(s);
      for (const f of l.segmentFlow) num(f);
    }
  }
  for (const tick of state.botLastDecisionTick) num(tick);
  if (state.rushHour) {
    num(state.rushHour.neighborhood);
    num(state.rushHour.startsAtTick);
    num(state.rushHour.endsAtTick);
    byte(state.rushHour.active ? 1 : 0);
  } else byte(200);

  return (h >>> 0).toString(16).padStart(8, '0');
}
