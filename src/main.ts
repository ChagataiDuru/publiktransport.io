import { decide } from './bot/greedy.ts';
import { createLineBuilder } from './input/linebuilder.ts';
import { OnlineClient } from './online/client.ts';
import { createRenderer } from './render/renderer.ts';
import type { FocusPair, Overlays } from './render/view.ts';
import { PARAMS, PLAYER_COLORS } from './sim/params.ts';
import { createInitialState, tick } from './sim/state.ts';
import type { Command, GameState, PlayerId } from './sim/types.ts';
import type { LobbyState, PlayerCommand } from './shared/protocol.ts';
import { createDevPanel } from './ui/devpanel.ts';
import { createEndScreen } from './ui/endscreen.ts';
import { createHud } from './ui/hud.ts';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const urlSeed = params.get('seed');
const speed = Math.max(0.25, Math.min(16, Number(params.get('speed') ?? '1') || 1));
const botEnabled = params.get('bot') !== 'off';
const skipSeconds = Math.max(0, Math.min(600, Number(params.get('skip') ?? '0') || 0));

let seed = urlSeed !== null ? Number(urlSeed) || 0 : 20260727;
let state: GameState = createInitialState(seed);
let localPlayer: PlayerId = 0;
let names = ['You', 'Rival Bot'];
let botSeats = [1];
let mode: 'menu' | 'offline' | 'online' = 'menu';
let gameActive = false;
let onlineConnected = false;
let latestLobby: LobbyState | null = null;
let online: OnlineClient | null = null;

const canvas = $('board') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const pending: Command[] = [];

function emit(command: Command): void {
  if (!gameActive || state.phase !== 'playing') return;
  if (mode === 'online') {
    if (!onlineConnected || !online) {
      showToast('Connection lost — your seat is under bot control');
      return;
    }
    const { player: _player, ...payload } = command;
    online.submit(payload as PlayerCommand);
    return;
  }
  pending.push(command);
}

const builder = createLineBuilder(
  canvas,
  () => state,
  () => renderer.camera,
  emit,
  () => localPlayer,
);
const hud = createHud(emit, () => localPlayer);
hud.setSessionMeta(names, botSeats);
const endscreen = createEndScreen(
  () => localPlayer,
  () => names,
  () => {
    if (mode === 'online') {
      if (latestLobby?.seats[localPlayer]?.isHost) online?.returnLobby();
      else showToast('Waiting for the host to return everyone to the lobby');
    } else restart();
  },
);

createDevPanel(() => {
  state.netDirty.fill(true);
  state.matchLengthTicks = Math.round(PARAMS.MATCH_SECONDS * PARAMS.TICK_HZ);
});

const overlays: Overlays = { flow: false, desire: false, districts: false };
let paused = true;
/** Corridor picked out of the pressure panel, fading out on the map. */
let focus: FocusPair | null = null;

hud.onFocusPair((i, j) => {
  focus = { i, j, fade: 8 };
});

function step(extra: Command[]): void {
  const commands = extra;
  if (botEnabled) {
    for (const bot of botSeats) {
      const interval = PARAMS.BOT_DECISION_INTERVAL * PARAMS.TICK_HZ;
      if (state.tick - state.botLastDecisionTick[bot] >= interval) {
        state.botLastDecisionTick[bot] = state.tick;
        commands.push(...decide(state, bot));
      }
    }
  }
  state = tick(state, commands);
}

function restart(): void {
  if (urlSeed === null) seed = (seed * 1664525 + 1013904223) >>> 0;
  state = createInitialState(seed, 2);
  names = [playerName(), 'Rival Bot'];
  botSeats = [1];
  localPlayer = 0;
  hud.setSessionMeta(names, botSeats);
  pending.length = 0;
  builder.cancel();
  paused = false;
  gameActive = true;
}

function startSolo(): void {
  mode = 'offline';
  document.body.classList.remove('online');
  hideScreens();
  restart();
  for (let t = 0; t < skipSeconds * PARAMS.TICK_HZ; t++) step([]);
}

window.addEventListener('keydown', (event) => {
  if (!gameActive) return;
  const target = event.target as HTMLElement;
  if (target?.tagName === 'INPUT' || target?.tagName === 'BUTTON') return;
  if (builder.onKey(event.key)) {
    event.preventDefault();
    return;
  }
  switch (event.key) {
    case 'F1':
      overlays.flow = !overlays.flow;
      event.preventDefault();
      break;
    case 'F2':
      overlays.desire = !overlays.desire;
      event.preventDefault();
      break;
    case 'F3':
      if (mode === 'offline') paused = !paused;
      else showToast('Online matches cannot be paused');
      event.preventDefault();
      break;
    case 'F4':
      overlays.districts = !overlays.districts;
      event.preventDefault();
      break;
    case 'r':
    case 'R':
      if (mode === 'offline') restart();
      break;
  }
});

let mouse = { x: 0, y: 0, inside: false };
canvas.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect();
  mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top, inside: true };
});
canvas.addEventListener('mouseleave', () => {
  mouse.inside = false;
  builder.hoverStation = null;
});

