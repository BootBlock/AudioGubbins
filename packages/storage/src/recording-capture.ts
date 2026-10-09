/**
 * Recording into an open project (ADR-0071, REQ-REC-096, REQ-STOR-098): the
 * session's start, then its audio committed in chunks as it arrives until
 * capture ends.
 *
 * Only the window holding the project to change it records into it, and only
 * a recording a WAV file can hold, so both are refused before anything is
 * written, with the reason. The manifest is written before the first chunk,
 * so every chunk a crash leaves is named by a session that can be recovered.
 *
 * A write refused for lack of room stops the recording there, keeping every
 * chunk committed before it, and ends it as the storage being full; a write
 * the storage refuses for another reason ends it as failed, with the reason.
 * Either way the session stays, to be finished now or recovered later, as a
 * crash leaves it. Audio that arrives out of order, which the capture channel
 * already refuses, ends it as failed too, after every frame that came in
 * order. The capture ends when its stream does: closing the stream is how a
 * recording is cut short.
 */

import {
  derivedSampleCount,
  fail,
  succeed,
  type DomainResult,
  type IdGenerator,
  type SampleCount,
} from '@audiogubbins/domain';
import { recordedWavLength } from '@audiogubbins/codecs';
import {
  CHUNK_SAMPLE_FORMAT,
  RecordingEnding,
  TreeFailure,
  TreeFailureKind,
  type Digest,
  type RecordingPurpose,
  type RecordingSessionId,
  type RecordingStart,
  type RecoveryChunkManifest,
  type StorageTree,
  type TakeRequest,
} from '@audiogubbins/project-format';

import type { CaptureStream } from './capture-stream.js';
import { CheckedRecords } from './checked-records.js';
import { ChunkWriter } from './recording-chunks.js';
import { recordingNotWritable, recordingTaken, stackUnnamed } from './recording-failures.js';
import { writeManifest, type RecordingFiles } from './recording-manifests.js';
import type { ProjectSession } from './project-session.js';
import { refusalsReported, storageRefused } from './storage-failures.js';
import { ProjectPaths, RecordingPaths } from './storage-layout.js';

/** What a recording is set up as: what its manifest states as it starts. */
export interface RecordingSetUp {
  readonly start: RecordingStart;

  /** Where its first frame lies on the transport, at its rate. */
  readonly transportFrame: SampleCount;
  readonly purpose: RecordingPurpose;

  /**
   * What the take it becomes is called and placed by, which only the page
   * knows as it begins, kept so a recovered recording is named and placed as
   * a stopped one is.
   */
  readonly take: TakeRequest;
}

/** What recording works with, each made once by the composition root. */
export interface RecordingServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly ids: IdGenerator;
}

/** The frames lost so far, written as silence. */
export interface LostFrames {
  readonly count: number;
  readonly frames: number;
}

/** How far a recording has reached, as it goes. */
export interface RecordingProgress {
  /** The frames in chunks closed, which a crash keeps. */
  readonly committed: number;
  readonly lost: LostFrames;
}

/** How a recording's capture ended. */
export interface CaptureEnded {
  readonly ending: RecordingEnding;

  /** What went wrong, where something did. */
  readonly problem?: string;
  readonly progress: RecordingProgress;
}

/**
 * Starts recording into the project `session` writes, as session `id`, as
 * `setUp` says, or says why it cannot: this window does not hold the project
 * to change it, no WAV file can hold the recording, a recording that starts a
 * stack gives the stack no name, the project has a session of that name
 * already, or its manifest could not be written.
 */
export async function startRecording(
  session: ProjectSession,
  id: RecordingSessionId,
  setUp: RecordingSetUp,
  services: RecordingServices,
  signal?: AbortSignal,
): Promise<DomainResult<RecordingFiles>> {
  const { access } = session.getSnapshot();
  if (access.kind !== 'writable') return fail(recordingNotWritable(access));
  const { sampleRate, layout } = setUp.start;
  const writable = recordedWavLength({ sampleRate, layout }, derivedSampleCount(0));
  if (!writable.ok) return writable;
  // Refused now, not when it ends: its manifest is all a recovery reads, so a
  // recording kept without the name could never be made into its take.
  if (setUp.purpose.kind !== 'take' && setUp.take.stackName === undefined) {
    return fail(stackUnnamed(id));
  }
  const manifest: RecoveryChunkManifest = {
    session: id,
    project: session.project,
    sampleFormat: CHUNK_SAMPLE_FORMAT,
    ...setUp,
  };
  const paths = new RecordingPaths(new ProjectPaths(session.project), id);
  const records = new CheckedRecords(services.tree, services.digest);
  return await refusalsReported(async () => {
    // A session is never written over: its chunks may be all that is left of a recording.
    if ((await services.tree.list(paths.directory)).length > 0) return fail(recordingTaken(id));
    const written = await writeManifest(records, paths, manifest, undefined, signal);
    return written.ok ? succeed({ manifest, paths, records, pair: written.value }) : written;
  });
}

/**
 * Commits the audio `stream` brings into the recording `started`, telling
 * `observe` of each chunk committed and each run of frames lost, until capture
 * ends (see the module comment).
 */
export async function captureInto(
  started: RecordingFiles,
  stream: CaptureStream,
  observe: (progress: RecordingProgress) => void,
): Promise<CaptureEnded> {
  const { start } = started.manifest;
  const writer = new ChunkWriter(
    started.records.tree,
    started.paths,
    start.layout.roles.length,
    start.sampleRate,
  );
  const lost = { count: 0, frames: 0 };
  const progress = (): RecordingProgress => ({ committed: writer.committed, lost: { ...lost } });
  const ended = async (ending: RecordingEnding, problem?: string): Promise<CaptureEnded> => {
    stream.close();
    const before = writer.committed;
    await writer.commit();
    if (writer.committed !== before) observe(progress());
    return { ending, ...(problem === undefined ? {} : { problem }), progress: progress() };
  };
  try {
    for (;;) {
      const event = await stream.next();
      if (event === undefined) return await ended(RecordingEnding.Failed, STREAM_CLOSED);
      if (event.kind === 'end') return await ended(event.ending, event.problem);
      if (event.frame !== writer.reached) return await ended(RecordingEnding.Failed, OUT_OF_ORDER);
      const before = writer.committed;
      if (event.kind === 'block') {
        await writer.append(event.channels);
      } else {
        await writer.silence(event.frames);
        lost.count += 1;
        lost.frames += event.frames;
      }
      if (event.kind === 'gap' || writer.committed !== before) observe(progress());
    }
  } catch (error) {
    // Storage that refuses a chunk ends the recording; anything else is a defect.
    if (!(error instanceof TreeFailure)) throw error;
    stream.close();
    return {
      ending:
        error.kind === TreeFailureKind.Quota ? RecordingEnding.StorageFull : RecordingEnding.Failed,
      problem: storageRefused(error).summary,
      progress: progress(),
    };
  }
}

const STREAM_CLOSED = 'The recording’s audio stopped arriving before capture ended.';
const OUT_OF_ORDER = 'The recording’s audio arrived out of order.';
