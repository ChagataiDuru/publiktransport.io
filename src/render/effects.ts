import { PARAMS, PLAYER_COLORS } from '../sim/params.ts';
import type { GameState, Id, Vec2 } from '../sim/types.ts';
import { toScreen, type ViewState } from './view.ts';

interface Burst {
  station: Id;
  color: string;
  born: number;
}

interface Pulse {
  lineId: Id;
  born: number;
  extensionStation?: Id;
}

interface Stream {
  from: Vec2;
  to: Vec2;
  color: string;
  born: number;
  offset: number;
}

export interface EffectsController {
  reset(state: GameState): void;
  draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    view: ViewState,
    geometry: Map<number, { pts: Vec2[]; stationAt: number[] }>,
  ): void;
}

export function createEffectsController(): EffectsController {
  let highestEventId = 0;
  let initialized = false;
  let seed = -1;
  let lastTick = -1;
  const bursts: Burst[] = [];
  const pulses: Pulse[] = [];
  const streams: Stream[] = [];

  function reset(state: GameState): void {
    seed = state.seed;
    lastTick = state.tick;
    highestEventId = state.events.at(-1)?.id ?? 0;
    initialized = true;
    bursts.length = 0;
    pulses.length = 0;
    streams.length = 0;
  }

  function consume(state: GameState, now: number): void {
    if (!initialized || state.seed !== seed || state.tick < lastTick) {
      reset(state);
      return;
    }
    lastTick = state.tick;
    for (const event of state.events) {
      if (event.id <= highestEventId) continue;
      highestEventId = event.id;
      if (event.kind !== 'serviceOpened' && event.kind !== 'lineExtended') continue;
      const stationIds =
        event.kind === 'serviceOpened' ? event.stationIds : [event.stationId];
      const color = PLAYER_COLORS[event.player] ?? '#e8edf0';
      for (const stationId of stationIds) {
        bursts.push({ station: stationId, color, born: now });
        const station = state.stations[stationId];
        const from = state.neighborhoods[station.neighborhood].centroid;
        for (let particle = 0; particle < 5; particle++) {
          streams.push({
            from,
            to: station.pos,
            color,
            born: now,
            offset: particle * 0.09,
          });
        }
      }
      pulses.push({
        lineId: event.lineId,
        born: now,
        extensionStation: event.kind === 'lineExtended' ? event.stationId : undefined,
      });
    }
  }

  function draw(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    view: ViewState,
    geometry: Map<number, { pts: Vec2[]; stationAt: number[] }>,
  ): void {
    consume(state, view.time);
    const now = view.time;
    const localBuilt = state.events.some(
      (event) =>
        event.player === view.localPlayer &&
        (event.kind === 'serviceOpened' || event.kind === 'lineExtended'),
    );
    if (state.tick < 30 * PARAMS.TICK_HZ && !localBuilt) {
      const starter = state.players[view.localPlayer]?.lines[0];
      if (starter) {
        for (const stationId of [starter.stations[0], starter.stations.at(-1)]) {
          if (stationId === undefined) continue;
          const center = toScreen(view.cam, state.stations[stationId].pos);
          const pulse = 0.5 + 0.5 * Math.sin(now * 5);
          ctx.beginPath();
          ctx.arc(center.x, center.y, (14 + pulse * 8) * view.cam.s, 0, Math.PI * 2);
          ctx.strokeStyle = colorWithAlpha(PLAYER_COLORS[view.localPlayer], 0.35 + pulse * 0.4);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const effect = bursts[i];
      const age = now - effect.born;
      if (age > 1.4) {
        bursts.splice(i, 1);
        continue;
      }
      const center = toScreen(view.cam, state.stations[effect.station].pos);
      for (let ring = 0; ring < 3; ring++) {
        const t = Math.max(0, age - ring * 0.12);
        if (t <= 0) continue;
        ctx.beginPath();
        ctx.arc(center.x, center.y, (12 + t * 38) * view.cam.s, 0, Math.PI * 2);
        ctx.strokeStyle = colorWithAlpha(effect.color, Math.max(0, 0.75 - t / 1.4));
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    for (let i = streams.length - 1; i >= 0; i--) {
      const particle = streams[i];
      const age = now - particle.born - particle.offset;
      if (age > 1.35) {
        streams.splice(i, 1);
        continue;
      }
      if (age < 0) continue;
      const t = Math.min(1, age / 1.05);
      const eased = t * t * (3 - 2 * t);
      const world = {
        x: particle.from.x + (particle.to.x - particle.from.x) * eased,
        y: particle.from.y + (particle.to.y - particle.from.y) * eased,
      };
      const point = toScreen(view.cam, world);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(particle.color, Math.min(1, age * 3) * (1 - t * 0.4));
      ctx.fill();
    }

    for (let i = pulses.length - 1; i >= 0; i--) {
      const pulse = pulses[i];
      const age = now - pulse.born;
      if (age > 1.5) {
        pulses.splice(i, 1);
        continue;
      }
      const line = state.players.flatMap((player) => player.lines).find((item) => item.id === pulse.lineId);
      const geo = geometry.get(pulse.lineId);
      if (!line || !geo || geo.pts.length < 2) continue;
      let pulsePoints = geo.pts;
      if (pulse.extensionStation !== undefined) {
        const stationIndex = line.stations.indexOf(pulse.extensionStation);
        if (stationIndex === 0 && geo.stationAt.length > 1) {
          pulsePoints = geo.pts.slice(0, geo.stationAt[1] + 1);
        } else if (stationIndex === line.stations.length - 1 && stationIndex > 0) {
          pulsePoints = geo.pts.slice(geo.stationAt[stationIndex - 1]);
        }
      }
      const progress = Math.min(1, age / 1.15);
      const segment = Math.min(
        pulsePoints.length - 2,
        Math.floor(progress * (pulsePoints.length - 1)),
      );
      const local = progress * (pulsePoints.length - 1) - segment;
      const a = pulsePoints[segment];
      const b = pulsePoints[segment + 1];
      const point = toScreen(view.cam, {
        x: a.x + (b.x - a.x) * local,
        y: a.y + (b.y - a.y) * local,
      });
      ctx.beginPath();
      ctx.arc(point.x, point.y, 8 + 5 * (1 - age / 1.5), 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha('#ffffff', 0.85 - age * 0.4);
      ctx.fill();
    }
  }

  return { reset, draw };
}

function colorWithAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}
