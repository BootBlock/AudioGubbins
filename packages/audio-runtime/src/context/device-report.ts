/**
 * What the output device reports once a context plays to it.
 *
 * Nothing about the device can be known before a context exists, so the
 * capabilities leave its rate, latency and channels to the runtime, which
 * reads them here and reads them again when the device changes. The latency
 * is what puts the playhead where the listener hears it rather than where the
 * engine has rendered to (REQ-ARCH-144).
 */

import type { AudioContextPort } from './audio-context-port.js';

/** The device as a context sees it. */
export interface DeviceReport {
  /** Frames per second the context runs at. */
  readonly sampleRate: number;
  /** Seconds the context adds between the processor and the device. */
  readonly baseLatencySeconds: number;
  /** Seconds the device adds after the context, or `undefined` where the browser does not say. */
  readonly outputLatencySeconds: number | undefined;
  /** The most channels the device takes. */
  readonly maxChannelCount: number;
  /** The channels the context sends it. */
  readonly channelCount: number;
}

/** What a context reports of its device now. */
export function deviceReport(context: AudioContextPort): DeviceReport {
  return {
    sampleRate: context.sampleRate,
    baseLatencySeconds: context.baseLatency,
    outputLatencySeconds: context.outputLatency,
    maxChannelCount: context.destination.maxChannelCount,
    channelCount: context.destination.channelCount,
  };
}

/** Whether two reports describe the same device in the same configuration. */
export function sameDeviceReport(first: DeviceReport, second: DeviceReport): boolean {
  return (
    first.sampleRate === second.sampleRate &&
    first.baseLatencySeconds === second.baseLatencySeconds &&
    first.outputLatencySeconds === second.outputLatencySeconds &&
    first.maxChannelCount === second.maxChannelCount &&
    first.channelCount === second.channelCount
  );
}

/**
 * The frames between the engine's output and the listener, at the context's
 * rate, for the media clock's `audibleFrame`.
 *
 * Rounded to the nearest frame: a browser measures latency in whole frames and
 * divides by the rate to report seconds, so multiplying back lands a hair
 * either side of the count it measured, and only the nearest whole frame
 * recovers it. Rounding down would drop a frame whenever the float lands just
 * below.
 *
 * Where the browser gives no output latency, the context's own is all that is
 * known, and the playhead shows early by the device's share.
 */
export function outputLatencyFrames(report: DeviceReport): number {
  const seconds = report.baseLatencySeconds + (report.outputLatencySeconds ?? 0);
  return Math.round(seconds * report.sampleRate);
}
