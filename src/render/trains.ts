import type { GameState, Vec2 } from '../sim/types.ts';
import { RGB, rgb, toScreen, type ViewState } from './view.ts';

interface Measured {
  pts: Vec2[];
  cum: number[];
  total: number;
}

const measured = new WeakMap<Vec2[], Measured>();

function measure(pts: Vec2[]): Measured {
  const cached = measured.get(pts);
  if (cached) return cached;
  const cum = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cum.push(total);
  }
  const m = { pts, cum, total };
  measured.set(pts, m);
  return m;
}

function at(m: Measured, s: number): Vec2 {
  if (m.total <= 0) return m.pts[0];
  const d = Math.max(0, Math.min(m.total, s));
  let lo = 0;
  let hi = m.cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (m.cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = m.cum[hi] - m.cum[lo] || 1;
  const t = (d - m.cum[lo]) / span;
  return {
    x: m.pts[lo].x + (m.pts[hi].x - m.pts[lo].x) * t,
    y: m.pts[lo].y + (m.pts[hi].y - m.pts[lo].y) * t,
  };
}

/**
 * Purely cosmetic. The sim has no idea these exist — it only knows headway and
 * load factor. One dot per owned train, evenly spaced around the round trip,
 * sized by how full the line is running.
 */
export function drawTrains(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState,
  geo: Map<number, { pts: Vec2[]; stationAt: number[] }>,
): void {
  for (const p of state.players) {
    for (const line of p.lines) {
      if (line.trains <= 0) continue;
      const g = geo.get(line.id);
      if (!g || g.pts.length < 2) continue;
      const m = measure(g.pts);
      if (m.total <= 0) continue;

      const rtt = Math.max(4, line.roundTripTime);
      const fullness = Math.min(1.4, line.loadFactor);
      const radius = (2.4 + fullness * 1.6) * view.cam.s;

      for (let i = 0; i < line.trains; i++) {
        // Position around a there-and-back loop of length 2 * total.
        const phase = ((view.time / rtt + i / line.trains) % 1) * 2 * m.total;
        const s = phase <= m.total ? phase : 2 * m.total - phase;
        const pos = toScreen(view.cam, at(m, s));

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 1.6, 0, Math.PI * 2);
        ctx.fillStyle = rgb(RGB.ink, 0.9);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = line.loadFactor > 1 ? rgb(RGB.rush, 0.95) : rgb(RGB.paper, 0.92);
        ctx.fill();
      }
    }
  }
}
