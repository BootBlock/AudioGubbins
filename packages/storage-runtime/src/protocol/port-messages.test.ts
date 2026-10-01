import { describe, expect, it } from 'vitest';

import { TreeFailureKind } from '@audiogubbins/project-format';

import { readPortMessage, type PortMessage } from './port-messages.js';

describe('the messages on the port, as either side reads them', () => {
  it.each<PortMessage>([
    { type: 'call', id: 0, operation: 'library.list', argument: { page: 2, names: ['a'] } },
    { type: 'call', id: 7, operation: 'project.close', argument: undefined },
    { type: 'cancel', target: 3 },
    { type: 'answer', id: 1, outcome: { kind: 'value', value: [1, { two: 2 }] } },
    { type: 'answer', id: 2, outcome: { kind: 'value', value: undefined } },
    {
      type: 'answer',
      id: 3,
      outcome: { kind: 'tree-refused', failure: TreeFailureKind.Quota, message: 'Full.' },
    },
    { type: 'answer', id: 4, outcome: { kind: 'cancelled' } },
    { type: 'answer', id: 5, outcome: { kind: 'fault', message: 'Broke.' } },
    { type: 'event', stream: 'project:1', value: { save: 'saved' } },
  ])('reads back a $type it was sent, after a structured clone', (message) => {
    expect(readPortMessage(structuredClone(message))).toEqual({ ok: true, value: message });
  });

  it.each([
    ['message', undefined],
    ['message', ['call']],
    ['type', { type: 'shout', id: 1 }],
    ['id', { type: 'call', operation: 'a.b', argument: 1 }],
    ['id', { type: 'call', id: -1, operation: 'a.b', argument: 1 }],
    ['id', { type: 'answer', id: 1.5, outcome: { kind: 'cancelled' } }],
    ['operation', { type: 'call', id: 1, operation: 4, argument: 1 }],
    ['target', { type: 'cancel', target: '2' }],
    ['outcome', { type: 'answer', id: 1, outcome: 'value' }],
    ['outcome.kind', { type: 'answer', id: 1, outcome: { kind: 'maybe' } }],
    [
      'outcome.failure',
      { type: 'answer', id: 1, outcome: { kind: 'tree-refused', failure: 'gone', message: 'x' } },
    ],
    [
      'outcome.message',
      { type: 'answer', id: 1, outcome: { kind: 'tree-refused', failure: 'io' } },
    ],
    ['outcome.message', { type: 'answer', id: 1, outcome: { kind: 'fault', message: 3 } }],
    ['stream', { type: 'event', value: 1 }],
  ])('refuses a message whose %s is wrong, naming it', (field, message) => {
    const read = readPortMessage(message);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.failures).toEqual([
      expect.objectContaining({
        code: 'protocol.port-message-malformed',
        summary: expect.stringContaining(`The message's ${field} is not`),
      }),
    ]);
  });
});
