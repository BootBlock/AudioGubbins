import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { RecordingEnding, endedUnexpectedly } from '@audiogubbins/project-format';
import { AssetOrigin, unsafeBrandId, type ProjectId } from '@audiogubbins/domain';

import { planCleanup } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import { openProject } from './project-opening.js';
import { captureInto, startRecording } from './recording-capture.js';
import type { RecordingFiles } from './recording-manifests.js';
import { finishRecording } from './recording-finishing.js';
import { discardRecording, recoverRecording } from './recording-recovery.js';
import { relieveStoragePressure } from './storage-pressure.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { measureUsage } from './usage-measurement.js';
import { storageOf } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';
import {
  TAKE,
  blocksOf,
  dryInput,
  framesOf,
  recordedSamples,
  recordingOf,
  recordingScene,
  recordingServices,
  setUpOf,
  streamOf,
} from './testing/recording-scene.js';
import { madeProject, writable, type Harness } from './testing/storage-harness.js';

/**
 * A recording cut short (ADR-0071, REQ-REC-096, REQ-AUDIO-220): by a crash at
 * any step of its session, by a torn or a missing chunk, or by its device
 * going away. Every chunk committed before is recoverable, bit for bit, the
 * session is offered when the project opens, before anything is cleaned, and
 * nothing but the person ends it.
 */

const INPUT = dryInput(20_000);

/**
 * Opens `project` on `tree` to write, from a window of `test`, with its report,
 * taking the project from any window before, as a person does from a window
 * that crashed.
 */
async function opened(test: Harness, tree: MemoryStorageTree, project: ProjectId) {
  const open = expectSuccess(
    await openProject({ project, access: 'write', steal: true }, test.services(tree)),
  );
  return { session: writable(open), report: open.report };
}

/** Records `events` into `project` on `tree` without finishing, leaving the session as a crash would. */
async function cutShort(
  test: Harness,
  tree: MemoryStorageTree,
  project: ProjectId,
  events: Parameters<typeof streamOf>[0],
): Promise<RecordingFiles> {
  const { session } = await opened(test, tree, project);
  const services = recordingServices(test, storageOf(test, tree));
  const started = expectSuccess(
    await startRecording(session, services.ids.next<'RecordingSessionId'>(), setUpOf(), services),
  );
  await captureInto(started, streamOf(events), () => undefined);
  return started;
}

/** Whether anything of the session at `started` is left on `tree`. */
function holds(tree: MemoryStorageTree, started: Pick<RecordingFiles, 'paths'>): boolean {
  return tree.paths().some((path) => path.startsWith(`${started.paths.directory}/`));
}

/** Recovers the one recording `project`'s opening offers, and checks it holds `expected`. */
async function recoveredAs(
  test: Harness,
  tree: MemoryStorageTree,
  project: ProjectId,
  expected: readonly Float32Array[],
) {
  const { session, report } = await opened(test, tree, project);
  const [interrupted] = report.interruptedRecordings;
  if (interrupted === undefined) throw new Error('The opening offered no recording.');
  expect(report.interruptedRecordings).toHaveLength(1);
  expect(interrupted.frames).toBe(expected[0]?.length);
  const services = recordingServices(test, storageOf(test, tree));
  const recovered = expectSuccess(
    await recoverRecording(session, interrupted.session, TAKE, services),
  );
  const state = session.getSnapshot().model.state;
  expect(await recordedSamples(services.store, state, recovered.asset.id)).toEqual(expected);
  return { interrupted, recovered, session };
}

