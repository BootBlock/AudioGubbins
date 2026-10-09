/**
 * The recording sessions a project keeps that are not yet assets (ADR-0071,
 * REQ-REC-096, REQ-STOR-099, REQ-STOR-106).
 *
 * A session is interrupted where its manifest can be read and the project
 * does not hold the asset the manifest names as its end: a crash, a reload, a
 * refused write or a lost device cut it short before, or while, it was made
 * into one. Recovering it says its capture ended unexpectedly: as the
 * manifest says where capture ended so, for want of storage or of the device,
 * and as interrupted otherwise, since even a recording stopped by the person
 * was cut short before it was whole. Every such session is listed when the
 * project opens, with the
 * frames its chunks hold, the device as it was recorded and its start, and
 * stays until the person recovers it or discards it: no cleanup step, cache
 * relief or purge reaches a project's recordings. A session whose asset the
 * project holds was finished and only its removal was cut short; the window
 * that opens the project to write removes it, and so it does a session that
 * holds no chunk, whose audio, if any arrived, never reached storage. A session holding chunks and no manifest that can be read is left
 * where it is, since nothing could say what it holds.
 */

import {
  fail,
  isWellFormedId,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type ProjectId,
  type SampleCount,
} from '@audiogubbins/domain';
import {
  RecordingEnding,
  endedUnexpectedly,
  type ProjectState,
  type RecordedDevice,
  type RecordedGaps,
  type RecordingPurpose,
  type RecordingSessionId,
  type RecoveryChunkManifest,
  type StorageTree,
} from '@audiogubbins/project-format';

import type { CheckedRecords } from './checked-records.js';
import { readRecordedAudio } from './recorded-audio.js';
import { recordingUnknown } from './recording-failures.js';
import { readManifest, type RecordingFiles } from './recording-manifests.js';
import { ProjectPaths, RecordingPaths } from './storage-layout.js';

/** A recording cut short before it became an asset, as the project's opening offers it. */
export interface InterruptedRecording {
  readonly session: RecordingSessionId;

  /** The whole frames its chunks hold, which recovering it keeps. */
  readonly frames: SampleCount;

  /** When it started, in milliseconds since the epoch. */
  readonly recordedAt: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly device: RecordedDevice;
  readonly purpose: RecordingPurpose;

  /** Why its capture ended, where it ended; `interrupted` where it never did. */
  readonly ending: RecordingEnding;

  /** The frames lost, where any were, which recovering it keeps as silence. */
  readonly gaps?: RecordedGaps;

  /** Of those, the frames chunks missing from storage left: none unless a file was lost. */
  readonly missing: number;
}

/** A project's recording sessions, by what is to be done with each. */
export interface RecordingListing {
  readonly interrupted: readonly InterruptedRecording[];

  /** Sessions whose asset the project holds, or that hold nothing: removed by the window writing. */
  readonly leftOver: readonly RecordingSessionId[];
}

/** Lists the recording sessions of `project`, whose state is `state` (see the module comment). */
export async function listRecordings(
  records: CheckedRecords,
  project: ProjectId,
  state: ProjectState,
  signal?: AbortSignal,
): Promise<RecordingListing> {
  const projectPaths = new ProjectPaths(project);
  const interrupted: InterruptedRecording[] = [];
  const leftOver: RecordingSessionId[] = [];
  for (const entry of await records.tree.list(projectPaths.recordings)) {
    signal?.throwIfAborted();
    if (entry.kind !== 'directory' || !isWellFormedId(entry.name)) continue;
    const session = unsafeBrandId<'RecordingSessionId'>(entry.name);
    const paths = new RecordingPaths(projectPaths, session);
    const read = await readManifest(records, paths, signal);
    const empty = await holdsNoChunk(records.tree, paths);
    if (read.kind === 'absent') {
      if (empty) leftOver.push(session);
      continue;
    }
    const { manifest } = read;
    if (manifest.session !== session || manifest.project !== project) continue;
    if (empty || isFinished(manifest, state)) {
      leftOver.push(session);
      continue;
    }
    const { start } = manifest;
    const audio = await readRecordedAudio(records.tree, paths, start.layout.roles.length, signal);
    interrupted.push({
      session,
      frames: audio.frames,
      recordedAt: start.recordedAt,
      sampleRate: start.sampleRate,
      channels: start.layout.roles.length,
      device: start.device,
      purpose: manifest.purpose,
      ending: recoveredEnding(manifest),
      ...(audio.gaps === undefined ? {} : { gaps: audio.gaps }),
      missing: audio.missing,
    });
  }
  return { interrupted, leftOver };
}

/** How a recovered session's capture is said to have ended (see the module comment). */
function recoveredEnding(manifest: RecoveryChunkManifest): RecordingEnding {
  const ending = manifest.end?.ending;
  return ending !== undefined && endedUnexpectedly(ending) ? ending : RecordingEnding.Interrupted;
}

/** Whether a session's manifest names an asset `state` holds, so it was finished. */
function isFinished(manifest: RecoveryChunkManifest, state: ProjectState): boolean {
  return manifest.end !== undefined && state.project.assets.has(manifest.end.asset);
}

async function holdsNoChunk(tree: StorageTree, paths: RecordingPaths): Promise<boolean> {
  return (await tree.list(paths.chunks)).length === 0;
}

/** Removes the files of `project`'s recording session `session`. */
export async function removeRecording(
  tree: StorageTree,
  project: ProjectId,
  session: RecordingSessionId,
): Promise<void> {
  await tree.remove(new RecordingPaths(new ProjectPaths(project), session).directory);
}

/** An interrupted session read to be finished, and how its capture is said to have ended. */
export interface Interrupted {
  readonly kept: RecordingFiles;
  readonly ending: RecordingEnding;
}

/**
 * The interrupted session `session` of `project`, whose state is `state`,
 * read to be finished, and how its capture is said to have ended.
 */
export async function interruptedRecording(
  records: CheckedRecords,
  project: ProjectId,
  state: ProjectState,
  session: RecordingSessionId,
  signal?: AbortSignal,
): Promise<DomainResult<Interrupted>> {
  const paths = new RecordingPaths(new ProjectPaths(project), session);
  const read = await readManifest(records, paths, signal);
  if (
    read.kind === 'absent' ||
    read.manifest.session !== session ||
    read.manifest.project !== project ||
    isFinished(read.manifest, state)
  ) {
    return fail(recordingUnknown(session));
  }
  const { manifest, pair } = read;
  return succeed({ kept: { manifest, paths, records, pair }, ending: recoveredEnding(manifest) });
}
