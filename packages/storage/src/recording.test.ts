import { describe, expect, it, vi } from 'vitest';

import { recordedWavHeader } from '@audiogubbins/codecs';
import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  StandardLayouts,
  ambisonicLayout,
  derivedSampleCount,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  RecordingEnding,
  TreeFailure,
  TreeFailureKind,
  contentIdOf,
  type ByteSink,
  type ByteSource,
  type StorageTree,
  type TreeEntry,
} from '@audiogubbins/project-format';

import { bytesSource } from './byte-streams.js';
import { openProject } from './project-opening.js';
import { captureInto, startRecording } from './recording-capture.js';
import { finishRecording } from './recording-finishing.js';
import {
  RECORDED_RATE,
  blocksOf,
  dryInput,
  framesOf,
  interleaved,
  recordedSamples,
  recordingOf,
  recordingScene,
  sceneOn,
  setUpOf,
  streamOf,
} from './testing/recording-scene.js';
import { WINDOW_B } from './testing/storage-harness.js';

/** A tree that, while `refusing`, refuses for lack of room every write to a project's journal. */
class JournalRefusingTree implements StorageTree {
  refusing = false;
  readonly #inner: StorageTree;

  constructor(inner: StorageTree) {
    this.#inner = inner;
  }

  async readFile(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined> {
    return await this.#inner.readFile(path, signal);
  }

  async openFile(path: string): Promise<ByteSource | undefined> {
    return await this.#inner.openFile(path);
  }

  async writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    this.#refuse(path);
    await this.#inner.writeFile(path, bytes, signal);
  }

  async createFile(path: string): Promise<ByteSink> {
    this.#refuse(path);
    return await this.#inner.createFile(path);
  }

  async remove(path: string): Promise<void> {
    await this.#inner.remove(path);
  }

  async list(directory: string): Promise<readonly TreeEntry[]> {
    return await this.#inner.list(directory);
  }

  #refuse(path: string): void {
    if (this.refusing && path.includes('/journal/')) {
      throw new TreeFailure(TreeFailureKind.Quota, 'The test storage is full.');
    }
  }
}

/**
 * Recording into a project (ADR-0071): a session's audio committed in chunks
 * of a second as it arrives, then made into an asset of origin `recorded` and
 * the take its purpose names, whose samples are the dry input's.
 */

/** Records `events` into the scene's project as `setUp` says, and finishes it. */
async function recorded(
  scene: Awaited<ReturnType<typeof recordingScene>>,
  events: Parameters<typeof streamOf>[0],
  setUp = setUpOf(),
) {
  const started = expectSuccess(
    await startRecording(
      scene.session,
      scene.services.ids.next<'RecordingSessionId'>(),
      setUp,
      scene.services,
    ),
  );
  const ended = await captureInto(started, streamOf(events), () => undefined);
  const finished = await finishRecording(scene.session, started, ended.ending, scene.services);
  return { started, ended, finished };
}