describe('a crash at any step of a recording session', () => {
  it.each(['short', 'full-length'] as const)(
    'keeps every chunk committed before it, recovered bit for bit, or the asset made whole, a write torn %s',
    async (torn) => {
      const test = harness(31);
      const from = new MemoryStorageTree();
      const { id: project } = await madeProject(test, from);
      const commits: { readonly operations: number; readonly committed: number }[] = [];
      let whole = true;

      const operations = await sweepCrashes({
        from,
        tornWrites: [torn],
        run: async (tree) => {
          const { session } = await opened(test, tree, project);
          const services = recordingServices(test, storageOf(test, tree));
          const started = expectSuccess(
            await startRecording(
              session,
              services.ids.next<'RecordingSessionId'>(),
              setUpOf(),
              services,
            ),
          );
          const ended = await captureInto(
            started,
            streamOf(recordingOf(INPUT, 3_000)),
            (progress) => {
              if (whole)
                commits.push({ operations: tree.operations, committed: progress.committed });
            },
          );
          whole = false;
          return await finishRecording(session, started, ended.ending, TAKE, services);
        },
        check: async (found, crash) => {
          const { session, report } = await opened(test, found, project);
          const state = session.getSnapshot().model.state;
          const recorded = [...state.project.assets.values()].filter(
            (asset) => asset.origin === AssetOrigin.Recorded,
          );
          const sessions = found.paths().filter((path) => path.includes('/recordings/'));
          if (recorded.length === 1 && recorded[0] !== undefined) {
            // Finished: the asset holds the whole input, and its session is gone.
            const store = storageOf(test, found).store;
            expect(await recordedSamples(store, state, recorded[0].id)).toEqual(INPUT);
            expect(report.interruptedRecordings).toEqual([]);
            expect(sessions).toEqual([]);
            return;
          }
          expect(recorded).toEqual([]);
          expect(crash.outcome).toBeUndefined();
          const before = commits.filter((commit) => commit.operations < (crash.at ?? 0));
          const kept = before.at(-1)?.committed ?? 0;
          const [interrupted] = report.interruptedRecordings;
          if (interrupted === undefined) {
            // Cut short before its manifest was whole: nothing was committed.
            expect(kept).toBe(0);
            expect(sessions).toEqual([]);
            return;
          }
          expect(interrupted.frames).toBeGreaterThanOrEqual(kept);
          const services = recordingServices(test, storageOf(test, found));
          const recovered = await recoverRecording(session, interrupted.session, TAKE, services);
          if (interrupted.frames === 0) {
            expect(expectFailureCode(recovered)).toBe('recording.nothing-recorded');
          } else {
            const { asset, recording } = expectSuccess(recovered);
            const samples = await recordedSamples(
              services.store,
              session.getSnapshot().model.state,
              asset.id,
            );
            expect(samples).toEqual(framesOf(INPUT, 0, interrupted.frames));
            expect(endedUnexpectedly(recording.ending)).toBe(true);
          }
          expect(found.paths().filter((path) => path.includes('/recordings/'))).toEqual([]);
        },
      });
      expect(operations).toBeGreaterThan(40);
      expect(commits.map((commit) => commit.committed)).toEqual([8_000, 16_000, 20_000]);
    },
  );
});

describe('a recording read back from its chunks', () => {
  it('reads a torn last chunk to its last whole frame', async () => {
    const test = harness(33);
    const tree = new MemoryStorageTree();
    const { id: project } = await madeProject(test, tree);
    const started = await cutShort(test, tree, project, blocksOf(INPUT, 3_000));
    // The crash came while the last chunk, from frame 16,000, was being written.
    const last = started.paths.chunk(16_000);
    const bytes = tree.snapshot().get(last);
    if (bytes === undefined) throw new Error('The last chunk was written.');
    const torn = new MemoryStorageTree(
      {},
      new Map(
        [...tree.snapshot()].map(([path, held]) => [
          path,
          path === last ? held.slice(0, 1_000 * 8 + 5) : held,
        ]),
      ),
    );
    const { interrupted, recovered } = await recoveredAs(
      test,
      torn,
      project,
      framesOf(INPUT, 0, 17_000),
    );
    expect(bytes.length).toBe(4_000 * 8);
    expect(interrupted.ending).toBe(RecordingEnding.Interrupted);
    expect(recovered.recording.ending).toBe(RecordingEnding.Interrupted);
  });

  it('reads a chunk storage lost as silence, counted as frames lost, and keeps every chunk after it', async () => {
    const test = harness(35);
    const tree = new MemoryStorageTree();
    const { id: project } = await madeProject(test, tree);
    const started = await cutShort(test, tree, project, blocksOf(INPUT, 3_000));
    await tree.remove(started.paths.chunk(8_000));
    const expected = framesOf(INPUT, 0, 20_000).map((channel) => {
      const copy = channel.slice();
      copy.fill(0, 8_000, 16_000);
      return copy;
    });
    const { interrupted, recovered } = await recoveredAs(test, tree, project, expected);
    expect(interrupted).toMatchObject({ missing: 8_000, gaps: { count: 1, frames: 8_000 } });
    expect(recovered.recording.gaps).toEqual({ count: 1, frames: 8_000 });
  });
});

