import { PARAMS } from '../sim/params.ts';
import { secondsLeft } from '../sim/state.ts';
import type { Command, GameState, PlayerId } from '../sim/types.ts';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const money = (v: number): string =>
  `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;

export interface Hud {
  update(state: GameState): void;
  showTooltip(html: string, x: number, y: number): void;
  hideTooltip(): void;
}

export function createHud(emit: (cmd: Command) => void, player: PlayerId = 0): Hud {
  const segCar = document.querySelector<HTMLElement>('.seg-car')!;
  const segP1 = document.querySelector<HTMLElement>('.seg-p1')!;
  const segP2 = document.querySelector<HTMLElement>('.seg-p2')!;
  const clock = $('clock');
  const cash = $('cash');
  const net = $('net');
  const riders = $('riders');
  const rivalcash = $('rivalcash');
  const lineList = $('hud-lines');
  const tooltip = $('tooltip');

  let listSig = '';

  function update(state: GameState): void {
    const [c, p1, p2] = state.cityShare;
    segCar.style.width = `${(c * 100).toFixed(2)}%`;
    segP1.style.width = `${(p1 * 100).toFixed(2)}%`;
    segP2.style.width = `${(p2 * 100).toFixed(2)}%`;
    segCar.firstElementChild!.textContent = `${(c * 100).toFixed(1)}%  ${Math.round((state.totalPopulation * c) / 1000)}k`;
    segP1.firstElementChild!.textContent = p1 > 0.04 ? `${Math.round(state.players[0].score / 1000)}k` : '';
    segP2.firstElementChild!.textContent = p2 > 0.04 ? `${Math.round(state.players[1].score / 1000)}k` : '';

    const left = secondsLeft(state);
    const mm = Math.floor(left / 60);
    const ss = Math.floor(left % 60);
    clock.textContent = `${mm}:${ss.toString().padStart(2, '0')}`;
    clock.classList.toggle('urgent', left <= 30);

    const me = state.players[player];
    const rival = state.players[player === 0 ? 1 : 0];
    cash.textContent = money(me.cash);
    cash.classList.toggle('neg', me.cash < PARAMS.TRAIN_COST);
    const delta = me.incomeRate - me.upkeepRate;
    net.textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}/s`;
    net.classList.toggle('neg', delta < 0);
    riders.textContent = `${Math.round(me.lines.reduce((a, l) => a + l.ridership, 0))}/min`;
    rivalcash.textContent = money(rival.cash);

    renderLineList(state, me.lines);
  }

  function renderLineList(state: GameState, lines: GameState['players'][0]['lines']): void {
    const sig = lines.map((l) => `${l.id}.${l.stations.length}.${l.trains}`).join('|');
    if (sig !== listSig) {
      listSig = sig;
      lineList.innerHTML = '';
      for (const line of lines) {
        const el = document.createElement('div');
        el.className = 'lineitem';
        el.style.borderLeftColor = line.color;
        el.innerHTML =
          `<span class="nm">LINE ${line.id + 1}</span>` +
          `<span class="st" data-st="${line.id}"></span>` +
          `<button data-act="sell" data-line="${line.id}" title="Sell a train">−</button>` +
          `<span class="tr" data-tr="${line.id}">1</span>` +
          `<button data-act="buy" data-line="${line.id}" title="Buy a train">+</button>` +
          `<button data-act="del" data-line="${line.id}" title="Close the line">×</button>`;
        lineList.appendChild(el);
      }
    }
    for (const line of lines) {
      const st = lineList.querySelector<HTMLElement>(`[data-st="${line.id}"]`);
      const tr = lineList.querySelector<HTMLElement>(`[data-tr="${line.id}"]`);
      if (st) {
        const load = line.trains > 0 ? `${(line.loadFactor * 100).toFixed(0)}%` : 'NO SVC';
        st.innerHTML =
          `${Math.round(line.ridership)}/min <span class="load ${line.loadFactor > 1 ? 'hot' : ''}">${load}</span>`;
      }
      if (tr) tr.textContent = String(line.trains);
      const sell = lineList.querySelector<HTMLButtonElement>(`[data-act="sell"][data-line="${line.id}"]`);
      if (sell) sell.disabled = line.trains <= 0;
      const buy = lineList.querySelector<HTMLButtonElement>(`[data-act="buy"][data-line="${line.id}"]`);
      if (buy) buy.disabled = state.players[player].cash < PARAMS.TRAIN_COST;
    }
  }

  lineList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!btn) return;
    const line = Number(btn.dataset.line);
    if (btn.dataset.act === 'buy') emit({ type: 'BuyTrain', player, line });
    if (btn.dataset.act === 'sell') emit({ type: 'SellTrain', player, line });
    if (btn.dataset.act === 'del') emit({ type: 'DeleteLine', player, line });
  });

  return {
    update,
    showTooltip(html, x, y) {
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';
      tooltip.style.left = `${x + 16}px`;
      tooltip.style.top = `${y + 16}px`;
    },
    hideTooltip() {
      tooltip.style.display = 'none';
    },
  };
}
