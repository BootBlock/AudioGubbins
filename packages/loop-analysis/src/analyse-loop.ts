/**
 * A loop analysis (ADR-0103, `REQ-GAME-121`): the seam of a region's loop
 * measured on the audio the engine plays, and on request the boundaries
 * nearby that would loop better.
 *
 * It is given the region's audio twice, as sources it reads in bounded
 * chunks: `heard`, with the loop's crossfade as the region's plan realises it,
 * which the loop's own metrics measure; and `plain`, without it, which the
 * crossfade's suitability and every candidate are measured on. It is pure and
 * deterministic: the same audio, request and algorithm version give the same
 * result on every machine, and it returns a value. Applying a candidate is
 * the person's command; a refused, failed or cancelled analysis is a failure
 * result and changes nothing.
 */

import {
  FailureKind,
  fail,
  failure,
  layoutsMatch,
  succeed,
  type CancellationSignal,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  allocateBlock,
  blockView,
  type CanonicalDsp,
  type PcmSource,
} from '@audiogubbins/audio-engine';

import { searchCandidates, searchCapture, type LoopCandidate } from './candidate-search.js';
import { crossfadeSuitability, SpanPairSums } from './crossfade-suitability.js';
import { driftSpan } from './cycle-stability.js';
import { capturedFrames, captureLoop, type CaptureRequest } from './loop-capture.js';
import {
  checkLoopRequest,
  type AnalysedLoop,
  type LoopAnalysisRequest,
  type LoopSearch,
} from './loop-request.js';
import {
  analysisWindow,
  envelopeCellFrames,
  measuringMargin,
  type SeamPlace,
} from './loop-windows.js';
import { MeasuringKit } from './measuring-kit.js';
import { MOST_PAIRS } from './candidate-pairs.js';
import { measurePair, type LoopMetrics } from './seam-metrics.js';
import { seamWindows } from './seam-windows.js';
import { CHUNK_FRAMES, LoopRefused, readChunk, type ReadingTools } from './source-reading.js';
import { worstVerdict, type Verdict } from './verdicts.js';

/**
 * The analysis's version: a change to a metric, a threshold or the search
 * changes it, and the golden values with it (`REQ-EXEC-180`).
 */
export const LOOP_ANALYSIS_VERSION = 1;

/** What an analysis runs with, apart from the audio. */
export interface LoopTools {
  readonly dsp: CanonicalDsp;
  readonly signal: CancellationSignal;
  /** Resolves once the host has read the messages that arrived meanwhile. */
  readonly yieldToHost: () => Promise<void>;
  readonly onProgress: (done: number, total: number) => void;
}

/** A loop analysis's answer. */
export interface LoopAnalysis {
  readonly version: number;
  readonly sampleRate: SampleRate;
  readonly channels: number;
  /** The analysis window W, in frames. */
  readonly windowFrames: number;
  /** The loop as it is heard, its crossfade included. */
  readonly current: LoopMetrics;
  /** The worst of the current metrics. */
  readonly verdict: Exclude<Verdict, 'not-applicable'>;
  /** Empty unless a search was asked for. */
  readonly candidates: readonly LoopCandidate[];
  /** The W frames heard before the seam and after it, one array per channel each, for the seam view. */
  readonly seam: { readonly tail: readonly Float32Array[]; readonly head: readonly Float32Array[] };
}

/** How much progress measuring one pair is worth, in frames read. */
function pairWork(window: number): number {
  return 2 * window;
}

/** Why the two sources cannot be one region heard two ways, or `undefined` where they can. */
function sourcesProblem(heard: PcmSource, plain: PcmSource): DomainResult<never> | undefined {
  if (
    heard.length === undefined ||
    heard.length !== plain.length ||
    heard.sampleRate !== plain.sampleRate ||
    !layoutsMatch(heard.layout, plain.layout)
  ) {
    return fail(
      failure(
        'loop.sources-differ',
        FailureKind.Rejected,
        'A loop is analysed over one region of known length, heard with and without its crossfade.',
      ),
    );
  }
  return undefined;
}

/** The pass that measures the loop as it is heard. */
export function heardCapture(
  loop: AnalysedLoop,
  regionLength: number,
  sampleRate: SampleRate,
): CaptureRequest {
  const length = loop.end - loop.start;
  return {
    start: loop.start,
    end: loop.end,
    regionLength,
    radius: 0,
    margin: measuringMargin(sampleRate, analysisWindow(sampleRate, length)),
    envelopeCell: envelopeCellFrames(sampleRate),
    driftReach: driftSpan(sampleRate, length),
    startReach: 0,
  };
}

/** Progress over the whole analysis, never going back. */
class Progress {
  #done = 0;
  readonly #total: number;
  readonly #report: (done: number, total: number) => void;

  constructor(total: number, report: (done: number, total: number) => void) {
    this.#total = total;
    this.#report = report;
  }

  add(work: number): void {
    this.#done = Math.min(this.#total, this.#done + work);
    this.#report(this.#done, this.#total);
  }

  finish(): void {
    this.#done = this.#total;
    this.#report(this.#done, this.#total);
  }
}

