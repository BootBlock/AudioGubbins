/**
 * The analysis contract every detector implements (ADR-0061, ADR-0062): the
 * canonical ones on `crates/analysis`'s feature extractors here, and a model
 * pack's once one is licensed for redistribution, which joins or replaces one
 * without change. A detector hears audio and answers findings; it never
 * changes the audio.
 */

import type {
  ChannelLayout,
  DetectorFinding,
  DetectorIdentity,
  DomainResult,
  FindingKind,
  NumericParameterDescriptor,
  SampleRate,
  TreatmentStep,
} from '@audiogubbins/domain';
import type { CanonicalDsp } from '@audiogubbins/audio-engine';

import type { WholePass } from '../framework/whole-pass.js';

/** What a detection is made for. */
export interface DetectionSettings {
  readonly input: ChannelLayout;
  readonly sampleRate: SampleRate;
  readonly dsp: CanonicalDsp;
  /**
   * The value of each of the detector's parameters, by key, every one
   * present and in its range (`detector-values.ts`).
   */
  readonly values: ReadonlyMap<string, number>;
}

/**
 * One pass of a detector over audio. Its result is its findings over
 * everything heard, their ranges counting frames from the first frame given.
 */
export type Detection = WholePass<readonly DetectorFinding[]>;

/** A detector: what it is, what it finds, what a person may set, and a pass of it over audio. */
export interface AudioDetector {
  readonly identity: DetectorIdentity;
  readonly finds: readonly FindingKind[];
  /** What a person may set of how it judges, each with its range and default. */
  readonly parameters: readonly NumericParameterDescriptor[];
  /**
   * Why `values`, every parameter's and each in its range, cannot be judged
   * by together, or `undefined` where they can: the one rule every reader of
   * the values asks (`settledValues`).
   */
  refusal(values: ReadonlyMap<string, number>): string | undefined;
  /** A pass over audio of `settings`, or why this detector cannot hear it. */
  open(settings: DetectionSettings): DomainResult<Detection>;
}

/** An assistant: the detectors it runs, and the chain it recommends from what they found. */
export interface Assistant {
  /** Stable machine-readable key, for example `restoration`. */
  readonly key: string;
  /** British-English label for its view. */
  readonly label: string;
  readonly detectors: readonly AudioDetector[];
  /**
   * The chain it recommends for `findings`, its detectors' findings: each
   * treatment once, in the order it applies them, and nothing where no
   * finding can be treated. It applies nothing itself.
   */
  recommend(findings: readonly DetectorFinding[]): readonly TreatmentStep[];
}
