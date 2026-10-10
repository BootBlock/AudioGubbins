/**
 * The one factory the codec worker's `encode` handler calls (ADR-0091,
 * ADR-0092): an export's planned file, opened as a writer of the streaming
 * write contract that takes the rendered blocks, in the rendered layout's
 * order, and answers the file's bytes.
 *
 * The file's target is derived from the request's format and encoding as the
 * plan derived it. Its layout is refused here as validation refused it, should
 * a request reach the worker unvalidated (`writtenChannelOrder`). An integer
 * target is dithered and quantised by one `Quantiser` for the file, seeded by
 * the planned file's dither key, before the writer takes a block. Each format
 * is a row of the table below, which loads only what its format needs: the
 * codec module for FLAC and Opus, LAME for MP3, libvorbis for Vorbis, and the
 * browser's encoder for AAC.
 */

import {
  writtenChannelOrder,
  type AudioFileWriter,
  type WrittenChannelOrder,
} from '@audiogubbins/codecs';
import {
  flatMapResult,
  mapResult,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  Quantiser,
  exportTarget,
  type ExportFormat,
  type FormatEncodingOf,
  type FormatEncodings,
} from '@audiogubbins/import-export';

import { openAacWriter } from './aac-file-encoder.js';
import type {
  ExportEncoderRequest,
  ExportEncoderServices,
  PrebuiltEncoderName,
} from './export-encoder-request.js';
import { openFlacWriter } from './flac-file-encoder.js';
import { openMp3Writer } from './mp3-file-encoder.js';
import { openOpusWriter } from './opus-file-encoder.js';
import { openAiffWriter, openWavWriter } from './pcm-file-encoder.js';
import { PrebuiltModule } from './prebuilt-encoder.js';
import { quantisingWriter } from './quantising-writer.js';
import { openVorbisWriter } from './vorbis-file-encoder.js';

/** What a format's row is given beside its encoding. */
interface OpenContext {
  readonly request: ExportEncoderRequest;
  readonly services: ExportEncoderServices;
  readonly order: WrittenChannelOrder;
  readonly signal: CancellationSignal | undefined;
}

/** How one format's writer is opened. */
type Opener<F extends ExportFormat> = (
  encoding: FormatEncodings[F],
  context: OpenContext,
) => Promise<DomainResult<AudioFileWriter>>;

/** A prebuilt encoder's module, loaded from its file and instantiated for this export. */
async function prebuilt(
  name: PrebuiltEncoderName,
  { services, signal }: OpenContext,
): Promise<DomainResult<PrebuiltModule>> {
  const code = await services.prebuiltEncoder(name, signal);
  return code.ok ? await PrebuiltModule.instantiate(name, code.value) : code;
}

const OPENERS: { readonly [F in ExportFormat]: Opener<F> } = {
  wav: (encoding, { request }) => Promise.resolve(openWavWriter(request, encoding)),
  aiff: (encoding, { request }) => Promise.resolve(openAiffWriter(request, 'aiff', encoding)),
  aifc: (encoding, { request }) => Promise.resolve(openAiffWriter(request, 'aifc', encoding)),
  flac: async (encoding, context) =>
    flatMapResult(await context.services.codecModule(context.signal), (module) =>
      openFlacWriter(context.request, encoding, module, context.order),
    ),
  opus: async (encoding, context) =>
    flatMapResult(await context.services.codecModule(context.signal), (module) =>
      openOpusWriter(context.request, encoding, module, context.order),
    ),
  mp3: async (encoding, context) =>
    flatMapResult(await prebuilt('lame', context), (lame) =>
      openMp3Writer(context.request, encoding, lame, context.order),
    ),
  'ogg-vorbis': async (encoding, context) =>
    flatMapResult(await prebuilt('libvorbis', context), (libvorbis) =>
      openVorbisWriter(context.request, encoding, libvorbis, context.order),
    ),
  aac: (encoding, context) =>
    Promise.resolve(
      openAacWriter(context.request, encoding, context.services.webCodecs, context.order),
    ),
};

function openFormat<F extends ExportFormat>(
  encoding: FormatEncodingOf<F>,
  context: OpenContext,
): Promise<DomainResult<AudioFileWriter>> {
  const opener: Opener<F> = OPENERS[encoding.format];
  return opener(encoding.encoding, context);
}

/**
 * The writer of `request`'s file, its blocks the rendered layout's channels in
 * order, or why the file cannot be written.
 */
export async function openExportEncoder(
  request: ExportEncoderRequest,
  services: ExportEncoderServices,
  signal?: CancellationSignal,
): Promise<DomainResult<AudioFileWriter>> {
  const target = exportTarget(request.encoding);
  const order = writtenChannelOrder(target.codec, target.container, request.layout);
  if (!order.ok) return order;
  const opened = await openFormat(request.encoding, {
    request,
    services,
    order: order.value,
    signal,
  });
  const { depth } = target;
  if (depth === undefined) return opened;
  const channels = request.layout.roles.length;
  return mapResult(opened, (writer) =>
    quantisingWriter(
      writer,
      new Quantiser({ bits: depth, dither: request.dither, key: request.ditherKey, channels }),
      channels,
    ),
  );
}
