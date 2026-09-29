import { describe, expect, it } from 'vitest';

import { postedForm, readLeaseMessage, type LeaseMessage } from './lease-messages.js';

/**
 * Reading what another window posted about a lease: every message this window
 * posts reads back as itself, and anything else of the origin, another
 * version's messages included, is ignored rather than trusted (REQ-STOR-098).
 */

const OWNER = { instance: 'window-a', label: 'Another AudioGubbins tab' };

const MESSAGES: readonly LeaseMessage[] = [
  { kind: 'who-owns', question: 'window-b.1' },
  { kind: 'owner', question: 'window-b.1', owner: OWNER },
  { kind: 'taking', by: OWNER },
  { kind: 'transfer-request', request: { id: 'window-b.2', from: OWNER } },
  { kind: 'transfer-answer', request: 'window-b.2', answer: 'granted' },
  { kind: 'transfer-answer', request: 'window-b.2', answer: 'declined' },
];

describe('lease messages', () => {
  it.each(MESSAGES)('reads back what it posts: $kind', (message) => {
    expect(readLeaseMessage(structuredClone(postedForm(message)))).toEqual(message);
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'who-owns'],
    ['another protocol', { protocol: 'audiogubbins.lease/2', kind: 'who-owns', question: 'q' }],
    ['no protocol', { kind: 'who-owns', question: 'q' }],
    ['an unknown kind', { protocol: 'audiogubbins.lease/1', kind: 'steal', by: OWNER }],
    ['an empty question', { protocol: 'audiogubbins.lease/1', kind: 'who-owns', question: '' }],
    [
      'an owner without a label',
      { protocol: 'audiogubbins.lease/1', kind: 'taking', by: { instance: 'window-a' } },
    ],
    [
      'a label past the longest',
      {
        protocol: 'audiogubbins.lease/1',
        kind: 'taking',
        by: { instance: 'window-a', label: 'x'.repeat(201) },
      },
    ],
    [
      'an answer that is neither',
      { protocol: 'audiogubbins.lease/1', kind: 'transfer-answer', request: 'r', answer: 'maybe' },
    ],
    [
      'a request without its asker',
      { protocol: 'audiogubbins.lease/1', kind: 'transfer-request', request: { id: 'r' } },
    ],
  ])('ignores %s', (_name, data) => {
    expect(readLeaseMessage(data)).toBeUndefined();
  });
});