describe('a recording whose device went away', () => {
  it('ends as the device lost, keeping every frame that arrived, and becomes its asset', async () => {
    const scene = await recordingScene(new MemoryStorageTree());
    const started = expectSuccess(
      await startRecording(
        scene.session,
        scene.services.ids.next<'RecordingSessionId'>(),
        setUpOf(),
        scene.services,
      ),
    );
    const arrived = framesOf(INPUT, 0, 11_000);
    const stream = streamOf([
      ...blocksOf(arrived, 2_000),
      { kind: 'end', ending: RecordingEnding.DeviceLost },
    ]);
    const ended = await captureInto(started, stream, () => undefined);
    expect(ended).toEqual({
      ending: RecordingEnding.DeviceLost,
      progress: { committed: 11_000, lost: { count: 0, frames: 0 } },
    });
    expect(stream.closed()).toBe(true);
    const finished = expectSuccess(
      await finishRecording(scene.session, started, ended.ending, TAKE, scene.services),
    );
    const state = scene.session.getSnapshot().model.state;
    expect(await recordedSamples(scene.storage.store, state, finished.asset.id)).toEqual(arrived);
    expect(finished.recording.ending).toBe(RecordingEnding.DeviceLost);
  });
});

describe('an interrupted recording', () => {
  it('is offered when the project opens, and no cleanup, cache relief or purge removes it', async () => {
    const test = harness(37);
    const tree = new MemoryStorageTree();
    const { id: project } = await madeProject(test, tree);
    const started = await cutShort(test, tree, project, blocksOf(INPUT, 3_000));
    const kept = new Map(
      [...tree.snapshot()].filter(([path]) => path.startsWith(`${started.paths.directory}/`)),
    );

    const storage = storageOf(harness(38), tree);
    const plan = expectSuccess(await planCleanup('everything', storage.cleaning, 0));
    expectSuccess(await runCleanup(plan, { bytes: plan.confirmationBytes }, storage.cleaning));
    expectSuccess(await relieveStoragePressure(storage.caches));
    const after = tree.snapshot();
    for (const [path, bytes] of kept) expect(after.get(path)).toEqual(bytes);

    const { report } = await opened(harness(39), tree, project);
    expect(report.interruptedRecordings).toEqual([
      expect.objectContaining({
        session: started.manifest.session,
        frames: 20_000,
        recordedAt: started.manifest.start.recordedAt,
        device: started.manifest.start.device,
        ending: RecordingEnding.Interrupted,
      }),
    ]);
  });

  it('is counted by usage as recordings, apart from the recovery checkpoints', async () => {
    const test = harness(41);
    const tree = new MemoryStorageTree();
    const { id: project } = await madeProject(test, tree);
    const started = await cutShort(test, tree, project, blocksOf(INPUT, 3_000));
    const usage = expectSuccess(await measureUsage(storageOf(test, tree).measuring));
    const bytes = [...tree.snapshot()]
      .filter(([path]) => path.startsWith(`${started.paths.directory}/`))
      .reduce((sum, [, held]) => sum + held.length, 0);
    expect(usage.recordings).toBe(bytes);
  });

  it('is removed by being discarded, and only in the window that writes the project', async () => {
    const test = harness(43);
    const tree = new MemoryStorageTree();
    const { id: project } = await madeProject(test, tree);
    const started = await cutShort(test, tree, project, blocksOf(INPUT, 3_000));
    const read = expectSuccess(await openProject({ project, access: 'read' }, test.services(tree)));
    expect(read.report.interruptedRecordings).toHaveLength(1);

    const { session } = await opened(test, tree, project);
    const services = recordingServices(test, storageOf(test, tree));
    const unknown = unsafeBrandId<'RecordingSessionId'>('f00dfeed');
    expect(expectFailureCode(await discardRecording(session, unknown, services))).toBe(
      'recording.unknown-session',
    );
    expect(holds(tree, started)).toBe(true);
    expectSuccess(await discardRecording(session, started.manifest.session, services));
    expect(holds(tree, started)).toBe(false);
  });

  it('keeps how its capture ended where that was unexpected, and is recovered as storage full', async () => {
    const test = harness(45);
    const tree = new MemoryStorageTree();
    const { id: project } = await madeProject(test, tree);
    const { session } = await opened(test, tree, project);
    const services = recordingServices(test, storageOf(test, tree));
    const started = expectSuccess(
      await startRecording(session, services.ids.next<'RecordingSessionId'>(), setUpOf(), services),
    );
    await captureInto(
      started,
      streamOf([...blocksOf(INPUT, 3_000), { kind: 'end', ending: RecordingEnding.StorageFull }]),
      () => undefined,
    );
    // The file could not be finished either: the manifest says how capture ended.
    const failing = {
      ...services,
      store: storageOf(test, new MemoryStorageTree({ quotaBytes: 0 })).store,
    };
    expect(
      (await finishRecording(session, started, RecordingEnding.StorageFull, TAKE, failing)).ok,
    ).toBe(false);
    expectSuccess(await session.close());

    const { interrupted, recovered } = await recoveredAs(test, tree, project, INPUT);
    expect(interrupted.ending).toBe(RecordingEnding.StorageFull);
    expect(recovered.recording.ending).toBe(RecordingEnding.StorageFull);
  });
});
