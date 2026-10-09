/**
 * One take, from the capture channel Record gives to what storage made of it
 * (`ADR-0071`): begun in the storage worker once the capture says which frame
 * the take begins on, its status followed as it is committed, and stopped
 * exactly once, with the ending the page gives.
 *
 * The page holds no recorded sample: the capture channel's port is handed to
 * the worker, transferred, and what the capture wrote before then waits in it.
 * Every recording begun is stopped once: a stop asked for before the worker has
 * begun is made once it has, and a take whose capture never began is never
 * begun at all. Where the capture cannot end the channel itself, its context
 * gone, the stop is called off once the worker has waited a while for the
 * channel's end, and the worker cuts the channel where it reached and keeps
 * everything committed.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  failure,
  type AssetId,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { RecordingEnding, RecordingSessionId } from '@audiogubbins/project-format';
import type { FinishedRecording } from '@audiogubbins/storage';
import type {
  RecordingClient,
  RecordingStatus,
  RemoteProjectSession,
} from '@audiogubbins/storage-runtime';

import type { Programme } from '../audio/programme.js';
import type { TakeSetUp } from './take-set-up.js';

/** What a take is recorded into: the storage worker's recordings and the project it writes. */
export interface RecordingWhere {
  readonly client: RecordingClient;
  readonly project: RemoteProjectSession;

  /** The programme that plays an asset of the project, or why it cannot be heard. */
  readonly programme: (asset: AssetId) => Programme | string;

  /** Told when a take could not be finished and is kept, to be offered for recovery. */
  readonly kept: () => void;
}

/** How long the worker waits for a stopped capture's channel to end before it cuts it. */
const CUT_AFTER_MILLISECONDS = 3_000;

/** What a take came to. */
export type TakeOutcome =
  /** It is its asset and take in the project. */
  | { readonly kind: 'finished'; readonly recording: FinishedRecording }
  /** It could not be made its asset, for `failure`, and is kept to be recovered. */
  | { readonly kind: 'kept'; readonly failure: DomainFailure }
  /** The worker refused to begin it, for `failure`: nothing was recorded. */
  | { readonly kind: 'refused'; readonly failure: DomainFailure }
  /** Its capture never began, so nothing was recorded or begun. */
  | { readonly kind: 'unbegun' };

/** Where a take is recorded into, and how. */
export interface TakeRecordingOptions {
  readonly client: RecordingClient;
  readonly project: RemoteProjectSession;
  readonly session: RecordingSessionId;
  /** The capture channel's far end, which the worker reads. */
  readonly port: MessagePort;
  /** Calls `callback` after `milliseconds`, answering how to cancel it. */
  readonly schedule: (callback: () => void, milliseconds: number) => () => void;
  readonly logger: Logger;
  /** Hears each status the worker sends, until the take settles. */
  readonly status: (status: RecordingStatus) => void;
}

/** Where a take is between Record and what it came to. */
type Stage =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'beginning'; readonly begun: Promise<DomainResult<void>> }
  | { readonly kind: 'begun' }
  | { readonly kind: 'settled' };

/** One take between Record and what it came to (see the module comment). */
export class TakeRecording {
  readonly #options: TakeRecordingOptions;
  readonly #outcome: Promise<TakeOutcome>;
  #settle: (outcome: TakeOutcome) => void = () => undefined;
  #stage: Stage = { kind: 'waiting' };
  #ending: RecordingEnding | undefined;
  #ended = false;
  readonly #stopHearing: () => void;

  constructor(options: TakeRecordingOptions) {
    this.#options = options;
    this.#outcome = new Promise((resolve) => {
      this.#settle = resolve;
    });
    // Heard from before the worker begins, so no status it sends is missed.
    this.#stopHearing = options.client.status(options.session, (status) => {
      if (status.kind === 'ended') this.#ended = true;
      options.status(status);
    });
  }

  /** What the take came to, once it has. */
  get outcome(): Promise<TakeOutcome> {
    return this.#outcome;
  }

  /** Whether the worker has begun the take, so it is committing what the capture sends. */
  get begun(): boolean {
    return this.#stage.kind === 'begun';
  }

  /** The capture began the take: the worker is told how, and begins it. */
  begin(setUp: TakeSetUp): void {
    if (this.#stage.kind !== 'waiting') return;
    const { client, project, session, port } = this.#options;
    const begun = client.begin(project, { session, capture: port, ...setUp });
    this.#stage = { kind: 'beginning', begun };
    void begun.then(
      (result) => {
        if (!result.ok) {
          this.#finish({ kind: 'refused', failure: result.failures[0] });
          return;
        }
        this.#stage = { kind: 'begun' };
        if (this.#ending !== undefined) this.#stopBegun(this.#ending);
      },
      (error: unknown) => {
        this.#failed('The recording could not be begun.', error);
      },
    );
  }

  /**
   * Says why the take ends: the first ending given is the one kept, and the
   * worker is told it once it has begun the take. A take whose capture never
   * began is let go of, with nothing begun.
   */
  stop(ending: RecordingEnding): void {
    if (this.#ending !== undefined || this.#stage.kind === 'settled') return;
    this.#ending = ending;
    if (this.#stage.kind === 'begun') this.#stopBegun(ending);
    else if (this.#stage.kind === 'waiting') {
      this.#options.port.close();
      this.#finish({ kind: 'unbegun' });
    }
  }

  #stopBegun(ending: RecordingEnding): void {
    const { client, session, schedule } = this.#options;
    const cut = new AbortController();
    const waited = schedule(() => {
      if (!this.#ended) cut.abort();
    }, CUT_AFTER_MILLISECONDS);
    client.stop(session, ending, cut.signal).then(
      (result) => {
        waited();
        this.#finish(
          result.ok
            ? { kind: 'finished', recording: result.value }
            : { kind: 'kept', failure: result.failures[0] },
        );
      },
      (error: unknown) => {
        waited();
        this.#failed('The recording could not be stopped.', error);
      },
    );
  }

  /**
   * The worker could not be reached: what it committed is kept by it, to be
   * recovered, as after a crash, and the fault is recorded.
   */
  #failed(what: string, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.#options.logger.error(what, { reason });
    this.#finish({
      kind: 'kept',
      failure: failure(
        'recording.storage-unreachable',
        FailureKind.Retryable,
        `${what} ${reason} Whatever was committed is kept, and offered for recovery when the project is opened again.`,
      ),
    });
  }

  #finish(outcome: TakeOutcome): void {
    if (this.#stage.kind === 'settled') return;
    this.#stage = { kind: 'settled' };
    this.#stopHearing();
    this.#settle(outcome);
  }
}
