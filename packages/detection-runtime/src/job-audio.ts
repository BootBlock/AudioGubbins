/**
 * The audio each of the worker's jobs reads, opened from the descriptions its
 * request carries: each through the engine's own described source, with the
 * chains its plan names run by the rack at the request's quality from the
 * stream's start, as the render and the peaks read it, never a second reader
 * (ADR-0061); and through the preview worker's renders where the page has
 * given the port to them. A job opened returns every source it opened, which
 * its caller releases once the job ends; one that cannot be opened releases
 * those it had and says why.
 */

import {
  ProcessedStart,
  describedSource,
  type CanonicalDsp,
  type ChainProcessing,
  type PcmSource,
  type PreviewClient,
} from '@audiogubbins/audio-engine';
import {
  discreteLayout,
  mapResult,
  type DomainResult,
  type QualityMode,
} from '@audiogubbins/domain';

import type {
  AnalyseLoopRequest,
  DescribedAudio,
  DetectRequest,
  MeasureLoudnessRequest,
} from './detection-messages.js';
import type { DetectionAudio } from './detection-run.js';
import type { LoopAudio } from './loop-run.js';

/** What the worker opens a source with. */
export interface SourceOpening {
  readonly dsp: CanonicalDsp;
  /** How the chains an edited source's plan names are run: the effect rack's. */
  readonly processing: ChainProcessing;
  /** The preview worker's renders, once the page has given the port to them. */
  readonly previews: PreviewClient | undefined;
}

/** A job's audio, and every source it was opened as, which are released when it ends. */
export interface Opened<TAudio> {
  readonly audio: TAudio;
  readonly sources: readonly PcmSource[];
}

/** The source of described audio, read as the render reads it, or why it cannot be. */
function sourceOf(
  opening: SourceOpening,
  audio: DescribedAudio,
  quality: QualityMode,
): DomainResult<PcmSource> {
  const layout = discreteLayout(audio.channels);
  if (!layout.ok) return layout;
  return describedSource(audio.description, layout.value, opening.dsp, {
    processing: opening.processing,
    quality: quality.settings,
    start: ProcessedStart.Canonical,
    ...(opening.previews === undefined ? {} : { cached: opening.previews }),
  });
}

/** The sources of two described audios, or why one cannot be read, the other released. */
function pairOf(
  opening: SourceOpening,
  first: DescribedAudio,
  second: DescribedAudio,
  quality: QualityMode,
): DomainResult<readonly [PcmSource, PcmSource]> {
  const one = sourceOf(opening, first, quality);
  if (!one.ok) return one;
  const other = sourceOf(opening, second, quality);
  if (!other.ok) one.value.release();
  return mapResult(other, (source): readonly [PcmSource, PcmSource] => [one.value, source]);
}

/**
 * The audio a detection reads, heard and learned from, one source where they
 * are the same, or why it cannot be read.
 */
export function detectionAudio(
  opening: SourceOpening,
  request: DetectRequest,
): DomainResult<Opened<DetectionAudio>> {
  const heard = { channels: request.channels, description: request.description };
  if (request.learning === undefined) {
    return mapResult(sourceOf(opening, heard, request.quality), (source) => ({
      audio: { heard: source, learning: source },
      sources: [source],
    }));
  }
  return mapResult(
    pairOf(opening, heard, request.learning, request.quality),
    ([source, learning]) => ({ audio: { heard: source, learning }, sources: [source, learning] }),
  );
}

/** The region a loop analysis reads, with its loop's crossfade and without, or why it cannot be read. */
export function loopAudio(
  opening: SourceOpening,
  request: AnalyseLoopRequest,
): DomainResult<Opened<LoopAudio>> {
  const { channels } = request;
  return mapResult(
    pairOf(
      opening,
      { channels, description: request.heard },
      { channels, description: request.plain },
      request.quality,
    ),
    ([heard, plain]) => ({ audio: { heard, plain }, sources: [heard, plain] }),
  );
}

/** The audio a loudness measurement reads, or why it cannot be read. */
export function loudnessAudio(
  opening: SourceOpening,
  request: MeasureLoudnessRequest,
): DomainResult<Opened<PcmSource>> {
  return mapResult(
    sourceOf(
      opening,
      { channels: request.channels, description: request.description },
      request.quality,
    ),
    (source) => ({ audio: source, sources: [source] }),
  );
}
