import { PARAMS } from './params.ts';
import type { GameState, Id, PlayerId } from './types.ts';

export interface DistrictFrontline {
  districtId: Id;
  leader: PlayerId | null;
  runnerUp: PlayerId | null;
  leaderShare: number;
  runnerUpShare: number;
  gap: number;
  carShare: number;
  population: number;
  contested: boolean;
}

export function districtFrontline(state: GameState, districtId: Id): DistrictFrontline {
  const neighborhood = state.neighborhoods[districtId];
  const ranked = state.players
    .map((player) => ({ player: player.id, share: neighborhood.share[player.id + 1] ?? 0 }))
    .sort((a, b) => b.share - a.share || a.player - b.player);
  const first = ranked[0] ?? { player: 0, share: 0 };
  const second = ranked[1] ?? { player: 0, share: 0 };
  const gap = first.share - second.share;
  const controlled =
    first.share >= PARAMS.DISTRICT_CONTROL_MIN_SHARE && gap >= PARAMS.DISTRICT_CONTROL_MARGIN;
  return {
    districtId,
    leader: controlled ? first.player : null,
    runnerUp: ranked.length > 1 ? second.player : null,
    leaderShare: first.share,
    runnerUpShare: second.share,
    gap,
    carShare: neighborhood.share[0],
    population: neighborhood.population,
    contested:
      first.share >= PARAMS.DISTRICT_CONTROL_MIN_SHARE &&
      gap < PARAMS.DISTRICT_CONTESTED_MARGIN,
  };
}

export function districtFrontlines(state: GameState): DistrictFrontline[] {
  return state.neighborhoods.map((neighborhood) => districtFrontline(state, neighborhood.id));
}