describe('a recording made whole', () => {
  it('becomes an asset whose file is the dry input, bit for bit, under the identity it was hashed as', async () => {
    const tree = new MemoryStorageTree();
    const scene = await recordingScene(tree);
    const input = dryInput(20_000);
    const { finished } = await recorded(scene, recordingOf(input, 4_096));
    const { asset, take, stack } = expectSuccess(finished);

    const state = scene.session.getSnapshot().model.state;
    expect(state.project.assets.get(asset.id)).toEqual(asset);
    expect(asset).toMatchObject({ origin: 'recorded', sampleRate: RECORDED_RATE, length: 20_000 });
    expect(state.project.takeStacks.get(stack)).toEqual({
      id: stack,
      name: 'Verse',
      takes: [take],
      chosen: take.id,
    });
    const samples = await recordedSamples(scene.storage.store, state, asset.id);
    expect(samples).toEqual(input);

    const header = expectSuccess(
      recordedWavHeader({ sampleRate: RECORDED_RATE, layout: asset.channelLayout }, asset.length),
    );
    const file = new Uint8Array([...header.bytes, ...interleaved(input)]);
    const { contentId } = expectSuccess(await contentIdOf(bytesSource(file), scene.test.digest));
    expect(state.sources.get(asset.id)?.media).toMatchObject({ kind: 'managed', contentId });
  });

  it('says how it was recorded, which reads back from storage as it was written', async () => {
    const tree = new MemoryStorageTree();
    const scene = await recordingScene(tree);
    const input = dryInput(9_000);
    const { finished } = await recorded(scene, [
      ...blocksOf(framesOf(input, 0, 3_000), 1_000),
      { kind: 'gap', frame: 3_000, frames: 1_500 },
      ...blocksOf(framesOf(input, 4_500, 9_000), 1_500, 4_500),
      { kind: 'end', ending: RecordingEnding.DeviceLost },
    ]);
    const { asset, recording } = expectSuccess(finished);
    const setUp = setUpOf();
    expect(recording).toEqual({
      ...setUp.start,
      length: 9_000,
      ending: RecordingEnding.DeviceLost,
      gaps: { count: 1, frames: 1_500 },
    });
    expectSuccess(await scene.session.close());

    const reopened = await sceneOn(tree, scene.session.project, scene.test);
    const state = reopened.session.getSnapshot().model.state;
    expect(state.sources.get(asset.id)?.provenance?.recording).toEqual(recording);
    const samples = await recordedSamples(reopened.storage.store, state, asset.id);
    const silence = new Float32Array(1_500);
    expect(samples.map((channel) => channel.slice(3_000, 4_500))).toEqual([silence, silence]);
    expect(samples.map((channel) => channel.slice(4_500))).toEqual(framesOf(input, 4_500, 9_000));
  });

  it('adds its take to the stack it was recorded for, and its punch where it was set up', async () => {
    const tree = new MemoryStorageTree();
    const scene = await recordingScene(tree);
    const first = expectSuccess(
      (await recorded(scene, recordingOf(dryInput(4_000), 2_000))).finished,
    );
    const purpose = { kind: 'take', stack: first.stack } as const;
    const second = expectSuccess(
      (await recorded(scene, recordingOf(dryInput(5_000), 2_000), setUpOf(purpose))).finished,
    );
    const stack = scene.session.getSnapshot().model.state.project.takeStacks.get(first.stack);
    expect(stack?.takes).toEqual([first.take, second.take]);
    expect(stack?.chosen).toBe(second.take.id);

    const punch = {
      length: derivedSampleCount(2_000),
      preRoll: derivedSampleCount(500),
      postRoll: derivedSampleCount(500),
      crossfade: { length: derivedSampleCount(80), shape: 'equal-power' as const },
      resampler: 1,
    };
    const punchPurpose = {
      kind: 'punch',
      asset: first.asset.id,
      basis: 0,
      range: { start: derivedSampleCount(1_000), end: derivedSampleCount(3_000) },
      punch,
    } as const;
    const punched = expectSuccess(
      (await recorded(scene, recordingOf(dryInput(3_000), 1_000), setUpOf(punchPurpose))).finished,
    );
    const state = scene.session.getSnapshot().model.state;
    const edits = state.project.assets.get(first.asset.id)?.edits;
    expect(edits?.at(-1)).toMatchObject({
      kind: 'process',
      range: punchPurpose.range,
      edit: { kind: 'punch', stack: punched.stack },
    });
    expect(state.project.takeStacks.get(punched.stack)?.punch).toEqual(punch);

    // The asset now has an edit, so a punch set up on it before is refused.
    const moved = await recorded(scene, recordingOf(dryInput(3_000), 1_000), setUpOf(punchPurpose));
    expect(expectFailureCode(moved.finished)).toBe('recording.punch-moved');
  });

  it('takes its undo as one change, the asset and the take together', async () => {
    const scene = await recordingScene(new MemoryStorageTree());
    const { asset, stack } = expectSuccess(
      (await recorded(scene, recordingOf(dryInput(3_000), 1_000))).finished,
    );
    expectSuccess(await scene.session.undo());
    const state = scene.session.getSnapshot().model.state;
    expect(state.project.assets.has(asset.id)).toBe(false);
    expect(state.project.takeStacks.has(stack)).toBe(false);
  });
});

