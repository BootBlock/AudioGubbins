/**
 * What a kind of processor is, independently of any instance of it.
 *
 * The contract the project model, the Inspector and the command layer work
 * against, so adding a processor does not mean editing the project model. A
 * processor type in `packages/processors` states one of these and makes its
 * kernel from the same object (ADR-0061), so it cannot be described by one
 * table and run by another.
 *
 * What depends on an instance's settings, its latency, its lead-in and the
 * layout it makes, is answered for those settings, the rate and the quality
 * it runs at, since a look-ahead in milliseconds, an oversampling filter and
 * an analysis window are all of them frames that only those can count.
 */

import type { ChannelLayout } from '../audio/channel-layout.js';
import type { ParameterId } from '../identity/branded-id.js';
import type { DomainResult } from '../result.js';
import type { SampleRate } from '../time/sample-time.js';
import type { ParameterDescriptor, ParameterValue } from './parameter.js';
import type { ProcessorLatency } from './processor-latency.js';
import type { ProcessorState, ProcessorStateVersion } from './processor-version.js';
import type { QualitySettingKey, QualitySettings } from './quality-mode.js';

/**
 * How a processor's final render is held to its answer (ADR-0061, ADR-0062).
 *
 * - `canonical`: basic IEEE-754 arithmetic in a stated order, the same bits on
 *   every machine, with a reference implementation for every kernel.
 * - `pinned`: inference, run on a fixed backend, thread count, precision and
 *   chunking, and identified by the hashes of its model and runtime.
 */
export const DeterminismClass = { Canonical: 'canonical', Pinned: 'pinned' } as const;

/** How a processor's final render is held to its answer. */
export type DeterminismClass = (typeof DeterminismClass)[keyof typeof DeterminismClass];

/** Where a processor is listed, so a menu groups like with like. */
export const ProcessorCategory = {
  Level: 'level',
  Equalisation: 'equalisation',
  Dynamics: 'dynamics',
  Time: 'time',
  Pitch: 'pitch',
  Space: 'space',
  Restoration: 'restoration',
  Separation: 'separation',
} as const;

/** Where a processor is listed. */
export type ProcessorCategory = (typeof ProcessorCategory)[keyof typeof ProcessorCategory];

/** An instance's parameter values, keyed by parameter identifier. */
export type ParameterValues = ReadonlyMap<ParameterId, ParameterValue>;

/** What a processor's answers about its running depend on. */
export interface ProcessorSettings {
  readonly values: ParameterValues;
  readonly sampleRate: SampleRate;
  readonly quality: QualitySettings;
}

/** Describes a kind of processor. */
export interface ProcessorDescriptor {
  /** Stable machine-readable type key, for example `parametric-equaliser`. */
  readonly typeKey: string;

  /** British-English label for menus and the Inspector. */
  readonly label: string;
  readonly category: ProcessorCategory;

  /**
   * The versions an instance made now is stamped with, and the only ones this
   * build reads (`processor-version.ts`).
   */
  readonly version: ProcessorStateVersion;

  readonly parameters: readonly ParameterDescriptor[];

  /** The quality settings it reads; it ignores the rest. */
  readonly qualitySettings: readonly QualitySettingKey[];

  readonly determinism: DeterminismClass;

  /**
   * Whether it must measure the whole of its input before it can write any
   * output, as a peak or loudness normalisation does. Such a processor never
   * runs as audio is heard: playback hears a cached render of it.
   */
  readonly wholePass: boolean;

  /**
   * Whether its kernel can run on the audio thread's schedule: bounded work
   * per block, no allocation, no waiting. A processor that cannot is heard
   * from a cached render (ADR-0061).
   */
  readonly realTime: boolean;

  /**
   * The non-parameter state it cannot run without, such as a learned noise
   * profile, where it needs one (ADR-0061).
   */
  readonly state?: StateRequirement;

  /**
   * The layout it makes of `input`, or why it does not accept it
   * (REQ-ARCH-157). A processor never downmixes in silence: a layout it does
   * not take is refused with the reason.
   */
  outputLayout(input: ChannelLayout, values: ParameterValues): DomainResult<ChannelLayout>;

  /**
   * Frames of delay it introduces, or that it cannot say, and why
   * (REQ-ARCH-144). Known zero only for a processor that is instantaneous:
   * REQ-EXEC-216 forbids assuming it.
   */
  latency(settings: ProcessorSettings): ProcessorLatency;

  /**
   * Frames of input a stateful kernel needs before its output settles, when a
   * preview starts it part way through a stream (ADR-0060). Zero for a
   * processor with no memory.
   */
  leadIn(settings: ProcessorSettings): number;

  /**
   * Frames its kernel counts its analysis frames or blocks in from its own
   * first frame, as a spectral processor's hop: a run started part way through
   * a stream settles, within its lead-in, to what a run from the stream's start
   * gives only when it starts a whole number of these into the stream, since
   * otherwise it judges other stretches of audio together. A count that only
   * decides when a running sum is remade or a design is taken changes nothing
   * beyond rounding, and is not one. 1 for a processor with none.
   */
  frameGrid(settings: ProcessorSettings): number;
}

/**
 * The state a processor cannot run without. A chain whose instance lacks it,
 * or holds state the check refuses, cannot be planned, so the entry it would
 * make is unavailable with the reason rather than rendered as if the
 * processor were not there; the kernel reads the state by the same check, so
 * the two cannot disagree.
 */
export interface StateRequirement {
  /** The kind of state it reads, as `ProcessorState.kind` names it. */
  readonly kind: string;

  /** What a person is told to do where an instance holds none. */
  readonly missing: string;

  /** Why `state`, of that kind, cannot serve `input` at `sampleRate` with `values`. */
  check(
    state: ProcessorState,
    input: ChannelLayout,
    sampleRate: SampleRate,
    values: ParameterValues,
  ): DomainResult<void>;
}

/** The descriptor of the parameter `key`, where the processor has one. */
export function parameterOf(
  descriptor: Pick<ProcessorDescriptor, 'parameters'>,
  key: string,
): ParameterDescriptor | undefined {
  return descriptor.parameters.find((parameter) => parameter.key === key);
}
