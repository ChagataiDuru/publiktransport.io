import { PARAMS, PLAYER_COLORS } from '../sim/params.ts';
import { topPressure } from '../sim/pressure.ts';
import { secondsLeft } from '../sim/state.ts';
import type { Command, GameState, Id, PlayerId } from '../sim/types.ts';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const money = (v: number): string =>
  `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;

export interface Hud {
  update(state: GameState): void;
  /** Called when the player picks a corridor out of the pressure panel. */
  onFocusPair(handler: (i: Id, j: Id) => void): void;
  setSessionMeta(names: string[], botSeats: number[]): void;
  showTooltip(html: string, x: number, y: number, danger?: boolean): void;
  hideTooltip(): void;
}

const PRESSURE_ROWS = 4;

export function createHud(
  emit: (cmd: Command) => void,
  getPlayer: () => PlayerId = () => 0,
): Hud {
  const modalTrack = $('modalbar-track');
  const modalLegend = $('modalbar-legend');
  const clock = $('clock');
  const cash = $('cash');
  const net = $('net');
  const riders = $('riders');
  const leader = $('rivalcash');
  const lineList = $('hud-lines');
  const pressureList = $('pressure-list');
  const subsidy = $('subsidy');
  const standings = $('hud-standings');
  const tooltip = $('tooltip');
  const stage = $('stage');

  let names: string[] = [];
  let bots = new Set<number>();
  let listSig = '';
  let modalSig = '';
  let pressureSig = '';
  let focusHandler: (i: Id, j: Id) => void = () => {};
  let activePair = '';

  function setSessionMeta(nextNames: string[], botSeats: number[]): void {
    names = [...nextNames];
    bots = new Set(botSeats);
    modalSig = '';
  }

  function ensureModal(state: GameState): void {
    const sig = `${state.players.length}:${names.join('|')}`;
    if (sig === modalSig) return;
    modalSig = sig;
    modalTrack.innerHTML = '<div class="seg seg-car" data-mode="0"><span></span></div>';
    modalLegend.innerHTML = '<span style="color:var(--car)">CAR</span>';
    for (let p = 0; p < state.players.length; p++) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.dataset.mode = String(p + 1);
      seg.style.background = PLAYER_COLORS[p];
      seg.innerHTML = '<span></span>';
      modalTrack.appendChild(seg);
      const label = document.createElement('span');
      label.style.color = PLAYER_COLORS[p];
      label.textContent = `${p === getPlayer() ? 'YOU' : names[p] || `P${p + 1}`}`;
      modalLegend.appendChild(label);
    }
  }

  function update(state: GameState): void {
    ensureModal(state);
    for (let mode = 0; mode < state.cityShare.length; mode++) {
      const segment = modalTrack.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
      if (!segment) continue;
      const share = state.cityShare[mode];
      segment.style.width = `${(share * 100).toFixed(2)}%`;
      segment.firstElementChild!.textContent =
        share > 0.055
          ? `${(share * 100).toFixed(1)}% ${Math.round((state.totalPopulation * share) / 1000)}k`
          : '';
    }

    const left = secondsLeft(state);
    const mm = Math.floor(left / 60);
    const ss = Math.floor(left % 60);
    clock.textContent = `${mm}:${ss.toString().padStart(2, '0')}`;
    clock.classList.toggle('urgent', left <= 30);

    const player = Math.min(getPlayer(), state.players.length - 1);
    const me = state.players[player];
    cash.textContent = money(me.cash);
    cash.classList.toggle('neg', me.cash < PARAMS.TRAIN_COST);
    const delta = me.incomeRate + me.subsidyRate - me.upkeepRate;
    net.textContent = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}/s`;
    net.classList.toggle('neg', delta < 0);
    subsidy.textContent = `+${me.subsidyRate.toFixed(1)}/s`;
    subsidy.classList.toggle('dim', me.subsidyRate < 0.05);
    riders.textContent = `${Math.round(me.lines.reduce((a, line) => a + line.ridership, 0))}/min`;
    const ranked = [...state.players].sort((a, b) => b.score - a.score);
    leader.textContent = names[ranked[0].id] || `P${ranked[0].id + 1}`;

    renderStandings(state, player);
    renderLineList(state, me.lines, player);
    renderPressure(state, player);
  }

  /**
   * The one question worth asking every few seconds — where is the city still
   * driving, and why can't it ride me? Sim-side ranking, so the bot and the
   * player are reading the same board.
   */
  function renderPressure(state: GameState, player: PlayerId): void {
    const rows = topPressure(state, player, PRESSURE_ROWS);
    const sig = rows.map((row) => `${row.i}-${row.j}`).join('|') + activePair;
    if (sig === pressureSig) {
      for (const row of rows) {
        const drivers = pressureList.querySelector<HTMLElement>(`[data-drivers="${row.i}-${row.j}"]`);
        if (drivers) drivers.textContent = `${Math.round(row.demand * row.carShare)}/min`;
      }
      return;
    }
    pressureSig = sig;
    if (rows.length === 0) {
      pressureList.innerHTML = '<div class="empty">You are competitive everywhere.</div>';
      return;
    }
    pressureList.innerHTML = rows
      .map((row) => {
        const key = `${row.i}-${row.j}`;
        const why = Number.isFinite(row.transitSeconds)
          ? `${Math.round(row.transitSeconds)}s by rail vs <b>${Math.round(row.carSeconds)}s</b> driving`
          : 'no service at all';
        return `<div class="pressure-row ${key === activePair ? 'active' : ''}" data-pair="${key}">
            <span class="pair">${escapeHtml(shortName(state, row.i))} ↔ ${escapeHtml(shortName(state, row.j))}</span>
            <span class="drivers" data-drivers="${key}">${Math.round(row.demand * row.carShare)}/min</span>
            <span class="why">${why}</span>
          </div>`;
      })
      .join('');
  }

  pressureList.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-pair]');
    if (!row) return;
    activePair = row.dataset.pair ?? '';
    pressureSig = '';
    const [i, j] = activePair.split('-').map(Number);
    focusHandler(i, j);
  });

  function renderStandings(state: GameState, player: PlayerId): void {
    standings.innerHTML = [...state.players]
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .map(
        (entry, rank) => `
          <div class="standing ${entry.id === player ? 'mine' : ''}">
            <i style="background:${PLAYER_COLORS[entry.id]}"></i>
            <b>${rank + 1}</b>
            <span>${escapeHtml(names[entry.id] || `PLAYER ${entry.id + 1}`)}</span>
            ${bots.has(entry.id) ? '<em>BOT</em>' : ''}
            <strong>${(entry.cityShare * 100).toFixed(1)}%</strong>
          </div>`,
      )
      .join('');
  }

  function renderLineList(
    state: GameState,
    lines: GameState['players'][number]['lines'],
    player: PlayerId,
  ): void {
    const sig = `${player}:` + lines.map((line) => `${line.id}.${line.stations.length}.${line.trains}`).join('|');
    if (sig !== listSig) {
      listSig = sig;
      lineList.innerHTML = '';
      for (const line of lines) {
        const element = document.createElement('div');
        element.className = 'lineitem';
        element.style.borderLeftColor = line.color;
        element.innerHTML =
          `<span class="nm">LINE ${line.id + 1}</span>` +
          `<span class="st" data-st="${line.id}"></span>` +
          `<button data-act="sell" data-line="${line.id}" title="Sell a train">−</button>` +
          `<span class="tr" data-tr="${line.id}">1</span>` +
          `<button data-act="buy" data-line="${line.id}" title="Buy a train for ${money(PARAMS.TRAIN_COST)}">+</button>` +
          `<button data-act="del" data-line="${line.id}" title="Close line and refund 50%">×</button>`;
        lineList.appendChild(element);
      }
    }
    for (const line of lines) {
      const stat = lineList.querySelector<HTMLElement>(`[data-st="${line.id}"]`);
      const trains = lineList.querySelector<HTMLElement>(`[data-tr="${line.id}"]`);
      if (stat) {
        const load = line.trains > 0 ? `${(line.loadFactor * 100).toFixed(0)}%` : 'NO SVC';
        stat.innerHTML =
          `${Math.round(line.ridership)}/min <span class="load ${line.loadFactor > 1 ? 'hot' : ''}">${load}</span>`;
      }
      if (trains) trains.textContent = String(line.trains);
      const sell = lineList.querySelector<HTMLButtonElement>(`[data-act="sell"][data-line="${line.id}"]`);
      if (sell) sell.disabled = line.trains <= 0;
      const buy = lineList.querySelector<HTMLButtonElement>(`[data-act="buy"][data-line="${line.id}"]`);
      if (buy) {
        buy.disabled = state.players[player].cash < PARAMS.TRAIN_COST;
        if (buy.disabled) {
          buy.title = `Need ${money(Math.ceil(PARAMS.TRAIN_COST - state.players[player].cash))} more`;
        }
      }
    }
  }

  lineList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const player = getPlayer();
    const line = Number(button.dataset.line);
    if (button.dataset.act === 'buy') emit({ type: 'BuyTrain', player, line });
    if (button.dataset.act === 'sell') emit({ type: 'SellTrain', player, line });
    if (button.dataset.act === 'del') {
      const confirmed = window.confirm('Close this line and receive a 50% refund?');
      if (confirmed) emit({ type: 'DeleteLine', player, line });
    }
  });

  function showTooltip(html: string, x: number, y: number, danger = false): void {
    tooltip.innerHTML = html;
    tooltip.classList.toggle('danger', danger);
    tooltip.style.display = 'block';
    const gap = 16;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const bounds = stage.getBoundingClientRect();
    let left = x + gap;
    let top = y + gap;
    if (left + width > bounds.width - 10) left = x - width - gap;
    if (top + height > bounds.height - 10) top = y - height - gap;
    tooltip.style.left = `${Math.max(10, Math.min(left, bounds.width - width - 10))}px`;
    tooltip.style.top = `${Math.max(10, Math.min(top, bounds.height - height - 10))}px`;
  }

  return {
    update,
    onFocusPair(handler) {
      focusHandler = handler;
    },
    setSessionMeta,
    showTooltip,
    hideTooltip() {
      tooltip.style.display = 'none';
    },
  };
}

/** District names are long; the panel is narrow. */
function shortName(state: GameState, id: Id): string {
  return state.neighborhoods[id].name.toUpperCase();
}

function escapeHtml(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}
