/**
 * One recording the storage worker is making (ADR-0071, REQ-REC-096): its
 * audio committed from its capture channel as it arrives, its status sent as
 * it goes, then, once capture has ended, made into its asset and take, or kept
 * to be recovered.
 *
 * Capture the page ended (stopped, or its input let go of, or cut by a stop
 * called off) is made into its asset once the page's stop says why, since the
 * page knows that better than the channel: a timed stop, a permission taken
 * away, a page suspended or a device unplugged. The stop may come before the
 * channel's end or after it. Capture that ended on its own, for storage that
 * filled or failed or a channel that failed, keeps its ending and is made
 * into its asset at once. A window that stops holding the project stops the
 * recording where it is, since it cannot finish it; the recording is kept, to
 * be recovered by the window that holds the project.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { RecordingEnding } from '@audiogubbins/project-format';
import type { StorageEstimate, StorageTimeLeft } from '@audiogubbins/recording';
import {
  captureInto,
  finishRecording,
  type CaptureEnded,
  type FinishedRecording,
  type FinishingServices,
  type ProjectSession,
  type RecordingProgress,
  type RecordingFiles,
} from '@audiogubbins/storage';

import type { RecordingStatus } from '../protocol/recording-operations.js';
import type { CaptureInput } from './capture-input.js';
import { QuotaWatch } from './quota-watch.js';

/** What a recording is made with. */
export interface RecordingParts {
  readonly session: ProjectSession;
  readonly started: RecordingFiles;
  readonly input: CaptureInput;
  readonly services: FinishingServices;
  readonly estimate: () => Promise<StorageEstimate | undefined>;

  /** Sends the page the recording's status. */
  readonly emit: (status: RecordingStatus) => void;
}

const NOT_WRITABLE = 'This window no longer holds the project to change it, so recording stopped.';

/** A recording in progress, or ended and not yet stopped by the page (see the module comment). */
export class RunningRecording {
  readonly #input: CaptureInput;
  readonly #said: Promise<RecordingEnding>;
  #say: (ending: RecordingEnding) => void = () => undefined;

  /** What the recording came to: its asset and take, or why it is kept. */
  readonly outcome: Promise<DomainResult<FinishedRecording>>;

  constructor(parts: RecordingParts) {
    this.#input = parts.input;
    this.#said = new Promise((resolve) => {
      this.#say = resolve;
    });
    this.outcome = this.#record(parts);
  }

  /**
   * Says why the recording ends, and waits for what it came to. Where
   * `signal` aborts first, the capture channel is cut where it has reached.
   */
  async stop(
    ending: RecordingEnding,
    signal: AbortSignal,
  ): Promise<DomainResult<FinishedRecording>> {
    this.#say(ending);
    const cut = (): void => {
      this.#input.cut(ending);
    };
    signal.addEventListener('abort', cut, { once: true });
    try {
      return await this.outcome;
    } finally {
      signal.removeEventListener('abort', cut);
    }
  }

  async #record(parts: RecordingParts): Promise<DomainResult<FinishedRecording>> {
    const { session, started, input, emit } = parts;
    const ended = await this.#captured(parts);
    const { ending, problem } = ended;
    emit({
      kind: 'ended',
      ending,
      ...(problem === undefined ? {} : { problem }),
      ...ended.progress,
      named: input.pageNames,
    });
    const finalEnding = input.pageNames ? await this.#said : ending;
    const finished = await finishRecording(session, started, finalEnding, parts.services);
    emit(
      finished.ok
        ? { kind: 'finished', recording: finished.value }
        : { kind: 'kept', failure: finished.failures[0] },
    );
    return finished;
  }

  /** Commits the capture until it ends, sending the progress and the time left as it goes. */
  async #captured(parts: RecordingParts): Promise<CaptureEnded> {
    const { session, started, input, emit } = parts;
    const { sampleRate, layout } = started.manifest.start;
    let progress: RecordingProgress = { committed: 0, lost: { count: 0, frames: 0 } };
    const publish = (timeLeft: StorageTimeLeft): void => {
      emit({ kind: 'recording', ...progress, timeLeft });
    };
    const watch = new QuotaWatch(parts.estimate, sampleRate, layout.roles.length, publish);
    const stopHearing = session.subscribe(() => {
      if (session.getSnapshot().access.kind !== 'writable') input.abandon(NOT_WRITABLE);
    });
    void watch.read(0);
    try {
      return await captureInto(started, input, (now) => {
        progress = now;
        publish(watch.timeLeft);
        watch.committed(now.committed);
      });
    } finally {
      stopHearing();
    }
  }
}
