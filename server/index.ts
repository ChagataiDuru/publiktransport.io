import { randomBytes, randomInt } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { decide } from '../src/bot/greedy.ts';
import { applyCommand, validate } from '../src/sim/commands.ts';
import { PARAMS } from '../src/sim/params.ts';
import { stringifyNetwork } from '../src/sim/serialize.ts';
import { createInitialState, tick } from '../src/sim/state.ts';
import type { Command, GameState } from '../src/sim/types.ts';
import {
  MAX_SEATS,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
  type LobbyState,
  type PublicSeat,
  type ServerMessage,
} from '../src/shared/protocol.ts';

interface Seat {
  id: number;
  name: string;
  kind: 'human' | 'bot';
  token: string;
  ready: boolean;
  connected: boolean;
  socket?: WebSocket;
  lastSeq: number;
}

interface Connection {
  socket: WebSocket;
  seat: Seat | null;
  isAlive: boolean;
  messages: number;
  rateWindow: number;
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const portIndex = process.argv.indexOf('--port');
const port = Math.max(
  1,
  Math.min(
    65535,
    Number(portArg?.slice(7) ?? (portIndex >= 0 ? process.argv[portIndex + 1] : undefined) ?? 8080) ||
      8080,
  ),
);

let seats: Array<Seat | null> = new Array(MAX_SEATS).fill(null);
let hostSeat = -1;
let phase: LobbyState['phase'] = 'lobby';
let game: GameState | null = null;
let queued: Array<{ seat: Seat; seq: number; command: Command }> = [];
const connections = new Set<Connection>();

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const httpServer = createServer((request, response) => {
  const rawPath = new URL(request.url ?? '/', 'http://localhost').pathname;
  const requested = rawPath === '/' ? 'index.html' : rawPath.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  let path = join(dist, safePath);
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(dist, 'index.html');
  if (!path.startsWith(dist) || !existsSync(path)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
    'Cache-Control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(path).pipe(response);
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(stringifyNetwork(message));
}

function publicLobby(): LobbyState {
  const publicSeats = seats.map((seat): PublicSeat | null =>
    seat
      ? {
          id: seat.id,
          name: seat.name,
          kind: seat.kind,
          ready: seat.ready,
          connected: seat.connected,
          isHost: seat.id === hostSeat,
        }
      : null,
  );
  const occupied = seats.filter(Boolean).length;
  const guestsReady = seats.every(
    (seat) => !seat || seat.kind === 'bot' || seat.id === hostSeat || seat.ready,
  );
  return { phase, seats: publicSeats, canStart: phase === 'lobby' && occupied >= 2 && guestsReady };
}

function broadcast(message: ServerMessage): void {
  const payload = stringifyNetwork(message);
  for (const connection of connections) {
    if (connection.socket.readyState === WebSocket.OPEN && connection.seat) {
      connection.socket.send(payload);
    }
  }
}

function broadcastLobby(): void {
  broadcast({ type: 'lobby', lobby: publicLobby() });
}

function freshToken(): string {
  return randomBytes(24).toString('base64url');
}

function normalizedName(value: string): string {
  return value.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 20) || 'Player';
}

function chooseHost(): void {
  const current = seats[hostSeat];
  if (current?.kind === 'human' && current.connected) return;
  hostSeat = seats.findIndex((seat) => seat?.kind === 'human' && seat.connected);
}

function compactSeats(): void {
  seats = seats.filter((seat): seat is Seat => Boolean(seat));
  for (let id = 0; id < seats.length; id++) seats[id]!.id = id;
  while (seats.length < MAX_SEATS) seats.push(null);
  chooseHost();
}

function names(): string[] {
  return seats.filter((seat): seat is Seat => Boolean(seat)).map((seat) => seat.name);
}

function botSeats(): number[] {
  return seats
    .filter((seat): seat is Seat => Boolean(seat))
    .filter((seat) => seat.kind === 'bot' || !seat.connected)
    .map((seat) => seat.id);
}

function startMatch(requester: Seat): void {
  if (requester.id !== hostSeat || !publicLobby().canStart) return;
  compactSeats();
  const active = seats.filter((seat): seat is Seat => Boolean(seat));
  game = createInitialState(randomInt(0, 0x7fffffff), active.length);
  phase = 'playing';
  queued = [];
  for (const seat of active) {
    if (seat.socket) {
      send(seat.socket, {
        type: 'matchStarted',
        playerId: seat.id,
        names: names(),
        botSeats: botSeats(),
      });
    }
  }
  broadcastSnapshot();
  broadcastLobby();
}

function returnLobby(requester: Seat): void {
  if (requester.id !== hostSeat || phase !== 'ended') return;
  phase = 'lobby';
  game = null;
  queued = [];
  for (const seat of seats) if (seat) seat.ready = false;
  chooseHost();
  broadcastLobby();
}

function reject(socket: WebSocket, seq: number, result: ReturnType<typeof validate>): void {
  send(socket, {
    type: 'commandRejected',
    seq,
    reason: result.reason ?? 'Command rejected',
    code: result.code,
    cost: result.cost,
    shortfall: result.shortfall,
  });
}

function handle(connection: Connection, message: ClientMessage): void {
  if (message.type === 'hello') {
    if (connection.seat) return;
    let seat =
      message.reconnectToken === undefined
        ? null
        : seats.find((candidate) => candidate?.token === message.reconnectToken) ?? null;
    if (!seat) {
      if (phase !== 'lobby') {
        send(connection.socket, { type: 'fatal', reason: 'Match already in progress' });
        return;
      }
      const id = seats.findIndex((candidate) => candidate === null);
      if (id < 0) {
        send(connection.socket, { type: 'fatal', reason: 'Lobby is full' });
        return;
      }
      seat = {
        id,
        name: normalizedName(message.name),
        kind: 'human',
        token: freshToken(),
        ready: false,
        connected: true,
        lastSeq: -1,
      };
      seats[id] = seat;
    }
    if (seat.kind !== 'human') return;
    seat.socket?.close(4001, 'Seat reclaimed');
    seat.socket = connection.socket;
    seat.connected = true;
    connection.seat = seat;
    chooseHost();
    send(connection.socket, {
      type: 'welcome',
      reconnectToken: seat.token,
      seat: seat.id,
      isHost: seat.id === hostSeat,
      lobby: publicLobby(),
    });
    if (game) {
      send(connection.socket, {
        type: 'matchStarted',
        playerId: seat.id,
        names: names(),
        botSeats: botSeats(),
      });
      send(connection.socket, {
        type: 'snapshot',
        state: clientState(game),
        names: names(),
        botSeats: botSeats(),
      });
    }
    broadcastLobby();
    return;
  }

  const seat = connection.seat;
  if (!seat) return;
  switch (message.type) {
    case 'ready':
      if (phase === 'lobby' && seat.id !== hostSeat) seat.ready = message.ready;
      broadcastLobby();
      break;
    case 'addBot': {
      if (phase !== 'lobby' || seat.id !== hostSeat) break;
      const id = seats.findIndex((candidate) => candidate === null);
      if (id >= 0) {
        seats[id] = {
          id,
          name: `Bot ${id + 1}`,
          kind: 'bot',
          token: freshToken(),
          ready: true,
          connected: true,
          lastSeq: -1,
        };
      }
      broadcastLobby();
      break;
    }
    case 'removeBot':
      if (phase === 'lobby' && seat.id === hostSeat && seats[message.seat]?.kind === 'bot') {
        seats[message.seat] = null;
        compactSeats();
        broadcastLobby();
      }
      break;
    case 'startMatch':
      startMatch(seat);
      break;
    case 'returnLobby':
      returnLobby(seat);
      break;
    case 'command': {
      if (!game || phase !== 'playing' || message.seq <= seat.lastSeq) break;
      seat.lastSeq = message.seq;
      const command = { ...message.command, player: seat.id } as Command;
      const result = validate(game, command);
      if (!result.ok) reject(connection.socket, message.seq, result);
      else queued.push({ seat, seq: message.seq, command });
      break;
    }
  }
}

function broadcastSnapshot(): void {
  if (!game) return;
  broadcast({ type: 'snapshot', state: clientState(game), names: names(), botSeats: botSeats() });
}

/** Route tables are server-only and dominate snapshot size; the renderer never reads them. */
function clientState(state: GameState): GameState {
  return { ...state, routes: [], netDirty: [] };
}

function gameStep(): void {
  if (!game || phase !== 'playing') return;

  const pending = queued;
  queued = [];
  for (const item of pending) {
    const result = validate(game, item.command);
    if (!result.ok) {
      if (item.seat.socket) reject(item.seat.socket, item.seq, result);
      continue;
    }
    if (applyCommand(game, item.command) && item.seat.socket) {
      send(item.seat.socket, { type: 'commandAccepted', seq: item.seq });
    }
  }

  const interval = PARAMS.BOT_DECISION_INTERVAL * PARAMS.TICK_HZ;
  for (const seat of seats) {
    if (!seat || (seat.kind === 'human' && seat.connected)) continue;
    if (game.tick - game.botLastDecisionTick[seat.id] < interval) continue;
    game.botLastDecisionTick[seat.id] = game.tick;
    for (const command of decide(game, seat.id)) applyCommand(game, command);
  }

  game = tick(game, []);
  if (game.tick % 2 === 0 || game.phase === 'ended') broadcastSnapshot();
  if (game.phase === 'ended') {
    phase = 'ended';
    broadcastLobby();
  }
}

sockets.on('connection', (socket) => {
  const connection: Connection = {
    socket,
    seat: null,
    isAlive: true,
    messages: 0,
    rateWindow: Date.now(),
  };
  connections.add(connection);
  socket.on('pong', () => (connection.isAlive = true));
  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const now = Date.now();
    if (now - connection.rateWindow >= 1000) {
      connection.rateWindow = now;
      connection.messages = 0;
    }
    if (++connection.messages > 30) {
      socket.close(4008, 'Rate limit');
      return;
    }
    const message = parseClientMessage(data.toString());
    if (!message) {
      send(socket, { type: 'fatal', reason: 'Invalid message' });
      return;
    }
    handle(connection, message);
  });
  socket.on('close', () => {
    connections.delete(connection);
    if (connection.seat?.socket === socket) {
      connection.seat.connected = false;
      connection.seat.socket = undefined;
      chooseHost();
      broadcastLobby();
    }
  });
});

httpServer.on('upgrade', (request, socket, head) => {
  if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/ws') {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (websocket) => sockets.emit('connection', websocket, request));
});

setInterval(gameStep, 1000 / PARAMS.TICK_HZ);
setInterval(() => {
  for (const connection of connections) {
    if (!connection.isAlive) {
      connection.socket.terminate();
      continue;
    }
    connection.isAlive = false;
    connection.socket.ping();
  }
}, 10_000);

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`publiktransport.io host running at http://0.0.0.0:${port}`);
  console.log(`Protocol v${PROTOCOL_VERSION} · forward TCP port ${port} for internet play`);
});
