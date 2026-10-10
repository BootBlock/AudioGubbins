/**
 * The public contract of the AudioGubbins codecs: the read contract for audio
 * files (ADR-0050, ADR-0052), the codec registry and the writers (ADR-0090 to
 * ADR-0093).
 *
 * A file is reached through `AudioBytes`, a size and a ranged, cancellable
 * read. `recogniseAudio` names its format from its contents alone, and
 * `openAudio` parses its header into an `AudioFormatDescriptor` and reads its
 * frames on demand at the rate it was recorded at, never holding the file whole
 * (REQ-AUDIO-220). Phase 09's decoders and writers extend this contract rather
 * than adding a second one: G.711 and ADPCM are read in place, every other
 * compressed format is routed by the registry to a decoded rendition, and the
 * WAV, AIFF and AIFF-C writers serve the streaming write contract, the WAV
 * writer built on Phase 07's recorded-media header (ADR-0071). The Ogg, FLAC,
 * M4A and MP3 framers wrap an encoder's packets in their containers, and every
 * container's metadata is read through `METADATA_READERS`.
 *
 * Portable: no browser or Node global, so the same readers serve the storage
 * worker, the feeder, render and peak workers, and a test. Depends on the
 * domain alone.
 */

export { type AudioBytes } from './audio-bytes.js';

export {
  type ReadableContainer,
  type RecognisedFormat,
  type StatedCodec,
} from './recognised-format.js';

export { recogniseAudio } from './recognition.js';

export { type AudioFormatDescriptor, layoutRead } from './format-descriptor.js';

export { speakerMaskLayout } from './channel-layouts.js';

export {
  type ByteOrder,
  type FloatSampleEncoding,
  type G711SampleEncoding,
  type ImaAdpcmEncoding,
  type IntegerSampleEncoding,
  type MsAdpcmEncoding,
  type SampleEncoding,
} from './sample-encoding.js';

export { type AudioReader, openAudio } from './audio-reader.js';

export {
  type RecordedWavFormat,
  type RecordedWavHeader,
  recordedWavHeader,
  recordedWavLength,
} from './recorded-wav.js';

export {
  type CodecCapability,
  type CodecCodes,
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

export { metadataMapOf, metadataPartOf } from './metadata-map-reading.js';

export { type SyncAudioBytes } from './sync-audio-bytes.js';

export { type AudioFileWriter, type FinishedAudioFile } from './audio-file-writer.js';

export { quantiseSample } from './sample-quantisation.js';

export { CODEC_REGISTRY, codecDescriptor } from './codec-registry.js';

export { type CodecEnvironment, type ModuleLoad, codecCapability } from './codec-capability.js';

export { type ImportRoute, importRoute } from './import-route.js';

export { adtsAudioConfig } from './adts-config.js';

export { type MetadataReader } from './metadata-reading.js';

export { METADATA_READERS } from './metadata-readers.js';

export {
  type OpenedFileWriter,
  type WavSampleFormat,
  type WavWriterSettings,
  createWavWriter,
} from './wav-file-writer.js';

export {
  type AiffSampleFormat,
  type AiffWriterSettings,
  createAiffWriter,
} from './aiff-file-writer.js';

export {
  type EncodedStreamLength,
  type EncodedStreamWriter,
  type FinishedEncodedStream,
} from './encoded-stream-writer.js';

export { OggOpusWriter, type OggOpusSettings } from './ogg-opus-writer.js';

export { type OpusChannelMapping, type OpusHeadSettings } from './opus-header.js';

export { OggVorbisCommentRewriter } from './ogg-vorbis-comment-rewriter.js';

export { type FlacStreamFormat } from './flac-frame-header.js';

export { type FlacMetadataSettings } from './flac-metadata-blocks.js';

export { FlacSampleDigest } from './flac-sample-digest.js';

export {
  FlacStreamWriter,
  type FlacStreamEnd,
  type FlacStreamSettings,
} from './flac-stream-writer.js';

export { Mp4AacWriter, type Mp4AacSettings } from './mp4-aac-writer.js';

export { Mp3StreamWriter, type Mp3StreamSettings } from './mp3-stream-writer.js';
