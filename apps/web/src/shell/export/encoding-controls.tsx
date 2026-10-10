/**
 * Each format's own encoding controls in the Export dialog (ADR-0092): one
 * row of a table for each format, so a format is a new row and never another
 * arm of a switch. Every value its encoding type allows is offered; whether
 * the value suits the rate and the channels is the package's validation to
 * say, beside the controls.
 */

import type { ReactNode } from 'react';

import {
  mp3BitRates,
  type AifcEncoding,
  type ExportFormat,
  type ExportSettingsOf,
  type FlacEncoding,
  type FloatPcm,
  type IntegerPcm,
  type FormatEncodings,
  type Mp3Encoding,
  type OpusApplication,
  type OpusFrameDuration,
  type VorbisEncoding,
  type WavEncoding,
} from '@audiogubbins/import-export';

import { APPLICATION_NAMES } from './export-words.js';
import {
  ChoiceField,
  NumberField,
  numberChoices,
  wholeNumbers,
  type Choice,
} from './setting-fields.js';

/** What a format's controls are given: its settings, and how to set its encoding. */
interface EncodingProps<F extends ExportFormat> {
  readonly settings: ExportSettingsOf<F>;
  readonly onEncoding: (encoding: FormatEncodings[F]) => void;
}

type EncodingControls = {
  readonly [F in ExportFormat]: (props: EncodingProps<F>) => ReactNode;
};

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
const OPUS_DURATIONS: readonly OpusFrameDuration[] = [2.5, 5, 10, 20, 40, 60];
const OPUS_APPLICATIONS: readonly Choice<OpusApplication>[] = (
  ['audio', 'voip', 'restricted-low-delay'] as const
).map((value) => ({ value, label: `Tuned for ${APPLICATION_NAMES[value]}` }));

const MP3_MODES: readonly Choice<Mp3Encoding['mode']>[] = [
  { value: 'constant', label: 'Constant bit rate' },
  { value: 'average', label: 'Average bit rate' },
  { value: 'variable', label: 'Variable bit rate' },
];

const VORBIS_MODES: readonly Choice<VorbisEncoding['mode']>[] = [
  { value: 'quality', label: 'By quality' },
  { value: 'bit-rate', label: 'By nominal bit rate' },
];

/** The MP3 encoding a choice of mode gives, keeping the bit rate where the mode has one. */
function mp3Of(
  mode: Mp3Encoding['mode'],
  held: Mp3Encoding,
  rates: readonly number[],
): Mp3Encoding {
  if (mode === 'variable') return { mode, quality: held.mode === 'variable' ? held.quality : 0 };
  return { mode, bitRate: held.mode === 'variable' ? (rates.at(-1) ?? 320) : held.bitRate };
}

const CONTROLS: EncodingControls = {
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
    </>
  ),
  mp3: ({ settings, onEncoding }) => {
    const { encoding } = settings;
    const rates = mp3BitRates(settings.sampleRate);
    return (
      <>
        <ChoiceField
          label="Bit rate mode"
          value={encoding.mode}
          choices={MP3_MODES}
          onChoose={(mode) => {
            onEncoding(mp3Of(mode, encoding, rates));
          }}
        />
        {encoding.mode === 'constant' && (
          <ChoiceField
            label="Bit rate"
            value={encoding.bitRate}
            choices={numberChoices(
              rates.includes(encoding.bitRate) ? rates : [...rates, encoding.bitRate],
              (rate) => `${String(rate)} kbit/s`,
            )}
            onChoose={(bitRate) => {
              onEncoding({ mode: 'constant', bitRate });
            }}
          />
        )}
        {encoding.mode === 'average' && (
          <NumberField
            label="Average bit rate"
            unit="kbit/s"
            value={encoding.bitRate}
            onNumber={(bitRate) => {
              onEncoding({ mode: 'average', bitRate });
            }}
          />
        )}
        {encoding.mode === 'variable' && (
          <ChoiceField
            label="Quality"
            value={encoding.quality}
            choices={numberChoices(wholeNumbers(0, 9), (quality) =>
              quality === 0 ? 'V0, the best' : `V${String(quality)}`,
            )}
            onChoose={(quality) => {
              onEncoding({ mode: 'variable', quality });
            }}
          />
        )}
      </>
    );
  },
  'ogg-vorbis': ({ settings, onEncoding }) => {
    const { encoding } = settings;
    return (
      <>
        <ChoiceField
          label="Encode"
          value={encoding.mode}
          choices={VORBIS_MODES}
          onChoose={(mode) => {
            onEncoding(
              mode === 'quality'
                ? { mode, quality: encoding.mode === 'quality' ? encoding.quality : 10 }
                : {
                    mode,
                    nominalBitRate: encoding.mode === 'bit-rate' ? encoding.nominalBitRate : 192,
                  },
            );
          }}
        />
        {encoding.mode === 'quality' ? (
          <NumberField
            label="Quality"
            description="From -1 to 10, 10 the best."
            value={encoding.quality}
            onNumber={(quality) => {
              onEncoding({ mode: 'quality', quality });
            }}
          />
        ) : (
          <NumberField
            label="Nominal bit rate"
            unit="kbit/s"
            value={encoding.nominalBitRate}
            onNumber={(nominalBitRate) => {
              onEncoding({ mode: 'bit-rate', nominalBitRate });
            }}
          />
        )}
      </>
    );
  },
  opus: ({ settings, onEncoding }) => {
    const { encoding } = settings;
    return (
      <>
        <NumberField
          label="Bit rate"
          unit="kbit/s"
          value={encoding.bitRate}
          onNumber={(bitRate) => {
            onEncoding({ ...encoding, bitRate });
          }}
        />
        <ChoiceField
          label="Tuning"
          value={encoding.application}
          choices={OPUS_APPLICATIONS}
          onChoose={(application) => {
            onEncoding({ ...encoding, application });
          }}
        />
        <ChoiceField
          label="Frame length"
          value={encoding.frameDuration}
          choices={numberChoices(OPUS_DURATIONS, (duration) => `${String(duration)} ms`)}
          onChoose={(frameDuration) => {
            onEncoding({ ...encoding, frameDuration });
          }}
        />
        <ChoiceField
          label="Complexity"
          value={encoding.complexity}
          choices={numberChoices(wholeNumbers(0, 10), (level) =>
            level === 10 ? '10, the best' : String(level),
          )}
          onChoose={(complexity) => {
            onEncoding({ ...encoding, complexity });
          }}
        />
      </>
    );
  },
  aac: ({ settings, onEncoding }) => (
    <NumberField
      label="Bit rate"
      unit="kbit/s"
      value={settings.encoding.bitRate}
      onNumber={(bitRate) => {
        onEncoding({ bitRate });
      }}
    />
  ),
};

/** The controls of one format's settings, setting the whole record as `onSettings` is told. */
function controlsOf<F extends ExportFormat>(
  settings: ExportSettingsOf<F>,
  onSettings: (settings: ExportSettingsOf<F>) => void,
): ReactNode {
  const Controls: (props: EncodingProps<F>) => ReactNode = CONTROLS[settings.format];
  return (
    <Controls
      settings={settings}
      onEncoding={(encoding) => {
        onSettings({ ...settings, encoding });
      }}
    />
  );
}

/** The encoding controls of `settings`' format. */
export function EncodingControls<F extends ExportFormat>({
  settings,
  onSettings,
}: {
  readonly settings: ExportSettingsOf<F>;
  readonly onSettings: (settings: ExportSettingsOf<F>) => void;
}): ReactNode {
  return controlsOf(settings, onSettings);
}