function updateTooltip(): void {
  if (!mouse.inside || !gameActive) {
    hud.hideTooltip();
    return;
  }
  const draft = builder.draft;
  if (draft) {
    const station = draft.candidate === null ? null : state.stations[draft.candidate];
    const used = station ? state.platformUsage[station.id] : 0;
    const shortfall = Math.ceil(draft.shortfall);
    const reason =
      draft.reason === 'not enough cash'
        ? `Need ${formatMoney(shortfall)} more`
        : draft.reason;
    hud.showTooltip(
      `${station ? `<span class="t">${station.name.toUpperCase()}</span>` : '<span class="t">LINE PREVIEW</span>'}` +
        `${station ? `<div class="metric"><span>PLATFORMS</span><b>${used}/${station.platforms} used</b></div>` : ''}` +
        `<div class="metric"><span>COST</span><b>${formatMoney(Math.ceil(draft.cost))}</b></div>` +
        `<div class="metric"><span>CASH</span><b>${formatMoney(draft.cash)}</b></div>` +
        `<div class="metric"><span>ROUND TRIP</span><b>~${Math.round(draft.roundTripSeconds)}s</b></div>` +
        `<div class="metric"><span>NETWORK</span><b>${draft.stops} stops · ${draft.districts} districts</b></div>` +
        (reason ? `<div class="error">${escapeHtml(reason)}</div>` : ''),
      mouse.x,
      mouse.y,
      Boolean(reason),
    );
    return;
  }

  const id = builder.hoverStation;
  if (id === null) {
    hud.hideTooltip();
    return;
  }
  const station = state.stations[id];
  const neighborhood = state.neighborhoods[station.neighborhood];
  const serving = state.players
    .flatMap((player) => player.lines)
    .filter((line) => line.stations.includes(id))
    .map((line) => `<span style="color:${line.color}">Line ${line.id + 1}</span>`)
    .join(' ');
  hud.showTooltip(
    `<span class="t">${station.name.toUpperCase()}</span>` +
      `<div>${neighborhood.name} · ${(neighborhood.population / 1000).toFixed(0)}k</div>` +
      `<div class="metric"><span>PLATFORMS</span><b>${state.platformUsage[id]}/${station.platforms} used</b></div>` +
      `<div class="metric"><span>LAND VALUE</span><b>${state.landValue[station.neighborhood].toFixed(2)}</b></div>` +
      (serving ? `<div>${serving}</div>` : ''),
    mouse.x,
    mouse.y,
  );
}

const TICK_MS = () => 1000 / PARAMS.TICK_HZ / speed;
let accumulator = 0;
let last = performance.now();
const start = last;

function frame(now: number): void {
  const elapsed = Math.min(250, now - last);
  last = now;

  if (mode === 'offline' && gameActive && !paused && state.phase === 'playing') {
    accumulator += elapsed;
    let guard = 0;
    while (accumulator >= TICK_MS() && guard++ < 40) {
      accumulator -= TICK_MS();
      step(pending.splice(0, pending.length));
    }
  } else {
    accumulator = 0;
  }

  if (focus) {
    focus.fade -= elapsed / 1000;
    if (focus.fade <= 0) focus = null;
  }

  if (gameActive) builder.refresh(state);
  renderer.draw(state, {
    overlays,
    hoverStation: builder.hoverStation,
    draft: builder.draft,
    focus,
    localPlayer,
    time: (now - start) / 1000,
    alpha: Math.min(1, accumulator / TICK_MS()),
    paused,
  });
  hud.update(state);
  endscreen.update(state);
  updateTooltip();
  requestAnimationFrame(frame);
}

function connectOnline(): void {
  mode = 'online';
  gameActive = false;
  paused = false;
  document.body.classList.add('online');
  document.body.classList.remove('playing');
  $('menu-screen').classList.remove('show');
  $('lobby-screen').classList.add('show');
  ($('invite-url') as HTMLElement).textContent = location.origin;
  online?.close();
  online = new OnlineClient({
    onLobby: renderLobby,
    onMatch(nextState, playerId, nextNames, nextBots) {
      const newMatch = !gameActive || state.seed !== nextState.seed || nextState.tick < state.tick;
      if (newMatch) {
        builder.cancel();
        pending.length = 0;
      }
      state = nextState;
      localPlayer = playerId;
      names = nextNames;
      botSeats = nextBots;
      hud.setSessionMeta(names, botSeats);
      gameActive = true;
      paused = false;
      hideScreens();
      setNetworkStatus('ONLINE', false);
    },
    onStatus(status, detail) {
      onlineConnected = status === 'connected';
      const lobbyConnection = $('lobby-connection');
      lobbyConnection.textContent = detail ?? status.toUpperCase();
      lobbyConnection.className = `connection ${status === 'connected' ? 'ok' : status === 'fatal' ? 'bad' : ''}`;
      if (status === 'reconnecting') setNetworkStatus('RECONNECTING · BOT CONTROL', true);
      if (status === 'fatal') {
        setNetworkStatus(detail ?? 'CONNECTION FAILED', true);
        showToast(detail ?? 'Connection failed');
      }
    },
    onRejected(reason, shortfall) {
      showToast(
        shortfall && shortfall > 0
          ? `${reason} · need ${formatMoney(Math.ceil(shortfall))} more`
          : reason,
      );
    },
  });
  online.connect(playerName());
}

