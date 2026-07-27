import { PARAMS, PLAYER_COLORS } from '../sim/params.ts';
import type { GameState } from '../sim/types.ts';
import { COLORS, PLAYER_RGB, RGB, mix, rgb, toScreen, type ViewState } from './view.ts';

/**
 * District polygons filled by blending the three modal-share colours.
 * As people convert, the fill both shifts hue and brightens — conversion is
 * meant to read as a wave running across the map, not as a legend lookup.
 */
export function drawNeighborhoods(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState,
  displayShare: number[][],
): void {
  for (const nb of state.neighborhoods) {
    const share = displayShare[nb.id] ?? nb.share;
    const sc = share[0];
    const blended: [number, number, number] = [
      RGB.car[0] * sc,
      RGB.car[1] * sc,
      RGB.car[2] * sc,
    ];
    for (let p = 0; p < state.players.length; p++) {
      const amount = share[p + 1];
      blended[0] += PLAYER_RGB[p][0] * amount;
      blended[1] += PLAYER_RGB[p][1] * amount;
      blended[2] += PLAYER_RGB[p][2] * amount;
    }
    const transit = 1 - sc;
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

  // Every seat's home district, faintly outlined in its own colour, with the
  // local player's called out by name.
  for (const player of state.players) {
    const nb = state.neighborhoods[player.homeDistrict];
    ctx.beginPath();
    const p0 = toScreen(view.cam, nb.polygon[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < nb.polygon.length; i++) {
      const p = toScreen(view.cam, nb.polygon[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgb(PLAYER_RGB[player.id], player.id === view.localPlayer ? 0.5 : 0.22);
    ctx.lineWidth = player.id === view.localPlayer ? 2.5 : 1.5;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Rush-hour marker: telegraphed for a few seconds, then a hard pulse.
  const rush = state.rushHour;
  if (rush) {
    const nb = state.neighborhoods[rush.neighborhood];
    const c = toScreen(view.cam, nb.centroid);
    const pulse = 0.5 + 0.5 * Math.sin(view.time * (rush.active ? 9 : 5));
    const r = (rush.active ? 44 : 30) + pulse * 16;

    for (const id of [rush.neighborhood, rush.secondary]) {
      if (id < 0) continue;
      const surge = state.neighborhoods[id];
      ctx.beginPath();
      const q0 = toScreen(view.cam, surge.polygon[0]);
      ctx.moveTo(q0.x, q0.y);
      for (let i = 1; i < surge.polygon.length; i++) {
        const p = toScreen(view.cam, surge.polygon[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      const strength = id === rush.neighborhood ? 1 : 0.6;
      ctx.strokeStyle = rgb(
        RGB.rush,
        (rush.active ? 0.55 + pulse * 0.35 : 0.2 + pulse * 0.25) * strength,
      );
      ctx.lineWidth = (rush.active ? 3 : 2) * strength;
      ctx.stroke();
    }

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

    // The home callout hangs off the district name rather than the centroid,
    // where it would sit on top of whatever line runs through the middle.
    if (state.players[view.localPlayer]?.homeDistrict === nb.id) {
      ctx.font = '600 9px "Barlow Condensed", sans-serif';
      ctx.fillStyle = rgb(PLAYER_RGB[view.localPlayer], 0.75);
      ctx.fillText('HOME · CHEAPER TO BUILD', c.x, labelY + 12);
    }

    if (view.overlays.districts) {
      ctx.font = '400 10px "IBM Plex Mono", monospace';
      ctx.fillStyle = rgb(RGB.paper, 0.7);
      ctx.fillText(`${(nb.population / 1000).toFixed(0)}k  LV ${state.landValue[nb.id].toFixed(2)}`, c.x, c.y + 11);
      ctx.fillStyle = COLORS.car;
      ctx.fillText(`${(nb.share[0] * 100).toFixed(0)}%`, c.x - 34, c.y + 24);
      const winner = nb.share.slice(1).reduce((best, value, p, all) => (value > all[best] ? p : best), 0);
      ctx.fillStyle = PLAYER_COLORS[winner];
      ctx.fillText(`${(nb.share[winner + 1] * 100).toFixed(0)}% P${winner + 1}`, c.x + 30, c.y + 24);
    }
  }
  ctx.textAlign = 'left';
}
