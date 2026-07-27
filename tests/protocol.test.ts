import { describe, expect, it } from 'vitest';
import { parseClientMessage, PROTOCOL_VERSION } from '../src/shared/protocol.ts';

describe('online protocol validation', () => {
  it('accepts a valid hello and command', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION, name: 'Ada' })),
    ).toMatchObject({ type: 'hello', name: 'Ada' });
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'command',
          seq: 2,
          command: { type: 'CreateLine', stations: [0, 1, 12] },
        }),
      ),
    ).toMatchObject({ type: 'command', seq: 2 });
  });

  it('rejects malformed and oversized commands', () => {
    expect(parseClientMessage('{')).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'command',
          seq: 1,
          command: { type: 'CreateLine', stations: new Array(15).fill(1) },
        }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ type: 'command', seq: '1', command: { type: 'BuyTrain', line: 0 } }),
      ),
    ).toBeNull();
  });
});
