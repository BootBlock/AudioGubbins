/**
 * Analysing a region's loop (ADR-0103) on the detection worker the session's
 * detections run on: what a looped region is to an analysis, and the control
 * that starts and stops the analyses and keeps what each came to in the
 * session's store (`loop-analysis-store.ts`).
 *
 * The region is read two ways, as the plan says: as heard, its loop's
 * crossfade realised in its plan, which the loop's own metrics measure; and
 * plain, without that crossfade, which the crossfade's suitability and every
 * candidate are measured on, since the crossfade belongs to the points being
 * moved. Both are the region's plan (`regionPlan`), so the analysis hears
 * exactly what playback and export do.
 *
 * Nothing here changes the project: an analysis is a value, and the region's
 * loop moves only by a command the person runs, so one that is refused, fails
 * or is cancelled leaves the loop as it was.
 */

import {
  anchorResolver,
  createCancellationSource,
  placeRegion,
  regionPlan,
  type Asset,
  type CancellationSource,
  type EditPlan,
  type LoopDefinition,
  type QualityMode,
  type Region,
} from '@audiogubbins/domain';
import { PcmDescriptionKind, type PcmDescription } from '@audiogubbins/audio-engine';
import type { DetectionHost, LoopOutcome, LoopSubject } from '@audiogubbins/detection-runtime';
import {
  LOOP_ANALYSIS_VERSION,
  type LoopAnalysis,
  type LoopAnalysisRequest,
  type LoopMetrics,
  type LoopSearch,
  type Verdict,
} from '@audiogubbins/loop-analysis';
import { canonicalJson, writeEditPlan, type ProjectState } from '@audiogubbins/project-format';
import { counted, quoted } from '@audiogubbins/text';

import type { EditorAsset } from '../assets/editor-asset.js';
import { planContextOf } from '../assets/project-assets.js';
import type {
  LoopAnalysisRecord,
  LoopAnalysisStore,
  LoopAsked,
} from '../state/loop-analysis-store.js';

/** A region's audio as the page describes it to the worker: its plan over the files it reads. */
type EditedDescription = Extract<
  PcmDescription,
  { readonly kind: typeof PcmDescriptionKind.Edited }
>;

/** A looped region of the project as an analysis and an audition read it. */
export interface RegionLoop {
  /** The region and its asset, as the region's sound was made from them. */
  readonly region: Region;
  readonly asset: Asset;
  /** The region's sound, as an editor view opens it. */
  readonly sound: EditorAsset;
  /** Its loop as its plan places it, in region frames, its crossfade cut to fit. */
  readonly loop: LoopDefinition;
  /** The region's plan with its loop's crossfade, as it is heard. */
  readonly heard: EditPlan;
  /** The region's plan without it, as a search for loop points reads it. */
  readonly plain: EditPlan;
  /** Both, written out whole with the media they read, and the loop (see {@link loopIdentity}). */
  readonly identity: string;
  /** The region's audio described with `plan` in place of its own, over the same files. */
  readonly describedWith: (plan: EditPlan) => PcmDescription;
}

/**
 * What a looped region is, for an analysis of it: its sound as heard, written
 * out whole with the media it reads (`EditorAsset.content`), its plan without
 * the loop's crossfade, which reads the same media, and the loop as placed. Two
 * analyses of one identity measure alike, so an edit that changes any of them,
 * the loop's points among them, which a loop without a crossfade does not
 * change the sound by, makes an analysis stale; undoing it makes it current
 * again.
 */
function loopIdentity(sound: EditorAsset, plain: EditPlan, loop: LoopDefinition): string {
  const placed = [loop.loopStart, loop.loopEnd, loop.crossfadeLength, loop.crossfadeShape];
  return `${sound.content}\u0000${canonicalJson(writeEditPlan(plain))}\u0000${JSON.stringify(placed)}`;
}

