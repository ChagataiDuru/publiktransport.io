import type { GameEvent, GameState } from './types.ts';

export type NewGameEvent = GameEvent extends infer Event
  ? Event extends GameEvent
    ? Omit<Event, 'id' | 'tick'>
    : never
  : never;

/** Authoritative, bounded event stream. IDs are never reused even after trimming. */
export function pushGameEvent(state: GameState, event: NewGameEvent): GameEvent {
  const complete = { ...event, id: state.nextEventId++, tick: state.tick } as GameEvent;
  state.events.push(complete);
  if (state.events.length > 32) state.events.splice(0, state.events.length - 32);
  return complete;
}

export function pushTextEvent(
  state: GameState,
  player: GameEvent['player'],
  text: string,
): GameEvent {
  return pushGameEvent(state, { kind: 'text', player, text });
}
