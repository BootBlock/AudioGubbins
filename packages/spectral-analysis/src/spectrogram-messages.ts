/**
 * The messages between the page and the spectrogram worker (ADR-0080).
 *
 * Each direction is one discriminated union, and each message is read field by
 * field on arrival (REQ-EXEC-136.12), so a malformed one is refused with the
 * field that was wrong rather than acted on. The page gives the worker the DSP
 * delivery a render worker takes, once, before it opens a job, and a port to
 * the preview worker, which a racked sound is read through (ADR-0061). A job
 * is one revision of one sound, named by the page; the worker keeps its source
 * while the job is open and makes the tiles the page wants, nearest the job's
 * focus first, one place at a time, dropping a want the page cancels.
 */

import type {
  DspDelivery,
  DspImplementation,
  MessagePortLike,
  PcmDescription,
} from '@audiogubbins/audio-engine';
import type { QualityMode } from '@audiogubbins/domain';

import type { SpectrogramConfig } from './spectrogram-config.js';

/** What the page asks of the worker. */
export const ToSpectrogramWorkerKind = {
  /** Run the DSP module delivered, or the reference path for the reason given. */
  Dsp: 'dsp',
  /** Read processed streams from the preview worker's renders, through the port given. */
  Previews: 'previews',
  /** Open a job: make the sound's source. */
  Open: 'open',
  /** Make a job's tiles nearest this frame first, where a view has moved to. */
  Focus: 'focus',
  /** Make a tile, or check and give back the cached bytes of one. */
  Want: 'want',
  /** Abandon a want no view shows any longer, and send nothing for it. */
  Cancel: 'cancel',
  /** Close a job and release its source. */
  Close: 'close',
} as const;

/**
 * The compiled DSP module as a dedicated worker is posted it. The package is
 * compiled without a host's definitions, so it is an object here, checked to
 * be a compiled WebAssembly module when read, and instantiated by the
 * worker's own module.
 */
export type CompiledModule = object;

export type ToSpectrogramWorker =
  | {
      readonly kind: typeof ToSpectrogramWorkerKind.Dsp;
      readonly delivery: DspDelivery<CompiledModule>;
    }
  | {
      readonly kind: typeof ToSpectrogramWorkerKind.Previews;
      /** The worker's end of its channel to the preview worker, transferred. */
      readonly port: MessagePortLike;
    }
  | {
      readonly kind: typeof ToSpectrogramWorkerKind.Open;
      readonly job: string;
      readonly identity: string;
      readonly revision: string;
      readonly channels: number;
      readonly description: PcmDescription;
      /** The quality an edited sound's chains run at: the final render's. */
      readonly quality: QualityMode;
    }
  | {
      readonly kind: typeof ToSpectrogramWorkerKind.Focus;
      readonly job: string;
      readonly centre: number;
    }
  | {
      readonly kind: typeof ToSpectrogramWorkerKind.Want;
      readonly job: string;
      readonly request: number;
      readonly config: SpectrogramConfig;
      readonly channel: number;
      readonly level: number;
      readonly index: number;
      /** The bytes the cache held for the tile, which the worker checks. */
      readonly cached: Uint8Array<ArrayBuffer> | undefined;
    }
  | {
      readonly kind: typeof ToSpectrogramWorkerKind.Cancel;
      readonly job: string;
      readonly request: number;
    }
  | { readonly kind: typeof ToSpectrogramWorkerKind.Close; readonly job: string };

/** What the worker tells the page. */
export const FromSpectrogramWorkerKind = {
  /** Which DSP the worker runs, and why the reference path where it does. */
  Dsp: 'dsp',
  /** A tile wanted: the cached bytes checked and given back, or bytes just made. */
  Tile: 'tile',
  /** The job cannot go on, and why. */
  Failed: 'failed',
} as const;

export type FromSpectrogramWorker =
  | {
      readonly kind: typeof FromSpectrogramWorkerKind.Dsp;
      readonly implementation: DspImplementation;
      readonly fallbackReason: string | undefined;
    }
  | {
      readonly kind: typeof FromSpectrogramWorkerKind.Tile;
      readonly job: string;
      readonly request: number;
      /** The tile in the cache's format. */
      readonly bytes: Uint8Array<ArrayBuffer>;
      /** Whether they are the cached bytes, which need not be kept again. */
      readonly adopted: boolean;
      /** Why the cached bytes were not used, where the page sent some. */
      readonly refusedCache: string | undefined;
    }
  | {
      readonly kind: typeof FromSpectrogramWorkerKind.Failed;
      readonly job: string;
      readonly reason: string;
    };
