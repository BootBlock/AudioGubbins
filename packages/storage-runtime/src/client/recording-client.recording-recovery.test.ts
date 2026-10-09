import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  CaptureProfileKind,
  RecordingEnding,
  type ProjectState,
  type RecordingSessionId,
} from '@audiogubbins/project-format';
import { storageTimeLeft } from '@audiogubbins/recording';
import type { RecordingSetUp, TakeRequest } from '@audiogubbins/storage';
import { MemoryLeaseCoordinator } from '@audiogubbins/storage/testing';

import type { RecordingStatus } from '../protocol/recording-operations.js';
import { memoryStorage, type MemoryStorage } from '../testing/memory-storage.js';
import { madeProject, opened, writable } from '../testing/project-scene.js';
import type { RemoteProjectSession } from './remote-project.js';

/**
 * Recording through the storage worker (ADR-0071), over a real
 * `MessageChannel` read by the audio runtime's capture reader: the worker
 * commits what the capture channel brings, says how far it has reached and
 * how much time is left, makes the recording its asset when capture ends, and
 * keeps one it cannot finish, to be recovered by the window that writes the
 * project.
 */

const RATE = expectSuccess(sampleRate(48_000));
const TAKE: TakeRequest = { name: 'Take 1', stackName: 'Verse', compensation: 0 };

/** The context frame the capture began at, which the recording counts from. */
const BEGUN_AT = 96_000;

const setUp: RecordingSetUp = {
  start: {
    recordedAt: 1_790_000_000_000,
    device: { label: 'USB Audio Interface (2-ch)', channelCount: 2 },
    profile: { kind: CaptureProfileKind.RawStudio, name: 'Raw/Studio' },
    requested: { echoCancellation: false },
    granted: { echoCancellation: false, sampleRate: RATE },
    sampleRate: RATE,
    layout: StandardLayouts.stereo,
  },
  transportFrame: derivedSampleCount(0),
  purpose: { kind: 'stack' },
};

/** `frames` frames of two channels, every sample a value a 32-bit float holds exactly. */
function input(frames: number): readonly Float32Array[] {
  return [0, 1].map((channel) =>
    Float32Array.from({ length: frames }, (_, frame) => ((frame * 5 + channel) % 1_001) / 1_024),
  );
}

/** The samples of `channels` as a WAV file's data holds them. */
function interleaved(channels: readonly Float32Array[]): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const bytes = new Uint8Array(frames * channels.length * 4);
  const view = new DataView(bytes.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    channels.forEach((channel, index) => {
      view.setFloat32((frame * channels.length + index) * 4, channel[frame] ?? 0, true);
    });
  }
  return bytes;
}

/** The capture worklet's end of a take's channel, posting as the capture processor does. */
class Capture {
  readonly channel = new MessageChannel();
  #frame = BEGUN_AT;

  begin(layout: ChannelLayout = StandardLayouts.stereo): void {
    this.channel.port1.postMessage({
      kind: 'begin',
      frame: BEGUN_AT,
      sampleRate: RATE,
      channels: layout.roles.length,
      transport: 'posted',
    });
  }

