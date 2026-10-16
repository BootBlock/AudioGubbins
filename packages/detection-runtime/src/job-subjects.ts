/**
 * What the page asks the detection worker about, one subject for each kind of
 * job, and the key an answer is kept under: everything that changes what the
 * job answers, the subject's whole identity among it, the canonical text of
 * its plan and of the media that plan reads, never a short fingerprint two
 * versions could share. Each key names its job's kind, so an answer of one
 * kind is never taken for another's.
 */

import type { DetectorValues, EditRange, QualityMode } from '@audiogubbins/domain';
import type { PcmDescription } from '@audiogubbins/audio-engine';
import type { LoopAnalysisRequest } from '@audiogubbins/loop-analysis';

/** What a detection is asked for. */
export interface DetectionSubject {
  /** What it analyses, an asset or a region, of which one detection runs at a time. */
  readonly target: string;
  /**
   * What the target's audio is made from, written out whole: two subjects of
   * one identity sound alike, so a result kept for one answers the other.
   */
  readonly identity: string;
  readonly channels: number;
  /** Its audio, described when a detection starts; arrays in memory are transferred. */
  readonly describe: () => PcmDescription;
  /**
   * The audio a recommended step learns its state from, where that is not the
   * audio analysed (`detection-run.ts`), with what it is made from, as
   * {@link identity} says for the audio analysed.
   */
  readonly learning?: {
    readonly identity: string;
    readonly channels: number;
    readonly describe: () => PcmDescription;
  };
  /** The quality an edited sound's chains run at: the final render's. */
  readonly quality: QualityMode;
  /** The frames of the target to read. */
  readonly range: EditRange;
  /** The keys of the assistants to run, in the order their reports are answered. */
  readonly assistants: readonly string[];
  /** What a person set of how their detectors judge, which changes what they find. */
  readonly detectors: DetectorValues;
}

/** What a loop analysis is asked for (ADR-0103). */
export interface LoopSubject {
  /** The region whose loop it analyses, of which one loop analysis runs at a time. */
  readonly target: string;
  /**
   * What the region's audio is made from with its loop's crossfade and
   * without it, written out whole, as {@link DetectionSubject.identity} is.
   */
  readonly identity: string;
  readonly channels: number;
  /**
   * The region's audio as its plan realises it with its loop's crossfade
   * (`heard`) and without it (`plain`), described when the analysis starts.
   */
  readonly describe: () => { readonly heard: PcmDescription; readonly plain: PcmDescription };
  /** The quality the region's chains run at: the final render's. */
  readonly quality: QualityMode;
  readonly request: LoopAnalysisRequest;
}

/** What a loudness measurement is asked for. */
export interface LoudnessSubject {
  /** What it measures, an asset or a region, of which one measurement runs at a time. */
  readonly target: string;
  /** What the target's audio is made from, written out whole, as {@link DetectionSubject.identity} is. */
  readonly identity: string;
  readonly channels: number;
  /** Its audio, described when the measurement starts; arrays in memory are transferred. */
  readonly describe: () => PcmDescription;
  /** The quality an edited sound's chains run at: the final render's. */
  readonly quality: QualityMode;
  /** The frames of the target to measure. */
  readonly range: EditRange;
}

/** `values` as text, the same however their keys were ordered. */
function valuesKey(values: DetectorValues): string {
  const sorted = <T>(record: Readonly<Record<string, T>>): [string, T][] =>
    Object.entries(record).toSorted(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0));
  return JSON.stringify(sorted(values).map(([detector, set]) => [detector, sorted(set)]));
}

/** The fields of a key, joined by a character no field holds. */
function keyOf(fields: readonly string[]): string {
  return fields.join('\u0000');
}

/** The key a detection's result is kept under. */
export function detectionKey(subject: DetectionSubject): string {
  return keyOf([
    'detect',
    subject.identity,
    subject.learning?.identity ?? '',
    JSON.stringify(subject.quality.settings),
    String(subject.channels),
    String(subject.range.start),
    String(subject.range.end),
    subject.assistants.join(','),
    valuesKey(subject.detectors),
  ]);
}

/** The key a loop analysis is kept under: the request's every field, in a fixed order. */
export function loopKey(subject: LoopSubject): string {
  const { loop, search } = subject.request;
  return keyOf([
    'analyse-loop',
    subject.identity,
    JSON.stringify(subject.quality.settings),
    String(subject.channels),
    JSON.stringify([loop.start, loop.end, loop.crossfadeLength, loop.crossfadeShape]),
    search === undefined
      ? ''
      : JSON.stringify([search.radiusFrames, search.keepLength, search.candidates]),
  ]);
}

/** The key a loudness measurement is kept under. */
export function loudnessKey(subject: LoudnessSubject): string {
  return keyOf([
    'measure-loudness',
    subject.identity,
    JSON.stringify(subject.quality.settings),
    String(subject.channels),
    String(subject.range.start),
    String(subject.range.end),
  ]);
}
