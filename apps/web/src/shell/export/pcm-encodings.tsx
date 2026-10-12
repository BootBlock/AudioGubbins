/**
 * The encoding controls of the uncompressed and lossless formats (ADR-0092):
 * WAV's and AIFF-C's kinds of sample and depths, AIFF's depths, and FLAC's
 * depth, compression level and whether it keeps the WAV chunks of loops, cues
 * and tuning, each a row of the table of formats.
 */

import type { ReactNode } from 'react';

import type {
  AifcEncoding,
  FlacEncoding,
  FloatPcm,
  IntegerPcm,
  WavEncoding,
} from '@audiogubbins/import-export';

import {
  ChoiceField,
  numberChoices,
  wholeNumbers,
  type Choice,
  type EncodingRows,
} from './setting-fields.js';

/** The kinds of PCM sample a WAV or AIFF-C file holds, and what each is called. */
type PcmKind = WavEncoding['kind'];

const PCM_KIND_NAMES: Readonly<Record<PcmKind, string>> = {
  integer: 'Integer',
  float: 'Floating point',
  'a-law': 'A-law (G.711)',
  'mu-law': 'µ-law (G.711)',
  'ima-adpcm': 'IMA ADPCM',
  'ms-adpcm': 'Microsoft ADPCM',
};

const INTEGER_BITS: readonly IntegerPcm['bits'][] = [8, 16, 24, 32];

/**
 * Where a FLAC file keeps its loops, cues and tuning: the Vorbis comments hold
 * the first loop alone, and the WAV chunks in `riff` blocks hold them all.
 */
const RIFF_CHUNK_CHOICES: readonly Choice<boolean>[] = [
  { value: false, label: 'The first loop alone, as comments' },
  { value: true, label: 'Every one, also as WAV chunks' },
];
const FLOAT_BITS: readonly FloatPcm['bits'][] = [32, 64];

/** The encoding of `kind` a choice of it gives, at the depth held where the kind has that depth. */
function pcmOf(kind: PcmKind, held: WavEncoding): WavEncoding {
  switch (kind) {
    case 'integer':
      return { kind, bits: held.kind === 'integer' ? held.bits : 24 };
    case 'float':
      return { kind, bits: held.kind === 'float' ? held.bits : 32 };
    default:
      return { kind };
  }
}

/** The kind and depth controls of PCM, over the kinds `kinds` a format holds. */
function PcmControls({
  encoding,
  kinds,
  onEncoding,
}: {
  readonly encoding: WavEncoding;
  readonly kinds: readonly PcmKind[];
  readonly onEncoding: (encoding: WavEncoding) => void;
}): ReactNode {
  return (
    <>
      <ChoiceField
        label="Samples"
        value={encoding.kind}
        choices={kinds.map((kind) => ({ value: kind, label: PCM_KIND_NAMES[kind] }))}
        onChoose={(kind) => {
          onEncoding(pcmOf(kind, encoding));
        }}
      />
      {encoding.kind === 'integer' && (
        <ChoiceField
          label="Bit depth"
          value={encoding.bits}
          choices={numberChoices(INTEGER_BITS, bitsName)}
          onChoose={(bits) => {
            onEncoding({ kind: 'integer', bits });
          }}
        />
      )}
      {encoding.kind === 'float' && (
        <ChoiceField
          label="Bit depth"
          value={encoding.bits}
          choices={numberChoices(FLOAT_BITS, bitsName)}
          onChoose={(bits) => {
            onEncoding({ kind: 'float', bits });
          }}
        />
      )}
    </>
  );
}

/** A depth, as a person reads it. */
function bitsName(bits: number): string {
  return `${String(bits)}-bit`;
}

/** Whether a PCM encoding is one AIFF-C holds, which has no Microsoft ADPCM. */
function isAifc(encoding: WavEncoding): encoding is AifcEncoding {
  return encoding.kind !== 'ms-adpcm';
}

const WAV_KINDS: readonly WavEncoding['kind'][] = [
  'integer',
  'float',
  'a-law',
  'mu-law',
  'ima-adpcm',
  'ms-adpcm',
];
const AIFC_KINDS: readonly PcmKind[] = ['integer', 'float', 'a-law', 'mu-law', 'ima-adpcm'];
const FLAC_BITS: readonly FlacEncoding['bits'][] = [16, 24, 32];

/** The rows of the uncompressed and lossless formats. */
export const PCM_ROWS: Pick<EncodingRows, 'wav' | 'aiff' | 'aifc' | 'flac'> = {
  wav: ({ settings, onEncoding }) => (
    <PcmControls encoding={settings.encoding} kinds={WAV_KINDS} onEncoding={onEncoding} />
  ),
  aiff: ({ settings, onEncoding }) => (
    <ChoiceField
      label="Bit depth"
      value={settings.encoding.bits}
      choices={numberChoices(INTEGER_BITS, bitsName)}
      onChoose={(bits) => {
        onEncoding({ kind: 'integer', bits });
      }}
    />
  ),
  aifc: ({ settings, onEncoding }) => (
    <PcmControls
      encoding={settings.encoding}
      kinds={AIFC_KINDS}
      onEncoding={(encoding) => {
        if (isAifc(encoding)) onEncoding(encoding);
      }}
    />
  ),
  flac: ({ settings, onEncoding }) => (
    <>
      <ChoiceField
        label="Bit depth"
        value={settings.encoding.bits}
        choices={numberChoices(FLAC_BITS, bitsName)}
        onChoose={(bits) => {
          onEncoding({ ...settings.encoding, bits });
        }}
      />
      <ChoiceField
        label="Compression level"
        value={settings.encoding.compressionLevel}
        choices={numberChoices(wholeNumbers(0, 8), (level) =>
          level === 0 ? '0, fastest' : level === 8 ? '8, smallest' : String(level),
        )}
        onChoose={(compressionLevel) => {
          onEncoding({ ...settings.encoding, compressionLevel });
        }}
      />
      <ChoiceField
        label="Loops, cues and tuning"
        value={settings.encoding.keepRiffChunks}
        choices={RIFF_CHUNK_CHOICES}
        onChoose={(keepRiffChunks) => {
          onEncoding({ ...settings.encoding, keepRiffChunks });
        }}
      />
    </>
  ),
};
