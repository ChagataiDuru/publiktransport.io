import { areAdjacent, freePlatforms, getAdjacency, validate } from '../sim/commands.ts';
import { createLineCost, extendLineCost } from '../sim/economy.ts';
import { dist } from '../sim/map.ts';
import { LIMITS, PARAMS } from '../sim/params.ts';
import { pressureList } from '../sim/pressure.ts';
import type { Command, GameState, Id, PlayerId } from '../sim/types.ts';

/**
 * Below this the extra frequency buys almost no rider time back but still
 * costs full upkeep, so piling on trains stops being the best move.
 */
const MIN_USEFUL_HEADWAY = 45;
/** Past this a line's own round-trip time hurts everyone already on it. */
const MAX_USEFUL_STOPS = 8;
/** More than this turns the bot into a map-painting machine rather than a rival. */
const MAX_STRATEGIC_LINES = 3;
/** How much the discount on home ground is worth when ranking targets. */
const HOME_BIAS = 1.35;

/**
 * Deterministic greedy opponent — no RNG anywhere, so a seeded match replays
 * identically and the tests stay meaningful.
 */
export function decide(state: GameState, p: PlayerId): Command[] {
  if (state.phase !== 'playing') return [];
  if (state.tick < PARAMS.BOT_OPENING_DELAY * PARAMS.TICK_HZ) return [];
  const player = state.players[p];

  const tacticalLine = player.lines
    .filter((line) => line.loadFactor > 0.9)
    .sort((a, b) => b.loadFactor - a.loadFactor || a.id - b.id)[0];
  const strategicMoment =
    state.civicContract?.phase === 'active' ||
    Boolean(state.rushHour?.active) ||
    Boolean(state.finalMandate?.active);
  if (
    tacticalLine &&
    (strategicMoment || tacticalLine.loadFactor > 1.3) &&
    player.cash > PARAMS.RAPID_DISPATCH_COST * 2
  ) {
    const dispatch: Command = { type: 'DispatchRapidService', player: p, line: tacticalLine.id };
    if (validate(state, dispatch).ok) return [dispatch];
  }

  const expressCandidate = player.lines
    .filter(
      (line) =>
        line.servicePlan === 'local' &&
        line.stations.length >= PARAMS.EXPRESS_MIN_STATIONS &&
        line.loadFactor > 0.75,
    )
    .sort((a, b) => b.stations.length - a.stations.length || a.id - b.id)[0];
  if (strategicMoment && expressCandidate) {
    const express: Command = {
      type: 'SetServicePlan',
      player: p,
      line: expressCandidate.id,
      servicePlan: 'express',
    };
    if (validate(state, express).ok) return [express];
  }

  // 1. Only a genuinely overloaded line interrupts expansion. The old 85%
  // threshold made the bot spend almost every dollar on trains and left the
  // outer map idle.
  const critical = player.lines
    .filter((l) => l.loadFactor > 1.15)
    .sort((a, b) => b.loadFactor - a.loadFactor || a.id - b.id)[0];
  if (critical && player.cash > PARAMS.TRAIN_COST * 2) {
    return [{ type: 'BuyTrain', player: p, line: critical.id }];
  }

  // 2. Otherwise chase the biggest pile of people still stuck in cars. Build
  // a second or third service before polishing the frequency of the first.
  const targets = rankedTargets(state, p).slice(0, 8);
  if (player.lines.length < MAX_STRATEGIC_LINES) {
    for (const target of targets) {
      const create = tryCreate(state, p, target.i, target.j);
      if (create.length > 0) return create;
    }
  }

  // 3. Extend into unmet demand once a fresh route is not affordable/buildable.
  // The best pair is often blocked by platforms or price, so walk the ranking
  // instead of stalling on it.
  for (const target of targets) {
    const extend = tryExtend(state, p, target.i, target.j);
    if (extend.length > 0) return extend;

    const create = tryCreate(state, p, target.i, target.j);
    if (create.length > 0) return create;
  }

  // 4. Improve a merely busy service after expansion options are exhausted.
  const busy = player.lines
    .filter((l) => l.loadFactor > 0.85 && l.headway > MIN_USEFUL_HEADWAY)
    .sort((a, b) => b.loadFactor - a.loadFactor || b.headway - a.headway || a.id - b.id)[0];
  if (busy && player.cash > PARAMS.TRAIN_COST * 2) {
    return [{ type: 'BuyTrain', player: p, line: busy.id }];
  }

  // 5. Nothing affordable yet — bank the fare box.
  return [];
}

