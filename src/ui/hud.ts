import { PARAMS, PLAYER_COLORS } from '../sim/params.ts';
import { topPressure } from '../sim/pressure.ts';
import { secondsLeft } from '../sim/state.ts';
import { districtFrontlines } from '../sim/rivalry.ts';
import type { Command, GameEvent, GameState, Id, PlayerId } from '../sim/types.ts';

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
  const contractCard = $('hud-contract');
  const frontlinesCard = $('hud-frontlines');
  const eventFeed = $('hud-events');
  const impactCard = $('impact-card');
  const openingGuide = $('opening-guide');

  let names: string[] = [];
  let bots = new Set<number>();
  let listSig = '';
  let modalSig = '';
  let pressureSig = '';
  let focusHandler: (i: Id, j: Id) => void = () => {};
  let activePair = '';
  let eventCursor = 0;
  let eventSeed = -1;
  let eventTick = -1;
  let firstBuildSeen = false;
  let crowdingHintSeen = false;
  let impact: {
    event: Extract<GameEvent, { kind: 'serviceOpened' | 'lineExtended' }>;
    tick: number;
    riders: number;
    net: number;
    shares: number[];
  } | null = null;
  let impactUntil = -1;
  let stateForUi: GameState | null = null;

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
    stateForUi = state;
    ensureModal(state);
    for (let mode = 0; mode < state.cityShare.length; mode++) {
      const segment = modalTrack.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
      if (!segment) continue;
      const share = state.cityShare[mode];
      segment.style.width = `${(share * 100).toFixed(2)}%`;
      segment.firstElementChild!.textContent =
        share > 0.055 || mode === getPlayer() + 1
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
    renderContract(state, player);
    renderFrontlines(state, player);
    consumeEvents(state, player);
    renderGuidance(state, player);
  }

  function consumeEvents(state: GameState, player: PlayerId): void {
    if (eventSeed !== state.seed || state.tick < eventTick) {
      eventSeed = state.seed;
      eventTick = state.tick;
      eventCursor = state.events.at(-1)?.id ?? 0;
      firstBuildSeen = false;
      crowdingHintSeen = false;
      impact = null;
      impactUntil = -1;
      return;
    }
    eventTick = state.tick;
    for (const event of state.events) {
      if (event.id <= eventCursor) continue;
      eventCursor = event.id;
      if (
        event.player === player &&
        (event.kind === 'serviceOpened' || event.kind === 'lineExtended')
      ) {
        firstBuildSeen = true;
        const districtIds =
          event.kind === 'serviceOpened'
            ? event.stationIds.map((id) => state.stations[id].neighborhood)
            : [state.stations[event.stationId].neighborhood];
        impact = {
          event,
          tick: state.tick,
          riders: state.players[player].lines.reduce((sum, line) => sum + line.ridership, 0),
          net:
            state.players[player].incomeRate +
            state.players[player].subsidyRate -
            state.players[player].upkeepRate,
          shares: state.neighborhoods.map((district) =>
            districtIds.includes(district.id) ? district.share[player + 1] : Number.NaN,
          ),
        };
      }
    }
    renderEventFeed(state);
    if (impact && state.tick >= impact.tick + Math.round(PARAMS.TICK_HZ * 2)) {
      const nowRiders = state.players[player].lines.reduce((sum, line) => sum + line.ridership, 0);
      const nowNet =
        state.players[player].incomeRate +
        state.players[player].subsidyRate -
        state.players[player].upkeepRate;
      const shareDelta = state.neighborhoods
        .map((district) => ({
          name: district.name,
          delta: Number.isNaN(impact!.shares[district.id])
            ? 0
            : district.share[player + 1] - impact!.shares[district.id],
        }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
      const title =
        impact.event.kind === 'serviceOpened'
          ? `LINE ${impact.event.lineId + 1} OPENED`
          : `LINE ${impact.event.lineId + 1} EXTENDED`;
      impactCard.innerHTML =
        `<b>${title}</b>` +
        `<span>${signed(Math.round(nowRiders - impact.riders))} riders/min</span>` +
        (shareDelta && Math.abs(shareDelta.delta) >= 0.0005
          ? `<span>${signed(shareDelta.delta * 100, 1)} pts transit in ${escapeHtml(shareDelta.name)}</span>`
          : '') +
        `<span>${signed(nowNet - impact.net, 1)}/s network net</span>`;
      impactCard.classList.add('show');
      impactUntil = state.tick + Math.round(PARAMS.TICK_HZ * 5);
      impact = null;
    }
    if (impactUntil >= 0 && state.tick >= impactUntil) impactCard.classList.remove('show');
  }

  function renderEventFeed(state: GameState): void {
    eventFeed.innerHTML = state.events
      .slice(-4)
      .reverse()
      .map(
        (event) =>
          `<div style="border-left-color:${event.player >= 0 ? PLAYER_COLORS[event.player] : 'var(--paper)'}">${escapeHtml(eventText(state, event))}</div>`,
      )
      .join('');
  }

  function renderGuidance(state: GameState, player: PlayerId): void {
    const me = state.players[player];
    if (!firstBuildSeen && state.tick < PARAMS.TICK_HZ * 30) {
      openingGuide.textContent = 'EXTEND YOUR STARTER LINE';
      openingGuide.className = 'hud show';
      return;
    }
    const crowded = me.lines.find((line) => line.loadFactor > 1);
    if (!crowdingHintSeen && crowded) {
      openingGuide.textContent = `LINE ${crowded.id + 1} OVERCROWDED — ADD A TRAIN`;
      openingGuide.className = 'hud show danger';
      crowdingHintSeen = true;
      window.setTimeout(() => openingGuide.classList.remove('show'), 5500);
      return;
    }
    if (!crowded) openingGuide.classList.remove('show');
  }

  function renderContract(state: GameState, player: PlayerId): void {
    const mandate = state.finalMandate;
    const contract = state.civicContract;
    if (mandate) {
      const seconds = mandate.active
        ? secondsLeft(state)
        : Math.max(0, (mandate.startsAtTick - state.tick) / PARAMS.TICK_HZ);
      contractCard.innerHTML = `<div class="contract-title final">FINAL MANDATE</div>
        <b>${escapeHtml(shortName(state, mandate.originId))} ↔ ${escapeHtml(shortName(state, mandate.destinationId))}</b>
        <span>${mandate.active ? 'ACTIVE UNTIL FINISH' : `OPENS IN ${Math.ceil(seconds)}s`}</span>`;
      contractCard.classList.add('show');
      return;
    }
    if (!contract) {
      contractCard.classList.remove('show');
      return;
    }
    const seconds =
      contract.phase === 'announced'
        ? (contract.startsAtTick - state.tick) / PARAMS.TICK_HZ
        : (contract.endsAtTick - state.tick) / PARAMS.TICK_HZ;
    contractCard.innerHTML = `<div class="contract-title">CIVIC CONTRACT · ${contract.phase.toUpperCase()}</div>
      <b>${escapeHtml(shortName(state, contract.originId))} ↔ ${escapeHtml(shortName(state, contract.destinationId))}</b>
      <span>${contract.phase === 'resolved' ? contract.winner === null ? 'NO AWARD' : `${names[contract.winner] || `P${contract.winner + 1}`} WON ${money(contract.reward)}` : `${Math.max(0, Math.ceil(seconds))}s · ${money(contract.reward)} GRANT · +${Math.round(contract.targetGain * 100)} PTS`}</span>
      <div class="contract-bars">${state.players
        .map((entry) => {
          const gain = contract.currentGains[entry.id] ?? 0;
          const width = Math.max(0, Math.min(100, (gain / contract.targetGain) * 100));
          return `<label><em>${entry.id === player ? 'YOU' : names[entry.id] || `P${entry.id + 1}`}</em><i><u style="width:${width}%;background:${PLAYER_COLORS[entry.id]}"></u></i><strong>${signed(gain * 100, 1)}</strong></label>`;
        })
        .join('')}</div>`;
    contractCard.classList.add('show');
  }

  function renderFrontlines(state: GameState, player: PlayerId): void {
    const rows = districtFrontlines(state)
      .filter((front) => front.contested || front.leader === player || front.runnerUp === player)
      .sort(
        (a, b) =>
          Number(b.contested) - Number(a.contested) ||
          b.population - a.population ||
          a.districtId - b.districtId,
      )
      .slice(0, 3);
    frontlinesCard.innerHTML =
      '<div class="ph">FRONTLINES</div>' +
      rows
        .map(
          (front) =>
            `<button data-frontline="${front.districtId}"><b>${escapeHtml(shortName(state, front.districtId))}</b><span>${front.contested ? 'CONTESTED' : front.leader === player ? 'DEFEND' : 'CAPTURE'} · ${(front.gap * 100).toFixed(1)} pt gap</span></button>`,
        )
        .join('');
  }

  frontlinesCard.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-frontline]');
    if (!button) return;
    const district = Number(button.dataset.frontline);
    focusHandler(district, district);
  });

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
    const sig = `${player}:` + lines.map((line) => `${line.id}.${line.stations.length}.${line.trains}.${line.servicePlan}`).join('|');
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
          `<button data-act="dispatch" data-line="${line.id}" title="Rapid Dispatch for ${money(PARAMS.RAPID_DISPATCH_COST)}">⚡</button>` +
          `<button data-act="plan" data-line="${line.id}" title="Toggle Local / Express">${line.servicePlan === 'express' ? 'EXP' : 'LOC'}</button>` +
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
      const dispatch = lineList.querySelector<HTMLButtonElement>(`[data-act="dispatch"][data-line="${line.id}"]`);
      if (dispatch) {
        const active = line.dispatchEndsAtTick > state.tick;
        const cooldown = Math.max(0, state.players[player].dispatchReadyAtTick - state.tick);
        dispatch.disabled =
          active || cooldown > 0 || state.players[player].cash < PARAMS.RAPID_DISPATCH_COST;
        dispatch.textContent = active
          ? `${Math.ceil((line.dispatchEndsAtTick - state.tick) / PARAMS.TICK_HZ)}s`
          : cooldown > 0
            ? `${Math.ceil(cooldown / PARAMS.TICK_HZ)}s`
            : '⚡';
      }
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
    if (button.dataset.act === 'dispatch') emit({ type: 'DispatchRapidService', player, line });
    if (button.dataset.act === 'plan') {
      const current = stateForUi?.players[player].lines.find((item) => item.id === line);
      if (current) {
        emit({
          type: 'SetServicePlan',
          player,
          line,
          servicePlan: current.servicePlan === 'local' ? 'express' : 'local',
        });
      }
    }
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

