import { describe, expect, it } from 'vitest';
import { EXPANDED_MAP } from '../src/sim/expanded-map.ts';
import { validateMap } from '../src/sim/map-validation.ts';
import { CLASSIC_MAP, buildEdges, buildNeighborhoods, buildStations } from '../src/sim/map.ts';
import { defaultMapId, getMap } from '../src/sim/maps.ts';
import { createInitialState } from '../src/sim/state.ts';

describe('map definitions', () => {
  it('preserves the classic city', () => {
    expect(CLASSIC_MAP.worldWidth).toBe(1600);
    expect(CLASSIC_MAP.worldHeight).toBe(1000);
    expect(buildNeighborhoods(CLASSIC_MAP)).toHaveLength(14);
    expect(buildStations(CLASSIC_MAP)).toHaveLength(36);
    expect(buildEdges(CLASSIC_MAP).filter((edge) => !edge.express)).toHaveLength(68);
    expect(buildEdges(CLASSIC_MAP).filter((edge) => edge.express)).toHaveLength(10);
    expect(CLASSIC_MAP.homeSeats).toHaveLength(4);
    expect(validateMap(CLASSIC_MAP).errors).toEqual([]);
  });

  it('provides a connected and accessible expanded city', () => {
    const report = validateMap(EXPANDED_MAP);
    expect(EXPANDED_MAP.worldWidth).toBe(2400);
    expect(EXPANDED_MAP.worldHeight).toBe(1600);
    expect(EXPANDED_MAP.neighborhoods.length).toBeGreaterThanOrEqual(22);
    expect(EXPANDED_MAP.neighborhoods.length).toBeLessThanOrEqual(24);
    expect(EXPANDED_MAP.stations.length).toBeGreaterThanOrEqual(54);
    expect(EXPANDED_MAP.stations.length).toBeLessThanOrEqual(64);
    expect(EXPANDED_MAP.homeSeats).toHaveLength(4);
    expect(EXPANDED_MAP.stations.filter((station) => station.platforms > 2).length).toBeGreaterThanOrEqual(8);
    expect(report.errors).toEqual([]);
    expect(report.worstCentroidStationDistance).toBeLessThan(190);
    expect(report.averageCentroidStationDistance).toBeLessThan(160);
  });

  it('selects by player count and applies only valid overrides', () => {
    expect(defaultMapId(2)).toBe('classic');
    expect(defaultMapId(3)).toBe('expanded');
    expect(defaultMapId(4)).toBe('expanded');
    expect(createInitialState(1, 2).mapId).toBe('classic');
    expect(createInitialState(1, 4).mapId).toBe('expanded');
    expect(createInitialState(1, 2, { mapId: 'expanded' }).mapId).toBe('expanded');
    expect(createInitialState(1, 4, { mapId: 'unknown' }).mapId).toBe('expanded');
    expect(getMap('unknown').id).toBe('classic');
  });
});