describe('a recording’s chunks', () => {
  it('are each a second at most, named by their first frame, holding the interleaved samples', async () => {
    const tree = new MemoryStorageTree();
    const scene = await recordingScene(tree);
    const input = dryInput(18_500);
    const started = expectSuccess(
      await startRecording(
        scene.session,
        scene.services.ids.next<'RecordingSessionId'>(),
        setUpOf(),
        scene.services,
      ),
    );
    const committed: number[] = [];
    await captureInto(started, streamOf(recordingOf(input, 3_000)), (progress) => {
      committed.push(progress.committed);
    });
    expect(committed).toEqual([8_000, 16_000, 18_500]);
    const chunks = tree.paths().filter((path) => path.startsWith(`${started.paths.chunks}/`));
    expect(chunks).toEqual([
      `${started.paths.chunks}/000000000000`,
      `${started.paths.chunks}/000000008000`,
      `${started.paths.chunks}/000000016000`,
    ]);
    const held = tree.snapshot();
    expect(held.get(chunks[1] ?? '')).toEqual(interleaved(framesOf(input, 8_000, 16_000)));
    expect(held.get(chunks[2] ?? '')).toEqual(interleaved(framesOf(input, 16_000, 18_500)));
  });

  it('are removed only once the journal holds the asset made of them', async () => {
    const memory = new MemoryStorageTree();
    const scene = await recordingScene(memory);
    expectSuccess(await scene.session.close());
    const tree = new JournalRefusingTree(memory);
    const reopened = await sceneOn(tree, scene.session.project, scene.test);
    const { session, services } = reopened;
    const started = expectSuccess(
      await startRecording(session, services.ids.next<'RecordingSessionId'>(), setUpOf(), services),
    );
    const input = recordingOf(dryInput(9_000), 3_000);
    const ended = await captureInto(started, streamOf(input), () => undefined);
    const holds = (): boolean =>
      memory.paths().some((path) => path.startsWith(`${started.paths.directory}/`));

    tree.refusing = true;
    const finished = expectSuccess(await finishRecording(session, started, ended.ending, services));
    expect(finished.outcome).toMatchObject({ kind: 'applied', saved: { kind: 'not-saved' } });
    expect(session.getSnapshot().model.state.project.assets.has(finished.asset.id)).toBe(true);
    expect(holds()).toBe(true);

    tree.refusing = false;
    expect(await session.retry()).toEqual({ kind: 'saved' });
    await vi.waitFor(() => {
      expect(holds()).toBe(false);
    });
  });
});

describe('recording is refused, with the reason, before anything is written', () => {
  it('in a window that no longer holds the project to change it', async () => {
    const tree = new MemoryStorageTree();
    const scene = await recordingScene(tree);
    expectSuccess(
      await openProject(
        { project: scene.session.project, access: 'write', steal: true },
        scene.test.services(tree, { owner: WINDOW_B }),
      ),
    );
    const before = tree.paths();
    const refused = await startRecording(
      scene.session,
      scene.services.ids.next<'RecordingSessionId'>(),
      setUpOf(),
      scene.services,
    );
    expect(expectFailureCode(refused)).toBe('recording.not-writable');
    expect(tree.paths()).toEqual(before);
  });

  it('under the name of a session the project has, which is kept as it is', async () => {
    const tree = new MemoryStorageTree();
    const scene = await recordingScene(tree);
    const id = scene.services.ids.next<'RecordingSessionId'>();
    const started = expectSuccess(
      await startRecording(scene.session, id, setUpOf(), scene.services),
    );
    await captureInto(started, streamOf(blocksOf(dryInput(9_000), 3_000)), () => undefined);
    const before = tree.snapshot();
    const refused = await startRecording(scene.session, id, setUpOf(), scene.services);
    expect(expectFailureCode(refused)).toBe('recording.session-taken');
    expect(tree.snapshot()).toEqual(before);
  });

  it('for a layout no WAV file can state', async () => {
    const tree = new MemoryStorageTree();
    const scene = await recordingScene(tree);
    const layout = expectSuccess(
      ambisonicLayout({
        order: 1,
        ordering: AmbisonicOrdering.Acn,
        normalisation: AmbisonicNormalisation.Sn3d,
      }),
    );
    const before = tree.paths();
    const refused = await startRecording(
      scene.session,
      scene.services.ids.next<'RecordingSessionId'>(),
      setUpOf({ kind: 'stack' }, layout),
      scene.services,
    );
    expect(refused.ok).toBe(false);
    expect(tree.paths()).toEqual(before);
  });

  it('that starts a stack without naming it, which no recovery could then name', async () => {
    const tree = new MemoryStorageTree();
    const scene = await recordingScene(tree);
    const before = tree.paths();
    const refused = await startRecording(
      scene.session,
      scene.services.ids.next<'RecordingSessionId'>(),
      setUpOf({ kind: 'stack' }, StandardLayouts.stereo, { name: 'Take 1', compensation: 0 }),
      scene.services,
    );
    expect(expectFailureCode(refused)).toBe('recording.stack-unnamed');
    expect(tree.paths()).toEqual(before);
  });
});