/** The region `sound` is, looped, as an analysis reads it in `state`, or why it cannot be analysed. */
export function regionLoopOf(sound: EditorAsset, state: ProjectState): RegionLoop | string {
  const { owner } = sound;
  if (owner.kind !== 'project' || owner.region === undefined) {
    return 'A loop is a region’s. Select one region, or open one in a view of its own.';
  }
  const { asset, region } = owner;
  const resolver = anchorResolver(asset);
  const loop = placeRegion(resolver, region)?.loop;
  if (loop === undefined) {
    return `${quoted(region.displayName)} does not loop. Loop part of it first, with “Loop the selection of the region”.`;
  }
  const plain = regionPlan(asset, region, planContextOf(state), resolver, { loopCrossfade: false });
  if (!plain.ok) return plain.failures[0].summary;
  const described = sound.describe();
  if (described.kind !== PcmDescriptionKind.Edited) {
    return `${quoted(region.displayName)} is not read from its plan, so its loop cannot be analysed.`;
  }
  const base: EditedDescription = described;
  return {
    region,
    asset,
    sound,
    loop,
    heard: owner.plan,
    plain: plain.value,
    identity: loopIdentity(sound, plain.value, loop),
    describedWith: (plan) => ({ ...base, plan }),
  };
}

/** The request that measures `loop` as it is placed, searching as `search` says where given. */
export function loopRequestOf(loop: LoopDefinition, search?: LoopSearch): LoopAnalysisRequest {
  return {
    loop: {
      start: loop.loopStart,
      end: loop.loopEnd,
      crossfadeLength: loop.crossfadeLength,
      crossfadeShape: loop.crossfadeShape,
    },
    ...(search === undefined ? {} : { search }),
  };
}

/** What the worker is asked of `looped` for `request`, at `quality`. */
function subjectOf(
  looped: RegionLoop,
  request: LoopAnalysisRequest,
  quality: QualityMode,
): LoopSubject {
  return {
    target: looped.region.id,
    // The host keys what it keeps by the quality and the request as well.
    identity: looped.identity,
    channels: looped.sound.layout.roles.length,
    describe: () => ({
      heard: looped.describedWith(looped.heard),
      plain: looped.describedWith(looped.plain),
    }),
    quality,
    request,
  };
}

/** The verdict of every check of `metrics`, the crossfade's where the loop has one. */
function verdictsOf(metrics: LoopMetrics): readonly Verdict[] {
  return [
    metrics.discontinuity.verdict,
    metrics.dcMismatch.verdict,
    metrics.netDc.verdict,
    metrics.levelMismatch.verdict,
    metrics.phaseMismatch.verdict,
    metrics.spectralMismatch.verdict,
    metrics.zeroCrossing.start.verdict,
    metrics.zeroCrossing.end.verdict,
    metrics.zeroCrossing.signs.verdict,
    metrics.cycleStability.seam.verdict,
    metrics.cycleStability.drift.verdict,
    ...(metrics.crossfade === undefined ? [] : [metrics.crossfade.verdict]),
  ];
}

/** How `metrics` are judged, in words: "passes every check", or what fails and what warns. */
export function judgedWords(metrics: LoopMetrics): string {
  const verdicts = verdictsOf(metrics);
  const failing = verdicts.filter((verdict) => verdict === 'fail').length;
  const warning = verdicts.filter((verdict) => verdict === 'warn').length;
  return failing === 0 && warning === 0
    ? 'passes every check'
    : [
        ...(failing === 0 ? [] : [`fails ${counted(failing, 'check', 'checks')}`]),
        ...(warning === 0 ? [] : [`warns on ${counted(warning, 'check', 'checks')}`]),
      ].join(' and ');
}

/** What is said once an analysis of the loop of the region called `name` has answered. */
function loopAnalysisSummary(analysis: LoopAnalysis, name: string): string {
  const found =
    analysis.candidates.length === 0
      ? ''
      : ` ${counted(analysis.candidates.length, 'candidate loop', 'candidate loops')} found; the Loop panel lists them.`;
  return `The loop of ${quoted(name)} ${judgedWords(analysis.current)}.${found}`;
}

