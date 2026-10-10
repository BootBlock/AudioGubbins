/**
 * The encoding controls of the lossy formats (ADR-0092): MP3's bit rate mode
 * with its rate or quality, Ogg Vorbis's quality or nominal bit rate, Opus's
 * bit rate, tuning, frame length and complexity, and AAC's bit rate, each a
 * row of the table of formats.
 */

import type { ReactNode } from 'react';

import {
  mp3BitRates,
  type Mp3Encoding,
  type OpusApplication,
  type OpusFrameDuration,
  type VorbisEncoding,
} from '@audiogubbins/import-export';

import type { SampleRate } from '@audiogubbins/domain';

import { APPLICATION_NAMES } from './export-words.js';
import {
  ChoiceField,
  NumberField,
  numberChoices,
  wholeNumbers,
  type Choice,
  type EncodingRows,
} from './setting-fields.js';

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

/** What MP3's mode sets: a constant rate the MPEG table holds, an average rate, or a quality. */
function Mp3Value({
  encoding,
  sampleRate,
  onEncoding,
}: {
  readonly encoding: Mp3Encoding;
  readonly sampleRate: SampleRate;
  readonly onEncoding: (encoding: Mp3Encoding) => void;
}): ReactNode {
  switch (encoding.mode) {
    case 'constant': {
      const rates = mp3BitRates(sampleRate);
      return (
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
      );
    }
    case 'average':
      return (
        <NumberField
          label="Average bit rate"
          unit="kbit/s"
          value={encoding.bitRate}
          onNumber={(bitRate) => {
            onEncoding({ mode: 'average', bitRate });
          }}
        />
      );
    case 'variable':
      return (
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
      );
  }
}

/** The rows of the lossy formats. */
export const LOSSY_ROWS: Pick<EncodingRows, 'mp3' | 'ogg-vorbis' | 'opus' | 'aac'> = {
  mp3: ({ settings, onEncoding }) => (
    <>
      <ChoiceField
        label="Bit rate mode"
        value={settings.encoding.mode}
        choices={MP3_MODES}
        onChoose={(mode) => {
          onEncoding(mp3Of(mode, settings.encoding, mp3BitRates(settings.sampleRate)));
        }}
      />
      <Mp3Value
        encoding={settings.encoding}
        sampleRate={settings.sampleRate}
        onEncoding={onEncoding}
      />
    </>
  ),
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
