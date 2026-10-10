/**
 * What the codec worker's `encode` handler opens an export's encoder with
 * (ADR-0091, ADR-0092): the request, a plain value the page plans and the
 * worker is sent, and the services, what the worker has loaded or can reach.
 *
 * The request says everything the file's bytes depend on, so the same request
 * and the same rendered blocks give the same file wherever the encoder is
 * local. The services are injected, so the encoders run in a Node test with
 * the module, the prebuilt encoders and a fake of the browser's encoder.
 */

import type {
  ChannelLayout,
  CancellationSignal,
  DomainResult,
  SampleRate,
} from '@audiogubbins/domain';
import type { MetadataMap } from '@audiogubbins/codecs';
import type { DitherSettings, FormatEncoding } from '@audiogubbins/import-export';

import type { CodecModule } from '../codec-module.js';
import type { WebCodecsAudioEncoding } from './webcodecs-port.js';

/**
 * One planned file's encoding: what `planExport` planned it from and what the
 * render makes of it.
 */
export interface ExportEncoderRequest {
  /**
   * The format and its encoding, as the export's settings state them; the
   * file's target (`exportTarget`) is derived from it, so the two can never
   * disagree.
   */
  readonly encoding: FormatEncoding;

  /** The rate the blocks are rendered at, the settings' rate, which the file states. */
  readonly sampleRate: SampleRate;

  /**
   * The rate of the audio the export was rendered from, which an Opus header
   * states for a player that wants it back.
   */
  readonly sourceRate: SampleRate;

  /**
   * The layout of the rendered blocks, the channel conversion's output, in
   * their order. The file writes it in its own order (`writtenChannelOrder`).
   */
  readonly layout: ChannelLayout;

  /** The file's metadata, by its policy and at its rate (`exportMetadata`). */
  readonly metadata: MetadataMap;

  /** The dither added before an integer encoder, from the settings. */
  readonly dither: DitherSettings;

  /** The planned file's dither key (`PlannedFile.ditherKey`). */
  readonly ditherKey: number;
}

/** The two prebuilt encoders, each a WebAssembly module of its own file (ADR-0091). */
export type PrebuiltEncoderName = 'lame' | 'libvorbis';

/** A WebAssembly module, compiled or as its bytes. */
export type WebAssemblyCode = WebAssembly.Module | BufferSource;

/** What the codec worker gives an export's encoder. */
export interface ExportEncoderServices {
  /**
   * The codec module, loaded when a FLAC or Opus export first asks for it
   * and kept by the worker, so a WAV export never loads it.
   */
  readonly codecModule: (signal?: CancellationSignal) => Promise<DomainResult<CodecModule>>;

  /**
   * A prebuilt encoder's module, fetched from its own file only when its
   * format is exported. The worker may cache the compiled module; each
   * export instantiates its own.
   */
  readonly prebuiltEncoder: (
    name: PrebuiltEncoderName,
    signal?: CancellationSignal,
  ) => Promise<DomainResult<WebAssemblyCode>>;

  /** The browser's WebCodecs audio encoding, where the worker probed it; AAC needs it. */
  readonly webCodecs: WebCodecsAudioEncoding | undefined;
}