/**
 * The session's loop analyses, started and stopped on `host`, the detection
 * worker's, and kept in `store`. Starting one of a region stops the one of it
 * still running; stopping one, or one that ends cancelled, leaves what the
 * region had before it was asked.
 */
export class LoopAnalysing {
  readonly #host: Pick<DetectionHost, 'analyseLoop'>;
  readonly #store: LoopAnalysisStore;
  readonly #announce: (text: string) => void;
  /** The analysis of each region still running, what stops it, and what the region had before. */
  readonly #running = new Map<
    string,
    { readonly cancellation: CancellationSource; readonly before: LoopAnalysisRecord | undefined }
  >();

  constructor(options: {
    readonly host: Pick<DetectionHost, 'analyseLoop'>;
    readonly store: LoopAnalysisStore;
    readonly announce: (text: string) => void;
  }) {
    this.#host = options.host;
    this.#store = options.store;
    this.#announce = options.announce;
  }

  /** The session's loop analyses, to read. */
  get analyses(): Pick<LoopAnalysisStore, 'get' | 'subscribe' | 'of'> {
    return this.#store;
  }

  /** Whether an analysis of `region` is running. */
  isRunning(region: string): boolean {
    return this.#running.has(region);
  }

  /** Analyses the loop of `looped` for `request`, its chains run at `quality`, the final render's. */
  analyse(looped: RegionLoop, request: LoopAnalysisRequest, quality: QualityMode): void {
    const region = looped.region.id;
    const earlier = this.#running.get(region);
    earlier?.cancellation.cancel();
    const cancellation = createCancellationSource();
    const before = earlier === undefined ? this.#store.of(region) : earlier.before;
    this.#running.set(region, { cancellation, before });
    const asked: LoopAsked = {
      region,
      name: looped.region.displayName,
      identity: looped.identity,
      request,
      version: LOOP_ANALYSIS_VERSION,
    };
    this.#store.put({ ...asked, kind: 'running', done: 0, total: 1 });
    const current = (): boolean => this.#running.get(region)?.cancellation === cancellation;
    void this.#host
      .analyseLoop(subjectOf(looped, request, quality), {
        signal: cancellation.signal,
        onProgress: (done, total) => {
          if (current()) this.#store.put({ ...asked, kind: 'running', done, total });
        },
      })
      .then((outcome) => {
        if (!current()) return;
        this.#running.delete(region);
        this.#answered(asked, before, outcome);
      });
  }

  /** Stops the analysis of `region` that is running, answering whether one was. */
  cancel(region: string): boolean {
    const running = this.#running.get(region);
    if (running === undefined) return false;
    this.#running.delete(region);
    running.cancellation.cancel();
    this.#restore(region, running.before);
    return true;
  }

  /** Stops every analysis running; the worker is the detections', which stop it. */
  dispose(): void {
    for (const running of this.#running.values()) running.cancellation.cancel();
    this.#running.clear();
  }

  /** Keeps what the analysis `asked` came to, and says it. */
  #answered(asked: LoopAsked, before: LoopAnalysisRecord | undefined, outcome: LoopOutcome): void {
    switch (outcome.kind) {
      case 'done':
        this.#store.put({ ...asked, kind: 'done', analysis: outcome.analysis });
        this.#announce(loopAnalysisSummary(outcome.analysis, asked.name));
        return;
      case 'failed':
        this.#store.put({ ...asked, kind: 'failed', reason: outcome.reason });
        this.#announce(
          `The loop of ${quoted(asked.name)} could not be analysed. ${outcome.reason}`,
        );
        return;
      case 'cancelled':
        this.#restore(asked.region, before);
        return;
    }
  }

  /** Gives `region` back what it had before an analysis that did not answer. */
  #restore(region: string, before: LoopAnalysisRecord | undefined): void {
    if (before === undefined || before.kind === 'running') this.#store.forget(region);
    else this.#store.put(before);
  }
}
