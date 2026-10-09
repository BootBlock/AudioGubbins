/**
 * The public contract of the AudioGubbins codecs: the read contract for audio
 * files (ADR-0050, ADR-0052).
 *
 * A file is reached through `AudioBytes`, a size and a ranged, cancellable
 * read. `recogniseAudio` names its format from its contents alone, and
 * `openAudio` parses its header into an `AudioFormatDescriptor` and reads its
 * frames on demand at the rate it was recorded at, never holding the file whole
 * (REQ-AUDIO-220). Phase 09's decoders and writers extend this contract rather
 * than adding a second one, beginning from the one writer Phase 07's recorded
 * media needs: the 32-bit float WAV header, RF64 past four gibibytes, of a
 * recording whose length is known (ADR-0071).
 *
 * Portable: no browser or Node global, so the same readers serve the storage
 * worker, the feeder, render and peak workers, and a test. Depends on the
 * domain alone.
 */

export { type AudioBytes } from './audio-bytes.js';

export { type ReadableContainer } from './recognised-format.js';

export { type AudioFormatDescriptor, type SampleEncoding } from './format-descriptor.js';

export { type AudioReader, openAudio } from './audio-reader.js';

export {
  type RecordedWavFormat,
  type RecordedWavHeader,
  recordedWavHeader,
  recordedWavLength,
} from './recorded-wav.js';
