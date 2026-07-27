import { freePlatforms, getAdjacency } from '../sim/commands.ts';
import { edgeKey } from '../sim/map.ts';
import type { GameState, Id, Line, Vec2 } from '../sim/types.ts';
import { RGB, rgb, toScreen, type Camera, type ViewState } from './view.ts';

const LINE_WIDTH = 6;
const PARALLEL_OFFSET = 8;

/**
 * Beck's diagram grammar: a corridor runs at 0/45/90 degrees only. Anything
 * else is resolved with exactly one elbow — straight along the dominant axis
 * first, then a 45-degree run into the destination.
 */
export function octilinear(a: Vec2, b: Vec2): Vec2[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < 1 || ady < 1 || Math.abs(adx - ady) < 1) return [a, b];
  if (adx > ady) {
    const k = adx - ady;
    return [a, { x: a.x + Math.sign(dx) * k, y: a.y }, b];
  }
  const k = ady - adx;
  return [a, { x: a.x, y: a.y + Math.sign(dy) * k }, b];
}

function normals(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy) || 1;
    out.push({ x: -dy / len, y: dx / len });
  }
  return out;
}

/**
 * Offset a polyline sideways, allowing a different distance per segment
 * (a line's slot changes when it enters a corridor shared with other lines).
 * Interior vertices use a clamped miter join.
 */
export function offsetPolyline(pts: Vec2[], d: number[]): Vec2[] {
  if (pts.length < 2) return pts.slice();
  const n = normals(pts);
  const out: Vec2[] = [];
  out.push({ x: pts[0].x + n[0].x * d[0], y: pts[0].y + n[0].y * d[0] });
  for (let i = 1; i < pts.length - 1; i++) {
    const a = n[i - 1];
    const b = n[i];
    const dd = (d[i - 1] + d[i]) / 2;
    let bx = a.x + b.x;
    let by = a.y + b.y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) {
      // 180-degree reversal — nothing sensible to miter into.
      out.push({ x: pts[i].x + b.x * dd, y: pts[i].y + b.y * dd });
      continue;
    }
    bx /= bl;
    by /= bl;
    const cos = bx * b.x + by * b.y;
    const miter = Math.max(-3, Math.min(3, dd / (Math.abs(cos) < 0.2 ? 0.2 : cos)));
    out.push({ x: pts[i].x + bx * miter, y: pts[i].y + by * miter });
  }
  const last = pts.length - 1;
  const nl = n[n.length - 1];
  const dl = d[d.length - 1];
  out.push({ x: pts[last].x + nl.x * dl, y: pts[last].y + nl.y * dl });
  return out;
}

/** corridor key -> ordered list of line ids sharing it (both players). */
export type CorridorSlots = Map<number, number[]>;

export function buildCorridorSlots(state: GameState): CorridorSlots {
  const slots: CorridorSlots = new Map();
  for (const p of state.players) {
    for (const line of p.lines) {
      for (let i = 0; i + 1 < line.stations.length; i++) {
        const k = edgeKey(line.stations[i], line.stations[i + 1]);
        const list = slots.get(k);
        if (list) {
          if (!list.includes(line.id)) list.push(line.id);
        } else {
          slots.set(k, [line.id]);
        }
      }
    }
  }
  for (const list of slots.values()) list.sort((a, b) => a - b);
  return slots;
}

/**
 * World-space polyline for a line, octilinear and offset off its neighbours.
 * Also returns which raw vertex each station landed on so trains and labels
 * can be placed without recomputing.
 */
export function linePolyline(
  state: GameState,
  line: Line,
  slots: CorridorSlots,
): { pts: Vec2[]; stationAt: number[] } {
  const raw: Vec2[] = [];
  const segD: number[] = [];
  const stationAt: number[] = [];

  for (let i = 0; i + 1 < line.stations.length; i++) {
    const aId = line.stations[i];
    const bId = line.stations[i + 1];
    const list = slots.get(edgeKey(aId, bId)) ?? [line.id];
    const idx = Math.max(0, list.indexOf(line.id));

    // Build the elbow in a canonical direction (low station id first) so that
    // two lines sharing a corridor never swap sides halfway along it.
    const lo = Math.min(aId, bId);
    const hi = Math.max(aId, bId);
    const forward = aId === lo;
    let seg = octilinear(state.stations[lo].pos, state.stations[hi].pos);
    if (!forward) seg = seg.slice().reverse();
    // Reversing the traversal flips the perpendicular, so flip the slot too.
    const d = (idx - (list.length - 1) / 2) * PARALLEL_OFFSET * (forward ? 1 : -1);

    if (raw.length === 0) {
      raw.push(seg[0]);
      stationAt.push(0);
    }
    for (let s = 1; s < seg.length; s++) {
      raw.push(seg[s]);
      segD.push(d);
    }
    stationAt.push(raw.length - 1);
  }

  const pts = offsetPolyline(raw, segD);
  return { pts, stationAt };
}

