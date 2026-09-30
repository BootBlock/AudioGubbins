/**
 * The messages between the page and the peak worker.
 *
 * Each direction is one discriminated union, and each message is read field by
 * field on arrival (REQ-EXEC-136.12), so a malformed one is refused with the
 * field that was wrong rather than acted on. A job is one source's pyramid,
 * named by the page; the worker keeps the source for as long as the job is
 * open, and answers requests for its samples, its detail buckets and its zero
 * crossings between the chunks it summarises, one at a time, dropping one the
 * page cancels.
 */

import type { PcmDescription } from '@audiogubbins/audio-engine';

import type { PeakChannel, PeakRun } from './peak-pyramid.js';

/** What the page asks of the worker. */
export const ToPeakWorkerKind = {
  /** Open a job: make the source, check a cache, and summarise what the cache did not hold. */
  Open: 'open',
  /** Summarise the chunks around a range first, where a view has moved to. */
  Focus: 'focus',
  /** Send the samples of a range, for a view zoomed past the detail buckets. */
  Samples: 'samples',
  /** Send the detail buckets of a range, for a view zoomed past the pyramid. */
  Buckets: 'buckets',
  /** Find the zero crossing nearest a position. */
  ZeroCrossing: 'zero-crossing',
  /** Abandon a request the page no longer waits on, and send nothing for it. */
  Cancel: 'cancel',
  /** Close a job and release its source. */
  Close: 'close',
} as const;

export type ToPeakWorker =
  | {
      readonly kind: typeof ToPeakWorkerKind.Open;
      readonly job: string;
      readonly identity: string;
      readonly revision: string;
      readonly channels: number;
      readonly description: PcmDescription;
      /** The bytes of a cache the page holds for the source, which the worker checks. */
      readonly cached: Uint8Array<ArrayBuffer> | undefined;
      readonly focus: FrameRange | undefined;
    }
  | {
      readonly kind: typeof ToPeakWorkerKind.Focus;
      readonly job: string;
      readonly range: FrameRange;
    }
  | {
      readonly kind: typeof ToPeakWorkerKind.Samples;
      readonly job: string;
      readonly request: number;
      readonly range: FrameRange;
    }
  | {
      readonly kind: typeof ToPeakWorkerKind.Buckets;
      readonly job: string;
      readonly request: number;
      readonly range: FrameRange;
    }
  | {
      readonly kind: typeof ToPeakWorkerKind.ZeroCrossing;
      readonly job: string;
      readonly request: number;
      readonly position: number;
      readonly within: number;
      readonly channels: readonly number[];
    }
  | {
      readonly kind: typeof ToPeakWorkerKind.Cancel;
      readonly job: string;
      readonly request: number;
    }
  | { readonly kind: typeof ToPeakWorkerKind.Close; readonly job: string };

/** What the worker tells the page. */
export const FromPeakWorkerKind = {
  /** The cache was whole and is the pyramid; its bytes come back to be viewed. */
  Adopted: 'adopted',
  /** Runs of buckets finished since the last. */
  Runs: 'runs',
  /** Every bucket is known; the bytes of the cache to keep. */
  Complete: 'complete',
  Samples: 'samples',
  Buckets: 'buckets',
  ZeroCrossing: 'zero-crossing',
  /** The job cannot go on, and why. */
  Failed: 'failed',
} as const;

export type FromPeakWorker =
  | {
      readonly kind: typeof FromPeakWorkerKind.Adopted;
      readonly job: string;
      readonly bytes: Uint8Array<ArrayBuffer>;
    }
  | {
      readonly kind: typeof FromPeakWorkerKind.Runs;
      readonly job: string;
      readonly runs: readonly PeakRun[];
    }
  | {
      readonly kind: typeof FromPeakWorkerKind.Complete;
      readonly job: string;
      readonly bytes: Uint8Array<ArrayBuffer>;
      /** Why a cache the page sent was not used, where it sent one. */
      readonly refusedCache: string | undefined;
    }
  | {
      readonly kind: typeof FromPeakWorkerKind.Samples;
      readonly job: string;
      readonly request: number;
      readonly start: number;
      readonly channels: readonly Float32Array[];
    }
  | {
      readonly kind: typeof FromPeakWorkerKind.Buckets;
      readonly job: string;
      readonly request: number;
      readonly start: number;
      readonly frames: number;
      readonly bucketFrames: number;
      readonly channels: readonly PeakChannel[];
    }
  | {
      readonly kind: typeof FromPeakWorkerKind.ZeroCrossing;
      readonly job: string;
      readonly request: number;
      readonly position: number | undefined;
    }
  | {
      readonly kind: typeof FromPeakWorkerKind.Failed;
      readonly job: string;
      readonly reason: string;
    };

/** A half-open range of frames, `[start, end)`. */
export interface FrameRange {
  readonly start: number;
  readonly end: number;
}

/** Each distinct buffer behind a message's arrays, to transfer rather than copy. */
export function peakTransferables(message: FromPeakWorker): readonly ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (array: { readonly buffer: ArrayBufferLike }): void => {
    if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
  };
  switch (message.kind) {
    case FromPeakWorkerKind.Adopted:
    case FromPeakWorkerKind.Complete:
      add(message.bytes);
      break;
    case FromPeakWorkerKind.Runs:
      for (const run of message.runs) {
        for (const channel of run.channels)
          [channel.minimum, channel.maximum, channel.rms, channel.clipped].forEach(add);
      }
      break;
    case FromPeakWorkerKind.Samples:
      message.channels.forEach(add);
      break;
    case FromPeakWorkerKind.Buckets:
      for (const channel of message.channels)
        [channel.minimum, channel.maximum, channel.rms, channel.clipped].forEach(add);
      break;
    default:
      break;
  }
  return [...buffers];
}
