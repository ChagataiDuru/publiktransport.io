import type { Id, MapEdge, Neighborhood, Station, Vec2 } from './types.ts';

export const WORLD_W = 1600;
export const WORLD_H = 1000;

/**
 * Irregular lattice the district polygons are cut from. Hand-jittered so the
 * city reads as a city rather than a spreadsheet. L[row][col].
 */
const L: Vec2[][] = [
  [
    { x: 0, y: 0 },
    { x: 330, y: 0 },
    { x: 660, y: 0 },
    { x: 980, y: 0 },
    { x: 1300, y: 0 },
    { x: 1600, y: 0 },
  ],
  [
    { x: 0, y: 300 },
    { x: 300, y: 340 },
    { x: 690, y: 310 },
    { x: 1010, y: 350 },
    { x: 1330, y: 320 },
    { x: 1600, y: 300 },
  ],
  [
    { x: 0, y: 690 },
    { x: 350, y: 640 },
    { x: 640, y: 700 },
    { x: 960, y: 640 },
    { x: 1290, y: 680 },
    { x: 1600, y: 660 },
  ],
  [
    { x: 0, y: 1000 },
    { x: 330, y: 1000 },
    { x: 660, y: 1000 },
    { x: 980, y: 1000 },
    { x: 1300, y: 1000 },
    { x: 1600, y: 1000 },
  ],
];

const cell = (r: number, c: number): Vec2[] => [L[r][c], L[r][c + 1], L[r + 1][c + 1], L[r + 1][c]];

/** Signed-area centroid of a simple polygon. */
export function polygonCentroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return { x: poly[0].x, y: poly[0].y };
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

interface NbDef {
  name: string;
  polygon: Vec2[];
  population: number;
}

const NEIGHBORHOOD_DEFS: NbDef[] = [
  // Westport spans two lattice rows — the one district that isn't a plain quad.
  {
    name: 'Westport',
    polygon: [L[0][0], L[0][1], L[1][1], L[2][1], L[2][0]],
    population: 46000,
  },
  { name: 'Northgate', polygon: cell(0, 1), population: 38000 },
  { name: 'Foundry', polygon: cell(0, 2), population: 52000 },
  { name: 'Kestrel Hill', polygon: cell(0, 3), population: 34000 },
  { name: 'Eastmoor', polygon: cell(0, 4), population: 41000 },
  { name: 'Old Town', polygon: cell(1, 1), population: 88000 },
  { name: 'Central', polygon: cell(1, 2), population: 120000 },
  { name: 'Exchange', polygon: cell(1, 3), population: 96000 },
  { name: 'Harbour East', polygon: cell(1, 4), population: 44000 },
  { name: 'Southwark', polygon: cell(2, 0), population: 33000 },
  { name: 'Millbank', polygon: cell(2, 1), population: 62000 },
  { name: 'Quayside', polygon: cell(2, 2), population: 74000 },
  { name: 'Riverton', polygon: cell(2, 3), population: 57000 },
  { name: 'Southferry', polygon: cell(2, 4), population: 29000 },
];

interface StDef {
  name: string;
  x: number;
  y: number;
  n: Id;
  platforms: number;
}

