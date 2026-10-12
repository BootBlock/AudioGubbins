/**
 * The spectrogram worker's messages, read field by field after they cross a
 * thread: each kind read as it was sent, and a malformed one refused with the
 * field that was wrong.
 */

import { describe, expect, it } from 'vitest';

import {
  DspDeliveryKind,
  DspImplementation,
  PcmDescriptionKind,
  StftWindow,
} from '@audiogubbins/audio-engine';
import { MAXIMUM_QUALITY, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import {
  FromSpectrogramWorkerKind,
  ToSpectrogramWorkerKind,
  type FromSpectrogramWorker,
  type ToSpectrogramWorker,
} from './spectrogram-messages.js';
import {
  readFromSpectrogramWorker,
  readToSpectrogramWorker,
} from './spectrogram-message-reading.js';

/** The part of the host's WebAssembly this test uses. */
declare const WebAssembly: { readonly Module: new (bytes: Uint8Array) => object };

/** The smallest valid module: the magic number and version, and nothing else. */
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

const CONFIG = { windowLength: 1024, window: StftWindow.Hann, overlap: 2 } as const;

function reason(read: { ok: boolean; failures?: readonly { summary: string }[] }): string {
  return read.ok ? 'read' : (read.failures?.[0]?.summary ?? '');
}

describe('a message to the spectrogram worker', () => {
  it.each<[string, ToSpectrogramWorker]>([
    [
      'a delivered module',
      {
        kind: ToSpectrogramWorkerKind.Dsp,
        delivery: { kind: DspDeliveryKind.Available, module: new WebAssembly.Module(EMPTY_MODULE) },
      },
    ],
    [
      'no module, and why',
      {
        kind: ToSpectrogramWorkerKind.Dsp,
        delivery: { kind: DspDeliveryKind.Unavailable, reason: 'No WebAssembly here.' },
      },
    ],
    [
      'an opened job',
      {
        kind: ToSpectrogramWorkerKind.Open,
        job: 'spectrogram-1',
        identity: 'asset-1',
        revision: 'r1',
        channels: 2,
        description: {
          kind: PcmDescriptionKind.Pcm,
          sampleRate: expectSuccess(sampleRate(44_100)),
          channels: [new Float32Array(4), new Float32Array(4)],
        },
        quality: MAXIMUM_QUALITY,
      },
    ],
    ['a focus', { kind: ToSpectrogramWorkerKind.Focus, job: 'spectrogram-1', centre: 96_000 }],
    [
      'a want with cached bytes',
      {
        kind: ToSpectrogramWorkerKind.Want,
        job: 'spectrogram-1',
        request: 9,
        config: CONFIG,
        channel: 1,
        level: 3,
        index: 12,
        cached: new Uint8Array([1, 2, 3, 4]),
      },
    ],
    ['a cancel', { kind: ToSpectrogramWorkerKind.Cancel, job: 'spectrogram-1', request: 9 }],
    ['a close', { kind: ToSpectrogramWorkerKind.Close, job: 'spectrogram-1' }],
  ])('reads %s as it was sent', (_case, message) => {
    const read = expectSuccess(readToSpectrogramWorker(structuredClone(message)));
    expect(read).toEqual(message);
  });

  it.each<[string, unknown, string]>([
    [
      'a delivered module that is not one',
      { kind: 'dsp', delivery: { kind: 'available', module: new Uint8Array(EMPTY_MODULE) } },
      'delivery.module',
    ],
    [
      'a want of settings the spectrogram refuses',
      {
        kind: 'want',
        job: 'j',
        request: 1,
        config: { ...CONFIG, windowLength: 1000 },
        channel: 0,
        level: 0,
        index: 0,
      },
      'config',
    ],
    [
      'a want of a fractional tile',
      { kind: 'want', job: 'j', request: 1, config: CONFIG, channel: 0, level: 0, index: 0.5 },
      'index',
    ],
    ['a focus with no job', { kind: 'focus', centre: 3 }, 'job'],
    ['a kind it does not know', { kind: 'paint', job: 'j' }, 'kind'],
  ])('refuses %s, naming the field', (_case, message, field) => {
    expect(reason(readToSpectrogramWorker(message))).toContain(`message's ${field} is not`);
  });
});

describe('a message from the spectrogram worker', () => {
  it.each<[string, FromSpectrogramWorker]>([
    [
      'the DSP it runs',
      {
        kind: FromSpectrogramWorkerKind.Dsp,
        implementation: DspImplementation.Reference,
        fallbackReason: 'No WebAssembly here.',
      },
    ],
    [
      'a tile',
      {
        kind: FromSpectrogramWorkerKind.Tile,
        job: 'spectrogram-1',
        request: 9,
        bytes: new Uint8Array([5, 6, 7, 8]),
        adopted: false,
        refusedCache: 'The tile does not match its checksum.',
      },
    ],
    [
      'a failed job',
      { kind: FromSpectrogramWorkerKind.Failed, job: 'spectrogram-1', reason: 'Unreadable.' },
    ],
  ])('reads %s as it was sent', (_case, message) => {
    expect(expectSuccess(readFromSpectrogramWorker(structuredClone(message)))).toEqual(message);
  });

  it.each<[string, unknown, string]>([
    ['a DSP of no kind it knows', { kind: 'dsp', implementation: 'gpu' }, 'implementation'],
    [
      'a tile whose bytes are not bytes',
      { kind: 'tile', job: 'j', request: 1, bytes: [1, 2], adopted: true },
      'bytes',
    ],
    [
      'a tile that does not say whether it was adopted',
      { kind: 'tile', job: 'j', request: 1, bytes: new Uint8Array(4) },
      'adopted',
    ],
  ])('refuses %s, naming the field', (_case, message, field) => {
    expect(reason(readFromSpectrogramWorker(message))).toContain(`message's ${field} is not`);
  });
});
