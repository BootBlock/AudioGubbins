/**
 * Workload estimates and chunk plans, without artificial limits (REQ-ARCH-087).
 *
 * AudioGubbins sets no ceiling on how long a recording may be or how many
 * channels it may carry. What the machine can hold is a fact to measure and
 * plan around, never a reason to refuse: work is always processed in chunks,
 * and when holding it whole would need more memory than is available the plan
 * says so, names the resource and the safer strategy, and proceeds.
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

import type { PerformanceSettings } from '../profiles/performance-profile.js';

/** The engine processes planar 32-bit float samples. */
const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

/** A span of audio to be processed. */
export interface WorkloadShape {
  readonly frames: SampleCount;
  readonly channels: number;
  readonly sampleRate: SampleRate;
}

/** What a workload would cost to hold whole, and how long it plays. */
export interface WorkloadEstimate {
  readonly bytesHeldWhole: number;
  readonly audioSeconds: number;
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
  return succeed({
    bytesHeldWhole: shape.frames * channels.value * BYTES_PER_SAMPLE,
    audioSeconds: samplesToSeconds(shape.frames, shape.sampleRate),
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

function describeChunk(frames: number, rate: SampleRate): string {
  return `${String(Math.round((frames / rate) * 1_000))} ms`;
}

/**
 * The frames in one chunk: the profile's chunk length at this rate, at least
 * one frame, no more than the workload has, and no more than fits in the
 * memory available.
 */
function chunkFramesFor(request: ChunkPlanRequest): number {
  const byProfile = Math.floor(
    (request.settings.renderChunkMilliseconds * request.sampleRate) / 1_000,
  );
  const fitting =
    request.availableMemoryBytes === undefined
      ? byProfile
      : Math.floor(request.availableMemoryBytes / (request.channels * BYTES_PER_SAMPLE));
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
 * Splits a workload into chunks. It never refuses a workload for its size:
 * when holding it whole would exceed the memory available, the plan carries a
 * warning and still proceeds in chunks. Unknown memory is assumed neither
 * large nor small, so the plan chunks and warns of nothing it cannot know.
 */
export function planChunks(request: ChunkPlanRequest): DomainResult<ChunkPlan> {
  const estimate = estimateWorkload(request);
  if (!estimate.ok) return estimate;
  const available = validMemory(request.availableMemoryBytes);
  if (!available.ok) return available;

  const chunkFrames = chunkFramesFor(request);
  const chunks = Math.ceil(request.frames / chunkFrames);
  const needed = estimate.value.bytesHeldWhole;
  const warnings =
    available.value !== undefined && needed > available.value
      ? [memoryWarning(request, needed, available.value, chunkFrames, chunks)]
      : [];
  return succeed({ chunkFrames, chunks, warnings });
}