/** The suitability of the loop's crossfade, from its two spans of `plain` read side by side in chunks. */
async function measuredCrossfade(
  plain: PcmSource,
  loop: AnalysedLoop,
  tools: ReadingTools,
  progress: Progress,
): Promise<LoopMetrics['crossfade']> {
  const length = loop.crossfadeLength;
  if (length === 0) return undefined;
  const sums = new SpanPairSums();
  const size = Math.min(CHUNK_FRAMES, length);
  const fadingOut = allocateBlock(plain.layout, plain.sampleRate, size);
  const fadingIn = allocateBlock(plain.layout, plain.sampleRate, size);
  for (let offset = 0; offset < length; offset += size) {
    const frames = Math.min(size, length - offset);
    const out = blockView(fadingOut, 0, frames);
    const into = blockView(fadingIn, 0, frames);
    await readChunk(plain, loop.end - length + offset, out, tools.signal);
    await readChunk(plain, loop.start - length + offset, into, tools.signal);
    sums.add(out.channels, into.channels, frames);
    progress.add(2 * frames);
    await tools.yieldToHost();
  }
  return crossfadeSuitability(sums.pair());
}

/** A request checked against its region, with what its passes and progress are made of. */
interface CheckedAnalysis {
  readonly loop: AnalysedLoop;
  readonly search: LoopSearch | undefined;
  readonly regionLength: number;
  readonly sampleRate: SampleRate;
  readonly window: number;
}

/** `request` checked against the region `heard` and `plain` are, or why it cannot be analysed. */
function checkedAnalysis(
  heard: PcmSource,
  plain: PcmSource,
  request: LoopAnalysisRequest,
): DomainResult<CheckedAnalysis> {
  const mismatch = sourcesProblem(heard, plain);
  if (mismatch !== undefined) return mismatch;
  const regionLength = heard.length ?? 0;
  const { sampleRate } = heard;
  const checked = checkLoopRequest(request, regionLength, sampleRate);
  if (!checked.ok) return checked;
  const { loop, search } = checked.value;
  return succeed({
    loop,
    search,
    regionLength,
    sampleRate,
    window: analysisWindow(sampleRate, loop.end - loop.start),
  });
}

/** The work an analysis does, in frames read and pairs measured at their worth in frames. */
function workOf({ loop, search, regionLength, sampleRate, window }: CheckedAnalysis): number {
  const own = capturedFrames(heardCapture(loop, regionLength, sampleRate));
  const searching =
    search === undefined
      ? 0
      : capturedFrames(searchCapture(loop, search, regionLength, sampleRate)) +
        MOST_PAIRS * pairWork(window);
  return own + 2 * loop.crossfadeLength + searching;
}

/** The analysis `checked` asks for, reading `heard` and `plain`. */
async function measuredLoop(
  heard: PcmSource,
  plain: PcmSource,
  checked: CheckedAnalysis,
  kit: MeasuringKit,
  tools: LoopTools,
  progress: Progress,
): Promise<LoopAnalysis> {
  const { loop, search, regionLength, sampleRate, window } = checked;
  const advance = (work: number): void => {
    progress.add(work);
  };
  const ownPass = heardCapture(loop, regionLength, sampleRate);
  const capture = await captureLoop(heard, ownPass, tools, advance);
  const place: SeamPlace = { start: loop.start, end: loop.end, regionLength, window };
  const current: LoopMetrics = {
    ...measurePair(capture, kit, place).metrics,
    crossfade: await measuredCrossfade(plain, loop, tools, progress),
  };
  const candidates =
    search === undefined
      ? []
      : await searchCandidates(plain, loop, search, kit, {
          ...tools,
          onFrames: advance,
          onPair: () => {
            advance(pairWork(window));
          },
        });
  const seam = Array.from({ length: capture.channels }, (_, channel) =>
    seamWindows(capture, place, 'adjacent', channel),
  );
  return {
    version: LOOP_ANALYSIS_VERSION,
    sampleRate,
    channels: capture.channels,
    windowFrames: window,
    current,
    verdict: worstVerdict(verdictsOf(current)),
    candidates,
    seam: {
      tail: seam.map(({ tail }) => tail.slice()),
      head: seam.map(({ head }) => head.slice()),
    },
  };
}

/** The analysis of `request`'s loop in a region heard as `heard`, and as `plain` without the loop's crossfade. */
export async function analyseLoop(
  heard: PcmSource,
  plain: PcmSource,
  request: LoopAnalysisRequest,
  tools: LoopTools,
): Promise<DomainResult<LoopAnalysis>> {
  const checked = checkedAnalysis(heard, plain, request);
  if (!checked.ok) return checked;
  const progress = new Progress(workOf(checked.value), tools.onProgress);
  const kit = new MeasuringKit(tools.dsp, checked.value.sampleRate);
  try {
    const analysis = await measuredLoop(heard, plain, checked.value, kit, tools, progress);
    progress.finish();
    return succeed(analysis);
  } catch (error: unknown) {
    // The two ways audio ends an analysis: a refusal from the reading, and
    // the caller's cancellation. Anything else is a fault and leaves as it came.
    if (error instanceof LoopRefused) return fail(error.refusal);
    if (tools.signal.aborted) {
      return fail(
        failure('loop.cancelled', FailureKind.Retryable, 'The loop analysis was cancelled.'),
      );
    }
    throw error;
  } finally {
    kit.release();
  }
}

/** Every verdict of `metrics`. */
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
    metrics.crossfade?.verdict ?? 'not-applicable',
    metrics.cycleStability.seam.verdict,
    metrics.cycleStability.drift.verdict,
  ];
}
