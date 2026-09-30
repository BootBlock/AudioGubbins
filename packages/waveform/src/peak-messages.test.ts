/**
 * The peak worker's messages, read field by field, and the worker refusing what
 * it cannot summarise; and the page's modules held to never building peaks
 * themselves (the packet's "no waveform generation on main UI thread").
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PcmDescriptionKind, REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { sampleRate } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  FromPeakWorkerKind,
  ToPeakWorkerKind,
  type FromPeakWorker,
  type ToPeakWorker,
} from './peak-messages.js';
import { readFromPeakWorker, readToPeakWorker } from './peak-message-reading.js';
import { PeakWorkerCore } from './peak-worker-core.js';

const RATE = expectSuccess(sampleRate(48_000));

const OPEN: ToPeakWorker = {
  kind: ToPeakWorkerKind.Open,
  job: 'peaks-1',
  identity: 'tone',
  revision: '1',
  channels: 1,
  description: { kind: PcmDescriptionKind.Pcm, sampleRate: RATE, channels: [new Float32Array(4)] },
  cached: undefined,
  focus: { start: 0, end: 4 },
};

function fieldOf(read: ReturnType<typeof readToPeakWorker>): unknown {
  return read.ok ? undefined : read.failures[0].details?.['field'];
}

describe('the messages to the peak worker', () => {
  it('reads each back from its structured clone', () => {
    const messages: ToPeakWorker[] = [
      OPEN,
      { kind: ToPeakWorkerKind.Focus, job: 'peaks-1', range: { start: 5, end: 9 } },
      { kind: ToPeakWorkerKind.Samples, job: 'peaks-1', request: 3, range: { start: 0, end: 2 } },
      { kind: ToPeakWorkerKind.Buckets, job: 'peaks-1', request: 5, range: { start: 0, end: 64 } },
      { kind: ToPeakWorkerKind.Cancel, job: 'peaks-1', request: 5 },
      {
        kind: ToPeakWorkerKind.ZeroCrossing,
        job: 'peaks-1',
        request: 4,
        position: 7,
        within: 20,
        channels: [0, 1],
      },
      { kind: ToPeakWorkerKind.Close, job: 'peaks-1' },
    ];
    for (const message of messages) {
      expect(expectSuccess(readToPeakWorker(structuredClone(message)))).toEqual(message);
    }
  });

  it('refuses a malformed one, naming the field', () => {
    expect(fieldOf(readToPeakWorker({ ...OPEN, kind: 'paint' }))).toBe('kind');
    expect(fieldOf(readToPeakWorker({ ...OPEN, job: 7 }))).toBe('job');
    expect(fieldOf(readToPeakWorker({ ...OPEN, channels: -1 }))).toBe('channels');
    expect(fieldOf(readToPeakWorker({ ...OPEN, description: { kind: 'file' } }))).toBe(
      'description',
    );
    expect(fieldOf(readToPeakWorker({ ...OPEN, cached: [1, 2] }))).toBe('cached');
    expect(fieldOf(readToPeakWorker({ ...OPEN, focus: { start: 9, end: 2 } }))).toBe('focus');
    expect(expectFailureCode(readToPeakWorker(null))).toBe('waveform.message-to-worker-malformed');
  });
});

describe('the messages from the peak worker', () => {
  it('reads each back from its structured clone', () => {
    const channel = {
      minimum: new Int16Array([-3]),
      maximum: new Int16Array([4]),
      rms: new Int16Array([2]),
      clipped: new Uint8Array([0]),
    };
    const messages: FromPeakWorker[] = [
      { kind: FromPeakWorkerKind.Adopted, job: 'a', bytes: new Uint8Array([1, 2]) },
      {
        kind: FromPeakWorkerKind.Runs,
        job: 'a',
        runs: [{ level: 0, first: 5, channels: [channel] }],
      },
      {
        kind: FromPeakWorkerKind.Complete,
        job: 'a',
        bytes: new Uint8Array(4),
        refusedCache: 'Torn.',
      },
      {
        kind: FromPeakWorkerKind.Samples,
        job: 'a',
        request: 1,
        start: 10,
        channels: [new Float32Array([0.5])],
      },
      {
        kind: FromPeakWorkerKind.Buckets,
        job: 'a',
        request: 3,
        start: 32,
        frames: 20,
        bucketFrames: 16,
        channels: [
          {
            minimum: new Int16Array([-4, -2]),
            maximum: new Int16Array([4, 2]),
            rms: new Int16Array([3, 1]),
            clipped: new Uint8Array([0, 1]),
          },
        ],
      },
      { kind: FromPeakWorkerKind.ZeroCrossing, job: 'a', request: 2, position: undefined },
      { kind: FromPeakWorkerKind.Failed, job: 'a', reason: 'Gone.' },
    ];
    for (const message of messages) {
      expect(expectSuccess(readFromPeakWorker(structuredClone(message)))).toEqual(message);
    }
  });

  it('refuses a run whose arrays are of different lengths or kinds', () => {
    const run = {
      level: 0,
      first: 0,
      channels: [
        {
          minimum: new Int16Array(2),
          maximum: new Int16Array(3),
          rms: new Int16Array(2),
          clipped: new Uint8Array(2),
        },
      ],
    };
    const read = readFromPeakWorker({ kind: 'runs', job: 'a', runs: [run] });
    expect(read.ok ? undefined : read.failures[0].details?.['field']).toBe('runs[0].channels[0]');
    const wrongKind = { ...run, channels: [{ ...run.channels[0], maximum: new Float32Array(2) }] };
    const again = readFromPeakWorker({ kind: 'runs', job: 'a', runs: [wrongKind] });
    expect(again.ok ? undefined : again.failures[0].details?.['field']).toBe(
      'runs[0].channels[0].maximum',
    );
  });
});

describe('the peak worker', () => {
  it('fails a job whose audio does not fit the channels it names, with the reason', () => {
    const said: FromPeakWorker[] = [];
    const core = new PeakWorkerCore({
      post: (message) => said.push(message),
      yieldToHost: () => Promise.resolve(),
      dsp: REFERENCE_DSP,
      reportFault: (error) => {
        throw error;
      },
      now: () => 0,
    });
    core.receive({ ...OPEN, channels: 2 });
    expect(said).toEqual([
      { kind: FromPeakWorkerKind.Failed, job: 'peaks-1', reason: expect.any(String) as string },
    ]);
  });

  it('reports a message it cannot read as a fault of the page', () => {
    const faults: Error[] = [];
    const core = new PeakWorkerCore({
      post: () => undefined,
      yieldToHost: () => Promise.resolve(),
      dsp: REFERENCE_DSP,
      reportFault: (error) => faults.push(error),
      now: () => 0,
    });
    core.receive({ kind: 'paint' });
    expect(faults).toHaveLength(1);
  });
});

describe('the page never builds peaks', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  /** The modules `start` imports from this package, followed through each. */
  function reached(start: string): ReadonlySet<string> {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(join(here, file), 'utf8');
      for (const match of text.matchAll(/^import[^;]*?from '\.\/([\w-]+)\.js';$/gmu)) {
        if (!match[0].startsWith('import type ')) visit(`${match[1] ?? ''}.ts`);
      }
    };
    visit(start);
    return seen;
  }

  it('reaches neither the builder nor the source from the host a page runs', () => {
    const modules = reached('peak-host.ts');
    expect(modules.has('peak-job.ts')).toBe(true);
    expect(modules.has('peak-builder.ts')).toBe(false);
    expect(modules.has('bucket-summary.ts')).toBe(false);
    expect(modules.has('peak-requests.ts')).toBe(false);
    expect(modules.has('zero-crossings.ts')).toBe(false);
    expect(modules.has('peak-worker-core.ts')).toBe(false);
  });
});
