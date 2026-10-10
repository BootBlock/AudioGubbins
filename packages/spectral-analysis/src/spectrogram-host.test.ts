/**
 * The host and the worker together, through the real worker core: tiles made
 * off the page for the views that show them, nearest the centre first, kept
 * and adopted, made again when the kept bytes are wrong, an older revision's
 * drawn stale until replaced, work no view waits on cancelled, a refused
 * write and a failed worker reported, and the memory budget kept.
 */

import { describe, expect, it } from 'vitest';

import {
  DspDeliveryKind,
  DspImplementation,
  PcmDescriptionKind,
  REFERENCE_DSP,
  StftWindow,
  frameBlock,
  memorySource,
  type CanonicalDsp,
} from '@audiogubbins/audio-engine';
import {
  NO_CHAIN_PROCESSING,
  countingDsp,
  dspModuleBytes,
} from '@audiogubbins/audio-engine/testing';
import { createCancellationSource, discreteLayout, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { noise } from '@audiogubbins/test-fixtures';

import type { SpectrogramConfig } from './spectrogram-config.js';
import {
  SpectrogramHost,
  type SpectrogramHandle,
  type SpectrogramHostEvent,
} from './spectrogram-host.js';
import type { SpectralTileCache, TileWriting } from './spectrogram-ports.js';
import {
  FromSpectrogramWorkerKind,
  ToSpectrogramWorkerKind,
  type FromSpectrogramWorker,
  type ToSpectrogramWorker,
} from './spectrogram-messages.js';
import { SpectrogramWorkerCore } from './spectrogram-worker-core.js';
import { tileKeyText, type SpectralTileKey } from './spectral-tile.js';
import {
  LocalSpectrogramWorker,
  MemoryTileCache,
  memorySubject,
  turn,
  type LocalSpectrogramOptions,
} from './testing/spectrogram-rig.js';
import { analyseTiles } from './tile-analysis.js';
import { decodeTile } from './tile-codec.js';
import { spectrogramGeometry } from './tile-geometry.js';

/** The part of the host's WebAssembly this test uses. */
declare const WebAssembly: { readonly Module: new (bytes: Uint8Array) => object };

const CONFIG: SpectrogramConfig = { windowLength: 256, window: StftWindow.Hann, overlap: 1 };

/** Frames a tile of level 0 spans at {@link CONFIG}. */
const TILE = 256 * 256;

function audio(tiles: number, seed = 1): Float32Array {
  return noise(seed, { length: tiles * TILE, amplitude: 0.5 }).channels[0]!;
}

function rig(
  options: {
    readonly worker?: LocalSpectrogramOptions;
    readonly memoryBudget?: number;
    readonly now?: () => number;
  } = {},
  cache: SpectralTileCache = new MemoryTileCache(),
) {
  const workers: LocalSpectrogramWorker[] = [];
  const events: SpectrogramHostEvent[] = [];
  const host = new SpectrogramHost({
    createWorker: () => {
      const worker = new LocalSpectrogramWorker(options.worker);
      workers.push(worker);
      return worker;
    },
    cache,
    report: (event) => events.push(event),
    now: options.now ?? (() => 0),
    ...(options.memoryBudget === undefined ? {} : { memoryBudget: options.memoryBudget }),
  });
  return { host, events, workers };
}

/** A cache that reads nothing and keeps every write waiting until its signal is cancelled. */
class WaitingTileCache implements SpectralTileCache {
  readonly writes: { readonly key: SpectralTileKey; readonly writing: TileWriting }[] = [];

  read(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  write(key: SpectralTileKey, _bytes: Uint8Array, writing: TileWriting): Promise<void> {
    this.writes.push({ key, writing });
    return new Promise((_resolve, reject) => {
      writing.signal.addEventListener('abort', () => {
        reject(writing.signal.reason instanceof Error ? writing.signal.reason : new Error());
      });
    });
  }
}

/** Waits until `done` holds, a worker's turn at a time. */
async function until(done: () => boolean): Promise<void> {
  for (let tries = 0; tries < 20_000; tries += 1) {
    if (done()) return;
    await turn();
  }
  throw new Error('The spectrogram never settled.');
}

/** Lets every message in flight arrive. */
async function quiet(): Promise<void> {
  for (let turns = 0; turns < 50; turns += 1) await turn();
}

function show(handle: SpectrogramHandle, first: number, last: number, centre?: number): void {
  handle.show({
    config: CONFIG,
    level: 0,
    channels: [0],
    first,
    last,
    centre: centre ?? ((first + last + 1) * TILE) / 2,
  });
}

function held(handle: SpectrogramHandle, first: number, last: number): boolean {
  for (let index = first; index <= last; index += 1) {
    if (handle.tile(CONFIG, 0, 0, index)?.stale !== false) return false;
  }
  return true;
}

function sentOf<TKind extends ToSpectrogramWorker['kind']>(
  worker: LocalSpectrogramWorker,
  kind: TKind,
): Extract<ToSpectrogramWorker, { kind: TKind }>[] {
  return worker.sent.filter(
    (message): message is Extract<ToSpectrogramWorker, { kind: TKind }> => message.kind === kind,
  );
}

function postedTiles(
  worker: LocalSpectrogramWorker,
): Extract<FromSpectrogramWorker, { kind: typeof FromSpectrogramWorkerKind.Tile }>[] {
  return worker.posted.filter(
    (message): message is Extract<FromSpectrogramWorker, { kind: 'tile' }> =>
      typeof message === 'object' &&
      message !== null &&
      'kind' in message &&
      message.kind === FromSpectrogramWorkerKind.Tile,
  );
}

/** The tile index each want of a worker named, by request. */
function indexOfRequest(worker: LocalSpectrogramWorker, request: number): number | undefined {
  return sentOf(worker, ToSpectrogramWorkerKind.Want).find((want) => want.request === request)
    ?.index;
}

async function madeAlone(samples: Float32Array, index: number): Promise<Uint8Array> {
  const source = expectSuccess(
    memorySource(
      expectSuccess(
        frameBlock(expectSuccess(discreteLayout(1)), expectSuccess(sampleRate(48_000)), [samples]),
      ),
    ),
  );
  const [tile] = await analyseTiles(
    {
      geometry: spectrogramGeometry(CONFIG, samples.length, 1),
      level: 0,
      index,
      channels: [0],
    },
    {
      source,
      dsp: REFERENCE_DSP,
      yieldToHost: () => Promise.resolve(),
      signal: createCancellationSource().signal,
    },
  );
  return tile!;
}

describe('the spectrogram host', () => {
  it('makes the tiles a view shows in the worker, and keeps each in the cache', async () => {
    const cache = new MemoryTileCache();
    const { host, workers } = rig({}, cache);
    const samples = audio(4);
    const handle = host.open(memorySubject('noise', [samples]));
    show(handle, 1, 2);
    await until(() => held(handle, 1, 2));
    expect([...handle.tile(CONFIG, 0, 0, 2)!.tile.values]).toEqual([
      ...(await madeAlone(samples, 2)),
    ]);
    await quiet();
    expect(cache.writes).toBe(2);
    expect(sentOf(workers[0]!, ToSpectrogramWorkerKind.Want).map((want) => want.index)).toEqual([
      1, 2,
    ]);
    expect(handle.tile(CONFIG, 0, 0, 0)).toBeUndefined();
    expect(handle.status).toEqual({ kind: 'running' });
  });

  it('moves the arrays of a sound held in memory to the worker rather than copying them', async () => {
    const { host } = rig();
    const subject = memorySubject('held', [audio(2)]);
    const described: Float32Array[] = [];
    const handle = host.open({
      ...subject,
      describe: () => {
        const description = subject.describe();
        if (description.kind === PcmDescriptionKind.Pcm) described.push(...description.channels);
        return description;
      },
    });
    expect(described).toHaveLength(1);
    // A transferred buffer is detached on the page, which a copy never is.
    expect(described.map((channel) => channel.buffer.byteLength)).toEqual([0]);
    show(handle, 0, 1);
    await until(() => held(handle, 0, 1));
  });

  it('adopts the tiles the cache keeps, and analyses none of them', async () => {
    const kept = new MemoryTileCache();
    const first = rig({}, kept);
    const subject = memorySubject('kept', [audio(3)]);
    const made = first.host.open(subject);
    show(made, 0, 2);
    await until(() => held(made, 0, 2));
    await quiet();
    const second = rig({}, kept);
    const adopted = second.host.open(subject);
    show(adopted, 0, 2);
    await until(() => held(adopted, 0, 2));
    await quiet();
    const tiles = postedTiles(second.workers[0]!);
    expect(tiles.map((tile) => tile.adopted)).toEqual([true, true, true]);
    expect(kept.writes).toBe(3);
    expect([...adopted.tile(CONFIG, 0, 0, 1)!.tile.values]).toEqual([
      ...made.tile(CONFIG, 0, 0, 1)!.tile.values,
    ]);
  });

  it('analyses again a kept tile that fails its checksum, says why, and keeps the new one', async () => {
    const cache = new MemoryTileCache();
    const subject = memorySubject('torn', [audio(1)]);
    const { host, events, workers } = rig({}, cache);
    const key: SpectralTileKey = {
      identity: 'torn',
      revision: '1',
      channel: 0,
      config: CONFIG,
      level: 0,
      index: 0,
    };
    const madeCache = new MemoryTileCache();
    const made = rig({}, madeCache);
    const original = made.host.open(subject);
    show(original, 0, 0);
    await until(() => held(original, 0, 0));
    await quiet();
    const bytes = madeCache.kept.get(tileKeyText(key))!.slice();
    bytes[200]! ^= 0xff;
    cache.kept.set(tileKeyText(key), bytes);
    const handle = host.open(subject);
    show(handle, 0, 0);
    await until(() => held(handle, 0, 0));
    await quiet();
    expect(events).toEqual([
      {
        kind: 'dsp',
        implementation: DspImplementation.Reference,
        fallbackReason: expect.any(String),
      },
      {
        kind: 'cache-refused',
        identity: 'torn',
        reason: 'The tile does not match its checksum.',
      },
    ]);
    expect(postedTiles(workers[0]!).map((tile) => tile.adopted)).toEqual([false]);
    expect(cache.kept.get(tileKeyText(key))).toEqual(madeCache.kept.get(tileKeyText(key)));
  });

  it('reports a refused cache write and still draws the tile', async () => {
    const cache = new MemoryTileCache();
    cache.refusing = 'The storage is full.';
    const { host, events } = rig({}, cache);
    const handle = host.open(memorySubject('full', [audio(1)]));
    show(handle, 0, 0);
    await until(() => held(handle, 0, 0));
    await quiet();
    expect(events.filter((event) => event.kind !== 'dsp')).toEqual([
      { kind: 'cache-unwritten', identity: 'full', reason: 'The storage is full.' },
    ]);
    expect(handle.tile(CONFIG, 0, 0, 0)?.tile.values.length).toBe(256 * 129);
  });

  it('tells the cache when each revision’s job opened, a later job later, even within the same millisecond', async () => {
    const cache = new WaitingTileCache();
    const { host } = rig({ now: () => 1_000 }, cache);
    const before = host.open(memorySubject('dated', [audio(1, 1)], 'r1'));
    show(before, 0, 0);
    await until(() => held(before, 0, 0));
    const after = host.open(memorySubject('dated', [audio(1, 2)], 'r2'));
    show(after, 0, 0);
    await until(() => held(after, 0, 0));

    expect(
      cache.writes.map(({ key, writing }) => ({ revision: key.revision, opened: writing.opened })),
    ).toEqual([
      { revision: 'r1', opened: 1_000 },
      { revision: 'r2', opened: 1_001 },
    ]);
  });

  it('gives up the writes of a job that closes, and reports none of them', async () => {
    const cache = new WaitingTileCache();
    const { host, events } = rig({}, cache);
    const handle = host.open(memorySubject('closed', [audio(2)]));
    show(handle, 0, 1);
    await until(() => held(handle, 0, 1));
    expect(cache.writes.map(({ writing }) => writing.signal.aborted)).toEqual([false, false]);
    handle.release();
    await quiet();

    expect(cache.writes.map(({ writing }) => writing.signal.aborted)).toEqual([true, true]);
    expect(events.filter((event) => event.kind !== 'dsp')).toEqual([]);
  });

  it('reports a cache it cannot read, and analyses the tile', async () => {
    const cache: SpectralTileCache = {
      read: () => Promise.reject(new Error('The cache is locked.')),
      write: () => Promise.resolve(),
    };
    const { host, events } = rig({}, cache);
    const handle = host.open(memorySubject('locked', [audio(1)]));
    show(handle, 0, 0);
    await until(() => held(handle, 0, 0));
    expect(events.filter((event) => event.kind !== 'dsp')).toEqual([
      { kind: 'cache-unreadable', identity: 'locked', reason: 'The cache is locked.' },
    ]);
  });

  it('draws the old revision’s tiles as stale until the new revision’s replace them', async () => {
    const { host } = rig();
    const before = host.open(memorySubject('edited', [audio(2, 1)], 'r1'));
    show(before, 0, 1);
    await until(() => held(before, 0, 1));
    const after = host.open(memorySubject('edited', [audio(2, 2)], 'r2'));
    before.release();
    expect(after.tile(CONFIG, 0, 0, 0)).toMatchObject({
      stale: true,
      tile: { key: { revision: 'r1' } },
    });
    show(after, 0, 1);
    expect(after.tile(CONFIG, 0, 0, 1)?.stale).toBe(true);
    await until(() => held(after, 0, 1));
    expect(after.tile(CONFIG, 0, 0, 1)?.tile.key.revision).toBe('r2');
  });

  it('makes the tiles nearest the view’s centre first', async () => {
    const { host, workers } = rig();
    const handle = host.open(memorySubject('long', [audio(10)]));
    show(handle, 0, 9, 8.5 * TILE);
    await until(() => held(handle, 0, 9));
    const order = postedTiles(workers[0]!).map((tile) => indexOfRequest(workers[0]!, tile.request));
    expect(order.slice(0, 3)).toEqual([8, 7, 9]);
    expect(order.toSorted()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('cancels the tiles no view shows any longer, and the worker makes no more of them', async () => {
    const { host, workers } = rig();
    const handle = host.open(memorySubject('long', [audio(10)]));
    show(handle, 0, 9, 0);
    await until(() => postedTiles(workers[0]!).length > 0);
    show(handle, 0, 0, 0);
    await until(() => held(handle, 0, 0));
    await quiet();
    const worker = workers[0]!;
    expect(sentOf(worker, ToSpectrogramWorkerKind.Cancel).length).toBeGreaterThan(0);
    expect(postedTiles(worker).length).toBeLessThan(4);
    expect(held(handle, 5, 9)).toBe(false);
  });

  it('shares one job among the views of a sound and revision, and closes it with the last', async () => {
    const { host, workers } = rig();
    const subject = memorySubject('shared', [audio(2)]);
    const one = host.open(subject);
    const two = host.open(subject);
    show(one, 0, 0);
    show(two, 1, 1);
    await until(() => held(one, 0, 1));
    expect(held(two, 0, 1)).toBe(true);
    const worker = workers[0]!;
    expect(sentOf(worker, ToSpectrogramWorkerKind.Open)).toHaveLength(1);
    one.release();
    one.release();
    expect(sentOf(worker, ToSpectrogramWorkerKind.Close)).toHaveLength(0);
    two.release();
    expect(sentOf(worker, ToSpectrogramWorkerKind.Close)).toHaveLength(1);
    expect(workers).toHaveLength(1);
  });

  it('fails every sound with the reason its lanes show when the worker fails, and starts a new worker next', async () => {
    const { host, events, workers } = rig();
    const handle = host.open(memorySubject('lost', [audio(4)]));
    show(handle, 0, 3);
    await turn();
    workers[0]!.fault('The worker ran out of memory.');
    expect(handle.status).toEqual({
      kind: 'failed',
      reason: 'The spectrogram worker stopped: The worker ran out of memory.',
    });
    expect(events.filter((event) => event.kind === 'failed')).toEqual([
      {
        kind: 'failed',
        identity: 'lost',
        reason: 'The spectrogram worker stopped: The worker ran out of memory.',
      },
    ]);
    expect(workers[0]!.terminated).toBe(true);
    handle.release();
    const again = host.open(memorySubject('lost', [audio(1)], '2'));
    show(again, 0, 0);
    await until(() => held(again, 0, 0));
    expect(workers).toHaveLength(2);
  });

  it('keeps every tile a view shows past its memory budget, and lets the least recently shown go', async () => {
    const tileBytes = 256 * 129 + 64;
    const { host } = rig({ memoryBudget: 2 * tileBytes });
    const handle = host.open(memorySubject('budget', [audio(6)]));
    show(handle, 0, 2);
    await until(() => held(handle, 0, 2));
    show(handle, 4, 5);
    await until(() => held(handle, 4, 5));
    expect([0, 1, 2, 4, 5].map((index) => handle.tile(CONFIG, 0, 0, index) !== undefined)).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('says which DSP the worker runs, and makes the same tiles on the WebAssembly module', async () => {
    const module = new WebAssembly.Module(dspModuleBytes());
    const samples = audio(2);
    const wasm = rig({ worker: { dsp: { kind: DspDeliveryKind.Available, module } } });
    const handle = wasm.host.open(memorySubject('wasm', [samples]));
    show(handle, 0, 1);
    await until(() => held(handle, 0, 1));
    expect(wasm.events[0]).toEqual({
      kind: 'dsp',
      implementation: DspImplementation.WebAssembly,
      fallbackReason: undefined,
    });
    expect([...handle.tile(CONFIG, 0, 0, 1)!.tile.values]).toEqual([
      ...(await madeAlone(samples, 1)),
    ]);
  });
});

describe('the spectrogram worker', () => {
  function core(dsp: CanonicalDsp = REFERENCE_DSP) {
    const posted: FromSpectrogramWorker[] = [];
    let yields = 0;
    const worker = new SpectrogramWorkerCore({
      post: (message) => posted.push(message),
      yieldToHost: () => {
        yields += 1;
        return turn();
      },
      processing: NO_CHAIN_PROCESSING,
      chooseDsp: () => ({ dsp, fallbackReason: 'For this test.' }),
      reportFault: (error) => {
        throw error;
      },
    });
    return { worker, posted, yields: () => yields };
  }

  function openOf(frames: number) {
    return {
      kind: ToSpectrogramWorkerKind.Open,
      job: 'job',
      identity: 'one',
      revision: '1',
      channels: 1,
      description: { kind: 'pcm', sampleRate: 48_000, channels: [audio(frames / TILE)] },
      quality: memorySubject('one', []).quality,
    };
  }

  const OPEN = openOf(TILE);

  const DSP = {
    kind: ToSpectrogramWorkerKind.Dsp,
    delivery: { kind: DspDeliveryKind.Unavailable, reason: 'For this test.' },
  };

  function want(request: number, index: number, config: SpectrogramConfig = CONFIG) {
    return {
      kind: ToSpectrogramWorkerKind.Want,
      job: 'job',
      request,
      config,
      channel: 0,
      level: 0,
      index,
    };
  }

  function tilesPosted(posted: readonly FromSpectrogramWorker[]): number[] {
    return posted.flatMap((message) =>
      message.kind === FromSpectrogramWorkerKind.Tile ? [message.request] : [],
    );
  }

  it('makes its tiles on the DSP chosen from the delivery, and releases every STFT it makes', async () => {
    const counting = countingDsp();
    const { worker, posted } = core(counting.dsp);
    worker.receive(DSP);
    worker.receive(OPEN);
    worker.receive(want(1, 0));
    await until(() => tilesPosted(posted).length === 1);
    expect(counting.made()).toBe(1);
    expect(counting.held()).toBe(0);
  });

  it('makes the wants that came together nearest the focus first', async () => {
    const { worker, posted } = core();
    worker.receive(DSP);
    worker.receive(openOf(10 * TILE));
    worker.receive({ kind: ToSpectrogramWorkerKind.Focus, job: 'job', centre: 8.5 * TILE });
    for (let index = 0; index < 10; index += 1) worker.receive(want(index, index));
    await until(() => tilesPosted(posted).length === 10);
    expect(tilesPosted(posted).slice(0, 4)).toEqual([8, 7, 9, 6]);
  });

  it('makes every channel wanted at a place in one pass, each as that channel alone', async () => {
    const counting = countingDsp();
    const { worker, posted } = core(counting.dsp);
    const left = audio(1, 3);
    const right = audio(1, 4);
    worker.receive(DSP);
    worker.receive({
      ...OPEN,
      channels: 2,
      description: { kind: 'pcm', sampleRate: 48_000, channels: [left, right] },
    });
    worker.receive({ ...want(1, 0), channel: 1 });
    worker.receive(want(2, 0));
    await until(() => tilesPosted(posted).length === 2);
    expect(counting.made()).toBe(1);
    const values = (request: number, channel: number): number[] => {
      const message = posted.find(
        (one) => one.kind === FromSpectrogramWorkerKind.Tile && one.request === request,
      );
      if (message?.kind !== FromSpectrogramWorkerKind.Tile) return [];
      const key: SpectralTileKey = {
        identity: 'one',
        revision: '1',
        channel,
        config: CONFIG,
        level: 0,
        index: 0,
      };
      const tile = decodeTile(message.bytes, { key, columns: 256, bins: 129 }, true);
      return tile.ok ? [...tile.value.values] : [];
    };
    expect(values(1, 1)).toEqual([...(await madeAlone(right, 0))]);
    expect(values(2, 0)).toEqual([...(await madeAlone(left, 0))]);
  });

  it('stops making a tile no want waits on any longer, and sends nothing for it', async () => {
    const { worker, posted, yields } = core();
    const long: SpectrogramConfig = { windowLength: 4096, window: StftWindow.Hann, overlap: 2 };
    worker.receive(DSP);
    worker.receive(openOf(8 * TILE));
    worker.receive(want(1, 0, long));
    worker.receive({ kind: ToSpectrogramWorkerKind.Cancel, job: 'job', request: 1 });
    await quiet();
    expect(tilesPosted(posted)).toEqual([]);
    // A tile at this window spans eight chunks; the work stops after the first.
    expect(yields()).toBeLessThan(3);
  });

  it('fails a sound it is given before its DSP, rather than choosing one itself', () => {
    const { worker, posted } = core();
    worker.receive(OPEN);
    expect(posted).toEqual([
      {
        kind: FromSpectrogramWorkerKind.Failed,
        job: 'job',
        reason: 'The spectrogram worker was given a sound before its DSP.',
      },
    ]);
  });

  it('fails a job asked for a tile its sound does not have', () => {
    const { worker, posted } = core();
    worker.receive(DSP);
    worker.receive(OPEN);
    worker.receive({
      kind: ToSpectrogramWorkerKind.Want,
      job: 'job',
      request: 1,
      config: CONFIG,
      channel: 1,
      level: 0,
      index: 0,
    });
    expect(posted.at(-1)).toEqual({
      kind: FromSpectrogramWorkerKind.Failed,
      job: 'job',
      reason: 'The page asked for a tile the sound does not have: channel 1, level 0, tile 0.',
    });
  });
});
