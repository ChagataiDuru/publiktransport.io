import { buildEdges, buildNeighborhoods, buildStations, dist, polygonCentroid, type MapDefinition } from './map.ts';

export interface MapValidationReport {
  errors: string[];
  warnings: string[];
  averageCentroidStationDistance: number;
  worstCentroidStationDistance: number;
}

function pointInPolygon(x: number, y: number, polygon: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function validateMap(map: MapDefinition): MapValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stations = buildStations(map);
  const neighborhoods = buildNeighborhoods(map);
  const edges = buildEdges(map);
  const edgeKeys = new Set<string>();

  for (const [id, nb] of neighborhoods.entries()) {
    if (nb.id !== id) errors.push(`duplicate or unstable district id ${nb.id}`);
    if (nb.polygon.length < 3) errors.push(`district ${id} has an invalid polygon`);
    for (const p of nb.polygon) {
      if (p.x < 0 || p.y < 0 || p.x > map.worldWidth || p.y > map.worldHeight) {
        errors.push(`district ${id} is outside world bounds`);
      }
    }
    const c = polygonCentroid(nb.polygon);
    if (c.x < 0 || c.y < 0 || c.x > map.worldWidth || c.y > map.worldHeight) {
      errors.push(`district ${id} centroid is outside world bounds`);
    }
  }

  for (const [id, station] of stations.entries()) {
    if (station.id !== id) errors.push(`duplicate or unstable station id ${station.id}`);
    if (!neighborhoods[station.neighborhood]) errors.push(`station ${id} has invalid district`);
    if (station.pos.x < 0 || station.pos.y < 0 || station.pos.x > map.worldWidth || station.pos.y > map.worldHeight) {
      errors.push(`station ${id} is outside world bounds`);
    }
    if (station.platforms < 1 || !Number.isInteger(station.platforms)) errors.push(`station ${id} has invalid platforms`);
    const nb = neighborhoods[station.neighborhood];
    if (nb && !pointInPolygon(station.pos.x, station.pos.y, nb.polygon)) {
      warnings.push(`station ${id} lies outside assigned district ${station.neighborhood}`);
    }
  }

  for (const edge of edges) {
    if (!stations[edge.a] || !stations[edge.b]) errors.push(`edge ${edge.a}-${edge.b} has invalid station`);
    if (edge.a === edge.b) errors.push(`self-edge ${edge.a}`);
    const key = `${edge.a}-${edge.b}-${edge.express ? 'x' : 'l'}`;
    if (edgeKeys.has(key)) errors.push(`duplicate edge ${key}`);
    edgeKeys.add(key);
  }

  const adj = Array.from({ length: stations.length }, () => [] as number[]);
  for (const edge of edges) {
    if (adj[edge.a] && adj[edge.b]) {
      adj[edge.a].push(edge.b);
      adj[edge.b].push(edge.a);
    }
  }
  const seen = new Set<number>(stations.length ? [0] : []);
  const queue = stations.length ? [0] : [];
  while (queue.length) {
    const at = queue.shift()!;
    for (const next of adj[at]) if (!seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
  }
  if (seen.size !== stations.length) errors.push(`station graph disconnected: ${seen.size}/${stations.length} reachable`);
  for (let id = 0; id < adj.length; id++) if (adj[id].length === 0) errors.push(`station ${id} is isolated`);

  const nearest = neighborhoods.map((nb) => {
    const local = stations.filter((station) => station.neighborhood === nb.id);
    if (!local.length) {
      errors.push(`district ${nb.id} has no station`);
      return Infinity;
    }
    return Math.min(...local.map((station) => dist(nb.centroid, station.pos)));
  });
  const finiteNearest = nearest.filter(Number.isFinite);
  const average = finiteNearest.reduce((sum, value) => sum + value, 0) / Math.max(1, finiteNearest.length);
  const worst = finiteNearest.length ? Math.max(...finiteNearest) : Infinity;
  if (worst > 210) warnings.push(`worst centroid access distance is ${worst.toFixed(1)}`);

  for (const [seatId, seat] of map.homeSeats.entries()) {
    if (!neighborhoods[seat.district]) errors.push(`home seat ${seatId} has invalid district`);
    const [a, b] = seat.starter;
    if (!stations[a] || !stations[b]) errors.push(`home seat ${seatId} has invalid starter`);
    if (stations[a]?.neighborhood !== seat.district || stations[b]?.neighborhood !== seat.district) {
      errors.push(`home seat ${seatId} starter is outside its district`);
    }
    if (!edges.some((edge) => !edge.express && ((edge.a === a && edge.b === b) || (edge.a === b && edge.b === a)))) {
      errors.push(`home seat ${seatId} starter has no local edge`);
    }
  }
  if (!stations.some((station) => station.isHub)) errors.push('map has no hubs');

  return { errors, warnings, averageCentroidStationDistance: average, worstCentroidStationDistance: worst };
}

export function assertValidMap(map: MapDefinition): MapValidationReport {
  const report = validateMap(map);
  if (report.errors.length) throw new Error(`${map.id}: ${report.errors.join('; ')}`);
  return report;
}
