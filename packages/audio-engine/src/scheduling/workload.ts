/**
 * Workload estimates and chunk plans, without artificial limits (REQ-ARCH-087).
 *
 * AudioGubbins sets no ceiling on how long a recording may be or how many
 * channels it may carry. What the machine can hold is a fact to measure and
 * plan around, never a reason to refuse: work is always processed in chunks,
 * and when holding it whole would need more memory than is available the plan
 * says so, names the resource and the safer strategy, and proceeds.
 *
 * The processor is planned around the same way. Where this machine has been
 * measured processing audio more slowly than it plays, the plan says the
 * processor is the limiting resource and offers the background, where the work
 * waits behind playback and editing rather than holding them up. That is never
 * a reason to refuse either.
 */

import {
  fail,
  failure,
  FailureKind,
  MAXIMUM_CHANNEL_COUNT,
  samplesToSeconds,
  succeed,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { CoefficientStrategy, type ResamplerCoefficients } from '../dsp/canonical-dsp.js';
import type { PerformanceSettings } from '../profiles/performance-profile.js';

/** The engine processes planar 32-bit float samples. */
const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

/** A span of audio to be processed. */
export interface WorkloadShape {
  readonly frames: SampleCount;
  readonly channels: number;
  readonly sampleRate: SampleRate;
  /** What each conversion of rate in the work reported of its filter's taps. */
  readonly conversions?: readonly ResamplerCoefficients[];
}

/** What a workload would cost to hold whole, and how long it plays. */
export interface WorkloadEstimate {
  readonly bytesHeldWhole: number;
  readonly audioSeconds: number;
  /** Bytes the conversions' coefficient tables hold, beside the audio. */
  readonly coefficientTableBytes: number;
  /** Conversions computing their taps as they go, each tens of times slower than a table. */
  readonly computedConversions: number;
}

/** A resource an operation may exhaust. */
export type LimitingResource = 'memory' | 'storage' | 'compute';

/** A warning that a resource may run short, and what to do instead of stopping. */
export interface ResourceWarning {
  readonly resource: LimitingResource;
  /** How much the operation would need, in the resource's unit (bytes for memory and storage). */
  readonly needed: number;
  readonly available: number;
  /** Names the limiting resource, for the person deciding whether to proceed. */
  readonly explanation: string;
  readonly saferStrategy: string;
}

/** What {@link planChunks} plans. */
export interface ChunkPlanRequest extends WorkloadShape {
  readonly settings: PerformanceSettings;
  /** Bytes the host measured as available; undefined when it could not tell. */
  readonly availableMemoryBytes?: number;
  /**
   * Processing seconds per second of audio, as this machine last measured
   * work of the kind planned; undefined until it has been measured.
   */
  readonly measuredCostRatio?: number;
}

/** How a workload is split, and anything the person should know first. */
export interface ChunkPlan {
  readonly chunkFrames: number;
  readonly chunks: number;
  readonly warnings: readonly ResourceWarning[];
}

function validChannels(channels: number): DomainResult<number> {
  if (Number.isSafeInteger(channels) && channels >= 1 && channels <= MAXIMUM_CHANNEL_COUNT) {
    return succeed(channels);
  }
  return fail(
    failure(
      'workload.channels-invalid',
      FailureKind.Rejected,
      `A workload needs between 1 and ${String(MAXIMUM_CHANNEL_COUNT)} whole channels; ` +
        `${String(channels)} was given.`,
    ),
  );
}

/** What `shape` would cost to hold whole, and how long it plays. */
export function estimateWorkload(shape: WorkloadShape): DomainResult<WorkloadEstimate> {
  const channels = validChannels(shape.channels);
  if (!channels.ok) return channels;
  const conversions = shape.conversions ?? [];
  return succeed({
    bytesHeldWhole: shape.frames * channels.value * BYTES_PER_SAMPLE,
    audioSeconds: samplesToSeconds(shape.frames, shape.sampleRate),
    coefficientTableBytes: conversions.reduce((sum, one) => sum + one.tableBytes, 0),
    computedConversions: conversions.filter((one) => one.strategy === CoefficientStrategy.Computed)
      .length,
  });
}

const BYTE_UNITS: readonly (readonly [number, string])[] = [
  [1e9, 'GB'],
  [1e6, 'MB'],
  [1e3, 'kB'],
];

function describeBytes(bytes: number): string {
  const unit = BYTE_UNITS.find(([size]) => bytes >= size);
  return unit === undefined
    ? `${String(bytes)} bytes`
    : `${(bytes / unit[0]).toFixed(1)} ${unit[1]}`;
}

/** A duration in words, to the tenth of a second under a minute and to the second above. */
function describeSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`;
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const rest = whole % 60;
  return hours > 0
    ? `${String(hours)} h ${String(minutes)} min`
    : `${String(minutes)} min ${String(rest)} s`;
}

function describeChunk(frames: number, rate: SampleRate): string {
  return `${String(Math.round((frames / rate) * 1_000))} ms`;
}

/**
 * The frames in one chunk: the profile's chunk length at this rate, at least
 * one frame, no more than the workload has, and no more than fits in the
 * memory the conversions' tables leave.
 */
function chunkFramesFor(request: ChunkPlanRequest, tableBytes: number): number {
  const byProfile = Math.floor(
    (request.settings.renderChunkMilliseconds * request.sampleRate) / 1_000,
  );
  const fitting =
    request.availableMemoryBytes === undefined
      ? byProfile
      : Math.floor(
          Math.max(0, request.availableMemoryBytes - tableBytes) /
            (request.channels * BYTES_PER_SAMPLE),
        );
  return Math.max(1, Math.min(byProfile, fitting, request.frames));
}

function memoryWarning(
  request: ChunkPlanRequest,
  needed: number,
  available: number,
  chunkFrames: number,
  chunks: number,
): ResourceWarning {
  const chunkBytes = chunkFrames * request.channels * BYTES_PER_SAMPLE;
  return {
    resource: 'memory',
    needed,
    available,
    explanation:
      `Holding all of this audio at once would need ${describeBytes(needed)} of memory, and ` +
      `about ${describeBytes(available)} is available. Memory is the limiting resource.`,
    saferStrategy:
      `Process it in ${String(chunks)} chunks of ${describeChunk(chunkFrames, request.sampleRate)}, ` +
      `holding about ${describeBytes(chunkBytes)} at a time. It takes longer, and it finishes.`,
  };
}

/**
 * The processor is the limiting resource where the measured cost is above
 * one: the work runs more slowly than the audio plays, so it cannot keep pace
 * with real time and holds a processor for longer than the audio lasts.
 */
function computeWarning(audioSeconds: number, costRatio: number): ResourceWarning | undefined {
  if (costRatio <= 1) return undefined;
  const needed = audioSeconds * costRatio;
  return {
    resource: 'compute',
    needed,
    available: audioSeconds,
    explanation:
      `At the speed this machine last processed audio, this takes about ${describeSeconds(needed)} ` +
      `for ${describeSeconds(audioSeconds)} of audio, more slowly than it plays. ` +
      'The processor is the limiting resource.',
    saferStrategy:
      'Run it in the background, so playback and editing keep the processor first while it runs. ' +
      'It may take longer, and it finishes.',
  };
}

function validCostRatio(ratio: number | undefined): DomainResult<number | undefined> {
  if (ratio === undefined || (Number.isFinite(ratio) && ratio >= 0)) return succeed(ratio);
  return fail(
    failure(
      'workload.cost-ratio-invalid',
      FailureKind.Rejected,
      `A measured cost ratio must be a finite number of at least zero; ${String(ratio)} was given.`,
    ),
  );
}

function validMemory(available: number | undefined): DomainResult<number | undefined> {
  if (available === undefined || (Number.isFinite(available) && available >= 0)) {
    return succeed(available);
  }
  return fail(
    failure(
      'workload.available-memory-invalid',
      FailureKind.Rejected,
      `Available memory must be a finite number of bytes, at least zero; ${String(available)} was given.`,
    ),
  );
}

/**
 * The bytes a render's conversions of rate may give their tables of
 * coefficients together: the memory the host measured, less the chunk the plan
 * holds at once, or `undefined` where the host could not measure, which leaves
 * every table to be built. A conversion whose table does not fit computes its
 * taps as it goes, slower and with the same bits (REQ-ARCH-087).
 */
export function conversionTableBudget(
  shape: { readonly channels: number; readonly availableMemoryBytes: number | undefined },
  plan: ChunkPlan,
): number | undefined {
  if (shape.availableMemoryBytes === undefined) return undefined;
  const chunkBytes = plan.chunkFrames * shape.channels * BYTES_PER_SAMPLE;
  return Math.max(0, shape.availableMemoryBytes - chunkBytes);
}

/**
 * Splits a workload into chunks. It never refuses a workload for its size:
 * when holding it whole would exceed the memory available, the plan carries a
 * warning and still proceeds in chunks, and when the processor was measured
 * slower than real time it carries a warning of that. Unknown memory and an
 * unmeasured processor are assumed neither large nor small, so the plan warns
 * of nothing it cannot know.
 */
export function planChunks(request: ChunkPlanRequest): DomainResult<ChunkPlan> {
  const estimate = estimateWorkload(request);
  if (!estimate.ok) return estimate;
  const available = validMemory(request.availableMemoryBytes);
  if (!available.ok) return available;
  const cost = validCostRatio(request.measuredCostRatio);
  if (!cost.ok) return cost;

  // The tables are held for the whole render, however it is chunked, so they
  // count in what holding it whole needs and come out of what a chunk may use.
  const tableBytes = estimate.value.coefficientTableBytes;
  const chunkFrames = chunkFramesFor(request, tableBytes);
  const chunks = Math.ceil(request.frames / chunkFrames);
  const needed = estimate.value.bytesHeldWhole + tableBytes;
  const warnings = [
    available.value !== undefined && needed > available.value
      ? memoryWarning(request, needed, available.value, chunkFrames, chunks)
      : undefined,
    cost.value === undefined ? undefined : computeWarning(estimate.value.audioSeconds, cost.value),
  ].filter((warning) => warning !== undefined);
  return succeed({ chunkFrames, chunks, warnings });
}
