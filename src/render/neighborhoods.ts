import { PARAMS } from '../sim/params.ts';
import type { GameState } from '../sim/types.ts';
import { COLORS, RGB, mix, rgb, toScreen, type ViewState } from './view.ts';

/**
 * District polygons filled by blending the three modal-share colours.
 * As people convert, the fill both shifts hue and brightens — conversion is
 * meant to read as a wave running across the map, not as a legend lookup.
 */
export function drawNeighborhoods(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState,
  displayShare: [number, number, number][],
): void {
  for (const nb of state.neighborhoods) {
    const [sc, s1, s2] = displayShare[nb.id] ?? nb.share;
    const blended: [number, number, number] = [
      RGB.car[0] * sc + RGB.p1[0] * s1 + RGB.p2[0] * s2,
      RGB.car[1] * sc + RGB.p1[1] * s1 + RGB.p2[1] * s2,
      RGB.car[2] * sc + RGB.p1[2] * s1 + RGB.p2[2] * s2,
    ];
    const transit = s1 + s2;
    const fill = mix(RGB.ink2, blended, 0.16 + 0.5 * transit);

    ctx.beginPath();
    const p0 = toScreen(view.cam, nb.polygon[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < nb.polygon.length; i++) {
      const p = toScreen(view.cam, nb.polygon[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = rgb(fill, 1);
    ctx.fill();

    ctx.strokeStyle = rgb(RGB.ink, 0.85);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Rush-hour marker: telegraphed for a few seconds, then a hard pulse.
  const rush = state.rushHour;
  if (rush) {
    const nb = state.neighborhoods[rush.neighborhood];
    const c = toScreen(view.cam, nb.centroid);
    const pulse = 0.5 + 0.5 * Math.sin(view.time * (rush.active ? 9 : 5));
    const r = (rush.active ? 44 : 30) + pulse * 16;

    ctx.beginPath();
    const p0 = toScreen(view.cam, nb.polygon[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < nb.polygon.length; i++) {
      const p = toScreen(view.cam, nb.polygon[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgb(RGB.rush, rush.active ? 0.55 + pulse * 0.35 : 0.2 + pulse * 0.25);
    ctx.lineWidth = rush.active ? 3 : 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(c.x, c.y, r * view.cam.s, 0, Math.PI * 2);
    ctx.strokeStyle = rgb(RGB.rush, 0.35 + pulse * 0.3);
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '600 13px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.rush;
    const secs = rush.active
      ? (rush.endsAtTick - state.tick) / PARAMS.TICK_HZ
      : (rush.startsAtTick - state.tick) / PARAMS.TICK_HZ;
    ctx.fillText(
      rush.active ? `RUSH HOUR  ${secs.toFixed(0)}s` : `RUSH INCOMING  ${secs.toFixed(0)}s`,
      c.x,
      c.y - r * view.cam.s - 8,
    );
    ctx.textAlign = 'left';
  }

  // District labels sit under everything else, quiet by default. Where a
  // station sits on the centroid, drop the label below it so the two names
  // never stack on each other.
  ctx.textAlign = 'center';
  for (const nb of state.neighborhoods) {
    const c = toScreen(view.cam, nb.centroid);
    let crowded = false;
    for (const st of state.stations) {
      if (st.neighborhood !== nb.id) continue;
      const dx = st.pos.x - nb.centroid.x;
      const dy = st.pos.y - nb.centroid.y;
      if (dx * dx + dy * dy < 55 * 55) {
        crowded = true;
        break;
      }
    }
    const labelY = crowded ? c.y + 34 : c.y - 4;
    ctx.font = '600 12px "Barlow Condensed", sans-serif';
    ctx.fillStyle = rgb(RGB.paper, 0.34);
    ctx.fillText(nb.name.toUpperCase(), c.x, labelY);

    if (view.overlays.districts) {
      ctx.font = '400 10px "IBM Plex Mono", monospace';
      ctx.fillStyle = rgb(RGB.paper, 0.7);
      ctx.fillText(`${(nb.population / 1000).toFixed(0)}k  LV ${state.landValue[nb.id].toFixed(2)}`, c.x, c.y + 11);
      ctx.fillStyle = COLORS.car;
      ctx.fillText(`${(nb.share[0] * 100).toFixed(0)}%`, c.x - 34, c.y + 24);
      ctx.fillStyle = COLORS.p1;
      ctx.fillText(`${(nb.share[1] * 100).toFixed(0)}%`, c.x, c.y + 24);
      ctx.fillStyle = COLORS.p2;
      ctx.fillText(`${(nb.share[2] * 100).toFixed(0)}%`, c.x + 34, c.y + 24);
    }
  }
  ctx.textAlign = 'left';
}
