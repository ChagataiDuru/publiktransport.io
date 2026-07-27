import { dist } from './map.ts';
import { LIMITS, PARAMS } from './params.ts';
import type { GameState, Id, Line, PathHop, PlayerId, RouteTable, Station } from './types.ts';

/** Recompute the values derived purely from a line's shape and train count. */
export function updateLineDerived(stations: Station[], line: Line): void {
  let length = 0;
  for (let i = 0; i + 1 < line.stations.length; i++) {
    length += dist(stations[line.stations[i]].pos, stations[line.stations[i + 1]].pos);
  }
  line.trackLength = length;
  const servedStops =
    line.servicePlan === 'express'
      ? getServiceStops(line, stations).length
      : line.stations.length;
  const runTime = length / PARAMS.TRAIN_SPEED + servedStops * PARAMS.STATION_DWELL;
  line.roundTripTime = Math.max(1, 2 * runTime);
  // A line with no trains runs no service at all rather than an infinitely
  // fast one — buying a train back revives it.
  const trains = effectiveTrainCount(line);
  line.headway = trains > 0 ? line.roundTripTime / trains : Infinity;
  if (line.segmentFlow.length !== Math.max(0, line.stations.length - 1)) {
    line.segmentFlow = new Array<number>(Math.max(0, line.stations.length - 1)).fill(0);
  }
}

export function effectiveTrainCount(line: Line): number {
  return line.trains + (line.dispatchEndsAtTick > 0 ? PARAMS.RAPID_DISPATCH_EXTRA_TRAINS : 0);
}

/** Endpoints, hubs and alternating intermediate stops form a stable express pattern. */
export function getServiceStops(line: Line, stations: Station[]): Id[] {
  if (line.servicePlan === 'local') return [...line.stations];
  return line.stations.filter(
    (stationId, index) =>
      index === 0 ||
      index === line.stations.length - 1 ||
      stations[stationId].isHub ||
      index % 2 === 0,
  );
}

export function lineServesStation(line: Line, station: Id, stations: Station[]): boolean {
  return getServiceStops(line, stations).includes(station);
}

/**
 * Crowding multiplier applied to every cost belonging to an over-capacity line.
 * Above 100% load the line starts to look slow to passengers, so the leader is
 * forced to stop expanding and buy trains instead. Anti-snowball valve #1.
 */
export function crowdPenalty(line: Line): number {
  if (line.loadFactor <= 1) return 1;
  return 1 + (line.loadFactor - 1) * PARAMS.CROWD_PENALTY_K;
}

export function lineCapacityPerHour(line: Line): number {
  const trains = effectiveTrainCount(line);
  if (trains <= 0 || line.roundTripTime <= 0) return 0;
  return trains * PARAMS.TRAIN_CAPACITY * (3600 / line.roundTripTime);
}

// ---------------------------------------------------------------------------
// Walk distance table — static, derived only from the (immutable) map.
// ---------------------------------------------------------------------------

const walkCache = new WeakMap<Station[], number[][]>();

/** walkDist[neighborhoodId][stationId], plus stations pre-sorted by proximity. */
function walkDistances(state: GameState): number[][] {
  const cached = walkCache.get(state.stations);
  if (cached) return cached;
  const table = state.neighborhoods.map((n) => state.stations.map((s) => dist(n.centroid, s.pos)));
  walkCache.set(state.stations, table);
  return table;
}

const orderCache = new WeakMap<Station[], number[][]>();

function stationsByProximity(state: GameState): number[][] {
  const cached = orderCache.get(state.stations);
  if (cached) return cached;
  const table = walkDistances(state);
  const order = state.neighborhoods.map((n) => {
    const ids = state.stations.map((s) => s.id);
    ids.sort((a, b) => table[n.id][a] - table[n.id][b] || a - b);
    return ids;
  });
  orderCache.set(state.stations, order);
  return order;
}