function renderLobby(lobby: LobbyState, seat: PlayerId | null): void {
  latestLobby = lobby;
  if (seat !== null) localPlayer = seat;
  if (lobby.phase === 'lobby') {
    gameActive = false;
    builder.cancel();
    pending.length = 0;
    document.body.classList.remove('playing');
    $('lobby-screen').classList.add('show');
    $('menu-screen').classList.remove('show');
  }
  const mine = seat === null ? null : lobby.seats[seat];
  const isHost = Boolean(mine?.isHost);
  const seatsRoot = $('lobby-seats');
  seatsRoot.innerHTML = lobby.seats
    .map((entry, id) =>
      entry
        ? `<div class="seat">
            <i style="background:${PLAYER_COLORS[id]}"></i>
            <div><b>${escapeHtml(entry.name)}${entry.isHost ? ' · HOST' : ''}</b>
            <small>${entry.kind === 'bot' ? 'BOT' : entry.connected ? entry.ready || entry.isHost ? 'READY' : 'NOT READY' : 'DISCONNECTED'}</small></div>
            ${isHost && entry.kind === 'bot' ? `<button data-remove-bot="${id}">REMOVE</button>` : `<em>P${id + 1}</em>`}
          </div>`
        : `<div class="seat empty"><i style="background:${PLAYER_COLORS[id]};opacity:.25"></i><span>EMPTY SEAT ${id + 1}</span></div>`,
    )
    .join('');

  const ready = $('lobby-ready') as HTMLButtonElement;
  ready.style.display = isHost ? 'none' : '';
  ready.textContent = mine?.ready ? 'NOT READY' : 'READY';
  const addBot = $('lobby-add-bot') as HTMLButtonElement;
  addBot.style.display = isHost ? '' : 'none';
  addBot.disabled = lobby.seats.every(Boolean);
  const startMatch = $('lobby-start') as HTMLButtonElement;
  startMatch.style.display = isHost ? '' : 'none';
  startMatch.disabled = !lobby.canStart;
  $('lobby-help').textContent = isHost
    ? lobby.canStart
      ? 'Everyone is ready. Start when you are.'
      : 'Fill at least two seats and wait for human guests to ready up.'
    : mine?.ready
      ? 'Ready. Waiting for the host to start.'
      : 'Ready up when you are prepared to play.';
}

function playerName(): string {
  const input = $('player-name') as HTMLInputElement;
  const value = input.value.trim().slice(0, 20) || 'Player';
  localStorage.setItem('publiktransport.playerName', value);
  return value;
}

function hideScreens(): void {
  document.body.classList.add('playing');
  $('menu-screen').classList.remove('show');
  $('lobby-screen').classList.remove('show');
}

function showMenu(): void {
  online?.close();
  online = null;
  onlineConnected = false;
  latestLobby = null;
  mode = 'menu';
  gameActive = false;
  paused = true;
  document.body.classList.remove('online');
  document.body.classList.remove('playing');
  $('lobby-screen').classList.remove('show');
  $('menu-screen').classList.add('show');
  setNetworkStatus('', false);
}

let toastTimer = 0;
function showToast(message: string): void {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function setNetworkStatus(text: string, bad: boolean): void {
  const status = $('network-status');
  status.textContent = text;
  status.classList.toggle('show', Boolean(text));
  status.classList.toggle('bad', bad);
}

function formatMoney(value: number): string {
  return `$${Math.max(0, Math.round(value)).toLocaleString('en-US')}`;
}

function escapeHtml(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

$('play-solo').addEventListener('click', startSolo);
$('play-online').addEventListener('click', connectOnline);
$('lobby-back').addEventListener('click', showMenu);
$('lobby-ready').addEventListener('click', () => {
  const mine = latestLobby?.seats[localPlayer];
  if (mine) online?.ready(!mine.ready);
});
$('lobby-add-bot').addEventListener('click', () => online?.addBot());
$('lobby-start').addEventListener('click', () => online?.start());
$('lobby-seats').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-bot]');
  if (button) online?.removeBot(Number(button.dataset.removeBot));
});
$('copy-invite').addEventListener('click', () => {
  void navigator.clipboard?.writeText(location.origin);
  showToast('Invite URL copied');
});

const savedName = localStorage.getItem('publiktransport.playerName');
if (savedName) ($('player-name') as HTMLInputElement).value = savedName;

window.addEventListener('resize', () => renderer.resize());
renderer.resize();
if (params.get('mode') === 'solo' || skipSeconds > 0) startSolo();
requestAnimationFrame(frame);