  /** Posts `channels` in blocks, as the processor does, their buffers transferred. */
  post(channels: readonly Float32Array[]): void {
    const frames = channels[0]?.length ?? 0;
    for (let from = 0; from < frames; from += 4_096) {
      const block = channels.map((channel) => channel.slice(from, from + 4_096));
      const length = block[0]?.length ?? 0;
      // Transferring the buffers empties these arrays here.
      this.channel.port1.postMessage(
        { kind: 'block', frame: this.#frame, channels: block },
        block.map((channel) => channel.buffer),
      );
      this.#frame += length;
    }
  }

  gap(frames: number): void {
    this.channel.port1.postMessage({ kind: 'gap', frame: this.#frame, frames });
    this.#frame += frames;
  }

  end(reason: 'stopped' | 'released'): void {
    this.channel.port1.postMessage({ kind: 'end', frame: this.#frame, reason });
  }
}

const opens: MessagePort[] = [];
afterEach(() => {
  for (const port of opens.splice(0)) port.close();
});

/** A page with a project open to write, whose worker keeps it in `tree`. */
async function scene(options: Parameters<typeof memoryStorage>[0] = {}) {
  const tree = new MemoryStorageTree();
  const storage = memoryStorage({ tree, ...options });
  const project = await madeProject(storage);
  const session = writable(await opened(storage, project));
  return { tree, storage, project, session };
}

/** Begins recording `id` into `session` from a new capture channel, hearing its statuses. */
async function begun(
  storage: MemoryStorage,
  session: RemoteProjectSession,
  id: RecordingSessionId,
) {
  const capture = new Capture();
  opens.push(capture.channel.port1);
  const statuses: RecordingStatus[] = [];
  storage.client.recording.status(id, (status) => statuses.push(status));
  const answer = await storage.client.recording.begin(session, {
    session: id,
    capture: capture.channel.port2,
    setUp,
    take: TAKE,
  });
  return { capture, statuses, answer };
}

/** The samples a recorded asset's file holds after its header, as bytes. */
async function dataOf(storage: MemoryStorage, state: ProjectState, asset: string) {
  const source = state.sources.get(unsafeBrandId<'AssetId'>(asset));
  if (source?.media.kind !== 'managed') throw new Error('A recording is managed media.');
  const file = expectSuccess(await storage.another.store.open(source.media.contentId));
  const bytes = await file.read(0, file.size);
  const frames = state.project.assets.get(unsafeBrandId<'AssetId'>(asset))?.length ?? 0;
  return bytes.slice(bytes.length - frames * 8);
}

const SESSION = unsafeBrandId<'RecordingSessionId'>('5e5510a0-0000-4000-8000-000000000001');

describe('the recording time left', () => {
  it('is read from the storage estimate, counting the finishing, and unknown without one', async () => {
    const estimate = { quota: 2_000_000_000, usage: 400_000_000 };
    const known = memoryStorage({ estimate: () => Promise.resolve(estimate) });
    expect(await known.client.recording.timeLeft(RATE, 2)).toEqual(
      storageTimeLeft(estimate, RATE, 2),
    );
    expect(await known.client.recording.timeLeft(RATE, 2)).toEqual({
      kind: 'enough',
      seconds: 2_083,
    });
    expect(await memoryStorage().client.recording.timeLeft(RATE, 2)).toEqual({ kind: 'unknown' });
  });
});

describe('a recording through the storage worker', () => {
  it('commits what the capture channel brings, and becomes its asset when the page stops it', async () => {
    const { tree, storage, session } = await scene({
      estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }),
    });
    const { capture, statuses, answer } = await begun(storage, session, SESSION);
    expectSuccess(answer);
    const audio = input(110_000);
    capture.begin();
    capture.post(audio);
    await vi.waitFor(() => {
      expect(statuses.filter((status) => status.kind === 'recording').length).toBeGreaterThan(1);
    });
    const stopping = storage.client.recording.stop(SESSION, RecordingEnding.Stopped);
    capture.end('stopped');
    const finished = expectSuccess(await stopping);

    expect(finished.recording).toMatchObject({ length: 110_000, ending: RecordingEnding.Stopped });
    const state = session.getSnapshot().model.state;
    expect(state.project.assets.get(finished.asset.id)).toEqual(finished.asset);
    expect(await dataOf(storage, state, finished.asset.id)).toEqual(interleaved(audio));
    expect(state.sources.get(finished.asset.id)?.provenance?.audio).toMatchObject({
      encoding: 'float',
      bitDepth: 32,
      frames: 110_000,
    });
    expect(tree.paths().filter((path) => path.includes('/recordings/'))).toEqual([]);

    const recording = statuses.filter((status) => status.kind === 'recording');
    expect(recording.map((status) => status.committed)).toContain(48_000);
    expect(recording.at(-1)).toMatchObject({ timeLeft: { kind: 'enough' } });
    expect(statuses.slice(-2)).toEqual([
      {
        kind: 'ended',
        ending: RecordingEnding.Stopped,
        committed: 110_000,
        lost: { count: 0, frames: 0 },
        named: true,
      },
      { kind: 'finished', recording: finished },
    ]);
  });

  it('writes frames the channel lost as silence, and counts them', async () => {
    const { storage, session } = await scene();
    const { capture } = await begun(storage, session, SESSION);
    capture.begin();
    capture.post(input(10_000));
    capture.gap(2_000);
    capture.post(input(5_000));
    const stopping = storage.client.recording.stop(SESSION, RecordingEnding.Stopped);
    capture.end('stopped');
    const finished = expectSuccess(await stopping);
    expect(finished.recording).toMatchObject({
      length: 17_000,
      gaps: { count: 1, frames: 2_000 },
    });
  });

  it('ends where its input was let go of, and waits for the page to say why', async () => {
    const { storage, session } = await scene();
    const { capture, statuses } = await begun(storage, session, SESSION);
    capture.begin();
    capture.post(input(30_000));
    capture.end('released');
    await vi.waitFor(() => {
      expect(statuses.at(-1)).toMatchObject({
        kind: 'ended',
        ending: RecordingEnding.DeviceLost,
        committed: 30_000,
        named: true,
      });
    });
    const finished = expectSuccess(
      await storage.client.recording.stop(SESSION, RecordingEnding.PermissionRevoked),
    );
    expect(finished.recording).toMatchObject({
      length: 30_000,
      ending: RecordingEnding.PermissionRevoked,
    });
  });

  it('keeps the page’s word for why it ended, whether it comes before the channel’s end or after', async () => {
    const { storage, session } = await scene();
    const { capture } = await begun(storage, session, SESSION);
    capture.begin();
    capture.post(input(20_000));
    const stopping = storage.client.recording.stop(SESSION, RecordingEnding.Timed);
    capture.end('stopped');
    expect(expectSuccess(await stopping).recording.ending).toBe(RecordingEnding.Timed);
  });

  it('is cut where it has reached when the stop is called off, for an audio thread that sends no end', async () => {
    const { storage, session } = await scene();
    const { capture, statuses } = await begun(storage, session, SESSION);
    const audio = input(60_000);
    capture.begin();
    capture.post(audio);
    await vi.waitFor(() => {
      expect(statuses.some((status) => status.kind === 'recording' && status.committed > 0)).toBe(
        true,
      );
    });
    const calledOff = new AbortController();
    const stopping = storage.client.recording.stop(
      SESSION,
      RecordingEnding.Suspended,
      calledOff.signal,
    );
    calledOff.abort(new Error('The audio thread is gone.'));
    const finished = expectSuccess(await stopping);
    const { length } = finished.recording;
    expect(length).toBeGreaterThanOrEqual(48_000);
    expect(finished.recording.ending).toBe(RecordingEnding.Suspended);
    const state = session.getSnapshot().model.state;
    expect(await dataOf(storage, state, finished.asset.id)).toEqual(
      interleaved(audio.map((channel) => channel.slice(0, length))),
    );
  });

  it('is refused, with the reason, under the name of a recording in progress', async () => {
    const { storage, session } = await scene();
    expectSuccess((await begun(storage, session, SESSION)).answer);
    expect(expectFailureCode((await begun(storage, session, SESSION)).answer)).toBe(
      'recording.in-progress',
    );
  });
});

describe('a recording in a window that loses the project', () => {
  it('is refused to begin, and one in progress is kept for the window that took it to recover', async () => {
    const tree = new MemoryStorageTree();
    const coordinator = new MemoryLeaseCoordinator();
    const first = memoryStorage({ tree, coordinator, tab: { name: 'first', seed: 3 } });
    const project = await madeProject(first);
    const session = writable(await opened(first, project));
    const { capture, statuses } = await begun(first, session, SESSION);
    const audio = input(50_000);
    capture.begin();
    capture.post(audio);
    await vi.waitFor(() => {
      expect(statuses.some((status) => status.kind === 'recording' && status.committed > 0)).toBe(
        true,
      );
    });

    const second = memoryStorage({ tree, coordinator, tab: { name: 'second', seed: 5 } });
    const took = expectSuccess(
      await second.client.projects.open({ project, access: 'write', steal: true }),
    );
    const taken = writable(took);
    await vi.waitFor(() => {
      expect(statuses.at(-1)?.kind).toBe('kept');
    });
    const other = unsafeBrandId<'RecordingSessionId'>('5e5510a0-0000-4000-8000-000000000002');
    expect(expectFailureCode((await begun(first, session, other)).answer)).toBe(
      'recording.not-writable',
    );

    const [interrupted] = expectSuccess(await second.client.recording.interrupted(taken));
    if (interrupted === undefined) throw new Error('The recording was not offered.');
    expect(interrupted.session).toBe(SESSION);
    const recovered = expectSuccess(await second.client.recording.recover(taken, SESSION, TAKE));
    expect(recovered.recording.ending).toBe(RecordingEnding.Interrupted);
    const state = taken.getSnapshot().model.state;
    expect(await dataOf(second, state, recovered.asset.id)).toEqual(
      interleaved(audio.map((channel) => channel.slice(0, recovered.recording.length))),
    );
    expect(expectSuccess(await second.client.recording.interrupted(taken))).toEqual([]);
  });
});
