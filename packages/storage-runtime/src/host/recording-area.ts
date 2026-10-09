/**
 * Recordings, served to the page (ADR-0071, REQ-REC-096): the time the
 * storage leaves to record, a recording begun from the capture channel the
 * page hands over (`running-recording.ts`), its stop, and the recovery and
 * discarding of one a crash cut short.
 *
 * A recording is held here from its beginning until the page's stop has its
 * outcome, and while it is held it is neither recovered nor discarded, nor
 * listed as cut short.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  addAssetInvocation,
  addPunchInvocation,
  addTakeInvocation,
  createTakeStackInvocation,
} from '@audiogubbins/project-commands';
import type { RecordingEnding, RecordingSessionId } from '@audiogubbins/project-format';
import { storageTimeLeft } from '@audiogubbins/recording';
import {
  discardRecording,
  interruptedRecordings,
  recordingInProgress,
  recoverRecording,
  startRecording,
  type FinishedRecording,
  type FinishingServices,
  type ProjectSession,
} from '@audiogubbins/storage';

import { recordingStream } from '../protocol/recording-operations.js';
import type {
  AreaHandlers,
  HostChannel,
  StorageOperations,
} from '../protocol/storage-operations.js';
import { CaptureInput } from './capture-input.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';
import { RunningRecording } from './running-recording.js';

/** The services a recording is finished with, over the worker's own. */
function finishingOf(services: HostServices): FinishingServices {
  return {
    tree: services.tree,
    digest: services.digest,
    ids: services.ids,
    store: services.store,
    clock: services.clock,
    commands: {
      addAsset: addAssetInvocation,
      createStack: createTakeStackInvocation,
      addTake: addTakeInvocation,
      addPunch: addPunchInvocation,
    },
  };
}

/** Why a stop names no recording this window is making. */
function notRecording(session: RecordingSessionId): DomainFailure {
  return failure(
    'recording.not-recording',
    FailureKind.Rejected,
    'No recording of that name is being made in this window.',
    { details: { session } },
  );
}

/** What beginning a recording is given. */
type Begin = StorageOperations['recording.begin']['argument'];

/** The recordings this window is making, each held until the page's stop has its outcome. */
class RunningRecordings {
  readonly #services: HostServices;
  readonly #finishing: FinishingServices;
  readonly #channel: HostChannel;
  readonly #running = new Map<RecordingSessionId, RunningRecording>();

  constructor(services: HostServices, channel: HostChannel) {
    this.#services = services;
    this.#finishing = finishingOf(services);
    this.#channel = channel;
  }

  get finishing(): FinishingServices {
    return this.#finishing;
  }

  /** Fails where `session` is being recorded here. */
  idle(session: RecordingSessionId): DomainResult<void> {
    return this.#running.has(session) ? fail(recordingInProgress(session)) : succeed(undefined);
  }

  /** Whether `session` is being recorded here. */
  has(session: RecordingSessionId): boolean {
    return this.#running.has(session);
  }

  /** Begins recording into the project `session` writes, as `request` says. */
  async begin(
    session: ProjectSession,
    request: Omit<Begin, 'handle'>,
    signal: AbortSignal,
  ): Promise<DomainResult<void>> {
    const { session: id, capture, setUp, take } = request;
    const free = this.idle(id);
    const started = free.ok
      ? await startRecording(session, id, setUp, this.#services, signal)
      : free;
    if (!started.ok) {
      capture.close();
      return started;
    }
    const stream = recordingStream(id);
    const recording = new RunningRecording({
      session,
      started: started.value,
      input: new CaptureInput(capture, setUp),
      take,
      services: this.#finishing,
      estimate: this.#services.estimate,
      emit: (status) => {
        this.#channel.emit(stream, status);
      },
    });
    this.#running.set(id, recording);
    return succeed(undefined);
  }

  /** Stops recording `session` for `ending`, and lets it go once its outcome is in. */
  async stop(
    session: RecordingSessionId,
    ending: RecordingEnding,
    signal: AbortSignal,
  ): Promise<DomainResult<FinishedRecording>> {
    const recording = this.#running.get(session);
    if (recording === undefined) return fail(notRecording(session));
    try {
      return await recording.stop(ending, signal);
    } finally {
      this.#running.delete(session);
    }
  }
}

/** The operations of recordings, over the worker's services, its open projects and the page. */
export function recordingHandlers(
  services: HostServices,
  projects: OpenProjects,
  channel: HostChannel,
): AreaHandlers<'recording'> {
  const running = new RunningRecordings(services, channel);
  return {
    'recording.timeLeft': async ({ sampleRate, channels }) =>
      storageTimeLeft(await services.estimate(), sampleRate, channels),
    'recording.begin': ({ handle, ...request }, { signal }) =>
      running.begin(projects.session(handle), request, signal),
    'recording.stop': ({ session, ending }, { signal }) => running.stop(session, ending, signal),
    'recording.interrupted': async ({ handle }, { signal }) => {
      const listed = await interruptedRecordings(projects.session(handle), services, signal);
      return listed.ok
        ? succeed(listed.value.filter(({ session }) => !running.has(session)))
        : listed;
    },
    'recording.recover': async ({ handle, session, take }, { signal }) => {
      const free = running.idle(session);
      return free.ok
        ? await recoverRecording(projects.session(handle), session, take, running.finishing, signal)
        : free;
    },
    'recording.discard': async ({ handle, session }) => {
      const free = running.idle(session);
      return free.ok ? await discardRecording(projects.session(handle), session, services) : free;
    },
  };
}