function strokePolyline(ctx: CanvasRenderingContext2D, cam: Camera, pts: Vec2[]): void {
  ctx.beginPath();
  const p0 = toScreen(cam, pts[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const p = toScreen(cam, pts[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

/** Faint hatch of every corridor track could be laid on. */
export function drawCorridors(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState,
): void {
  ctx.lineCap = 'round';
  for (const e of state.edges) {
    const pts = octilinear(state.stations[e.a].pos, state.stations[e.b].pos);
    ctx.strokeStyle = rgb(RGB.paper, e.express ? 0.09 : 0.17);
    ctx.lineWidth = e.express ? 1 : 2;
    if (e.express) ctx.setLineDash([5, 7]);
    strokePolyline(ctx, view.cam, pts);
    ctx.setLineDash([]);
  }
}

export function drawLines(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState,
  cache: Map<number, { pts: Vec2[]; stationAt: number[] }>,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of state.players) {
    for (const line of p.lines) {
      const geo = cache.get(line.id);
      if (!geo || geo.pts.length < 2) continue;

      // Halo keeps lines legible where they cross a bright district.
      ctx.strokeStyle = rgb(RGB.ink, 0.75);
      ctx.lineWidth = (LINE_WIDTH + 5) * view.cam.s;
      strokePolyline(ctx, view.cam, geo.pts);

      // Over-capacity lines pulse red *around* the line, never over it — the
      // crowding valve made visible without losing whose line it is.
      if (line.loadFactor > 1) {
        const t = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(view.time * 6));
        ctx.strokeStyle = rgb(RGB.rush, Math.min(0.85, t * Math.min(1.6, line.loadFactor)));
        ctx.lineWidth = (LINE_WIDTH + 5) * view.cam.s;
        strokePolyline(ctx, view.cam, geo.pts);
      }

      ctx.strokeStyle = line.color;
      ctx.lineWidth = LINE_WIDTH * view.cam.s;
      if (line.servicePlan === 'express') ctx.setLineDash([14 * view.cam.s, 4 * view.cam.s]);
      strokePolyline(ctx, view.cam, geo.pts);
      ctx.setLineDash([]);

      if (line.dispatchEndsAtTick > state.tick) {
        ctx.strokeStyle = rgb(RGB.paper, 0.28 + 0.2 * Math.sin(view.time * 10));
        ctx.lineWidth = (LINE_WIDTH + 2) * view.cam.s;
        strokePolyline(ctx, view.cam, geo.pts);
      }
    }
  }
}

/** Live preview of the line under construction, with its running cost. */
export function drawDraft(ctx: CanvasRenderingContext2D, state: GameState, view: ViewState): void {
  const draft = view.draft;
  if (!draft || draft.stations.length === 0) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const color = draft.candidateValid || draft.candidate === null ? RGB.p1 : RGB.rush;

  const chain: Id[] = draft.stations.slice();

  // Light up every stop the open end can actually reach. Track only follows
  // corridors that exist, and without this the rule is invisible — you click a
  // station across the map, nothing happens, and the game looks broken.
  const tailId0 = chain[chain.length - 1];
  for (const nId of getAdjacency(state)[tailId0] ?? []) {
    if (chain.includes(nId)) continue;
    const open = freePlatforms(state, nId) >= 1;
    const seg = octilinear(state.stations[tailId0].pos, state.stations[nId].pos);
    ctx.strokeStyle = rgb(open ? RGB.p1 : RGB.rush, 0.3);
    ctx.lineWidth = 2;
    strokePolyline(ctx, view.cam, seg);

    const c = toScreen(view.cam, state.stations[nId].pos);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 13 * view.cam.s, 0, Math.PI * 2);
    ctx.strokeStyle = rgb(open ? RGB.p1 : RGB.rush, 0.55);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  const pts: Vec2[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const seg = octilinear(state.stations[chain[i]].pos, state.stations[chain[i + 1]].pos);
    for (const s of seg) {
      if (pts.length === 0 || pts[pts.length - 1] !== s) pts.push(s);
    }
  }

  if (pts.length >= 2) {
    ctx.strokeStyle = rgb(RGB.p1, 0.95);
    ctx.lineWidth = LINE_WIDTH * view.cam.s;
    ctx.setLineDash([]);
    strokePolyline(ctx, view.cam, pts);
  }

  // Rubber band from the open end to the cursor.
  const tailId = chain[chain.length - 1];
  const tail = state.stations[tailId].pos;
  const target = draft.candidate !== null ? state.stations[draft.candidate].pos : draft.cursor;
  if (target) {
    const seg = octilinear(tail, target);
    ctx.strokeStyle = rgb(color, 0.7);
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    strokePolyline(ctx, view.cam, seg);
    ctx.setLineDash([]);
  }

}
