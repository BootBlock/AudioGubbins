import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { RecordingEnding } from '@audiogubbins/project-format';

import { openProject } from './project-opening.js';
import { captureInto, startRecording } from './recording-capture.js';
import { finishRecording } from './recording-finishing.js';
import { recoverRecording } from './recording-recovery.js';
import { FillableTree } from './testing/fillable-tree.js';
import { storageOf } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';
import {
  dryInput,
  framesOf,
  recordedSamples,
  recordingOf,
  recordingServices,
  setUpOf,
  streamOf,
} from './testing/recording-scene.js';
import { madeProject, writable } from './testing/storage-harness.js';

/**
 * A recording whose storage fills while it is made (ADR-0071, REQ-REC-096,
 * REQ-STOR-106): the refused write stops it there, as storage full, every
 * chunk committed before stays, and once room is made the session is offered
 * and recovered as those chunks, bit for bit. A recording that ended so and
 * could still say so is recovered as storage full
 * (`recording.recording-recovery.test.ts`).
 */

const INPUT = dryInput(30_000);

/** Records `INPUT` into a project whose storage fills at its `fullAt`th write of the capture. */
async function filledAt(fullAt: number) {
  const test = harness(51);
  const memory = new MemoryStorageTree();
  const { id: project } = await madeProject(test, memory);
  const tree = new FillableTree(memory);
  const session = writable(
    expectSuccess(await openProject({ project, access: 'write' }, test.services(tree))),
  );
  const services = { ...recordingServices(test, storageOf(test, tree)), tree };
  const started = expectSuccess(
    await startRecording(session, services.ids.next<'RecordingSessionId'>(), setUpOf(), services),
  );
  tree.fullAtWrite = tree.writes + fullAt;
  const stream = streamOf(recordingOf(INPUT, 2_500));
  const ended = await captureInto(started, stream, () => undefined);
  const finishing = await finishRecording(session, started, ended.ending, services);
  return { test, memory, tree, project, session, started, ended, stream, finishing };
}

describe('storage that fills while recording', () => {
  it('stops the recording as storage full and keeps every chunk committed, at every write', async () => {
    // Each chunk is created and written: two writes, and four chunks in all.
    for (let fullAt = 1; fullAt <= 8; fullAt += 1) {
      const { ended, stream, finishing, tree, memory, project, test } = await filledAt(fullAt);
      const committed = Math.floor((fullAt - 1) / 2) * 8_000;
      expect(ended.ending).toBe(RecordingEnding.StorageFull);
      expect(ended.progress.committed).toBe(committed);
      expect(stream.closed()).toBe(true);
      expect(expectFailureCode(finishing)).toBe('storage.full');

      tree.full = false;
      const reopened = expectSuccess(
        await openProject({ project, access: 'write', steal: true }, test.services(memory)),
      );
      const [interrupted] = reopened.report.interruptedRecordings;
      if (committed === 0) {
        // Nothing reached storage, so nothing is offered, and the session is gone.
        expect(interrupted).toBeUndefined();
        expect(memory.paths().some((path) => path.includes('/recordings/'))).toBe(false);
        continue;
      }
      // Full storage refused the manifest's rewrite too, so the session reads as cut short.
      expect(interrupted).toMatchObject({ frames: committed, ending: RecordingEnding.Interrupted });
      if (interrupted === undefined) continue;
      const session = writable(reopened);
      const services = recordingServices(test, storageOf(test, memory));
      const recovered = expectSuccess(
        await recoverRecording(session, interrupted.session, services),
      );
      expect(
        await recordedSamples(
          services.store,
          session.getSnapshot().model.state,
          recovered.asset.id,
        ),
      ).toEqual(framesOf(INPUT, 0, committed));
      expect(recovered.recording.ending).toBe(RecordingEnding.Interrupted);
    }
  });

  it('records whole where the storage never fills', async () => {
    const { ended, finishing } = await filledAt(1_000);
    expect(ended).toMatchObject({
      ending: RecordingEnding.Stopped,
      progress: { committed: 30_000 },
    });
    expect(expectSuccess(finishing).recording.length).toBe(30_000);
  });
});
