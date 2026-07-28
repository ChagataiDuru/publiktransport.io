import type { Id, Vec2 } from './types.ts';
import type { MapDefinition } from './map.ts';

const W = 2400;
const H = 1600;

/** Hand-jittered 6 × 4 borough lattice; local cell scale matches the classic city. */
const L: Vec2[][] = [
  [{ x: 0, y: 0 }, { x: 385, y: 0 }, { x: 805, y: 0 }, { x: 1190, y: 0 }, { x: 1595, y: 0 }, { x: 2010, y: 0 }, { x: 2400, y: 0 }],
  [{ x: 0, y: 385 }, { x: 410, y: 420 }, { x: 775, y: 380 }, { x: 1215, y: 415 }, { x: 1570, y: 375 }, { x: 2035, y: 410 }, { x: 2400, y: 390 }],
  [{ x: 0, y: 805 }, { x: 375, y: 770 }, { x: 825, y: 825 }, { x: 1170, y: 785 }, { x: 1625, y: 820 }, { x: 1980, y: 780 }, { x: 2400, y: 810 }],
  [{ x: 0, y: 1180 }, { x: 425, y: 1220 }, { x: 760, y: 1170 }, { x: 1230, y: 1210 }, { x: 1560, y: 1165 }, { x: 2040, y: 1215 }, { x: 2400, y: 1185 }],
  [{ x: 0, y: 1600 }, { x: 390, y: 1600 }, { x: 810, y: 1600 }, { x: 1195, y: 1600 }, { x: 1605, y: 1600 }, { x: 2005, y: 1600 }, { x: 2400, y: 1600 }],
];

const names = [
  'Westhaven', 'Alder Park', 'Northworks', 'Crown Heights', 'University', 'East Aerodrome',
  'Harbour Ward', 'Juniper Square', 'Canal Market', 'Civic North', 'Meridian Park', 'Eastgate',
  'Shipyards', 'West Exchange', 'Grand Forum', 'Central Gardens', 'Glasshouse', 'Tech Quarter',
  'South Docks', 'Briar Commons', 'Founders Bank', 'Civic South', 'Stadium', 'Seabrook',
];

const populations = [
  38000, 50000, 45000, 45000, 50000, 38000,
  48000, 76000, 100000, 100000, 76000, 48000,
  48000, 76000, 100000, 100000, 76000, 48000,
  38000, 50000, 60000, 60000, 50000, 38000,
];

const cell = (r: number, c: number): Vec2[] => [
  L[r][c], L[r][c + 1], L[r + 1][c + 1], L[r + 1][c],
];

const neighborhoods = names.map((name, id) => ({
  name,
  polygon: cell(Math.floor(id / 6), id % 6),
  population: populations[id],
}));

const stationNames = [
  'Haven Pier', 'Westhaven', 'Alder West', 'Alder Junction', 'Pine Walk', 'Northworks', 'Forge Gate',
  'Crown North', 'Crown Cross', 'University', 'Library', 'Airfield', 'Terminal',
  'Harbour Gate', 'Mariners', 'Juniper West', 'Juniper Square', 'Juniper East',
  'Canal Market', 'Lock Street', 'Civic North', 'Assembly', 'Museum',
  'Meridian Park', 'Observatory', 'Eastgate', 'Orchard Road',
  'Shipyards', 'Dry Dock', 'West Exchange', 'Arcade', 'Forum West',
  'Grand Forum', 'Forum East', 'Central Gardens', 'City Hall', 'Glasshouse',
  'Crystal Row', 'Tech Quarter', 'Innovation Way',
  'South Docks', 'Ferry Basin', 'Briar Commons', 'Elm Street', 'Founders Bank',
  'Foundry', 'Civic South', 'Parliament South', 'River Steps', 'Stadium', 'Exhibition',
  'Seabrook', 'Coast Road',
];

