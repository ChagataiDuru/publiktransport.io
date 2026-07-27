import { WORLD_H, WORLD_W } from '../sim/map.ts';
import type { GameState, Vec2 } from '../sim/types.ts';
import { buildCorridorSlots, drawCorridors, drawDraft, drawLines, linePolyline } from './lines.ts';
import { drawNeighborhoods } from './neighborhoods.ts';
import { drawDesireOverlay, drawFlowOverlay, drawFocusPair } from './overlay.ts';
import { buildStationService, drawStations } from './stations.ts';
import { drawTrains } from './trains.ts';
import { createEffectsController } from './effects.ts';
import { COLORS, fitCamera, type Camera, type ViewState } from './view.ts';

export interface Renderer {
  canvas: HTMLCanvasElement;
  camera: Camera;
  resize(): void;
  draw(state: GameState, view: Omit<ViewState, 'cam'>): void;
}

function networkSignature(state: GameState): string {
  const parts: string[] = [];
  for (const player of state.players) {
    for (const line of player.lines) parts.push(`${line.id}:${line.stations.join('.')}`);
  }
  return parts.join('|');
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d')!;
  let camera: Camera = { s: 1, ox: 0, oy: 0 };
  let geoSig = '__initial__';
  let geoCache = new Map<number, { pts: Vec2[]; stationAt: number[] }>();
  let displayShare: number[][] = [];
  let lastFrame = 0;
  const effects = createEffectsController();

  const resize = (): void => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    camera = fitCamera(width, height, WORLD_W, WORLD_H);
  };

  const draw = (state: GameState, partial: Omit<ViewState, 'cam'>): void => {
    const view: ViewState = { ...partial, cam: camera };
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    const dt = lastFrame > 0 ? Math.min(0.25, view.time - lastFrame) : 0;
    lastFrame = view.time;
    if (
      displayShare.length !== state.neighborhoods.length ||
      displayShare[0]?.length !== state.cityShare.length
    ) {
      displayShare = state.neighborhoods.map((neighborhood) => [...neighborhood.share]);
    }
    const easing = 1 - Math.exp(-5 * dt);
    for (const neighborhood of state.neighborhoods) {
      const displayed = displayShare[neighborhood.id];
      for (let mode = 0; mode < displayed.length; mode++) {
        displayed[mode] += (neighborhood.share[mode] - displayed[mode]) * easing;
      }
    }

    const signature = networkSignature(state);
    const slots = buildCorridorSlots(state);
    if (signature !== geoSig) {
      geoSig = signature;
      geoCache = new Map();
      for (const player of state.players) {
        for (const line of player.lines) {
          geoCache.set(line.id, linePolyline(state, line, slots));
        }
      }
    }

    drawNeighborhoods(ctx, state, view, displayShare);
    drawFocusPair(ctx, state, view);
    drawCorridors(ctx, state, view);
    if (view.overlays.desire) drawDesireOverlay(ctx, state, view);
    drawLines(ctx, state, view, geoCache);
    if (view.overlays.flow) drawFlowOverlay(ctx, state, view, geoCache);
    drawTrains(ctx, state, view, geoCache);
    drawStations(ctx, state, view, buildStationService(state, geoCache));
    drawDraft(ctx, state, view);
    effects.draw(ctx, state, view, geoCache);
  };

  return {
    canvas,
    get camera() {
      return camera;
    },
    resize,
    draw,
  };
}
