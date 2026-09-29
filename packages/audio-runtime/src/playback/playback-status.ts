/**
 * What playback is doing, as one value the interface reads.
 *
 * A snapshot rather than a live object: a listener is handed the whole of it
 * each time anything changes, and a view compares two snapshots rather than
 * watching fields. The transitions that are more than setting a field are
 * written here as functions of a snapshot, so the session only says what
 * happened.
 */

import type { NodeId } from '@audiogubbins/audio-graph';
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

/** Which canonical DSP the processor runs, and why the reference path, when it does. */
export interface DspStatus {
  readonly implementation: DspImplementation;
  readonly fallbackReason: string | undefined;
}

/** A meter's last reading, one value per channel. */
export interface MeterLevels {
  readonly peak: readonly number[];
  readonly rms: readonly number[];
}

/** What playback is doing. */
export interface PlaybackStatus {
  readonly phase: PlaybackPhase;
  readonly transport: TransportState;
  /** The loaded graph's DSP, once the processor has said. */
  readonly dsp: DspStatus | undefined;
  /** The loaded graph's latency in context frames, where every node on the way can say it. */
  readonly latencyFrames: number | undefined;
  readonly device: DeviceReport | undefined;
  readonly contextState: LifecycleState;
  /** Whether the device is being kept fed, once a graph has loaded on a context. */
  readonly stability: StabilityAssessment | undefined;
  readonly meters: ReadonlyMap<NodeId, MeterLevels>;
  /** What the person should know is wrong, worded for them. */
  readonly problems: readonly string[];
}

const NO_METERS: ReadonlyMap<NodeId, MeterLevels> = new Map();

/** Playback before anything is loaded. */
export function initialStatus(contextState: LifecycleState): PlaybackStatus {
  return {
    phase: PlaybackPhase.Unloaded,
    transport: TRANSPORT_AT_START,
    dsp: undefined,
    latencyFrames: undefined,
    device: undefined,
    contextState,
    stability: undefined,
    meters: NO_METERS,
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
    dsp: undefined,
    latencyFrames: undefined,
    stability,
    meters: NO_METERS,
    problems: [],
  };
}

/** The processor has the graph and says how it runs it. */
export function readyStatus(
  status: PlaybackStatus,
  dsp: DspStatus,
  latencyFrames: number | undefined,
): PlaybackStatus {
  return { ...status, phase: PlaybackPhase.Ready, dsp, latencyFrames, problems: [] };
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
    dsp: undefined,
    latencyFrames: undefined,
    meters: NO_METERS,
    problems: [problem],
  };
}

/** Something the person should know about that leaves playback as it was. */
export function withProblem(status: PlaybackStatus, problem: string): PlaybackStatus {
  return { ...status, problems: [...status.problems, problem] };
}

/** A meter's new reading. */
export function withMeter(
  status: PlaybackStatus,
  node: NodeId,
  levels: MeterLevels,
): PlaybackStatus {
  const meters = new Map(status.meters);
  meters.set(node, levels);
  return { ...status, meters };
}
