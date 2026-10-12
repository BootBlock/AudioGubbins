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
 * The codec worker (`threads/codec-worker.ts`) serves analysis, decoding and
 * encoding requests over the protocol below, with the stream messages of
 * `@audiogubbins/import-export` on the channels its requests carry; a
 * stream's receiver reads them with credit (`CreditedReceiver`).
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
  type AnalysedStream,
  type CodecRequest,
  type ExportEncodeRequest,
  FromCodecWorkerKind,
  type FromCodecWorker,
  type ImportAnalysis,
  type MetadataOutcome,
  type ModuleSource,
  type EncoderModuleName,
  ToCodecWorkerKind,
  type ToCodecWorker,
} from './worker/codec-worker-messages.js';

export { readFromCodecWorker } from './worker/codec-worker-message-reading.js';

export {
  type ExportEncoderServices,
  type OpenExportEncoder,
  type OpenedExportEncoder,
} from './worker/encode-job.js';

export { type EncoderIdentity } from './encoding/encoder-identity.js';

export { type FileHandleLike, type FileSource } from './files/file-source.js';

export { type BlobLike } from './files/sync-file-bytes.js';

export { type MessagePortLike } from './streams/stream-port.js';

export { CreditedReceiver } from './streams/credited-receiver.js';

export { WORK_CANCELLED } from './work-cancelled.js';
