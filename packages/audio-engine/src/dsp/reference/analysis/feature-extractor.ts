/**
 * What every detector's reference feature extractor does: read planar
 * samples, and write records of a fixed width as they are pulled
 * (`DetectorFeatures` in `detectors/mod.rs`).
 */
export interface FeatureExtractor {
  readonly recordWidth: number;

  /** Appends one chunk of `frames` samples a channel, its shape checked by the port. */
  push(input: readonly Float32Array[], frames: number): void;

  /** Writes the records ready into `into`, as many whole records as it holds, and answers how many. */
  pull(into: Float64Array): number;
}
