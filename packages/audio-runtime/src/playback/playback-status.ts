/**
 * What playback is doing, as one value the interface reads.
 *
 * A snapshot rather than a live object: a listener is handed the whole of it
 * each time anything changes, and a view compares two snapshots rather than
 * watching fields. The transitions that are more than setting a field are
 * written here as functions of a snapshot, so the session only says what
 * happened.
 *
 * What changes many times a second is not in it: the position and the
 * meters' levels are read where they are shown, once a display frame, so a
 * report from the audio thread does not redraw every reader of the status.
 */

import {
  TRANSPORT_AT_START,
  type DspImplementation,
  type StabilityAssessment,
  type TransportState,
} from '@audiogubbins/audio-engine';

import type { LifecycleState } from '../context/context-lifecycle.js';
import type { DeviceReport } from '../context/device-report.js';

/** Where the loaded graph stands. */
export const PlaybackPhase = {
  /** Nothing loaded, or what was loaded went with its audio context. */
  Unloaded: 'unloaded',
  /** A graph is on its way to the processor. */
  Loading: 'loading',
  /** A graph is loaded and can play. */
  Ready: 'ready',
  /** The last graph cannot play here, for the reasons in `problems`. */
  Refused: 'refused',
  /** Processing stopped, for the reason in `problems`, until a graph is loaded again. */
  Faulted: 'faulted',
} as const;

/** Where the loaded graph stands. */
export type PlaybackPhase = (typeof PlaybackPhase)[keyof typeof PlaybackPhase];

/** Which canonical DSP a thread runs, why the reference path, when it does, and whether it is used. */
export interface DspStatus {
  readonly implementation: DspImplementation;
  readonly fallbackReason: string | undefined;
  /**
   * Whether anything the thread runs calls it: a node of the graph on the
   * audio thread, a source such as a tone in the feeder.
   */
  readonly inUse: boolean;
}

/** A meter's last reading: one value per channel, and one per pair it correlates. */
export interface MeterLevels {
  readonly peak: readonly number[];
  readonly rms: readonly number[];
  /** The phase correlation of each pair the meter names, from -1 to 1, in its order. */
  readonly correlation: readonly number[];
}

/** What playback is doing. */
export interface PlaybackStatus {
  readonly phase: PlaybackPhase;
  readonly transport: TransportState;
  /** The DSP of the audio thread, which runs the graph, once the processor has said. */
  readonly processorDsp: DspStatus | undefined;
  /**
   * The DSP of the feeder worker, which makes the sources, once it has said;
   * none for a graph without a graph input, which the feeder does not feed.
   */
  readonly feederDsp: DspStatus | undefined;
  /** The loaded graph's latency in context frames, where every node on the way can say it. */
  readonly latencyFrames: number | undefined;
  readonly device: DeviceReport | undefined;
  readonly contextState: LifecycleState;
  /** Whether the device is being kept fed, once a graph has loaded on a context. */
  readonly stability: StabilityAssessment | undefined;
  /** What the person should know is wrong, worded for them. */
  readonly problems: readonly string[];
}

/** Playback before anything is loaded. */
export function initialStatus(contextState: LifecycleState): PlaybackStatus {
  return {
    phase: PlaybackPhase.Unloaded,
    transport: TRANSPORT_AT_START,
    processorDsp: undefined,
    feederDsp: undefined,
    latencyFrames: undefined,
    device: undefined,
    contextState,
    stability: undefined,
    problems: [],
  };
}

/** A graph on its way to the processor, which forgets everything the last one reported. */
export function loadingStatus(
  status: PlaybackStatus,
  stability: StabilityAssessment,
): PlaybackStatus {
  return {
    ...status,
    phase: PlaybackPhase.Loading,
    processorDsp: undefined,
    feederDsp: undefined,
    latencyFrames: undefined,
    stability,
    problems: [],
  };
}

/** The processor has the graph and says how it runs it, beside the feeder's DSP. */
export function readyStatus(
  status: PlaybackStatus,
  processorDsp: DspStatus,
  feederDsp: DspStatus | undefined,
  latencyFrames: number | undefined,
): PlaybackStatus {
  return {
    ...status,
    phase: PlaybackPhase.Ready,
    processorDsp,
    feederDsp,
    latencyFrames,
    problems: [],
  };
}

/** The graph cannot play, for `reasons`. */
export function refusedStatus(status: PlaybackStatus, reasons: readonly string[]): PlaybackStatus {
  return { ...status, phase: PlaybackPhase.Refused, problems: reasons };
}

/** Processing stopped, for `problem`, added to what was already wrong. */
export function faultedStatus(status: PlaybackStatus, problem: string): PlaybackStatus {
  return { ...status, phase: PlaybackPhase.Faulted, problems: [...status.problems, problem] };
}

/** The graph went with its context, for `problem`, and nothing it reported still holds. */
export function unloadedStatus(status: PlaybackStatus, problem: string): PlaybackStatus {
  return {
    ...status,
    phase: PlaybackPhase.Unloaded,
    processorDsp: undefined,
    feederDsp: undefined,
    latencyFrames: undefined,
    problems: [problem],
  };
}

/** Something the person should know about that leaves playback as it was. */
export function withProblem(status: PlaybackStatus, problem: string): PlaybackStatus {
  return { ...status, problems: [...status.problems, problem] };
}
