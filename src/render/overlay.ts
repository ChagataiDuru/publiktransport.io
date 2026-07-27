import { effectiveDemand } from '../sim/demand.ts';
import type { GameState, Vec2 } from '../sim/types.ts';
import { COLORS, PLAYER_RGB, RGB, rgb, toScreen, type ViewState } from './view.ts';

/** F1 — segment flows: stroke width tracks passengers per minute. */
export function drawFlowOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState,
  geo: Map<number, { pts: Vec2[]; stationAt: number[] }>,
): void {
  let peak = 1;
  for (const p of state.players) {
    for (const l of p.lines) for (const f of l.segmentFlow) if (f > peak) peak = f;
  }

  ctx.lineCap = 'butt';
  ctx.font = '500 10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';

  for (const p of state.players) {
    for (const line of p.lines) {
      const g = geo.get(line.id);
      if (!g) continue;
      for (let i = 0; i < line.segmentFlow.length; i++) {
        const flow = line.segmentFlow[i];
        if (flow <= 0) continue;
        const a = g.stationAt[i];
        const b = g.stationAt[i + 1];
        const w = 2 + (flow / peak) * 22;

        ctx.beginPath();
        const p0 = toScreen(view.cam, g.pts[a]);
        ctx.moveTo(p0.x, p0.y);
        for (let k = a + 1; k <= b; k++) {
          const q = toScreen(view.cam, g.pts[k]);
          ctx.lineTo(q.x, q.y);
        }
        ctx.strokeStyle = rgb(RGB.paper, 0.22);
        ctx.lineWidth = w * view.cam.s;
        ctx.stroke();

        const mid = toScreen(view.cam, g.pts[Math.floor((a + b) / 2)]);
        ctx.fillStyle = rgb(RGB.paper, 0.85);
        ctx.fillText(flow.toFixed(0), mid.x, mid.y - 8);
      }
    }
  }
  ctx.textAlign = 'left';
  ctx.lineCap = 'round';
}

/** F2 — the 30 strongest desire lines, before anyone tries to serve them. */
export function drawDesireOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState,
): void {
  const n = state.neighborhoods.length;
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs.push({ i, j, d: effectiveDemand(state, i, j) + effectiveDemand(state, j, i) });
    }
  }
  pairs.sort((a, b) => b.d - a.d);
  const top = pairs.slice(0, 30);
  const max = top[0]?.d ?? 1;

  ctx.lineCap = 'round';
  for (const p of top) {
    const a: Vec2 = toScreen(view.cam, state.neighborhoods[p.i].centroid);
    const b: Vec2 = toScreen(view.cam, state.neighborhoods[p.j].centroid);
    const t = p.d / max;
    // Colour by who currently owns that flow.
    const s = state.odShare[p.i][p.j];
    let winner = 0;
    for (let mode = 1; mode < s.length; mode++) if (s[mode] > s[winner]) winner = mode;
    const c = winner === 0 ? RGB.car : PLAYER_RGB[winner - 1];
    ctx.strokeStyle = rgb(c, 0.15 + t * 0.5);
    ctx.lineWidth = 1 + t * 7;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

/**
 * The corridor picked out in the pressure panel. Answering "where are people
 * still driving?" is only useful if the answer lands on the map you build on,
 * so the panel points at the ground rather than just naming it.
 */
export function drawFocusPair(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState,
): void {
  const focus = view.focus;
  if (!focus || focus.fade <= 0) return;
  const alpha = Math.min(1, focus.fade);
  const pulse = 0.5 + 0.5 * Math.sin(view.time * 4);

  for (const id of [focus.i, focus.j]) {
    const nb = state.neighborhoods[id];
    ctx.beginPath();
    const p0 = toScreen(view.cam, nb.polygon[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let k = 1; k < nb.polygon.length; k++) {
      const p = toScreen(view.cam, nb.polygon[k]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgb(RGB.paper, alpha * (0.35 + pulse * 0.4));
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const a = toScreen(view.cam, state.neighborhoods[focus.i].centroid);
  const b = toScreen(view.cam, state.neighborhoods[focus.j].centroid);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = rgb(RGB.paper, alpha * 0.5);
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 8]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '600 12px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.paper;
  ctx.globalAlpha = alpha;
  ctx.fillText('UNSERVED DEMAND', (a.x + b.x) / 2, (a.y + b.y) / 2 - 10);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}
