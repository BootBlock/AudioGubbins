/**
 * Measuring members' loudness for the conformance report (ADR-0101): each
 * member's whole audio as the final render hears it, its rack and edits
 * included, read once on the detection worker by the canonical loudness and
 * peak meters loudness normalisation measures with, so a member normalised to
 * its target reads that target.
 *
 * One run at a time, its members measured one after another, so the worker
 * reads one sound at once and the page holds one sound's description; a new
 * run stops the one before. A measurement the host keeps is answered again
 * without reading anything, which an undo back to audio measured before gets.
 * The readings are the session's (`loudness-store.ts`); nothing here changes
 * the project.
 */

import {
  ZERO_SAMPLES,
  createCancellationSource,
  type CancellationSource,
  type QualityMode,
} from '@audiogubbins/domain';
import type { DetectionHost, LoudnessOutcome } from '@audiogubbins/detection-runtime';
import { quoted } from '@audiogubbins/text';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { LoudnessReadings, LoudnessStore } from '../state/loudness-store.js';
import type { Observable } from '../state/observable.js';
import { detectionIdentity } from './detection-control.js';

/** A member to measure: its key, its name, and its audio as the editor opens it. */
export interface MeasuredMember {
  readonly key: string;
  readonly name: string;
  readonly audio: EditorAsset;
}

/** The session's loudness measurements (see the module comment). */
export class LoudnessMeasuring {
  readonly #host: Pick<DetectionHost, 'measureLoudness'>;
  readonly #store: LoudnessStore;
  readonly #announce: (text: string) => void;
  #running: CancellationSource | undefined;

  constructor(options: {
    readonly host: Pick<DetectionHost, 'measureLoudness'>;
    readonly store: LoudnessStore;
    readonly announce: (text: string) => void;
  }) {
    this.#host = options.host;
    this.#store = options.store;
    this.#announce = options.announce;
  }

  /** The readings of this session, which a surface reads and never writes. */
  get readings(): Observable<LoudnessReadings> {
    return this.#store;
  }

  /**
   * Measures each of `members` in turn at `quality`, the final render's,
   * stopping a run still going; says what the run came to once it ends.
   */
  measure(members: readonly MeasuredMember[], quality: QualityMode): void {
    this.cancel();
    const cancellation = createCancellationSource();
    this.#running = cancellation;
    for (const member of members) {
      this.#store.put(member.key, {
        kind: 'queued',
        identity: detectionIdentity(member.audio, quality),
        name: member.name,
      });
    }
    void this.#run(members, quality, cancellation);
  }

  /** Stops the run going, forgetting the readings it had not finished; answers whether one was. */
  cancel(): boolean {
    const running = this.#running;
    if (running === undefined) return false;
    this.#running = undefined;
    running.cancel();
    for (const [key, reading] of this.#store.get()) {
      if (reading.kind === 'queued' || reading.kind === 'measuring') this.#store.forget(key);
    }
    return true;
  }

  async #run(
    members: readonly MeasuredMember[],
    quality: QualityMode,
    cancellation: CancellationSource,
  ): Promise<void> {
    let measured = 0;
    let failed = 0;
    for (const member of members) {
      if (cancellation.signal.aborted) return;
      const outcome = await this.#measureOne(member, quality, cancellation);
      if (this.#running !== cancellation) return;
      if (outcome.kind === 'done') measured += 1;
      else if (outcome.kind === 'failed') failed += 1;
      else return;
    }
    this.#running = undefined;
    const failures = failed === 0 ? '' : ` ${String(failed)} could not be measured.`;
    this.#announce(
      `Measured the loudness of ${String(measured)} of ${String(members.length)} members.${failures}`,
    );
  }

  async #measureOne(
    member: MeasuredMember,
    quality: QualityMode,
    cancellation: CancellationSource,
  ): Promise<LoudnessOutcome> {
    const { audio } = member;
    const asked = { identity: detectionIdentity(audio, quality), name: member.name };
    const current = (): boolean => this.#running === cancellation;
    const outcome = await this.#host.measureLoudness(
      {
        target: audio.id,
        // The host keys what it keeps by the quality as well, so the content
        // alone is the identity it is given.
        identity: audio.content,
        channels: audio.layout.roles.length,
        describe: audio.describe,
        quality,
        range: { start: ZERO_SAMPLES, end: audio.length },
      },
      {
        signal: cancellation.signal,
        onProgress: (framesRead, framesTotal) => {
          if (current()) {
            this.#store.put(member.key, { ...asked, kind: 'measuring', framesRead, framesTotal });
          }
        },
      },
    );
    if (!current()) return outcome;
    switch (outcome.kind) {
      case 'done':
        this.#store.put(member.key, {
          ...asked,
          kind: 'measured',
          measurement: outcome.measurement,
        });
        break;
      case 'failed':
        this.#store.put(member.key, { ...asked, kind: 'failed', reason: outcome.reason });
        this.#announce(`${quoted(member.name)} could not be measured. ${outcome.reason}`);
        break;
      case 'cancelled':
        this.#store.forget(member.key);
        break;
    }
    return outcome;
  }
}
