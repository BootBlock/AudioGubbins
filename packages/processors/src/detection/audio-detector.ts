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
}

/**
 * One pass of a detector over audio. Its result is its findings over
 * everything heard, their ranges counting frames from the first frame given.
 */
export type Detection = WholePass<readonly DetectorFinding[]>;

/** A detector: what it is, what it finds, and a pass of it over audio. */
export interface AudioDetector {
  readonly identity: DetectorIdentity;
  readonly finds: readonly FindingKind[];
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
