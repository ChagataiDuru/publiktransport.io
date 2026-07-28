import type { Command, GameState, PlayerId } from '../sim/types.ts';

export const PROTOCOL_VERSION = 1;
export const MAX_SEATS = 4;

export type PlayerCommand =
  | Omit<Extract<Command, { type: 'CreateLine' }>, 'player'>
  | Omit<Extract<Command, { type: 'ExtendLine' }>, 'player'>
  | Omit<Extract<Command, { type: 'DeleteLine' }>, 'player'>
  | Omit<Extract<Command, { type: 'BuyTrain' }>, 'player'>
  | Omit<Extract<Command, { type: 'SellTrain' }>, 'player'>
  | Omit<Extract<Command, { type: 'DispatchRapidService' }>, 'player'>
  | Omit<Extract<Command, { type: 'SetServicePlan' }>, 'player'>;

export interface PublicSeat {
  id: number;
  name: string;
  kind: 'human' | 'bot';
  ready: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface LobbyState {
  phase: 'lobby' | 'playing' | 'ended';
  seats: Array<PublicSeat | null>;
  canStart: boolean;
  mapId: string;
  mapName: string;
}

export type ClientMessage =
  | { type: 'hello'; version: number; name: string; reconnectToken?: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'addBot' }
  | { type: 'removeBot'; seat: number }
  | { type: 'startMatch' }
  | { type: 'returnLobby' }
  | { type: 'command'; seq: number; command: PlayerCommand };

export type ServerMessage =
  | {
      type: 'welcome';
      reconnectToken: string;
      seat: PlayerId;
      isHost: boolean;
      lobby: LobbyState;
    }
  | { type: 'lobby'; lobby: LobbyState }
  | { type: 'matchStarted'; playerId: PlayerId; names: string[]; botSeats: number[] }
  | { type: 'snapshot'; state: GameState; names: string[]; botSeats: number[] }
  | { type: 'commandAccepted'; seq: number }
  | {
      type: 'commandRejected';
      seq: number;
      reason: string;
      code?: string;
      cost?: number;
      shortfall?: number;
    }
  | { type: 'fatal'; reason: string };

export function isPlayerCommand(value: unknown): value is PlayerCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Record<string, unknown>;
  switch (command.type) {
    case 'CreateLine':
      return (
        Array.isArray(command.stations) &&
        command.stations.length <= 14 &&
        command.stations.every(Number.isInteger)
      );
    case 'ExtendLine':
      return (
        Number.isInteger(command.line) &&
        Number.isInteger(command.station) &&
        (command.end === 'head' || command.end === 'tail')
      );
    case 'DeleteLine':
    case 'BuyTrain':
    case 'SellTrain':
    case 'DispatchRapidService':
      return Number.isInteger(command.line);
    case 'SetServicePlan':
      return (
        Number.isInteger(command.line) &&
        (command.servicePlan === 'local' || command.servicePlan === 'express')
      );
    default:
      return false;
  }
}

export function parseClientMessage(text: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'hello':
      return typeof message.name === 'string' && message.version === PROTOCOL_VERSION
        ? (value as ClientMessage)
        : null;
    case 'ready':
      return typeof message.ready === 'boolean' ? (value as ClientMessage) : null;
    case 'addBot':
    case 'startMatch':
    case 'returnLobby':
      return value as ClientMessage;
    case 'removeBot':
      return Number.isInteger(message.seat) ? (value as ClientMessage) : null;
    case 'command':
      return Number.isInteger(message.seq) && isPlayerCommand(message.command)
        ? (value as ClientMessage)
        : null;
    default:
      return null;
  }
}
