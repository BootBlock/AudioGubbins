import { describe, expect, it } from 'vitest';

import { readPageMessage, readWorkerMessage, transferOf } from './tree-protocol.js';

const buffer = (): ArrayBuffer => new Uint8Array([1, 2]).buffer;

describe("the page's requests, as the worker reads them", () => {
  it.each([
    { type: 'read-file', id: 0, path: 'a/b.bin' },
    { type: 'open-file', id: 1, path: 'a' },
    { type: 'read-range', id: 2, path: 'a', offset: 0, length: 10 },
    { type: 'write-file', id: 3, path: 'a', bytes: buffer() },
    { type: 'create-file', id: 4, path: 'a' },
    { type: 'write-chunk', id: 5, sink: 4, bytes: buffer() },
    { type: 'close-file', id: 6, sink: 4 },
    { type: 'abort-file', id: 7, sink: 4 },
    { type: 'remove', id: 8, path: '' },
    { type: 'list', id: 9, path: '' },
    { type: 'cancel', target: 3 },
  ])('reads a well-formed $type', (message) => {
    expect(readPageMessage(message)).toEqual({ ok: true, message });
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'read-file'],
    ['no id', { type: 'read-file', path: 'a' }],
    ['a negative id', { type: 'read-file', id: -1, path: 'a' }],
    ['a fractional id', { type: 'read-file', id: 1.5, path: 'a' }],
    ['a cancel naming nothing', { type: 'cancel' }],
  ])('answers %s as unreadable, since no request can be told', (_form, message) => {
    expect(readPageMessage(message)).toMatchObject({ ok: false, answer: { type: 'unreadable' } });
  });

  it.each([
    ['an unknown operation', { type: 'rename', id: 1, path: 'a' }],
    ['a path that climbs', { type: 'read-file', id: 1, path: '../a' }],
    ['an upper-case path', { type: 'read-file', id: 1, path: 'A' }],
    ['an empty segment', { type: 'list', id: 1, path: 'a//b' }],
    ['the root as a file', { type: 'write-file', id: 1, path: '', bytes: buffer() }],
    ['bytes that are not a buffer', { type: 'write-file', id: 1, path: 'a', bytes: [1, 2] }],
    ['shared memory', { type: 'write-file', id: 1, path: 'a', bytes: new SharedArrayBuffer(2) }],
    [
      'a view rather than a buffer',
      { type: 'write-chunk', id: 1, sink: 0, bytes: new Uint8Array(2) },
    ],
    ['a negative offset', { type: 'read-range', id: 1, path: 'a', offset: -1, length: 1 }],
    [
      'a length that is not a number',
      { type: 'read-range', id: 1, path: 'a', offset: 0, length: '1' },
    ],
    ['a sink that is not a number', { type: 'close-file', id: 1, sink: 'x' }],
  ])('answers %s as a fault of that request', (_form, message) => {
    expect(readPageMessage(message)).toMatchObject({ ok: false, answer: { type: 'fault', id: 1 } });
  });
});

describe("the worker's answers, as the page reads them", () => {
  it.each([
    { type: 'bytes', id: 0, bytes: buffer() },
    { type: 'absent', id: 1 },
    { type: 'size', id: 2, size: 10 },
    { type: 'done', id: 3 },
    {
      type: 'entries',
      id: 4,
      entries: [
        { name: 'a.bin', kind: 'file' },
        { name: 'b', kind: 'directory' },
      ],
    },
    { type: 'failed', id: 5, kind: 'quota', name: 'QuotaExceededError', message: 'Full.' },
    { type: 'cancelled', id: 6 },
    { type: 'fault', id: 7, message: 'Broken.' },
    { type: 'unreadable', message: 'Not a request.' },
  ])('reads a well-formed $type', (message) => {
    expect(readWorkerMessage(message)).toEqual(message);
  });

  it.each([
    ['nothing', null],
    ['an unknown type', { type: 'maybe', id: 1 }],
    ['no id', { type: 'done' }],
    ['a negative size', { type: 'size', id: 1, size: -1 }],
    ['bytes that are not a buffer', { type: 'bytes', id: 1, bytes: 'ab' }],
    ['an entry of no kind', { type: 'entries', id: 1, entries: [{ name: 'a', kind: 'link' }] }],
    [
      'an entry no path can hold',
      { type: 'entries', id: 1, entries: [{ name: '..', kind: 'file' }] },
    ],
    ['entries that are not a list', { type: 'entries', id: 1, entries: {} }],
    ['an unknown failure kind', { type: 'failed', id: 1, kind: 'lost', name: 'X', message: '' }],
    ['a failure with no name', { type: 'failed', id: 1, kind: 'io', message: '' }],
    ['a fault with no message', { type: 'fault', id: 1 }],
    ['an unreadable with no message', { type: 'unreadable' }],
  ])('refuses %s', (_form, message) => {
    expect(readWorkerMessage(message)).toBeUndefined();
  });
});

describe('the buffers a message gives up', () => {
  it('names the bytes a message carries, and nothing for one that carries none', () => {
    const bytes = buffer();
    expect(transferOf({ type: 'write-chunk', id: 1, sink: 0, bytes })).toEqual([bytes]);
    expect(transferOf({ type: 'done', id: 1 })).toEqual([]);
  });
});
