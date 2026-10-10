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

export {
  type CodecCapability,
  type CodecDescriptor,
  type CodecDirection,
  type CodecId,
  type CodecImplementation,
  type CodecUse,
  type ContainerId,
  type SampleRateSupport,
} from './codec-descriptor.js';

export {
  type BroadcastDescription,
  type CoverArt,
  type CuePoint,
  type ForeignMetadataField,
  type LoopDirection,
  type MetadataLoop,
  type MetadataMap,
  type MetadataPart,
  type MetadataTextKey,
  type SamplerTuning,
} from './metadata-map.js';

export { type SyncAudioBytes } from './sync-audio-bytes.js';

export { type AudioFileWriter, type FinishedAudioFile } from './audio-file-writer.js';
