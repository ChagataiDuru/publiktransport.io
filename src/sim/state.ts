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

export function createInitialState(seed: number): GameState {
  const stations = buildStations();
  const neighborhoods = buildNeighborhoods();
  const edges = buildEdges();
  const n = neighborhoods.length;

  const state: GameState = {
    tick: 0,
    seed,
    rng: createRng(seed),
    matchLengthTicks: Math.round(PARAMS.MATCH_SECONDS * PARAMS.TICK_HZ),
    phase: 'playing',
    players: [makePlayer(0), makePlayer(1)],
    stations,
    neighborhoods,
    edges,
    landValue: new Array<number>(n).fill(1),
    odMatrix: buildOdMatrix(neighborhoods),
    odShare: Array.from({ length: n }, () =>
      Array.from({ length: n }, () => [1, 0, 0] as [number, number, number]),
    ),
    rushHour: null,
    lastRushTick: 0,
    platformUsage: new Array<number>(stations.length).fill(0),
    routes: [emptyRoutes(n), emptyRoutes(n)],
    netDirty: [true, true],
    nextLineId: 0,
    totalPopulation: neighborhoods.reduce((a, b) => a + b.population, 0),
    cityShare: [1, 0, 0],
    botLastDecisionTick: -1e9,
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
  for (let p = 0 as PlayerId; p < 2; p = (p + 1) as PlayerId) {
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
    state.routes[0] = buildRoutes(state, 0);
    state.routes[1] = buildRoutes(state, 1);
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
  const r0 = state.routes[0];
  const r1 = state.routes[1];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const share = state.odShare[i][j];
      const ct = carTime(state, i, j, share[0]);
      const target = logitShares(ct, r0.time[i][j], r1.time[i][j]);
      lerpSplit(share, target, PARAMS.SHARE_LERP);
    }
  }
}

function updateScores(state: GameState): void {
  const n = state.neighborhoods.length;
  let cityCar = 0;
  let city1 = 0;
  let city2 = 0;
  let score1 = 0;
  let score2 = 0;

  for (let i = 0; i < n; i++) {
    let w = 0;
    let car = 0;
    let p1 = 0;
    let p2 = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = effectiveDemand(state, i, j);
      if (d <= 0) continue;
      const s = state.odShare[i][j];
      w += d;
      car += d * s[0];
      p1 += d * s[1];
      p2 += d * s[2];
    }
    const nb = state.neighborhoods[i];
    if (w > 0) nb.share = [car / w, p1 / w, p2 / w];
    cityCar += nb.population * nb.share[0];
    city1 += nb.population * nb.share[1];
    city2 += nb.population * nb.share[2];
    score1 += nb.population * nb.share[1];
    score2 += nb.population * nb.share[2];
  }

  const total = state.totalPopulation || 1;
  state.cityShare = [cityCar / total, city1 / total, city2 / total];
  state.players[0].score = score1;
  state.players[1].score = score2;
  state.players[0].cityShare = city1 / total;
  state.players[1].cityShare = city2 / total;
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
  byte(state.phase === 'ended' ? 1 : 0);
  for (const v of state.landValue) num(v);
  for (const v of state.platformUsage) num(v);
  for (const row of state.odShare) for (const s of row) { num(s[0]); num(s[1]); num(s[2]); }
  for (const nb of state.neighborhoods) { num(nb.share[0]); num(nb.share[1]); num(nb.share[2]); }
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
  if (state.rushHour) {
    num(state.rushHour.neighborhood);
    num(state.rushHour.startsAtTick);
    num(state.rushHour.endsAtTick);
    byte(state.rushHour.active ? 1 : 0);
  } else byte(200);

  return (h >>> 0).toString(16).padStart(8, '0');
}
