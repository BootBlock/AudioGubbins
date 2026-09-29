/**
 * The offline renderer: a render job, run chunk by chunk to its sinks.
 *
 * The canonical path (ADR-0032): every frame comes from the canonical DSP
 * port and the executor, so a job renders the same bits on every machine,
 * whether the DSP is the WebAssembly module or the reference path, and
 * whatever the chunk size (REQ-ARCH-049). A render holds one chunk of each
 * source and sink at a time, never a whole file (REQ-PROD-009), can be
 * cancelled between any two chunks, and reports its progress.
 *
 * A sink's audio is aligned to its sources: the latency the graph reports at
 * the sink is trimmed from the start, and the graph runs that many frames past
 * the range, reading the sources' audio beyond it, so the last frames of the
 * range are what a lookahead processor makes of what follows them. A sink whose
 * latency the graph cannot state cannot be aligned, so its render is refused.
 * The graph starts silent at the range's start.
 */

import {
  failure,
  FailureKind,
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import {
  compileGraph,
  type ExecutionPlan,
  type GraphDiagnostic,
  type NodeId,
} from '@audiogubbins/audio-graph';

import { throwIfCancelled } from '../cancellation.js';
import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { createExecutor, type GraphExecutor } from '../execution/graph-executor.js';
import type { NodeImplementations } from '../nodes/node-implementation.js';
import { resampledSource } from '../pcm/resampled-source.js';
import type { PcmSource } from '../pcm/pcm-source.js';
import type {
  RenderConversion,
  RenderJob,
  RenderOptions,
  RenderSink,
  RenderSummary,
} from './render-job.js';
import { SinkCapture } from './sink-capture.js';
import { StagedFeed } from './staged-feed.js';

/** One sink of the plan, with where its audio goes and how much of its start is latency. */
interface BoundSink {
  readonly node: NodeId;
  readonly sink: RenderSink;
  readonly capture: SinkCapture;
  readonly latency: SampleCount;
}

/** The sources as the render reads them, and those it made and must release. */
interface PreparedSources {
  readonly feeds: ReadonlyMap<NodeId, StagedFeed>;
  readonly made: readonly PcmSource[];
  readonly conversions: readonly RenderConversion[];
}

function refusal(code: string, summary: string, details?: Record<string, string>): DomainFailure {
  return failure(code, FailureKind.Rejected, summary, details === undefined ? {} : { details });
}

/** Each sink of the plan bound to the job's target, or every reason one cannot be. */
function bindSinks(plan: ExecutionPlan, job: RenderJob): DomainResult<readonly BoundSink[]> {
  const bound: BoundSink[] = [];
  const problems: DomainFailure[] = [];
  for (const planned of plan.sinks) {
    const sink = job.sinks.get(planned.node);
    if (sink === undefined) {
      problems.push(
        refusal(
          'render.sink-unbound',
          `The graph's sink ${planned.node} has nowhere to write; bind a render sink to it.`,
          { node: planned.node },
        ),
      );
    } else if (planned.latency.kind === 'unknown') {
      problems.push(
        refusal(
          'render.latency-unknown',
          `The latency at sink ${planned.node} is not known, so its audio cannot be aligned; give ${planned.latency.causes.map((cause) => cause.node).join(', ')} a known latency.`,
          { node: planned.node },
        ),
      );
    } else {
      bound.push({
        node: planned.node,
        sink,
        capture: new SinkCapture(job.chunkFrames),
        latency: planned.latency.frames,
      });
    }
  }
  const [first, ...rest] = problems;
  return first === undefined ? succeed(bound) : fail(first, ...rest);
}

/**
 * Refuses a source bound to a node the graph lacks, which would leave the
 * input it was meant for silent without a word.
 */
function unplacedSources(plan: ExecutionPlan, job: RenderJob): readonly DomainFailure[] {
  const nodes = new Set(plan.steps.map((step) => step.node));
  return [...job.sources.keys()]
    .filter((node) => !nodes.has(node))
    .map((node) =>
      refusal(
        'render.source-unplaced',
        `A source is bound to ${node}, which the graph does not have; bind it to one of the graph's inputs.`,
        { node },
      ),
    );
}

/** The job's sources at the render's rate, converted where they are not. */
function prepareSources(job: RenderJob, dsp: CanonicalDsp): DomainResult<PreparedSources> {
  const feeds = new Map<NodeId, StagedFeed>();
  const made: PcmSource[] = [];
  const conversions: RenderConversion[] = [];
  for (const [node, source] of job.sources) {
    let read = source;
    if (source.sampleRate !== job.sampleRate) {
      const converted = resampledSource(
        dsp,
        source,
        job.sampleRate,
        job.quality.resampling,
        job.coefficientBudgetBytes,
      );
      if (!converted.ok) {
        for (const one of made) one.release();
        return converted;
      }
      read = converted.value;
      made.push(read);
      conversions.push({
        node,
        from: source.sampleRate,
        to: job.sampleRate,
        quality: job.quality.resampling,
      });
    }
    feeds.set(node, new StagedFeed(read, job.range.start, job.chunkFrames));
  }
  return succeed({ feeds, made, conversions });
}

/** The latest sink's latency: the frames the graph runs past the range. */
function tailOf(sinks: readonly BoundSink[]): number {
  return sinks.reduce((most, one) => Math.max(most, one.latency), 0);
}

/** Writes the part of the chunk `[ran, ran + frames)` that falls in the sink's aligned range. */
async function deliver(
  bound: BoundSink,
  ran: number,
  frames: number,
  length: number,
  options: RenderOptions,
): Promise<void> {
  const first = Math.max(ran, bound.latency);
  const end = Math.min(ran + frames, bound.latency + length);
  if (end <= first) return;
  await bound.sink.write(bound.capture.view(first - ran, end - first), options.signal);
}

async function run(
  executor: GraphExecutor,
  sources: PreparedSources,
  sinks: readonly BoundSink[],
  job: RenderJob,
  options: RenderOptions,
): Promise<void> {
  const length = job.range.length;
  const total = length + tailOf(sinks);
  for (let ran = 0; ran < total;) {
    throwIfCancelled(options.signal);
    const frames = Math.min(job.chunkFrames, total - ran);
    for (const feed of sources.feeds.values()) await feed.stage(ran, frames, options.signal);
    executor.process(frames);
    for (const bound of sinks) await deliver(bound, ran, frames, length, options);
    ran += frames;
    options.onProgress?.({ framesRendered: ran, framesTotal: total });
    if (options.yieldToHost !== undefined) await options.yieldToHost();
  }
}

/**
 * Renders a job with `dsp` and the node types of `implementations`, or says
 * why it cannot begin. Cancelling `options.signal` rejects with its reason.
 */
export async function renderOffline(
  job: RenderJob,
  dsp: CanonicalDsp,
  implementations: NodeImplementations,
  options: RenderOptions = {},
): Promise<DomainResult<RenderSummary>> {
  if (!Number.isSafeInteger(job.chunkFrames) || job.chunkFrames < 1) {
    return fail(
      refusal('render.chunk-invalid', 'A render runs chunks of at least one whole frame.'),
    );
  }
  const compiled = compileGraph(job.graph, implementations, job.sampleRate);
  if (!compiled.ok) {
    const refused = (diagnostic: GraphDiagnostic): DomainFailure =>
      refusal('render.graph-refused', diagnostic.message, { diagnostic: diagnostic.code });
    const [first, ...rest] = compiled.diagnostics;
    return fail(refused(first), ...rest.map(refused));
  }
  const [unplaced, ...moreUnplaced] = unplacedSources(compiled.plan, job);
  if (unplaced !== undefined) return fail(unplaced, ...moreUnplaced);
  const sinks = bindSinks(compiled.plan, job);
  if (!sinks.ok) return sinks;
  const sources = prepareSources(job, dsp);
  if (!sources.ok) return sources;
  const captures = new Map(sinks.value.map((bound) => [bound.node, bound.capture]));
  const executor = createExecutor(compiled.plan, implementations, {
    sampleRate: job.sampleRate,
    blockFrames: job.chunkFrames,
    dsp,
    feedFor: (node) => sources.value.feeds.get(node),
    sinkFor: (node) => captures.get(node),
    meterFor: (node) => job.meters?.get(node),
  });
  try {
    if (!executor.ok) return executor;
    await run(executor.value, sources.value, sinks.value, job, options);
    return succeed({
      frames: job.range.length,
      latencyTrimmed: new Map(sinks.value.map((bound) => [bound.node, bound.latency])),
      conversions: sources.value.conversions,
    });
  } finally {
    if (executor.ok) executor.value.release();
    for (const made of sources.value.made) made.release();
  }
}
