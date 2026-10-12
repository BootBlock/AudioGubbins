/**
 * The WAV writer of exports (ADR-0091, ADR-0093): integer PCM of every depth
 * from 8 to 32 bits, each sample left-justified in the next whole byte, 32-
 * and 64-bit float, A-law, µ-law, IMA ADPCM and Microsoft ADPCM, in RIFF,
 * RF64 past four gibibytes, or BW64, with the file's metadata and its channel
 * layout, over the streaming write contract.
 *
 * The form is the plain one wherever it says all there is to say: up to two
 * channels in their default layout, of integer PCM that is 8 or 16 bits and so
 * fills its container, as Microsoft's rule for WAVE_FORMAT_EXTENSIBLE has it;
 * otherwise the extensible form, which states a depth deeper than 16 bits or
 * short of its container in its valid bits, with the speaker mask of
 * `wave-layout-writing.ts`. ADPCM has no
 * extensible form, so a layout its plain form does not state is stated in
 * `iXML` alone. Every code but integer PCM carries a `fact` chunk. The head,
 * with RF64 or RIFF decided from the whole length, is written once the stream
 * has ended (`wave-head.ts`).
 */

import {
  fail,
  succeed,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';

import { adpcmBlockAlign, imaEncodingFor, msEncodingFor } from './adpcm-encoding.js';
import type { AudioFileWriter } from './audio-file-writer.js';
import { unwritableFile, writeInvalid } from './codec-failures.js';
import { encoderOf } from './frame-encoding.js';
import { PCM_INTEGER_DEPTHS, containerBytes, holdsDepth } from './integer-depths.js';
import { ixmlLayoutChunk } from './ixml-layout.js';
import type { MetadataMap } from './metadata-map.js';
import { riffMetadataChunks } from './riff-metadata-writing.js';
import type { SampleEncoding } from './sample-encoding.js';
import { streamingWriter } from './streaming-writer.js';
import { waveFormatChunk, type WaveFormatForm } from './wave-format-writing.js';
import { waveHeadPlan, writeWaveHead, type WaveHeadParts } from './wave-head.js';
import { waveLayoutPlan, type WaveLayoutPlan } from './wave-layout-writing.js';
import type { WrittenChunk } from './written-chunk.js';

/** How a WAV export stores its samples: integer PCM of `bits` bits, 8 to 32, or another code. */
export type WavSampleFormat =
  | { readonly kind: 'integer'; readonly bits: number }
  | { readonly kind: 'float'; readonly bits: 32 | 64 }
  | { readonly kind: 'g711-alaw' | 'g711-ulaw' | 'ima-adpcm' | 'ms-adpcm' };

/** A WAV export. */
export interface WavWriterSettings {
  /** `riff` becomes RF64 where the file passes four gibibytes; `bw64` is always BW64. */
  readonly form: 'riff' | 'bw64';
  readonly sampleRate: SampleRate;

  /** The layout of the blocks the writer is handed. */
  readonly layout: ChannelLayout;
  readonly sampleFormat: WavSampleFormat;
  readonly metadata: MetadataMap;
}

/** A file writer, and the layout its file states, in the file's own channel order. */
export interface OpenedFileWriter {
  readonly writer: AudioFileWriter;
  readonly layout: ChannelLayout;
}

/** The byte offsets a file may reach and stay exact numbers, less room for its head. */
const LARGEST_DATA_LENGTH = Number.MAX_SAFE_INTEGER - 2 ** 24;

/** The sample encoding of a WAV sample format, at a rate, for a count of channels. */
function waveEncoding(
  format: WavSampleFormat,
  sampleRate: number,
  channelCount: number,
): SampleEncoding {
  switch (format.kind) {
    case 'integer':
      // WAV's eight-bit samples are offset binary, and wider ones two's complement.
      return {
        kind: 'integer',
        bits: format.bits,
        bytes: containerBytes(format.bits),
        byteOrder: 'little',
        signed: format.bits !== 8,
      };
    case 'float':
      return {
        kind: 'float',
        bits: format.bits,
        bytes: format.bits === 32 ? 4 : 8,
        byteOrder: 'little',
      };
    case 'ima-adpcm':
      return imaEncodingFor('wav', sampleRate, channelCount);
    case 'ms-adpcm':
      return msEncodingFor(sampleRate, channelCount);
    default:
      return { kind: format.kind };
  }
}

/** Why a WAV file cannot hold `format`, or `undefined` where it can. */
function formatProblem(format: WavSampleFormat): DomainFailure | undefined {
  if (format.kind !== 'integer' || holdsDepth(PCM_INTEGER_DEPTHS, format.bits)) return undefined;
  return writeInvalid(
    `A WAV file holds integer samples of ${String(PCM_INTEGER_DEPTHS.lowest)} to ${String(PCM_INTEGER_DEPTHS.highest)} whole bits, not ${String(format.bits)}.`,
  );
}

/** How the format chunk states the layout, and the `iXML` chunk where it cannot. */
function layoutStatement(
  encoding: SampleEncoding,
  plan: WaveLayoutPlan,
): { readonly form: WaveFormatForm; readonly ixml: WrittenChunk | undefined } {
  const count = plan.written.roles.length;
  if (encoding.kind === 'ima-adpcm' || encoding.kind === 'ms-adpcm') {
    return {
      form: { kind: 'plain' },
      ixml: plan.unstatedReads ? undefined : ixmlLayoutChunk(plan.written),
    };
  }
  // Integer PCM deeper than 16 bits, or short of its container, is stated by the valid bits alone.
  const validBitsStated =
    encoding.kind === 'integer' && (encoding.bits > 16 || encoding.bits !== encoding.bytes * 8);
  if (count <= 2 && !validBitsStated && plan.unstatedReads)
    return { form: { kind: 'plain' }, ixml: undefined };
  return { form: { kind: 'extensible', channelMask: plan.channelMask }, ixml: plan.ixml };
}

/** Opens a WAV writer for `settings`, or says why no WAV file can hold them. */
export function createWavWriter(settings: WavWriterSettings): DomainResult<OpenedFileWriter> {
  const problem = formatProblem(settings.sampleFormat);
  if (problem !== undefined) return fail(problem);
  const planned = waveLayoutPlan(settings.layout);
  if (!planned.ok) return planned;
  const plan = planned.value;
  const channelCount = plan.written.roles.length;
  const encoding = waveEncoding(settings.sampleFormat, settings.sampleRate, channelCount);
  const encoder = encoderOf(encoding, channelCount);
  const blockAlign =
    encoding.kind === 'ima-adpcm' || encoding.kind === 'ms-adpcm'
      ? adpcmBlockAlign(encoding, channelCount)
      : encoder.blockBytes;
  const statement = layoutStatement(encoding, plan);
  const format = waveFormatChunk({
    encoding,
    channelCount,
    sampleRate: settings.sampleRate,
    blockAlign,
    framesPerBlock: encoder.framesPerBlock,
    form: statement.form,
  });
  const metadata = riffMetadataChunks(settings.metadata, settings.sampleRate);
  const chunks = [...metadata.chunks, ...(statement.ixml === undefined ? [] : [statement.ixml])];
  const tooLong = () =>
    unwritableFile('The export is too long for any WAV file to hold with exact byte offsets.');
  const writer = streamingWriter({
    order: plan.order,
    encoder,
    maximumDataLength: LARGEST_DATA_LENGTH,
    maximumFrames: LARGEST_DATA_LENGTH,
    tooLong,
    dropped: metadata.dropped,
    head: ({ frames, dataLength }) => {
      const parts: WaveHeadParts = {
        form: settings.form,
        format,
        factFrames: encoding.kind === 'integer' ? undefined : frames,
        chunks,
        dataLength,
        frames,
      };
      const head = waveHeadPlan(parts, tooLong);
      return head.ok ? succeed(writeWaveHead(head.value, parts)) : head;
    },
  });
  return succeed({ writer, layout: plan.written });
}
