import { PLAYER_COLORS } from '../sim/params.ts';
import type { GameState, Line, PlayerId } from '../sim/types.ts';

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const thousands = (value: number): string => `${Math.round(value / 1000).toLocaleString('en-US')}k`;

function bestLine(state: GameState): { line: Line; owner: number } | null {
  let best: { line: Line; owner: number } | null = null;
  for (const player of state.players) {
    for (const line of player.lines) {
      if (!best || line.ridership > best.line.ridership) best = { line, owner: player.id };
    }
  }
  return best;
}

export function createEndScreen(
  getPlayer: () => PlayerId,
  getNames: () => string[],
  onContinue: () => void,
): { update(state: GameState): void } {
  const root = document.getElementById('endscreen')!;
  let shownAt = -1;
  root.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-end-continue]')) onContinue();
  });

  return {
    update(state: GameState) {
      if (state.phase !== 'ended') {
        root.classList.remove('show');
        shownAt = -1;
        return;
      }
      if (shownAt === state.tick) return;
      shownAt = state.tick;

      const local = getPlayer();
      const names = getNames();
      const ranking = [...state.players].sort((a, b) => b.score - a.score || a.id - b.id);
      const rank = ranking.findIndex((player) => player.id === local) + 1;
      const tied = ranking.length > 1 && Math.abs(ranking[0].score - ranking[1].score) < 1;
      const best = bestLine(state);

      root.innerHTML = `
        <div class="end-card">
          <h1 style="color:${tied ? 'var(--paper)' : PLAYER_COLORS[ranking[0].id]}">
            ${tied ? 'DEAD HEAT' : rank === 1 ? 'YOU WIN' : `YOU PLACE #${rank}`}
          </h1>
          <div class="sub">FINAL MODAL SHARE · ${thousands(state.totalPopulation)} RESIDENTS</div>
          <div class="end-bar">
            ${state.cityShare
              .map(
                (share, mode) =>
                  `<div style="width:${share * 100}%;background:${mode === 0 ? 'var(--car)' : PLAYER_COLORS[mode - 1]}"></div>`,
              )
              .join('')}
          </div>
          <div class="end-ranking">
            ${ranking
              .map(
                (player, index) => `
                <div class="end-rank ${player.id === local ? 'mine' : ''}">
                  <b>${index + 1}</b>
                  <i style="background:${PLAYER_COLORS[player.id]}"></i>
                  <span>${escapeHtml(names[player.id] || `PLAYER ${player.id + 1}`)}</span>
                  <em>${thousands(player.score)} · ${pct(player.cityShare)}</em>
                  <small>${player.lines.length} lines · ${player.lines.reduce((a, line) => a + line.trains, 0)} trains</small>
                </div>`,
              )
              .join('')}
          </div>
          ${
            best
              ? `<div class="end-foot">BEST LINE ·
                  <b style="color:${best.line.color}">${escapeHtml(names[best.owner] || `P${best.owner + 1}`)} LINE ${best.line.id + 1}</b>
                  · ${Math.round(best.line.ridership).toLocaleString('en-US')} riders/min</div>`
              : ''
          }
          <button class="primary end-continue" data-end-continue>RETURN TO LOBBY / PLAY AGAIN</button>
        </div>`;
      root.classList.add('show');
    },
  };
}

function escapeHtml(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}
