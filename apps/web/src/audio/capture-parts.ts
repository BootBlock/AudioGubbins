/**
 * The part of a capture session the recording part drives (`ADR-0070`), made
 * over the page's context by the engine once its DSP is compiled, and by a
 * test's fake alike: jsdom has no audio context, worklet or media stream.
 */

import type { CaptureSession, ContextLifecycle } from '@audiogubbins/audio-runtime';

/** The part of a capture session the recording part drives. */
export type CapturePort = Pick<
  CaptureSession,
  | 'subscribe'
  | 'open'
  | 'arm'
  | 'disarm'
  | 'record'
  | 'stop'
  | 'monitor'
  | 'monitorThrough'
  | 'meters'
  | 'monitoringLatency'
  | 'close'
  | 'dispose'
>;

/** Makes a capture session in the context `lifecycle` runs. */
export type OpenCapture = (lifecycle: ContextLifecycle) => Promise<CapturePort>;
