import type { Camera, Draft } from '../render/view.ts';
import { toWorld } from '../render/view.ts';
import { areAdjacent, freePlatforms, validate } from '../sim/commands.ts';
import { createLineCost, extendLineCost } from '../sim/economy.ts';
import { dist } from '../sim/map.ts';
import { LIMITS, PARAMS } from '../sim/params.ts';
import type { Command, GameState, Id, PlayerId, Vec2 } from '../sim/types.ts';

const HIT_RADIUS_PX = 12;

export interface LineBuilder {
  draft: Draft | null;
  hoverStation: Id | null;
  /** Called by main once per frame after state changes. */
  refresh(state: GameState): void;
  onMove(e: MouseEvent): void;
  onClick(e: MouseEvent): void;
  onDoubleClick(e: MouseEvent): void;
  onKey(key: string): boolean;
  cancel(): void;
  commit(state: GameState): void;
}

export function stationAt(state: GameState, p: Vec2, camera: Camera): Id | null {
  let best: Id | null = null;
  let bestD = HIT_RADIUS_PX / camera.s;
  for (const s of state.stations) {
    const d = dist(s.pos, p);
    if (d < bestD) {
      bestD = d;
      best = s.id;
    }
  }
  return best;
}

export function createLineBuilder(
  canvas: HTMLCanvasElement,
  getState: () => GameState,
  getCamera: () => Camera,
  emit: (cmd: Command) => void,
  getPlayer: () => PlayerId = () => 0,
  suppressInteraction: () => boolean = () => false,
): LineBuilder {
  const lb: LineBuilder = {
    draft: null,
    hoverStation: null,
    refresh,
    onMove,
    onClick,
    onDoubleClick,
    onKey,
    cancel,
    commit,
  };

  function pointer(e: MouseEvent): Vec2 {
    const rect = canvas.getBoundingClientRect();
    return toWorld(getCamera(), e.clientX - rect.left, e.clientY - rect.top);
  }

  function cancel(): void {
    lb.draft = null;
  }

  /** Recompute candidate validity, cost and the readout rows. */
  function refresh(state: GameState): void {
    const player = getPlayer();
    const d = lb.draft;
    if (!d) return;
    const chain = d.stations;
    const tail = chain[chain.length - 1];

    d.candidateValid = false;
    d.reason = null;

    if (d.candidate !== null && d.candidate !== tail) {
      if (chain.includes(d.candidate)) {
        d.reason = 'already on this line';
      } else if (!areAdjacent(state, tail, d.candidate)) {
        d.reason = 'no corridor that way';
      } else if (freePlatforms(state, d.candidate) < 1) {
        d.reason = `${state.stations[d.candidate].name}: platforms full`;
      } else if (chain.length >= LIMITS.MAX_LINE_STATIONS) {
        d.reason = 'line is at maximum length';
      } else {
        d.candidateValid = true;
      }
    }

    const preview = d.candidateValid && d.candidate !== null ? [...chain, d.candidate] : chain;

    let cost: number;
    if (d.extending !== null) {
      cost = 0;
      for (let i = 0; i + 1 < preview.length; i++) cost += extendLineCost(state, player, preview[i], preview[i + 1]);
    } else {
      cost = preview.length >= 2 ? createLineCost(state, player, preview) : 0;
    }
    d.cost = cost;

    // Estimated round trip for the previewed shape.
    let length = 0;
    for (let i = 0; i + 1 < preview.length; i++) {
      length += dist(state.stations[preview[i]].pos, state.stations[preview[i + 1]].pos);
    }
    const stops = d.extending !== null ? preview.length + lengthOfExistingLine(state, d.extending) : preview.length;
    const rtt = 2 * (length / PARAMS.TRAIN_SPEED + stops * PARAMS.STATION_DWELL);
    const districts = new Set(preview.map((s) => state.stations[s].neighborhood)).size;

    const affordable = state.players[player].cash >= cost;
    d.cash = state.players[player].cash;
    d.shortfall = Math.max(0, cost - d.cash);
    d.roundTripSeconds = rtt;
    d.districts = districts;
    d.stops = preview.length;
    if (!affordable) d.reason = 'not enough cash';
  }

  function lengthOfExistingLine(state: GameState, lineId: Id): number {
    const player = getPlayer();
    const line = state.players[player].lines.find((l) => l.id === lineId);
    return line ? line.stations.length - 1 : 0;
  }

  function onMove(e: MouseEvent): void {
    if (suppressInteraction()) return;
    const state = getState();
    const p = pointer(e);
    const hit = stationAt(state, p, getCamera());
    lb.hoverStation = hit;
    if (lb.draft) {
      lb.draft.cursor = p;
      lb.draft.candidate = hit;
      refresh(state);
    }
  }

  function onClick(e: MouseEvent): void {
    if (suppressInteraction() || e.button !== 0) return;
    const state = getState();
    const player = getPlayer();
    if (state.phase !== 'playing') return;
    const p = pointer(e);
    const hit = stationAt(state, p, getCamera());

    if (!lb.draft) {
      if (hit === null) return;
      // Clicking the loose end of one of my lines extends it instead of
      // starting a brand new one.
      for (const line of state.players[player].lines) {
        if (line.stations[0] === hit) {
          lb.draft = newDraft(hit, line.id, 'head', p);
          refresh(state);
          return;
        }
        if (line.stations[line.stations.length - 1] === hit) {
          lb.draft = newDraft(hit, line.id, 'tail', p);
          refresh(state);
          return;
        }
      }
      if (state.players[player].lines.length >= LIMITS.MAX_LINES) return;
      if (freePlatforms(state, hit) < 1) return;
      lb.draft = newDraft(hit, null, 'tail', p);
      refresh(state);
      return;
    }

    if (hit === null) return;
    lb.draft.candidate = hit;
    lb.draft.cursor = p;
    refresh(state);
    if (lb.draft.candidateValid) {
      lb.draft.stations.push(hit);
      lb.draft.candidate = null;
      lb.draft.candidateValid = false;
      refresh(state);
    }
  }

  function newDraft(start: Id, extending: Id | null, end: 'head' | 'tail', cursor: Vec2): Draft {
    const player = getPlayer();
    return {
      stations: [start],
      cursor,
      candidate: null,
      candidateValid: false,
      cost: 0,
      cash: getState().players[player].cash,
      shortfall: 0,
      roundTripSeconds: 0,
      districts: 1,
      stops: 1,
      reason: null,
      extending,
      end,
    };
  }

  function onDoubleClick(e: MouseEvent): void {
    const state = getState();
    if (!lb.draft) return;
    if (stationAt(state, pointer(e), getCamera()) === null) commit(state);
  }

  function commit(state: GameState): void {
    const d = lb.draft;
    const player = getPlayer();
    if (!d) {
      lb.draft = null;
      return;
    }
    if (d.stations.length < 2) {
      lb.draft = null;
      return;
    }

    if (d.extending !== null) {
      // The anchor is already on the line; everything after it is new.
      for (let i = 1; i < d.stations.length; i++) {
        emit({
          type: 'ExtendLine',
          player,
          line: d.extending,
          station: d.stations[i],
          end: d.end,
        });
      }
    } else {
      const cmd: Command = { type: 'CreateLine', player, stations: [...d.stations] };
      if (validate(state, cmd).ok) emit(cmd);
    }
    lb.draft = null;
  }

  function onKey(key: string): boolean {
    const state = getState();
    if (!lb.draft) return false;
    if (key === 'Escape') {
      cancel();
      return true;
    }
    if (key === 'Enter') {
      commit(state);
      return true;
    }
    if (key === 'Backspace') {
      if (lb.draft.stations.length > 1) lb.draft.stations.pop();
      else cancel();
      if (lb.draft) refresh(state);
      return true;
    }
    return false;
  }

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancel();
  });

  return lb;
}
