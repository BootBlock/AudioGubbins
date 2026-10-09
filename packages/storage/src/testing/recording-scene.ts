/**
 * What this package's recording tests record and check against: a dry input
 * made of known samples, its blocks as a capture stream brings them, the
 * bytes its chunks must hold, a project open to record into with every
 * service a recording takes, and the samples a recorded asset holds, read
 * back through the read contract.
 */

import { openAudio } from '@audiogubbins/codecs';
import {
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  type AssetId,
  type ChannelLayout,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { MediaObjectStore } from '@audiogubbins/media-store';
import {
  CaptureProfileKind,
  RecordingEnding,
  type ProjectState,
  type RecordingPurpose,
  type RecordingStart,
  type StorageTree,
} from '@audiogubbins/project-format';

import type { CaptureStream, CapturedEvent } from '../capture-stream.js';
import type { ProjectSession } from '../project-session.js';
import type { RecordingSetUp } from '../recording-capture.js';
import type { FinishingServices } from '../recording-finishing.js';
import type { TakeRequest } from '../recording-takes.js';
import { storageOf, type TestStorage } from './memory-ports.js';
import { harness } from './node-services.js';
import { madeProject, openToWrite, type Harness } from './storage-harness.js';
import { testRecordingCommands } from './take-commands.js';
import { addRecord } from './test-commands.js';

/** A low rate, so a chunk, a second, is a few thousand frames and a sweep stays short. */
export const RECORDED_RATE: SampleRate = expectSuccess(sampleRate(8_000));

/** What a recording is set up as in these tests: a new stack of a stereo input. */
export function setUpOf(
  purpose: RecordingPurpose = { kind: 'stack' },
  layout: ChannelLayout = StandardLayouts.stereo,
): RecordingSetUp {
  const start: RecordingStart = {
    recordedAt: 1_790_000_000_000,
    device: { label: 'USB Audio Interface (2-ch)', group: 'group-7', channelCount: 2 },
    profile: { kind: CaptureProfileKind.RawStudio, name: 'Raw/Studio' },
    requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    granted: { echoCancellation: false, noiseSuppression: false, sampleRate: RECORDED_RATE },
    sampleRate: RECORDED_RATE,
    layout,
  };
  return { start, transportFrame: derivedSampleCount(0), purpose };
}

/** What the take is called and placed by in these tests. */
export const TAKE: TakeRequest = { name: 'Take 1', stackName: 'Verse', compensation: 0 };

/**
 * A dry input of `frames` frames over `channels` channels, every sample a
 * different value that a 32-bit float holds exactly.
 */
export function dryInput(frames: number, channels = 2): readonly Float32Array[] {
  return Array.from({ length: channels }, (_, channel) =>
    Float32Array.from(
      { length: frames },
      (_, frame) => ((frame * 7 + channel * 3) % 2_001) / 2_048 - 0.4,
    ),
  );
}

/** The frames from `start` to `end` of `input`. */
export function framesOf(
  input: readonly Float32Array[],
  start: number,
  end: number,
): readonly Float32Array[] {
  return input.map((channel) => channel.slice(start, end));
}

/** `input` in blocks of `blockFrames` frames, the first at frame `from`, as the capture stream brings them. */
export function blocksOf(
  input: readonly Float32Array[],
  blockFrames: number,
  from = 0,
): CapturedEvent[] {
  const frames = input[0]?.length ?? 0;
  const events: CapturedEvent[] = [];
  for (let frame = 0; frame < frames; frame += blockFrames) {
    events.push({
      kind: 'block',
      frame: from + frame,
      channels: framesOf(input, frame, frame + blockFrames),
    });
  }
  return events;
}

/** `input` in blocks of `blockFrames` frames, then the end, as `ending`. */
export function recordingOf(
  input: readonly Float32Array[],
  blockFrames: number,
  ending: RecordingEnding = RecordingEnding.Stopped,
): CapturedEvent[] {
  return [...blocksOf(input, blockFrames), { kind: 'end', ending }];
}

/** A capture stream that brings `events`, then nothing; `closed` says whether it was closed. */
export function streamOf(events: readonly CapturedEvent[]): CaptureStream & {
  readonly closed: () => boolean;
} {
  let next = 0;
  let closed = false;
  return {
    next: () => {
      const event = closed ? undefined : events[next];
      next += 1;
      return Promise.resolve(event);
    },
    close: () => {
      closed = true;
    },
    closed: () => closed,
  };
}

/** The samples of `input` as the chunks and the WAV file's data hold them. */
export function interleaved(input: readonly Float32Array[]): Uint8Array {
  const frames = input[0]?.length ?? 0;
  const bytes = new Uint8Array(frames * input.length * 4);
  const view = new DataView(bytes.buffer);
  for (let frame = 0; frame < frames; frame += 1) {
    input.forEach((channel, index) => {
      view.setFloat32((frame * input.length + index) * 4, channel[frame] ?? 0, true);
    });
  }
  return bytes;
}

/** The samples of a recorded asset, read back through the read contract. */
export async function recordedSamples(
  store: MediaObjectStore,
  state: ProjectState,
  asset: AssetId,
): Promise<readonly Float32Array[]> {
  const source = state.sources.get(asset);
  if (source?.media.kind !== 'managed') throw new Error('A recording is kept as managed media.');
  const reader = expectSuccess(
    await openAudio(expectSuccess(await store.open(source.media.contentId))),
  );
  const { frames, channelCount } = reader.format;
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  expectSuccess(await reader.read(derivedSampleCount(0), frames, channels));
  return channels;
}

/** A project open to record into, and what recording into it takes. */
export interface RecordingScene {
  readonly test: Harness;
  readonly storage: TestStorage;
  readonly session: ProjectSession;
  readonly services: FinishingServices;
}

/** Recording services over `tree`, for `test`'s windows. */
export function recordingServices(test: Harness, storage: TestStorage): FinishingServices {
  return {
    tree: storage.tree,
    digest: test.digest,
    ids: test.ids,
    store: storage.store,
    clock: test.clock,
    commands: testRecordingCommands(addRecord),
  };
}

/** A project made on `tree`, and the scene of recording into it from a window of `test`. */
export async function recordingScene(
  tree: StorageTree,
  test: Harness = harness(11),
): Promise<RecordingScene> {
  const header = await madeProject(test, tree);
  return await sceneOn(tree, header.id, test);
}

/** The scene of recording into the project `project` kept on `tree`, opened to write. */
export async function sceneOn(
  tree: StorageTree,
  project: ProjectState['project']['id'],
  test: Harness,
): Promise<RecordingScene> {
  const storage = storageOf(test, tree);
  const session = await openToWrite(test, tree, project);
  return { test, storage, session, services: recordingServices(test, storage) };
}
