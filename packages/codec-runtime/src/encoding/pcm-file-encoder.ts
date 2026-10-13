/**
 * WAV, AIFF and AIFF-C exports, written by the codecs' own writers
 * (ADR-0091), which state the layout, put the channels in the file's order
 * and quantise each sample by the one rule; an integer or coded encoding is
 * dithered first by the export's quantiser. A WAV file is RIFF, becoming RF64
 * only where it passes four gibibytes.
 */

import {
  createAiffWriter,
  createWavWriter,
  type AiffSampleFormat,
  type AudioFileWriter,
  type WavSampleFormat,
} from '@audiogubbins/codecs';
import { mapResult, type DomainResult } from '@audiogubbins/domain';
import type { AifcEncoding, AiffEncoding, WavEncoding } from '@audiogubbins/import-export';

import type { ExportEncodeRequest } from '../worker/codec-worker-messages.js';

/** The WAV writer's name for each coded encoding. */
const CODED = {
  'a-law': 'g711-alaw',
  'mu-law': 'g711-ulaw',
  'ima-adpcm': 'ima-adpcm',
  'ms-adpcm': 'ms-adpcm',
} as const;

function wavFormat(encoding: WavEncoding): WavSampleFormat {
  switch (encoding.kind) {
    case 'integer':
      return { kind: 'integer', bits: encoding.bits };
    case 'float':
      return { kind: 'float', bits: encoding.bits };
    default:
      return { kind: CODED[encoding.kind] };
  }
}

function aifcFormat(encoding: AifcEncoding): AiffSampleFormat {
  switch (encoding.kind) {
    case 'integer':
      return { kind: 'integer', bits: encoding.bits, byteOrder: 'big' };
    case 'float':
      return { kind: 'float', bits: encoding.bits };
    default:
      return { kind: CODED[encoding.kind] };
  }
}

/** A WAV export's writer, its blocks in the rendered layout's order. */
export function openWavWriter(
  request: ExportEncodeRequest,
  encoding: WavEncoding,
): DomainResult<AudioFileWriter> {
  return mapResult(
    createWavWriter({
      form: 'riff',
      sampleRate: request.sampleRate,
      layout: request.layout,
      sampleFormat: wavFormat(encoding),
      metadata: request.metadata,
    }),
    (opened) => opened.writer,
  );
}

/** An AIFF or AIFF-C export's writer, its blocks in the rendered layout's order. */
export function openAiffWriter(
  request: ExportEncodeRequest,
  container: 'aiff' | 'aifc',
  encoding: AiffEncoding | AifcEncoding,
): DomainResult<AudioFileWriter> {
  return mapResult(
    createAiffWriter({
      container,
      sampleRate: request.sampleRate,
      layout: request.layout,
      sampleFormat: aifcFormat(encoding),
      metadata: request.metadata,
    }),
    (opened) => opened.writer,
  );
}