// ---------------------------------------------------------------------------
// Binary min-heap keyed by float cost, carrying an int payload.
// ---------------------------------------------------------------------------

class MinHeap {
  private key: number[] = [];
  private val: number[] = [];

  get size(): number {
    return this.val.length;
  }

  push(k: number, v: number): void {
    this.key.push(k);
    this.val.push(v);
    let i = this.val.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key[p] <= this.key[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.val[0];
    const lastK = this.key.pop()!;
    const lastV = this.val.pop()!;
    if (this.val.length > 0) {
      this.key[0] = lastK;
      this.val[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.val.length && this.key[l] < this.key[m]) m = l;
        if (r < this.val.length && this.key[r] < this.key[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const k = this.key[a];
    this.key[a] = this.key[b];
    this.key[b] = k;
    const v = this.val[a];
    this.val[a] = this.val[b];
    this.val[b] = v;
  }
}

// ---------------------------------------------------------------------------
// Line-expanded graph
// ---------------------------------------------------------------------------

interface Expanded {
  count: number;
  /** node -> station id */
  station: number[];
  /** node -> index into player's lines array */
  lineIdx: number[];
  /** node -> position within that line's station list */
  pos: number[];
  /** stationId -> nodes sitting at it */
  atStation: number[][];
  /** node -> [neighbourNode, cost, kind] triples flattened */
  edgeTo: number[][];
  edgeCost: number[][];
  edgeKind: number[][]; // 1 = ride, 2 = transfer
}

const KIND_RIDE = 1;
const KIND_TRANSFER = 2;

function expand(state: GameState, lines: Line[]): Expanded {
  const g: Expanded = {
    count: 0,
    station: [],
    lineIdx: [],
    pos: [],
    atStation: state.stations.map(() => []),
    edgeTo: [],
    edgeCost: [],
    edgeKind: [],
  };
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const served = new Set(getServiceStops(line, state.stations));
    for (let p = 0; p < line.stations.length; p++) {
      const id = g.count++;
      g.station.push(line.stations[p]);
      g.lineIdx.push(li);
      g.pos.push(p);
      if (served.has(line.stations[p])) g.atStation[line.stations[p]].push(id);
      g.edgeTo.push([]);
      g.edgeCost.push([]);
      g.edgeKind.push([]);
    }
  }

  const link = (a: number, b: number, cost: number, kind: number): void => {
    g.edgeTo[a].push(b);
    g.edgeCost[a].push(cost);
    g.edgeKind[a].push(kind);
  };

  // In-vehicle: consecutive stops on the same line, both directions.
  let base = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const pen = crowdPenalty(line);
    for (let p = 0; p + 1 < line.stations.length; p++) {
      const a = base + p;
      const b = base + p + 1;
      const dwell = lineServesStation(line, line.stations[p + 1], state.stations)
        ? PARAMS.STATION_DWELL
        : 0;
      const ride =
        (dist(state.stations[line.stations[p]].pos, state.stations[line.stations[p + 1]].pos) /
          PARAMS.TRAIN_SPEED +
          dwell) *
        pen;
      link(a, b, ride, KIND_RIDE);
      link(b, a, ride, KIND_RIDE);
    }
    base += line.stations.length;
  }

  // Transfer: between two different lines calling at the same station.
  for (let s = 0; s < g.atStation.length; s++) {
    const here = g.atStation[s];
    if (here.length < 2) continue;
    for (const a of here) {
      for (const b of here) {
        if (a === b) continue;
        if (g.lineIdx[a] === g.lineIdx[b]) continue;
        const target = lines[g.lineIdx[b]];
        const cost = PARAMS.TRANSFER_PENALTY + (target.headway / 2) * crowdPenalty(target);
        link(a, b, cost, KIND_TRANSFER);
      }
    }
  }

  return g;
}

/** The player's nearest ACCESS_STATIONS served stations within MAX_WALK_TIME. */
function accessStations(state: GameState, g: Expanded, nb: Id): { station: Id; walk: number }[] {
  const order = stationsByProximity(state)[nb];
  const table = walkDistances(state)[nb];
  const out: { station: Id; walk: number }[] = [];
  for (const s of order) {
    if (g.atStation[s].length === 0) continue;
    const walk = table[s] / PARAMS.WALK_SPEED;
    if (walk > PARAMS.MAX_WALK_TIME) break;
    out.push({ station: s, walk });
    if (out.length >= LIMITS.ACCESS_STATIONS) break;
  }
  return out;
}

function emptyRouteTable(n: number): RouteTable {
  return {
    time: Array.from({ length: n }, () => new Array<number>(n).fill(Infinity)),
    path: Array.from({ length: n }, () => Array.from({ length: n }, () => [] as PathHop[])),
    transfers: Array.from({ length: n }, () => new Array<number>(n).fill(0)),
  };
}

/**
 * Door-to-door travel times for one player: walk + wait + ride + transfers.
 * One Dijkstra per origin neighborhood over the line-expanded graph — about
 * 14 runs across <=216 nodes, which is microseconds. (Deliberately not
 * Floyd-Warshall: 216^3 would stall the frame every time a line changes.)
 */
export function buildRoutes(state: GameState, player: PlayerId): RouteTable {
  const n = state.neighborhoods.length;
  const rt = emptyRouteTable(n);
  const lines = state.players[player].lines;
  if (lines.length === 0) return rt;

  const g = expand(state, lines);
  if (g.count === 0) return rt;

  const access: { station: Id; walk: number }[][] = [];
  for (let nb = 0; nb < n; nb++) access.push(accessStations(state, g, nb));

  const distArr = new Float64Array(g.count);
  const prev = new Int32Array(g.count);
  const prevKind = new Int32Array(g.count);
  const done = new Uint8Array(g.count);

  for (let o = 0; o < n; o++) {
    if (access[o].length === 0) continue;
    distArr.fill(Infinity);
    prev.fill(-1);
    prevKind.fill(0);
    done.fill(0);

    const heap = new MinHeap();
    for (const a of access[o]) {
      for (const node of g.atStation[a.station]) {
        const line = lines[g.lineIdx[node]];
        const cost = a.walk + (line.headway / 2) * crowdPenalty(line);
        if (cost < distArr[node]) {
          distArr[node] = cost;
          heap.push(cost, node);
        }
      }
    }

    while (heap.size > 0) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      const du = distArr[u];
      const to = g.edgeTo[u];
      const cs = g.edgeCost[u];
      const ks = g.edgeKind[u];
      for (let e = 0; e < to.length; e++) {
        const v = to[e];
        const nd = du + cs[e];
        if (nd < distArr[v]) {
          distArr[v] = nd;
          prev[v] = u;
          prevKind[v] = ks[e];
          heap.push(nd, v);
        }
      }
    }

    for (let d = 0; d < n; d++) {
      if (d === o) continue;
      let best = Infinity;
      let bestNode = -1;
      for (const e of access[d]) {
        for (const node of g.atStation[e.station]) {
          const total = distArr[node] + e.walk;
          if (total < best) {
            best = total;
            bestNode = node;
          }
        }
      }
      if (bestNode < 0 || !isFinite(best)) continue;
      rt.time[o][d] = best;

      const hops: PathHop[] = [];
      let transfers = 0;
      let cur = bestNode;
      while (prev[cur] >= 0) {
        const p = prev[cur];
        if (prevKind[cur] === KIND_RIDE) {
          const from = g.pos[p];
          const to2 = g.pos[cur];
          hops.push({
            line: lines[g.lineIdx[cur]].id,
            seg: Math.min(from, to2),
            forward: from < to2,
          });
        } else if (prevKind[cur] === KIND_TRANSFER) {
          transfers++;
        }
        cur = p;
      }
      hops.reverse();
      rt.path[o][d] = hops;
      rt.transfers[o][d] = transfers;
    }
  }

  return rt;
}