interface Pair {
  i: Id;
  j: Id;
  value: number;
}

/**
 * The shared unmet-demand ranking, tilted toward this seat's home district.
 * Building on your own doorstep is cheaper (HOME_DISCOUNT), so the bot should
 * want it too — otherwise all four seats converge on the same middle corridors.
 */
function rankedTargets(state: GameState, p: PlayerId): Pair[] {
  const home = state.players[p].homeDistrict;
  const contract = state.civicContract;
  const mandate = state.finalMandate;
  return pressureList(state, p).map((entry) => ({
    i: entry.i,
    j: entry.j,
    value:
      entry.value *
      (entry.i === home || entry.j === home ? HOME_BIAS : 1) *
      (contract &&
      (entry.i === contract.originId || entry.j === contract.originId) &&
      (entry.i === contract.destinationId || entry.j === contract.destinationId)
        ? 2.5
        : 1) *
      (mandate &&
      (entry.i === mandate.originId || entry.j === mandate.originId) &&
      (entry.i === mandate.destinationId || entry.j === mandate.destinationId)
        ? 3
        : 1),
  })).sort((a, b) => b.value - a.value || a.i - b.i || a.j - b.j);
}

/** Cheapest usable station in a district, preferring hubs with room to spare. */
function entryStation(state: GameState, nb: Id, exclude: Set<Id>): Id | null {
  const c = state.neighborhoods[nb].centroid;
  let best: Id | null = null;
  let bestKey = Infinity;
  for (const s of state.stations) {
    if (s.neighborhood !== nb) continue;
    if (exclude.has(s.id)) continue;
    if (freePlatforms(state, s.id) < 1) continue;
    const key = dist(s.pos, c) - (s.isHub ? 60 : 0);
    if (key < bestKey) {
      bestKey = key;
      best = s.id;
    }
  }
  return best;
}

/** Shortest corridor path between two stations, weighted by track distance. */
function mapPath(state: GameState, from: Id, to: Id, requireFreePlatforms: boolean): Id[] {
  const adj = getAdjacency(state);
  const n = state.stations.length;
  const d = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  d[from] = 0;

  for (;;) {
    let u = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && d[i] < bestD) {
        bestD = d[i];
        u = i;
      }
    }
    if (u < 0) break;
    if (u === to) break;
    done[u] = 1;
    for (const v of adj[u]) {
      if (requireFreePlatforms && v !== to && freePlatforms(state, v) < 1) continue;
      const w = dist(state.stations[u].pos, state.stations[v].pos);
      if (d[u] + w < d[v]) {
        d[v] = d[u] + w;
        prev[v] = u;
      }
    }
  }

  if (!isFinite(d[to])) return [];
  const out: Id[] = [];
  for (let cur = to; cur >= 0; cur = prev[cur]) out.push(cur);
  return out.reverse();
}

/**
 * The two districts with the most drivers are often neighbours, so the direct
 * corridor between them is a single hop — too short to be a line. Grow it out
 * of the tail end toward whichever adjacent district adds the most population.
 */
