import { parseNetwork, stringifyNetwork } from '../sim/serialize.ts';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type LobbyState,
  type PlayerCommand,
  type ServerMessage,
} from '../shared/protocol.ts';
import type { GameState, PlayerId } from '../sim/types.ts';

export interface OnlineCallbacks {
  onLobby(lobby: LobbyState, seat: PlayerId | null): void;
  onMatch(state: GameState, playerId: PlayerId, names: string[], botSeats: number[]): void;
  onStatus(status: 'connecting' | 'connected' | 'reconnecting' | 'fatal', detail?: string): void;
  onRejected(reason: string, shortfall?: number): void;
}

const TOKEN_KEY = 'publiktransport.reconnectToken';

export class OnlineClient {
  private socket: WebSocket | null = null;
  private reconnectTimer = 0;
  private retry = 0;
  private stopped = false;
  private name = 'Player';
  private seq = 0;
  private seat: PlayerId | null = null;
  private names: string[] = [];
  private botSeats: number[] = [];

  constructor(private readonly callbacks: OnlineCallbacks) {}

  connect(name: string): void {
    this.name = name;
    this.stopped = false;
    this.open(false);
  }

  close(): void {
    this.stopped = true;
    window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  ready(ready: boolean): void {
    this.send({ type: 'ready', ready });
  }

  addBot(): void {
    this.send({ type: 'addBot' });
  }

  removeBot(seat: number): void {
    this.send({ type: 'removeBot', seat });
  }

  start(): void {
    this.send({ type: 'startMatch' });
  }

  returnLobby(): void {
    this.send({ type: 'returnLobby' });
  }

  submit(command: PlayerCommand): number {
    const seq = ++this.seq;
    this.send({ type: 'command', seq, command });
    return seq;
  }

  private open(reconnecting: boolean): void {
    this.callbacks.onStatus(reconnecting ? 'reconnecting' : 'connecting');
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${scheme}//${location.host}/ws`);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.retry = 0;
      const reconnectToken = localStorage.getItem(TOKEN_KEY) ?? undefined;
      this.send({
        type: 'hello',
        version: PROTOCOL_VERSION,
        name: this.name,
        reconnectToken,
      });
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      const message = parseNetwork<ServerMessage>(event.data);
      this.receive(message);
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      this.callbacks.onStatus('reconnecting');
      const delay = Math.min(5000, 500 * 2 ** Math.min(4, this.retry++));
      this.reconnectTimer = window.setTimeout(() => this.open(true), delay);
    });
    socket.addEventListener('error', () => {
      // close drives the retry path and presents one stable status to the UI.
    });
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(stringifyNetwork(message));
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
        localStorage.setItem(TOKEN_KEY, message.reconnectToken);
        this.seat = message.seat;
        this.callbacks.onStatus('connected');
        this.callbacks.onLobby(message.lobby, this.seat);
        break;
      case 'lobby':
        this.callbacks.onLobby(message.lobby, this.seat);
        break;
      case 'matchStarted':
        this.seat = message.playerId;
        this.names = message.names;
        this.botSeats = message.botSeats;
        break;
      case 'snapshot':
        this.names = message.names;
        this.botSeats = message.botSeats;
        if (this.seat !== null) {
          this.callbacks.onMatch(message.state, this.seat, this.names, this.botSeats);
        }
        break;
      case 'commandRejected':
        this.callbacks.onRejected(message.reason, message.shortfall);
        break;
      case 'commandAccepted':
        break;
      case 'fatal':
        this.callbacks.onStatus('fatal', message.reason);
        this.stopped = true;
        this.socket?.close();
        break;
    }
  }
}