const homeDistricts = new Set([7, 10, 13, 16]);
const hubDistricts = new Set([1, 3, 4, 7, 8, 9, 10, 13, 14, 15, 16, 21]);
const stations: Array<{ name: string; x: number; y: number; n: Id; platforms: number }> = [];
const districtStations: Id[][] = [];
let stationNameIndex = 0;
for (let id = 0; id < 24; id++) {
  const r = Math.floor(id / 6);
  const c = id % 6;
  const poly = cell(r, c);
  const minX = Math.min(...poly.map((p) => p.x));
  const maxX = Math.max(...poly.map((p) => p.x));
  const minY = Math.min(...poly.map((p) => p.y));
  const maxY = Math.max(...poly.map((p) => p.y));
  const count = homeDistricts.has(id) ? 3 : (id === 1 || id === 23 ? 2 : id % 2 === 0 ? 2 : 3);
  const ids: Id[] = [];
  // Opposed stops make a useful local corridor: each end reaches toward a
  // neighbouring district while the optional third stop creates a branch.
  const offsets = count === 2
    ? [[0.14, 0.46], [0.86, 0.58]]
    : [[0.14, 0.54], [0.86, 0.48], [0.52, 0.22]];
  for (let k = 0; k < count; k++) {
    const stationId = stations.length;
    ids.push(stationId);
    stations.push({
      name: stationNames[stationNameIndex++] ?? `${names[id]} ${k + 1}`,
      x: minX + (maxX - minX) * offsets[k][0],
      y: minY + (maxY - minY) * offsets[k][1],
      n: id,
      platforms: hubDistricts.has(id) && k === 1 ? ([8, 9, 14, 15].includes(id) ? 4 : 3) : 2,
    });
  }
  districtStations.push(ids);
}

const localEdges: Array<[Id, Id]> = [];
const add = (a: Id, b: Id): void => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!localEdges.some(([x, y]) => x === lo && y === hi)) localEdges.push([lo, hi]);
};
for (const ids of districtStations) {
  for (let i = 0; i + 1 < ids.length; i++) add(ids[i], ids[i + 1]);
  if (ids.length === 3) add(ids[0], ids[2]);
}
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 6; c++) {
    const id = r * 6 + c;
    if (c < 5) {
      add(districtStations[id].at(-1)!, districtStations[id + 1][0]);
      if (r === 1 || r === 2) add(districtStations[id][0], districtStations[id + 1].at(-1)!);
    }
    if (r < 3) {
      add(districtStations[id][1], districtStations[id + 6][0]);
      if (c === 1 || c === 4) add(districtStations[id][0], districtStations[id + 6][1]);
    }
  }
}

const h = (district: Id): Id => districtStations[district][1];
const expressEdges: Array<[Id, Id]> = [
  [h(7), h(10)], [h(10), h(16)], [h(16), h(13)], [h(13), h(7)],
  [h(8), h(9)], [h(9), h(15)], [h(15), h(14)], [h(14), h(8)],
  [h(3), h(21)], [h(1), h(19)], [h(4), h(22)], [h(6), h(17)],
  [h(7), h(15)], [h(10), h(14)],
];

export const EXPANDED_MAP: MapDefinition = {
  id: 'expanded',
  name: 'Greater Publik City',
  description: 'Four regional centres, a distributed metropolitan core, and inner and outer orbital routes.',
  worldWidth: W,
  worldHeight: H,
  recommendedMinPlayers: 3,
  recommendedMaxPlayers: 4,
  neighborhoods,
  stations,
  localEdges,
  expressEdges,
  homeSeats: [
    { district: 7, starter: [districtStations[7][0], districtStations[7][1]] },
    { district: 10, starter: [districtStations[10][0], districtStations[10][1]] },
    { district: 13, starter: [districtStations[13][0], districtStations[13][1]] },
    { district: 16, starter: [districtStations[16][0], districtStations[16][1]] },
  ],
  landmarkDistricts: [7, 9, 10, 13, 14, 15, 16, 21],
  tuning: { matchSeconds: 360 },
};
