import WebSocket from 'ws';
import { parseNetwork, stringifyNetwork } from '../src/sim/serialize.ts';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../src/shared/protocol.ts';

const url = process.argv[2] ?? 'ws://127.0.0.1:8080/ws';

interface TestClient {
  socket: WebSocket;
  messages: ServerMessage[];
  token: string;
}

function waitFor(
  client: TestClient,
  predicate: (message: ServerMessage) => boolean,
  timeout = 5000,
): Promise<ServerMessage> {
  const existing = client.messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for server message')), timeout);
    const onMessage = (data: WebSocket.RawData): void => {
      const message = parseNetwork<ServerMessage>(data.toString());
      client.messages.push(message);
      if (!predicate(message)) return;
      clearTimeout(timer);
      client.socket.off('message', onMessage);
      resolve(message);
    };
    client.socket.on('message', onMessage);
  });
}

async function connect(name: string, reconnectToken?: string): Promise<TestClient> {
  const socket = new WebSocket(url);
  const client: TestClient = { socket, messages: [], token: '' };
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const hello: ClientMessage = { type: 'hello', version: PROTOCOL_VERSION, name, reconnectToken };
  socket.send(stringifyNetwork(hello));
  const welcome = await waitFor(client, (message) => message.type === 'welcome');
  if (welcome.type !== 'welcome') throw new Error('Missing welcome');
  client.token = welcome.reconnectToken;
  return client;
}

async function main(): Promise<void> {
  const host = await connect('Smoke Host');
  const guest = await connect('Smoke Guest');
  guest.socket.send(stringifyNetwork({ type: 'ready', ready: true } satisfies ClientMessage));
  await waitFor(host, (message) => message.type === 'lobby' && message.lobby.canStart);
  host.socket.send(stringifyNetwork({ type: 'startMatch' } satisfies ClientMessage));
  const first = await waitFor(
    host,
    (message) => message.type === 'snapshot' && message.state.players.length === 2,
  );
  if (first.type !== 'snapshot') throw new Error('Match did not start');
  const initialTick = first.state.tick;
  const advanced = await waitFor(
    host,
    (message) => message.type === 'snapshot' && message.state.tick >= initialTick + 2,
  );
  if (advanced.type !== 'snapshot') throw new Error('Authoritative clock did not advance');

  host.socket.send(
    stringifyNetwork({
      type: 'command',
      seq: 1,
      command: { type: 'BuyTrain', line: first.state.players[0].lines[0].id },
    } satisfies ClientMessage),
  );
  await waitFor(host, (message) => message.type === 'commandAccepted' && message.seq === 1);

  guest.socket.close();
  await waitFor(host, (message) => message.type === 'snapshot' && message.botSeats.includes(1));
  const reclaimed = await connect('Smoke Guest', guest.token);
  await waitFor(reclaimed, (message) => message.type === 'snapshot' && !message.botSeats.includes(1));

  host.socket.close();
  reclaimed.socket.close();
  console.log('online smoke passed: join, ready, start, bot takeover, reconnect reclaim');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
