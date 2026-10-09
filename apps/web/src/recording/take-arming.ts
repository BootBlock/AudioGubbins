/**
 * Arming the input for what the next take is for (`ADR-0070`, `ADR-0072`,
 * `REQ-STOR-098`): a new take stack, the next take of a stack, or a punch over
 * a range of an asset; an input armed already is given the new purpose.
 *
 * Only the tab holding the project's write lease arms (the session refuses any
 * other, with the reason), and only while storage has room: the time the
 * storage leaves to record is read before the input is opened, at the rate of
 * the context it joins, so where nothing fits the arming is refused with the
 * reason before the browser is asked for the microphone, and below the margin
 * the person is warned (`REQ-REC-096`, `ADR-0071`). An input armed already,
 * given another purpose, is read at its own rate and channels. A punch is
 * recorded on the clock of the audio it replaces, so its audio is cued first,
 * which makes the context at its rate, and the input joins that context.
 */

import {
  FailureKind,
  fail,
  failure,
  sampleRate,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import { nextSession, type ArmedPurpose, type StorageTimeLeft } from '@audiogubbins/recording';
import type { Logger } from '@audiogubbins/diagnostics';
import type { RecordingClient } from '@audiogubbins/storage-runtime';

import type { PlaybackControl } from '../audio/playback-control.js';
import type { Programme } from '../audio/programme.js';
import { observable, type Observable } from '../state/observable.js';
import { listedAs } from './capture-facts.js';
import type { InputControl } from './input-control.js';
import type { OpeningCheck } from './input-opener.js';
import { timeLeftWarning } from './take-words.js';

/** The rate and channels storage time is reckoned at before an input says its own. */
const ASSUMED_RATE = 48_000;
const ASSUMED_CHANNELS = 2;

/** What an arming is for, and what it is made with. */
export interface ArmTake {
  readonly purpose: ArmedPurpose;

  /** Whether this tab holds the project's write lease now (`ArmRequest`). */
  readonly holdsWriteLease: () => boolean;

  /** The storage worker's recordings, which say how much time is left. */
  readonly client: RecordingClient;

  /** A punch's audio, cued where its pre-roll's playback starts, at the rate it plays at. */
  readonly cue?: {
    readonly programme: Programme;
    readonly from: SampleCount;
    readonly rate: number;
  };
}

/** Arms the input for a purpose, watching the storage it would fill. */
export class TakeArming {
  readonly #input: InputControl;
  readonly #playback: Pick<PlaybackControl, 'cue'>;
  readonly #announce: (text: string) => void;
  readonly #logger: Logger;
  readonly #timeLeft = observable<StorageTimeLeft | undefined>(undefined);

  constructor(
    input: InputControl,
    playback: Pick<PlaybackControl, 'cue'>,
    announce: (text: string) => void,
    logger: Logger,
  ) {
    this.#input = input;
    this.#playback = playback;
    this.#announce = announce;
    this.#logger = logger;
  }

  /** The recording time storage left when last read, or `undefined` before the first reading. */
  get timeLeft(): Observable<StorageTimeLeft | undefined> {
    return this.#timeLeft;
  }

  /** Why the input cannot be armed for `purpose` now, or nothing where it can. */
  refusal(purpose: ArmedPurpose, holdsWriteLease: () => boolean): string | undefined {
    if (this.#timeLeft.get()?.kind === 'exhausted') return timeLeftWarning(this.#timeLeft.get());
    const { session } = this.#input.view.get();
    if (session.kind !== 'armed') return this.#input.armRefusal({ purpose, holdsWriteLease });
    if (samePurpose(session.purpose, purpose)) return 'An input is armed already.';
    const retargeted = nextSession(session, { kind: 'retarget', purpose });
    return retargeted.ok ? undefined : retargeted.failures[0].summary;
  }

  /**
   * Arms the input for `request`, or gives an armed input its purpose, or
   * answers why not. Run from the person's gesture: a punch's audio is cued,
   * and the context started, before anything is awaited.
   */
  arm(request: ArmTake): DomainResult<void> {
    const refusal = this.refusal(request.purpose, request.holdsWriteLease);
    if (refusal !== undefined)
      return fail(failure('recording.not-armed', FailureKind.Rejected, refusal));
    const input = this.#input;
    const { session, opened } = input.view.get();
    const { cue } = request;
    // An input open at another rate than the punch's audio would be closed
    // by the context the cue makes, so it is closed first and opened again
    // on that context.
    const reopen =
      session.kind === 'armed' &&
      cue !== undefined &&
      opened !== undefined &&
      opened.rate !== cue.rate;
    if (reopen) input.disarm();
    if (cue !== undefined) this.#playback.cue(cue.programme, cue.from);
    if (session.kind === 'armed' && !reopen) {
      const retargeted = input.retarget(request.purpose);
      if (retargeted.ok) this.read(request.client);
      return retargeted;
    }
    return input.arm(
      { purpose: request.purpose, holdsWriteLease: request.holdsWriteLease },
      (check) => this.#admit(request.client, check),
    );
  }

  /**
   * Reads the time storage leaves before the input is opened, at the rate
   * the capture will run at and the channels the input reports, or a stereo
   * input's where it reports none: where nothing fits, the reason the arming
   * is refused; below the margin, a warning said now.
   */
  async #admit(client: RecordingClient, check: OpeningCheck): Promise<DomainFailure | undefined> {
    const { devices } = this.#input.view.get();
    const channels = listedAs(devices, check.device)?.channelCounts?.max ?? ASSUMED_CHANNELS;
    const left = await this.#timeLeftOf(client, check.rate, channels);
    this.#timeLeft.set(left);
    const warning = timeLeftWarning(left);
    if (warning === undefined) return undefined;
    if (left.kind === 'exhausted') {
      return failure(
        'recording.no-room',
        FailureKind.Rejected,
        `${warning} Free some space to record.`,
      );
    }
    this.#announce(warning);
    return undefined;
  }

  /**
   * Reads how long storage leaves to record at the input's rate and channels,
   * or a stereo input's at the usual rate before one is open, and warns where
   * it is short; with no room left, an armed input is closed again, saying why.
   */
  read(client: RecordingClient): void {
    const { opened, context } = this.#input.view.get();
    const rate = sampleRate(opened?.rate ?? context?.sampleRate ?? ASSUMED_RATE);
    if (!rate.ok) return;
    void this.#timeLeftOf(client, rate.value, opened?.channels ?? ASSUMED_CHANNELS).then((left) => {
      this.#heard(left);
    });
  }

  /** The time storage leaves at `rate` over `channels`, or unknown where it cannot be read. */
  async #timeLeftOf(
    client: RecordingClient,
    rate: SampleRate,
    channels: number,
  ): Promise<StorageTimeLeft> {
    try {
      return await client.timeLeft(rate, channels);
    } catch (error) {
      // The worker went with the page or the project system; nothing is
      // known of the storage, which is said as unknown rather than plenty.
      if (!(error instanceof Error)) throw error;
      this.#logger.warning('The storage time left could not be read.', { reason: error.message });
      return { kind: 'unknown' };
    }
  }

  #heard(left: StorageTimeLeft): void {
    this.#timeLeft.set(left);
    const warning = timeLeftWarning(left);
    if (warning === undefined) return;
    if (left.kind === 'exhausted' && this.#input.view.get().session.kind === 'armed') {
      this.#input.disarm();
      this.#announce(`${warning} The input was closed again. Free some space to record.`);
      return;
    }
    this.#announce(warning);
  }
}

/** Whether two purposes record for the same thing, which arming again would not change. */
function samePurpose(one: ArmedPurpose, other: ArmedPurpose): boolean {
  switch (one.kind) {
    case 'new-stack':
      return other.kind === 'new-stack';
    case 'take':
      return other.kind === 'take' && other.stack === one.stack;
    case 'punch':
      return (
        other.kind === 'punch' &&
        other.asset === one.asset &&
        other.start === one.start &&
        other.length === one.length &&
        other.preRoll === one.preRoll &&
        other.postRoll === one.postRoll
      );
  }
}
