import type { GameState, Line } from '../sim/types.ts';

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const thousands = (v: number): string => `${Math.round(v / 1000).toLocaleString('en-US')}k`;

function bestLine(state: GameState): { line: Line; owner: number } | null {
  let best: { line: Line; owner: number } | null = null;
  for (const p of state.players) {
    for (const l of p.lines) {
      if (!best || l.ridership > best.line.ridership) best = { line: l, owner: p.id };
    }
  }
  return best;
}

export function createEndScreen(): { update(state: GameState): void } {
  const root = document.getElementById('endscreen')!;
  let shownAt = -1;

  return {
    update(state: GameState) {
      if (state.phase !== 'ended') {
        root.classList.remove('show');
        shownAt = -1;
        return;
      }
      if (shownAt === state.tick) return;
      shownAt = state.tick;

      const [car, s1, s2] = state.cityShare;
      const me = state.players[0];
      const rival = state.players[1];
      const win = me.score > rival.score;
      const draw = Math.abs(me.score - rival.score) < 1;
      const best = bestLine(state);

      root.innerHTML = `
        <div class="end-card">
          <h1 style="color:${draw ? 'var(--paper)' : win ? 'var(--p1)' : 'var(--p2)'}">
            ${draw ? 'DEAD HEAT' : win ? 'YOU WIN' : 'RIVAL WINS'}
          </h1>
          <div class="sub">FINAL MODAL SHARE · ${thousands(state.totalPopulation)} RESIDENTS</div>

          <div class="end-bar">
            <div style="width:${car * 100}%;background:var(--car)"></div>
            <div style="width:${s1 * 100}%;background:var(--p1)"></div>
            <div style="width:${s2 * 100}%;background:var(--p2)"></div>
          </div>
          <div class="end-legend">
            <span style="color:var(--car)">CAR ${pct(car)}</span>
            <span style="color:var(--p1)">YOU ${pct(s1)}</span>
            <span style="color:var(--p2)">RIVAL ${pct(s2)}</span>
          </div>

          <div class="end-stats">
            <div class="r"><span>CONVERTED</span><span style="color:var(--p1)">${thousands(me.score)}</span></div>
            <div class="r"><span>CONVERTED</span><span style="color:var(--p2)">${thousands(rival.score)}</span></div>
            <div class="r"><span>LINES</span><span>${me.lines.length}</span></div>
            <div class="r"><span>LINES</span><span>${rival.lines.length}</span></div>
            <div class="r"><span>TRAINS</span><span>${me.lines.reduce((a, l) => a + l.trains, 0)}</span></div>
            <div class="r"><span>TRAINS</span><span>${rival.lines.reduce((a, l) => a + l.trains, 0)}</span></div>
            <div class="r"><span>CASH</span><span>$${Math.round(me.cash).toLocaleString('en-US')}</span></div>
            <div class="r"><span>CASH</span><span>$${Math.round(rival.cash).toLocaleString('en-US')}</span></div>
          </div>

          ${
            best
              ? `<div class="end-foot" style="letter-spacing:.12em">BEST LINE ·
                  <b style="color:${best.line.color}">LINE ${best.line.id + 1}</b>
                  <b>${Math.round(best.line.ridership).toLocaleString('en-US')}</b> riders/min ·
                  ${best.line.stations.length} stops ·
                  ${best.line.trains} trains</div>`
              : ''
          }
          <div class="end-foot">PRESS <b>R</b> TO PLAY AGAIN</div>
        </div>`;
      root.classList.add('show');
    },
  };
}
