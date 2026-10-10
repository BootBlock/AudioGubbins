/**
 * The codec runtime: the host of the codec module (ADR-0090, ADR-0091).
 *
 * `instantiateCodecModule` instantiates the module from its own file and
 * refuses one of another ABI version, naming both. Through it, a file read
 * synchronously (`SyncAudioBytes`) is opened as a decode session that
 * describes its default audio track and decodes it in order into planar
 * samples at its own rate, never resampled; FLAC frames are encoded for the
 * application's FLAC writer, and Opus packets with what its Ogg writer needs.
 * Every failure is a `DomainResult` with a stable `codec-runtime.*` code, and
 * every object is released once, by its `release()`.
 *
 * `openExportEncoder` opens a planned export file as a writer of the
 * streaming write contract: WAV, AIFF and AIFF-C by the codecs' writers,
 * FLAC and Opus by the module, MP3 and Vorbis by the prebuilt LAME and
 * libvorbis modules, each loaded from its own file, and AAC by the browser's
 * WebCodecs encoder, each quantised through the export's dither where its
 * samples are integers. `encodeRenderedBlocks` feeds such a writer the blocks
 * the render worker sends over a rendered-block channel, granting credit as
 * they are written.
 */

export { type CodecModule, instantiateCodecModule } from './codec-module.js';

export { type DecoderSession, type EncodedPacket } from './decoder-session.js';

export { type StatedLayout, type StreamDescription } from './stream-description.js';

export { type FlacFrameEncoder, type FlacFrameSettings } from './flac-frame-encoder.js';

export {
  type OpusApplication,
  type OpusEncoder,
  type OpusEncoderSettings,
  type OpusFrameDuration,
  type OpusPacket,
  type OpusRateControl,
} from './opus-encoder.js';

export { MAX_OPUS_PACKET_FRAMES, type OpusPacketDecoder } from './opus-packet-decoder.js';

export {
  type ExportEncoderRequest,
  type ExportEncoderServices,
  type PrebuiltEncoderName,
  type WebAssemblyCode,
} from './encoding/export-encoder-request.js';

export {
  type AudioDataLike,
  type AudioEncoderInitLike,
  type AudioEncoderLike,
  type EncodedAudioChunkLike,
  type EncodedAudioChunkMetadataLike,
  type WebCodecsAudioEncoding,
} from './encoding/webcodecs-port.js';

export { openExportEncoder } from './encoding/open-export-encoder.js';

export { type EncodedRender, encodeRenderedBlocks } from './encoding/rendered-block-intake.js';
