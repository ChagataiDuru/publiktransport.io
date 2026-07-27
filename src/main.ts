import { decide } from './bot/greedy.ts';
import { createLineBuilder } from './input/linebuilder.ts';
import { createRenderer } from './render/renderer.ts';
import type { Overlays } from './render/view.ts';
import { PARAMS } from './sim/params.ts';
import { createInitialState, tick } from './sim/state.ts';
import type { Command, GameState } from './sim/types.ts';
import { createDevPanel } from './ui/devpanel.ts';
import { createEndScreen } from './ui/endscreen.ts';
import { createHud } from './ui/hud.ts';

const params = new URLSearchParams(location.search);
const urlSeed = params.get('seed');
const speed = Math.max(0.25, Math.min(16, Number(params.get('speed') ?? '1') || 1));
const botEnabled = params.get('bot') !== 'off';

const HUMAN = 0;
const BOT = 1;

/** ?skip=90 fast-forwards the match at load — handy for tuning the late game. */
const skipSeconds = Math.max(0, Math.min(600, Number(params.get('skip') ?? '0') || 0));

let seed = urlSeed !== null ? Number(urlSeed) || 0 : 20260727;
let state: GameState = createInitialState(seed);

const canvas = document.getElementById('board') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const pending: Command[] = [];

const builder = createLineBuilder(canvas, () => state, () => renderer.camera, HUMAN);
const hud = createHud((cmd) => pending.push(cmd), HUMAN);
const endscreen = createEndScreen();
createDevPanel(() => {
  // Most knobs feed straight into the next cycle; the ones baked into derived
  // values need a nudge, so mark both networks dirty.
  state.netDirty = [true, true];
  state.matchLengthTicks = Math.round(PARAMS.MATCH_SECONDS * PARAMS.TICK_HZ);
});

const overlays: Overlays = { flow: false, desire: false, districts: false };
let paused = false;

/** One sim step plus the bot's turn, shared by the main loop and ?skip. */
function step(extra: Command[]): void {
  const cmds = extra;
  if (botEnabled) {
    const interval = PARAMS.BOT_DECISION_INTERVAL * PARAMS.TICK_HZ;
    if (state.tick - state.botLastDecisionTick >= interval) {
      state.botLastDecisionTick = state.tick;
      cmds.push(...decide(state, BOT));
    }
  }
  state = tick(state, cmds);
}

function restart(): void {
  if (urlSeed === null) seed = (seed * 1664525 + 1013904223) >>> 0;
  state = createInitialState(seed);
  pending.length = 0;
  builder.cancel();
  paused = false;
}

// ------------------------------------------------------------------ keyboard

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (builder.onKey(e.key)) {
    e.preventDefault();
    return;
  }
  switch (e.key) {
    case 'F1':
      overlays.flow = !overlays.flow;
      e.preventDefault();
      break;
    case 'F2':
      overlays.desire = !overlays.desire;
      e.preventDefault();
      break;
    case 'F3':
      paused = !paused;
      e.preventDefault();
      break;
    case 'F4':
      overlays.districts = !overlays.districts;
      e.preventDefault();
      break;
    case 'r':
    case 'R':
      restart();
      break;
  }
});

// -------------------------------------------------------------------- tooltip

let mouse = { x: 0, y: 0, inside: false };
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top, inside: true };
});
canvas.addEventListener('mouseleave', () => {
  mouse.inside = false;
  builder.hoverStation = null;
});

function updateTooltip(): void {
  const id = builder.hoverStation;
  if (id === null || !mouse.inside) {
    hud.hideTooltip();
    return;
  }
  const st = state.stations[id];
  const nb = state.neighborhoods[st.neighborhood];
  const serving = state.players
    .flatMap((p) => p.lines)
    .filter((l) => l.stations.includes(id))
    .map((l) => `<span style="color:${l.color}">Line ${l.id + 1}</span>`)
    .join(' ');
  const free = st.platforms - state.platformUsage[id];
  hud.showTooltip(
    `<span class="t">${st.name.toUpperCase()}</span>` +
      `${nb.name} · ${(nb.population / 1000).toFixed(0)}k\n` +
      `platforms ${st.platforms - free}/${st.platforms} used\n` +
      `land value ${state.landValue[st.neighborhood].toFixed(2)}` +
      (serving ? `\n${serving}` : ''),
    mouse.x,
    mouse.y,
  );
}

// ------------------------------------------------------------------ game loop

const TICK_MS = () => 1000 / PARAMS.TICK_HZ / speed;
let accumulator = 0;
let last = performance.now();
const start = last;

function frame(now: number): void {
  const elapsed = Math.min(250, now - last);
  last = now;

  if (!paused && state.phase === 'playing') {
    accumulator += elapsed;
    let guard = 0;
    while (accumulator >= TICK_MS() && guard++ < 40) {
      accumulator -= TICK_MS();
      step(pending.splice(0, pending.length));
    }
  } else {
    accumulator = 0;
  }

  builder.refresh(state);
  renderer.draw(state, {
    overlays,
    hoverStation: builder.hoverStation,
    draft: builder.draft,
    time: (now - start) / 1000,
    alpha: Math.min(1, accumulator / TICK_MS()),
    paused,
  });
  hud.update(state);
  endscreen.update(state);
  updateTooltip();

  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => renderer.resize());
renderer.resize();
for (let t = 0; t < skipSeconds * PARAMS.TICK_HZ; t++) step([]);
requestAnimationFrame(frame);
