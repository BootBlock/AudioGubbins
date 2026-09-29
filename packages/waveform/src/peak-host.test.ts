/**
 * The host and the worker together: peaks made off the page and shared, kept
 * and adopted, made again when the kept bytes are wrong, and a view's samples
 * and zero crossings answered, each through the real worker core.
 */

import { describe, expect, it } from 'vitest';

import { PcmDescriptionKind, REFERENCE_DSP, describedSource } from '@audiogubbins/audio-engine';
import { StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { CHUNK_FRAMES } from './peak-geometry.js';
import { PeakHost, type PeakHandle } from './peak-host.js';
import type { PeakEvent } from './peak-job.js';
import { ToPeakWorkerKind } from './peak-messages.js';
import { LocalPeakWorker, MemoryPeakCache, memorySubject, turn } from './testing/peak-rig.js';
import { nearestZeroCrossing } from './zero-crossings.js';

function ramp(frames: number, from = -0.5): Float32Array {
  return Float32Array.from({ length: frames }, (_, index) => from + index / frames);
}

async function settled(handle: PeakHandle): Promise<void> {
  for (let tries = 0; tries < 10_000; tries += 1) {
    if (handle.status.kind === 'complete' || handle.status.kind === 'failed') return;
    await turn();
  }
  throw new Error('The peaks never settled.');
}

function rig() {
  const workers: LocalPeakWorker[] = [];
  const cache = new MemoryPeakCache();
  const events: PeakEvent[] = [];
  const host = new PeakHost({
    createWorker: () => {
      const worker = new LocalPeakWorker();
      workers.push(worker);
      return worker;
    },
    cache,
    report: (event) => events.push(event),
  });
  return { host, cache, events, workers };
}

describe('the peak host', () => {
  it('makes the peaks in the worker, fills the pyramid as runs arrive, and keeps the cache', async () => {
    const { host, cache } = rig();
    const handle = host.open(memorySubject('ramp', [ramp(3 * CHUNK_FRAMES)]));
    const seen: number[] = [];
    handle.subscribe(() => seen.push(handle.pyramid.progress));
    await settled(handle);
    expect(handle.status).toEqual({ kind: 'complete' });
    expect(handle.pyramid.complete).toBe(true);
    expect(seen.some((progress) => progress > 0 && progress < 1)).toBe(true);
    expect(cache.writes).toBe(1);
  });

  it('shares one job among every view of a source and revision, and closes it with the last', async () => {
    const { host, workers } = rig();
    const subject = memorySubject('shared', [ramp(1000)]);
    const one = host.open(subject);
    const two = host.open(subject);
    expect(two.pyramid).toBe(one.pyramid);
    const other = host.open(memorySubject('shared', [ramp(1000)], '2'));
    expect(other.pyramid).not.toBe(one.pyramid);
    await settled(one);
    await settled(other);
    const opens = () => workers[0]!.sent.filter((sent) => sent.kind === ToPeakWorkerKind.Open);
    expect(opens()).toHaveLength(2);
    one.release();
    one.release();
    expect(workers[0]!.sent.some((sent) => sent.kind === ToPeakWorkerKind.Close)).toBe(false);
    two.release();
    expect(workers[0]!.sent.filter((sent) => sent.kind === ToPeakWorkerKind.Close)).toHaveLength(1);
    expect(workers).toHaveLength(1);
  });

  it('adopts a kept cache whole, and summarises nothing', async () => {
    const first = rig();
    const subject = memorySubject('kept', [ramp(2 * CHUNK_FRAMES)]);
    const made = first.host.open(subject);
    await settled(made);
    const second = rig();
    second.cache.kept.set('kept/1', [...first.cache.kept.values()][0]!);
    const adopted = second.host.open(subject);
    const runs: unknown[] = [];
    adopted.subscribe(() => runs.push(adopted.status.kind));
    await settled(adopted);
    expect(adopted.pyramid.complete).toBe(true);
    expect(adopted.pyramid.levels.map((level) => level.channels)).toEqual(
      made.pyramid.levels.map((level) => level.channels),
    );
    expect(runs).toEqual(['generating', 'complete']);
    expect(second.cache.writes).toBe(0);
  });

  it('makes the peaks again when the kept bytes are wrong, says why, and keeps the new ones', async () => {
    const { host, cache, events } = rig();
    cache.kept.set('torn/1', new Uint8Array(40));
    const handle = host.open(memorySubject('torn', [ramp(1000)]));
    await settled(handle);
    expect(handle.pyramid.complete).toBe(true);
    expect(events).toEqual([
      {
        kind: 'cache-refused',
        identity: 'torn',
        reason: expect.stringMatching(/header|peak cache/u),
      },
    ]);
    expect(cache.kept.get('torn/1')?.length).toBeGreaterThan(40);
  });

  it('summarises the chunks around the focus first', async () => {
    const { host, workers } = rig();
    const handle = host.open(memorySubject('long', [ramp(40 * CHUNK_FRAMES)]));
    handle.focus({ start: 30 * CHUNK_FRAMES, end: 31 * CHUNK_FRAMES });
    let firstKnown: number | undefined;
    handle.subscribe(() => {
      if (handle.pyramid.progress > 0) firstKnown ??= handle.pyramid.levels[0]!.known.indexOf(1);
    });
    await settled(handle);
    expect(workers).toHaveLength(1);
    expect(Math.floor(firstKnown! / 256)).toBe(30);
  });

  it('answers a view with its samples, kept for the next ask, and with the nearest zero crossing', async () => {
    const { host, workers } = rig();
    const handle = host.open(memorySubject('ramp', [ramp(10_000)]));
    const held = await handle.samples({ start: 100, end: 300 });
    expect(held.start).toBe(100);
    expect([...held.channels[0]!]).toEqual([...ramp(10_000).subarray(100, 300)]);
    const asked = () =>
      workers[0]!.sent.filter((sent) => sent.kind === ToPeakWorkerKind.Samples).length;
    await handle.samples({ start: 150, end: 250 });
    expect(asked()).toBe(1);
    // The ramp crosses zero half way along.
    expect(await handle.zeroCrossings.nearest(4_000, 2_000, [0])).toBe(5_000);
    expect(await handle.zeroCrossings.nearest(1_000, 100, [0])).toBeUndefined();
  });

  it('fails every job with the reason when the worker fails, refuses what was waiting, and starts a new worker next', async () => {
    const { host, events, workers } = rig();
    const handle = host.open(memorySubject('lost', [ramp(50 * CHUNK_FRAMES)]));
    await turn();
    const waiting = handle.samples({ start: 0, end: 10 });
    workers[0]!.fault('The worker ran out of memory.');
    await expect(waiting).rejects.toThrow('The peak worker stopped: The worker ran out of memory.');
    expect(handle.status).toEqual({
      kind: 'failed',
      reason: 'The peak worker stopped: The worker ran out of memory.',
    });
    expect(events.map((event) => event.kind)).toEqual(['failed']);
    expect(workers[0]!.terminated).toBe(true);
    handle.release();
    const again = host.open(memorySubject('lost', [ramp(1000)]));
    await settled(again);
    expect(again.status).toEqual({ kind: 'complete' });
    expect(workers).toHaveLength(2);
  });

  it('closes a job whose view let go before the cache was read, without starting a worker', async () => {
    const { host, workers } = rig();
    host.open(memorySubject('brief', [ramp(1000)])).release();
    await turn();
    expect(workers).toEqual([]);
  });
});

describe('the zero-crossing search', () => {
  const RATE = expectSuccess(sampleRate(48_000));
  const left = Float32Array.from([0.5, 0.4, -0.1, -0.2, 0.3, 0.3]);
  const right = Float32Array.from([0.5, 0.4, 0.3, -0.2, 0.3, 0.3]);
  const stereo = expectSuccess(
    describedSource(
      { kind: PcmDescriptionKind.Pcm, sampleRate: RATE, channels: [left, right] },
      StandardLayouts.stereo,
      REFERENCE_DSP,
    ),
  );

  it('finds the nearest boundary where every channel asked for crosses, the earlier at equal distance', async () => {
    // The left channel crosses at 2 and 4, the right at 3 and 4.
    expect(await nearestZeroCrossing(stereo, 3, 3, [0])).toBe(2);
    expect(await nearestZeroCrossing(stereo, 3, 3, [1])).toBe(3);
    expect(await nearestZeroCrossing(stereo, 3, 3, [0, 1])).toBe(4);
  });

  it('counts the silence before the first frame and after the last, so both ends cross', async () => {
    expect(await nearestZeroCrossing(stereo, 0, 0, [0, 1])).toBe(0);
    expect(await nearestZeroCrossing(stereo, 6, 0, [0, 1])).toBe(6);
  });

  it('finds none beyond its reach', async () => {
    expect(await nearestZeroCrossing(stereo, 1, 0, [0, 1])).toBeUndefined();
  });
});
