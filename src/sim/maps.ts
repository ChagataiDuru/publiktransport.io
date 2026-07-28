import { EXPANDED_MAP } from './expanded-map.ts';
import { CLASSIC_MAP, type MapDefinition } from './map.ts';

export type MapId = 'classic' | 'expanded';

export const MAPS: Readonly<Record<MapId, MapDefinition>> = {
  classic: CLASSIC_MAP,
  expanded: EXPANDED_MAP,
};

export function isMapId(value: unknown): value is MapId {
  return value === 'classic' || value === 'expanded';
}

export function getMap(value: unknown): MapDefinition {
  return isMapId(value) ? MAPS[value] : CLASSIC_MAP;
}

export function defaultMapId(playerCount: number): MapId {
  return playerCount >= 3 ? 'expanded' : 'classic';
}
