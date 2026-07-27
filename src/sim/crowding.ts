import { effectiveDemand } from './demand.ts';
import { lineCapacityPerHour } from './network.ts';
import type { GameState, Line } from './types.ts';

/**
 * Push the chosen trips onto the line segments they actually ride, then read
 * off each line's busiest segment. Flows are passengers per minute.
 */
export function assignFlows(state: GameState): void {
  const byId = new Map<number, Line>();
  for (const p of state.players) {
    for (const line of p.lines) {
      line.segmentFlow.fill(0);
      line.ridership = 0;
      byId.set(line.id, line);
    }
  }

  const n = state.neighborhoods.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const trips = effectiveDemand(state, i, j);
      if (trips <= 0) continue;
      for (let p = 0; p < state.players.length; p++) {
        const share = state.odShare[i][j][p + 1];
        if (share <= 0) continue;
        const flow = trips * share;
        const hops = state.routes[p].path[i][j];
        let lastLine = -1;
        for (const hop of hops) {
          const line = byId.get(hop.line);
          if (!line) continue;
          if (hop.seg < line.segmentFlow.length) line.segmentFlow[hop.seg] += flow;
          if (hop.line !== lastLine) {
            line.ridership += flow;
            lastLine = hop.line;
          }
        }
      }
    }
  }
}

export function updateLoadFactors(state: GameState): void {
  for (const p of state.players) {
    for (const line of p.lines) {
      let peak = 0;
      for (const f of line.segmentFlow) if (f > peak) peak = f;
      const capacity = lineCapacityPerHour(line);
      line.loadFactor = capacity > 0 ? (peak * 60) / capacity : peak > 0 ? Infinity : 0;
    }
  }
}
