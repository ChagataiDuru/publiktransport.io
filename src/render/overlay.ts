import { effectiveDemand } from '../sim/demand.ts';
import type { GameState, Vec2 } from '../sim/types.ts';
import { RGB, rgb, toScreen, type ViewState } from './view.ts';

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
    const c =
      s[1] > s[2] && s[1] > s[0] ? RGB.p1 : s[2] > s[0] ? RGB.p2 : RGB.car;
    ctx.strokeStyle = rgb(c, 0.15 + t * 0.5);
    ctx.lineWidth = 1 + t * 7;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}
