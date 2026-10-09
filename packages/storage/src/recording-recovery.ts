/**
 * What the person does with a recording a crash, a reload, a refused write or
 * a lost device interrupted (ADR-0071, REQ-REC-096): recovering it, which
 * makes it the asset and take it was for as a stop does, saying its capture
 * ended unexpectedly, or discarding it, which removes it. Nothing else ends an
 * interrupted session, and only the window holding the project to change it
 * does either.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { RecordingSessionId } from '@audiogubbins/project-format';

import { CheckedRecords } from './checked-records.js';
import type { ProjectSession } from './project-session.js';
import { recordingNotWritable } from './recording-failures.js';
import {
  finishRecording,
  type FinishedRecording,
  type FinishingServices,
} from './recording-finishing.js';
import {
  interruptedRecording,
  listRecordings,
  removeRecording,
  type Interrupted,
  type InterruptedRecording,
} from './recording-sessions.js';
import type { RecordingServices } from './recording-capture.js';
import type { TakeRequest } from './recording-takes.js';
import { refusalsReported } from './storage-failures.js';

/**
 * The recordings of the project `session` writes that were cut short, as its
 * opening offered them, less any recovered or discarded since; a recording in
 * progress reads as cut short until it ends, so its caller leaves it out.
 */
export async function interruptedRecordings(
  session: ProjectSession,
  services: RecordingServices,
  signal?: AbortSignal,
): Promise<DomainResult<readonly InterruptedRecording[]>> {
  const records = new CheckedRecords(services.tree, services.digest);
  const { state } = session.getSnapshot().model;
  return await refusalsReported(async () =>
    succeed((await listRecordings(records, session.project, state, signal)).interrupted),
  );
}

/** Finds the interrupted session `id` of the project `session` writes, refusing a window that cannot write it. */
async function found(
  session: ProjectSession,
  id: RecordingSessionId,
  services: RecordingServices,
  signal?: AbortSignal,
): Promise<DomainResult<Interrupted>> {
  const { access, model } = session.getSnapshot();
  if (access.kind !== 'writable') return fail(recordingNotWritable(access));
  const records = new CheckedRecords(services.tree, services.digest);
  return await refusalsReported(
    async () => await interruptedRecording(records, session.project, model.state, id, signal),
  );
}

/** Makes the interrupted session `id` the asset and take it was for, named and placed as `request` says. */
export async function recoverRecording(
  session: ProjectSession,
  id: RecordingSessionId,
  request: TakeRequest,
  services: FinishingServices,
  signal?: AbortSignal,
): Promise<DomainResult<FinishedRecording>> {
  const interrupted = await found(session, id, services, signal);
  if (!interrupted.ok) return interrupted;
  const { kept, ending } = interrupted.value;
  return await finishRecording(session, kept, ending, request, services, signal);
}

/** Removes the interrupted session `id`, on the person's word alone. */
export async function discardRecording(
  session: ProjectSession,
  id: RecordingSessionId,
  services: RecordingServices,
): Promise<DomainResult<void>> {
  const interrupted = await found(session, id, services);
  if (!interrupted.ok) return interrupted;
  return await refusalsReported(async () => {
    await removeRecording(services.tree, session.project, id);
    return succeed(undefined);
  });
}