/** 36 stations, hand-placed. platforms > 2 marks an interchange hub. */
const STATION_DEFS: StDef[] = [
  { name: 'Westport North', x: 140, y: 120, n: 0, platforms: 2 },
  { name: 'Westport Cross', x: 180, y: 340, n: 0, platforms: 3 },
  { name: 'Dockside', x: 140, y: 560, n: 0, platforms: 2 },

  { name: 'Northgate', x: 420, y: 140, n: 1, platforms: 2 },
  { name: 'Ironworks', x: 620, y: 180, n: 1, platforms: 2 },

  { name: 'Foundry Lane', x: 760, y: 100, n: 2, platforms: 2 },
  { name: 'Foundry Central', x: 860, y: 240, n: 2, platforms: 3 },
  { name: 'Clocktower', x: 980, y: 120, n: 2, platforms: 2 },

  { name: 'Kestrel Hill', x: 1100, y: 140, n: 3, platforms: 2 },
  { name: 'Beacon Park', x: 1240, y: 260, n: 3, platforms: 2 },

  { name: 'Eastmoor', x: 1400, y: 120, n: 4, platforms: 2 },
  { name: 'Moorfield', x: 1520, y: 240, n: 4, platforms: 2 },

  { name: 'Old Town Gate', x: 400, y: 400, n: 5, platforms: 2 },
  { name: 'Cathedral', x: 520, y: 520, n: 5, platforms: 3 },
  { name: 'Bramble Row', x: 400, y: 620, n: 5, platforms: 2 },

  { name: 'Union Square', x: 720, y: 400, n: 6, platforms: 4 },
  { name: 'Grand Central', x: 860, y: 460, n: 6, platforms: 4 },
  { name: 'Parliament', x: 960, y: 560, n: 6, platforms: 2 },
  { name: 'Lantern Street', x: 740, y: 620, n: 6, platforms: 2 },

  { name: 'Exchange', x: 1080, y: 420, n: 7, platforms: 3 },
  { name: 'Mint Yard', x: 1220, y: 380, n: 7, platforms: 2 },
  { name: 'Sable Court', x: 1180, y: 600, n: 7, platforms: 2 },

  { name: 'Harbour East', x: 1400, y: 420, n: 8, platforms: 2 },
  { name: 'Saltworks', x: 1520, y: 580, n: 8, platforms: 2 },

  { name: 'Southwark', x: 160, y: 760, n: 9, platforms: 2 },
  { name: "Tanner's End", x: 220, y: 940, n: 9, platforms: 2 },

  { name: 'Millbank', x: 400, y: 780, n: 10, platforms: 3 },
  { name: 'Weaver Street', x: 560, y: 880, n: 10, platforms: 2 },
  { name: 'Kiln Road', x: 380, y: 960, n: 10, platforms: 2 },

  { name: 'Quayside', x: 720, y: 760, n: 11, platforms: 3 },
  { name: 'Ferry Steps', x: 880, y: 840, n: 11, platforms: 2 },
  { name: 'Wharfgate', x: 760, y: 960, n: 11, platforms: 2 },

  { name: 'Riverton', x: 1060, y: 780, n: 12, platforms: 2 },
  { name: 'Lock Gardens', x: 1220, y: 900, n: 12, platforms: 2 },

  { name: 'Southferry', x: 1400, y: 760, n: 13, platforms: 2 },
  { name: 'Cinder Wharf', x: 1520, y: 920, n: 13, platforms: 2 },
];

/** Local corridors — short hops between adjacent stations. */
const LOCAL_EDGES: [Id, Id][] = [
  [0, 1], [0, 3], [1, 3], [1, 2], [1, 12],
  [3, 4], [3, 12], [4, 5], [4, 6], [4, 15],
  [5, 6], [5, 7], [6, 7], [6, 15], [6, 16],
  [7, 8], [7, 19], [8, 9], [8, 10], [9, 10],
  [9, 19], [9, 20], [10, 11], [10, 22], [11, 22],
  [2, 12], [2, 14], [2, 24],
  [12, 13], [12, 14], [13, 14], [13, 15], [13, 18],
  [14, 26],
  [15, 16], [15, 18], [16, 17], [16, 18], [16, 19],
  [17, 19], [17, 21], [17, 30], [18, 29],
  [19, 20], [19, 21], [20, 22], [21, 22], [21, 32], [21, 34],
  [22, 23], [23, 34], [23, 35],
  [24, 25], [24, 26], [25, 28],
  [26, 27], [26, 28], [27, 28], [27, 29], [27, 31],
  [29, 30], [29, 31], [30, 31], [30, 32],
  [32, 33], [33, 34], [33, 35], [34, 35],
];

/**
 * Express chords between hubs. They skip the intermediate stations entirely,
 * so a line using them pays no dwell for what it flies over — this is what
 * makes "run an express over the rival's corridor and take their share" work.
 */
const EXPRESS_EDGES: [Id, Id][] = [
  [1, 13], [13, 16], [15, 29], [16, 22], [26, 29],
  [6, 19], [1, 26], [19, 32], [3, 15], [16, 29],
];

export function buildStations(): Station[] {
  return STATION_DEFS.map((d, i) => ({
    id: i,
    name: d.name,
    pos: { x: d.x, y: d.y },
    neighborhood: d.n,
    platforms: d.platforms,
    isHub: d.platforms > 2,
  }));
}

export function buildNeighborhoods(): Neighborhood[] {
  return NEIGHBORHOOD_DEFS.map((d, i) => ({
    id: i,
    name: d.name,
    centroid: polygonCentroid(d.polygon),
    polygon: d.polygon.map((p) => ({ x: p.x, y: p.y })),
    population: d.population,
    share: [1, 0, 0] as [number, number, number],
  }));
}

export function buildEdges(): MapEdge[] {
  const out: MapEdge[] = [];
  for (const [a, b] of LOCAL_EDGES) out.push({ a: Math.min(a, b), b: Math.max(a, b), express: false });
  for (const [a, b] of EXPRESS_EDGES) out.push({ a: Math.min(a, b), b: Math.max(a, b), express: true });
  return out;
}

export function edgeKey(a: Id, b: Id): number {
  return a < b ? a * 1000 + b : b * 1000 + a;
}

/** stationId -> list of stations reachable by one buildable corridor. */
export function buildAdjacency(stationCount: number, edges: MapEdge[]): Id[][] {
  const adj: Id[][] = Array.from({ length: stationCount }, () => []);
  for (const e of edges) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }
  for (const list of adj) list.sort((x, y) => x - y);
  return adj;
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