function signed(value: number, digits = 0): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function eventText(state: GameState, event: GameEvent): string {
  switch (event.kind) {
    case 'serviceOpened':
      return `P${event.player + 1} opened Line ${event.lineId + 1}`;
    case 'lineExtended':
      return `P${event.player + 1} extended Line ${event.lineId + 1} to ${state.stations[event.stationId].name}`;
    case 'lineDeleted':
      return `P${event.player + 1} closed Line ${event.lineId + 1}`;
    case 'capacityAdded':
      return `P${event.player + 1} ${event.trainDelta > 0 ? 'added' : 'sold'} a train`;
    case 'rushStarted':
      return `Rush hour: ${state.neighborhoods[event.originId].name}`;
    case 'contractStarted':
      return `Civic Contract opened`;
    case 'contractResolved':
      return event.player < 0 ? 'Civic Contract expired' : `P${event.player + 1} won the Civic Contract`;
    case 'dispatchStarted':
      return `P${event.player + 1} activated Rapid Dispatch`;
    case 'dispatchExpired':
      return `P${event.player + 1} Rapid Dispatch ended`;
    case 'districtChanged':
      return event.player < 0
        ? `${state.neighborhoods[event.districtId].name} is contested`
        : `P${event.player + 1} took ${state.neighborhoods[event.districtId].name}`;
    case 'finalMandate':
      return event.active ? 'Final Mandate active' : 'Final Mandate announced';
    case 'servicePlanChanged':
      return `P${event.player + 1} set Line ${event.lineId + 1} ${event.servicePlan.toUpperCase()}`;
    case 'text':
      return event.text;
  }
}
