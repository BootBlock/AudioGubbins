/**
 * What a detector finds in audio, and what an assistant recommends for it
 * (ADR-0061, ADR-0062).
 *
 * A detector measures and never changes the audio: it answers findings, each a
 * kind, the frames and channels it covers, a measure, and the treatment that
 * would deal with it. An assistant gathers the findings of its detectors and
 * recommends one chain, which the person applies or not; none applies
 * processing itself. A treatment names processor types and parameter values
 * rather than instances, so a finding holds no identifier until a person
 * applies it, when the chain is made under new ones (`treatment-chain.ts`). A
 * finding whose frames are better taken out of the timeline than processed, a
 * silence, is treated by removing them, which a person applies as the existing
 * trim and delete edits (`removal-operations.ts`).
 */

import type { EditRange } from '../editing/operations.js';
import type { ParameterValue } from './parameter.js';

/** What a finding is. */
export const FindingKind = {
  Click: 'click',
  Hum: 'hum',
  Noise: 'noise',
  Clipping: 'clipping',
  DcOffset: 'dc-offset',
  Transient: 'transient',
  Silence: 'silence',
} as const;

/** What a finding is. */
export type FindingKind = (typeof FindingKind)[keyof typeof FindingKind];

/** The unit a finding's measure is stated in. */
export const MeasureUnit = {
  /** A level relative to full scale. */
  Dbfs: 'dbfs',
  /** A level above another, such as a hum's above the floor beside it. */
  Decibels: 'decibels',
  Hertz: 'hertz',
  /** A linear amplitude, such as a DC offset's mean. */
  Linear: 'linear',
} as const;

/** The unit a finding's measure is stated in. */
export type MeasureUnit = (typeof MeasureUnit)[keyof typeof MeasureUnit];

/** How large a finding is, in its unit. */
export interface FindingMeasure {
  readonly value: number;
  readonly unit: MeasureUnit;
}

/** One processor of a treatment: a type and the values it is set to, by parameter key. */
export interface TreatmentStep {
  readonly typeKey: string;
  /** Values by parameter key; a parameter not named keeps its default. */
  readonly values: Readonly<Record<string, ParameterValue>>;
  /**
   * The frames of the audio the processor's state is learned from, for a
   * processor that cannot run without state, such as a noise reduction's
   * profile learned from a stretch of the noise alone.
   */
  readonly learnFrom?: EditRange;
}

/**
 * What would deal with a finding: the processors, in order; taking its frames
 * out of the timeline; or why nothing this build has can.
 */
export type Treatment =
  | { readonly kind: 'steps'; readonly steps: readonly TreatmentStep[] }
  | { readonly kind: 'removal' }
  | { readonly kind: 'none'; readonly reason: string };

/** Something a detector found. */
export interface DetectorFinding {
  readonly kind: FindingKind;
  /** The frames it covers, of the audio the detector was given. */
  readonly range: EditRange;
  /** The channels it was found on, by index, in order. */
  readonly channels: readonly number[];
  readonly measure: FindingMeasure;
  readonly treatment: Treatment;
}

/**
 * The values a detection's detectors judge by, as a person set them: by the
 * detector's key, then by its parameter's key, a silence's threshold among
 * them. A detector or a parameter not named takes its default; a value is
 * checked against the detector's own parameter where the request is read,
 * and refused out of range, never moved into it.
 */
export type DetectorValues = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** Which detector, at which version, made a set of findings. */
export interface DetectorIdentity {
  /** Stable machine-readable key, for example `clicks`. */
  readonly key: string;
  /** British-English label for the assistants' views. */
  readonly label: string;
  /** Raised whenever the same audio could give other findings. */
  readonly version: number;
}

/**
 * What an assistant recommends from its detectors' findings: every finding,
 * one chain of the treatments they share, in the order the assistant applies
 * them, or, where none can be treated, an empty chain, and the frames its
 * findings would have taken out of the timeline, in order and apart.
 */
export interface Recommendation {
  readonly assistant: string;
  readonly detectors: readonly DetectorIdentity[];
  readonly findings: readonly DetectorFinding[];
  readonly steps: readonly TreatmentStep[];
  readonly removals: readonly EditRange[];
}
