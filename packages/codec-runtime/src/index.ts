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