function padPath(state: GameState, path: Id[], minLen: number): Id[] {
  if (path.length === 0) return path;
  const adj = getAdjacency(state);
  const out = [...path];
  const covered = new Set(out.map((s) => state.stations[s].neighborhood));

  while (out.length < minLen) {
    let bestS: Id | null = null;
    let bestKey = -Infinity;
    let atHead = false;
    for (const head of [false, true]) {
      const end = head ? out[0] : out[out.length - 1];
      for (const v of adj[end]) {
        if (out.includes(v) || freePlatforms(state, v) < 1) continue;
        const nb = state.stations[v].neighborhood;
        const gain = covered.has(nb) ? 0 : state.neighborhoods[nb].population;
        const key = gain - dist(state.stations[end].pos, state.stations[v].pos);
        if (key > bestKey) {
          bestKey = key;
          bestS = v;
          atHead = head;
        }
      }
    }
    if (bestS === null) break;
    if (atHead) out.unshift(bestS);
    else out.push(bestS);
    covered.add(state.stations[bestS].neighborhood);
  }
  return out;
}

/** Can one of my lines reach the target district with two stops or fewer? */
function tryExtend(state: GameState, p: PlayerId, i: Id, j: Id): Command[] {
  const player = state.players[p];
  const budget = player.cash / Math.max(0.01, PARAMS.BOT_COST_DISCOUNT);

  let best: { cmds: Command[]; cost: number } | null = null;

  for (const line of player.lines) {
    if (line.stations.length >= Math.min(LIMITS.MAX_LINE_STATIONS, MAX_USEFUL_STOPS)) continue;
    const served = new Set(line.stations.map((s) => state.stations[s].neighborhood));
    // Aim at whichever end of the pair this line does not already touch.
    const goals = [i, j].filter((nb) => !served.has(nb));
    if (goals.length === 0) continue;

    for (const end of ['head', 'tail'] as const) {
      const anchor = end === 'head' ? line.stations[0] : line.stations[line.stations.length - 1];
      for (const goal of goals) {
        const dest = entryStation(state, goal, new Set(line.stations));
        if (dest === null) continue;
        const path = mapPath(state, anchor, dest, true);
        if (path.length < 2 || path.length > 3) continue; // at most two new stops

        const cmds: Command[] = [];
        let cost = 0;
        let ok = true;
        let prev = anchor;
        for (let k = 1; k < path.length; k++) {
          const s = path[k];
          if (line.stations.includes(s) || freePlatforms(state, s) < 1 || !areAdjacent(state, prev, s)) {
            ok = false;
            break;
          }
          cost += extendLineCost(state, p, prev, s);
          cmds.push({ type: 'ExtendLine', player: p, line: line.id, station: s, end });
          prev = s;
        }
        if (!ok || cost > budget) continue;
        if (!best || cost < best.cost) best = { cmds, cost };
      }
    }
  }

  if (!best) return [];
  // Only the first hop can be validated against today's state; the rest are
  // emitted together and simply drop if the ground shifts underneath them.
  return validate(state, best.cmds[0]).ok ? best.cmds : [];
}

function tryCreate(state: GameState, p: PlayerId, i: Id, j: Id): Command[] {
  const player = state.players[p];
  if (player.lines.length >= LIMITS.MAX_LINES) return [];
  const budget = player.cash / Math.max(0.01, PARAMS.BOT_COST_DISCOUNT);

  const from = entryStation(state, i, new Set());
  const to = entryStation(state, j, new Set());
  if (from === null || to === null) return [];

  const path = padPath(state, mapPath(state, from, to, true), 5);
  if (path.length < 3) return [];

  // Walk out along the corridor as far as the wallet allows, 5 stops max.
  let chosen: Id[] = [];
  for (let len = Math.min(5, path.length); len >= 3; len--) {
    const candidate = path.slice(0, len);
    const cmd: Command = { type: 'CreateLine', player: p, stations: candidate };
    if (!validate(state, cmd).ok) continue;
    if (createLineCost(state, p, candidate) > budget) continue;
    chosen = candidate;
    break;
  }
  if (chosen.length === 0) return [];
  return [{ type: 'CreateLine', player: p, stations: chosen }];
}
