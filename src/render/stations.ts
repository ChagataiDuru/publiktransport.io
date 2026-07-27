import type { GameState, Id, Line, Vec2 } from '../sim/types.ts';
import { lineServesStation } from '../sim/network.ts';
import { RGB, rgb, toScreen, type ViewState } from './view.ts';

export interface StationService {
  lines: Line[];
  /** Local tangent of the first line through the station, for capsule angle. */
  tangent: Vec2 | null;
}

export function buildStationService(
  state: GameState,
  geo: Map<number, { pts: Vec2[]; stationAt: number[] }>,
): Map<Id, StationService> {
  const map = new Map<Id, StationService>();
  for (const p of state.players) {
    for (const line of p.lines) {
      const g = geo.get(line.id);
      for (let i = 0; i < line.stations.length; i++) {
        const s = line.stations[i];
        let entry = map.get(s);
        if (!entry) {
          entry = { lines: [], tangent: null };
          map.set(s, entry);
        }
        entry.lines.push(line);
        if (!entry.tangent && g && g.pts.length >= 2) {
          const at = g.stationAt[i];
          const a = g.pts[Math.max(0, at - 1)];
          const b = g.pts[Math.min(g.pts.length - 1, at + 1)];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          if (len > 0.001) entry.tangent = { x: dx / len, y: dy / len };
        }
      }
    }
  }
  return map;
}

function capsule(
  ctx: CanvasRenderingContext2D,
  c: Vec2,
  t: Vec2,
  half: number,
  r: number,
): void {
  ctx.beginPath();
  const ax = c.x - t.x * half;
  const ay = c.y - t.y * half;
  const bx = c.x + t.x * half;
  const by = c.y + t.y * half;
  const ang = Math.atan2(t.y, t.x);
  ctx.arc(ax, ay, r, ang + Math.PI / 2, ang - Math.PI / 2);
  ctx.arc(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2);
  ctx.closePath();
}

/**
 * Metro-map vernacular, not decoration: a plain stop is a ring, an interchange
 * is an elongated capsule. Platform pips under each stop show how much of the
 * shared capacity is already taken — by either player.
 */
export function drawStations(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState,
  service: Map<Id, StationService>,
): void {
  const s = view.cam.s;

  for (const st of state.stations) {
    const c = toScreen(view.cam, st.pos);
    const svc = service.get(st.id);
    const served = svc ? svc.lines.length : 0;
    const passedOnly = Boolean(svc && svc.lines.every((line) => !lineServesStation(line, st.id, state.stations)));
    const r = (st.isHub ? 10 : 7) * s;

    if (served >= 2 && svc?.tangent) {
      ctx.fillStyle = rgb(RGB.ink);
      capsule(ctx, c, svc.tangent, r * 0.95, r);
      ctx.fill();
      ctx.strokeStyle = rgb(RGB.paper, 0.95);
      ctx.lineWidth = 2.2;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = served > 0 && !passedOnly ? rgb(RGB.ink) : rgb(RGB.ink2);
      ctx.fill();
      ctx.strokeStyle = rgb(
        RGB.paper,
        passedOnly ? 0.42 : served > 0 ? 0.95 : st.isHub ? 0.5 : 0.32,
      );
      if (passedOnly) ctx.setLineDash([2, 3]);
      ctx.lineWidth = st.isHub ? 2.4 : 1.7;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Platform pips.
    const used = state.platformUsage[st.id];
    const pipW = 3 * s;
    const gap = 2 * s;
    const total = st.platforms;
    const startX = c.x - ((total - 1) * (pipW + gap)) / 2;
    const y = c.y + r + 5 * s;
    for (let i = 0; i < total; i++) {
      ctx.fillStyle = i < used ? rgb(RGB.paper, 0.8) : rgb(RGB.paper, 0.16);
      ctx.fillRect(startX + i * (pipW + gap) - pipW / 2, y, pipW, pipW);
    }

    if (st.isHub && served === 0) {
      ctx.font = '600 10px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = rgb(RGB.paper, 0.4);
      ctx.fillText(st.name.toUpperCase(), c.x, c.y - r - 6);
      ctx.textAlign = 'left';
    }
  }

  // Names for served stations, drawn last so they sit above the network.
  ctx.font = '600 11px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center';
  for (const [id, svc] of service) {
    const st = state.stations[id];
    const c = toScreen(view.cam, st.pos);
    const r = (st.isHub ? 10 : 7) * s;
    const label = st.name.toUpperCase();
    ctx.fillStyle = rgb(RGB.ink, 0.8);
    const w = ctx.measureText(label).width;
    ctx.fillRect(c.x - w / 2 - 3, c.y - r - 17, w + 6, 13);
    ctx.fillStyle = rgb(RGB.paper, svc.lines.length >= 2 ? 0.95 : 0.72);
    ctx.fillText(label, c.x, c.y - r - 7);
  }
  ctx.textAlign = 'left';

  // Hover ring.
  if (view.hoverStation !== null) {
    const st = state.stations[view.hoverStation];
    const c = toScreen(view.cam, st.pos);
    ctx.beginPath();
    ctx.arc(c.x, c.y, (st.isHub ? 10 : 7) * s + 6, 0, Math.PI * 2);
    ctx.strokeStyle = rgb(RGB.p1, 0.9);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}
