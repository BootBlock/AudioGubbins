/**
 * The detections of the session: one for each asset or region a person asked
 * the assistants about, its progress while it runs, and what it found, kept
 * for the Analysis panel and for the command that applies a recommendation
 * (ADR-0062). It starts and stops detections on the worker's host and holds
 * the session's view of them; it never changes the project, which only a
 * recommendation applied through the project's commands does.
 *
 * A detection is of the audio as it was when asked for. Each is kept with the
 * identity of that audio, its content and the quality its chains ran at, so a
 * reader can tell when an edit since has made it stale; undoing the edit makes
 * it current again, and asking again answers from what the host kept.
 */

import {
  finalRenderSettings,
  createCancellationSource,
  type CancellationSource,
  type EditRange,
  type QualityMode,
} from '@audiogubbins/domain';
import type {
  DetectionHost,
  DetectionOutcome,
  DetectionResult,
} from '@audiogubbins/detection-runtime';

import type { EditorAsset } from '../assets/editor-asset.js';
import { observable, type Observable } from '../state/observable.js';
import { detectionSummary } from './detection-words.js';

/** What a detection reads of a view's audio: a range of it, and whether that is all of it. */
export interface DetectionScope {
  /** On the view's timeline, as the selection states it. */
  readonly range: EditRange;
  readonly whole: boolean;
}

/** What a detection is of: the asset or region, its name, its scope and its audio's identity. */
interface Asked {
  readonly target: string;
  readonly name: string;
  readonly scope: DetectionScope;
  /** What the audio was made of when it was asked for (`detectionIdentity`). */
  readonly identity: string;
  /** The keys of the assistants it runs, in the order their reports are shown. */
  readonly assistants: readonly string[];
}

/** A detection of the session. */
export type Detection =
  | (Asked & {
      readonly kind: 'running';
      readonly framesRead: number;
      readonly framesTotal: number;
    })
  | (Asked & { readonly kind: 'done'; readonly result: DetectionResult })
  | (Asked & { readonly kind: 'failed'; readonly reason: string });

/** The detections of the session, by the asset or region each is of. */
export type Detections = ReadonlyMap<string, Detection>;

/** The assistants a detection runs unless it names others, in the order their reports are shown. */
export const EVERY_ASSISTANT: readonly string[] = ['repair', 'restoration', 'classification'];

/**
 * What `asset`'s audio is, for a detection: its content and the values a
 * final render at `quality` runs its chains at, each of which changes what a
 * detection hears.
 */
export function detectionIdentity(asset: EditorAsset, quality: QualityMode): string {
  return `${JSON.stringify(finalRenderSettings(quality))}\u0000${asset.content}`;
}

/** The session's detections, started and stopped on `host`. */
export class DetectionControl implements Observable<Detections> {
  readonly #host: Pick<DetectionHost, 'detect' | 'dispose'>;
  readonly #announce: (text: string) => void;
  readonly #detections = observable<Detections>(new Map());
  /** The detection of each target still running, and what stops it. */
  readonly #running = new Map<string, CancellationSource>();

  constructor(options: {
    readonly host: Pick<DetectionHost, 'detect' | 'dispose'>;
    readonly announce: (text: string) => void;
  }) {
    this.#host = options.host;
    this.#announce = options.announce;
  }

  readonly get = (): Detections => this.#detections.get();

  readonly subscribe = (listener: () => void): (() => void) => this.#detections.subscribe(listener);

  /** The detection of `target`, if one was asked for this session. */
  of(target: string): Detection | undefined {
    return this.#detections.get().get(target);
  }

  /**
   * Analyses `scope` of `asset`'s audio, as a final render at `quality` makes
   * it, with `assistants`. A detection of the same asset still running is
   * stopped, and what it was is replaced.
   */
  detect(
    asset: EditorAsset,
    scope: DetectionScope,
    quality: QualityMode,
    assistants: readonly string[] = EVERY_ASSISTANT,
  ): void {
    this.#running.get(asset.id)?.cancel();
    const cancellation = createCancellationSource();
    this.#running.set(asset.id, cancellation);
    const asked: Asked = {
      target: asset.id,
      name: asset.name,
      scope,
      identity: detectionIdentity(asset, quality),
      assistants,
    };
    const total = scope.range.end - scope.range.start;
    this.#put({ ...asked, kind: 'running', framesRead: 0, framesTotal: total });
    const current = (): boolean => this.#running.get(asset.id) === cancellation;
    void this.#host
      .detect(
        {
          target: asset.id,
          // The host keys what it keeps by the quality as well, so the
          // content alone is the identity it is given.
          identity: asset.content,
          channels: asset.layout.roles.length,
          describe: asset.describe,
          quality,
          range: scope.range,
          assistants,
        },
        {
          signal: cancellation.signal,
          onProgress: (framesRead, framesTotal) => {
            if (current()) this.#put({ ...asked, kind: 'running', framesRead, framesTotal });
          },
        },
      )
      .then((outcome) => {
        if (!current()) return;
        this.#running.delete(asset.id);
        this.#answered(asked, outcome);
      });
  }

  /** Stops the detection of `target` that is running, answering whether one was. */
  cancel(target: string): boolean {
    const running = this.#running.get(target);
    if (running === undefined) return false;
    this.#running.delete(target);
    running.cancel();
    this.#forget(target);
    return true;
  }

  /** Stops every detection running, and the worker with them. */
  dispose(): void {
    for (const running of this.#running.values()) running.cancel();
    this.#running.clear();
    this.#host.dispose();
  }

  /** Keeps what the detection `asked` came to, and says it. */
  #answered(asked: Asked, outcome: DetectionOutcome): void {
    switch (outcome.kind) {
      case 'done':
        this.#put({ ...asked, kind: 'done', result: outcome.result });
        this.#announce(detectionSummary(outcome.result, asked.name));
        return;
      case 'failed':
        this.#put({ ...asked, kind: 'failed', reason: outcome.reason });
        this.#announce(`${asked.name} could not be analysed. ${outcome.reason}`);
        return;
      case 'cancelled':
        this.#forget(asked.target);
        return;
    }
  }

  #put(detection: Detection): void {
    this.#detections.update((current) => new Map([...current, [detection.target, detection]]));
  }

  #forget(target: string): void {
    this.#detections.update((current) => {
      if (!current.has(target)) return current;
      const next = new Map(current);
      next.delete(target);
      return next;
    });
  }
}
