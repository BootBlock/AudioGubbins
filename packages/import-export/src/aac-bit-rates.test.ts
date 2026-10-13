import { describe, expect, it } from 'vitest';

import { StandardLayouts, type DomainResult } from '@audiogubbins/domain';

import { defaultExportSettings } from './default-settings.js';
import { encodingProblems } from './encoding-rules.js';
import { BUILT_IN_PRESETS, resolvePreset } from './export-presets.js';
import type { ExportSettings } from './export-settings.js';
import { offeredBitRates } from './offered-bit-rates.js';
import { validateExportSettings } from './settings-validation.js';
import { WINDOWS_AAC_BIT_RATES } from '@audiogubbins/codecs/testing';

import { browserAacContextOf, contextOf, rate } from './testing/export-fixtures.js';

/** A stereo 48 kHz project, AAC written by a browser probed as Chromium on Windows. */
const WINDOWS = browserAacContextOf(WINDOWS_AAC_BIT_RATES);

function aac(bitRate: number, context = WINDOWS): ExportSettings {
  return { ...defaultExportSettings('aac', context), encoding: { bitRate } };
}

/** Every failure of a result, by its code and sentence. */
function refusals(result: DomainResult<unknown>): readonly (readonly [string, string])[] {
  return result.ok ? [] : result.failures.map((one) => [one.code, one.summary] as const);
}

describe("AAC's bit rate, where the browser's encoder states the bit rates it takes", () => {
  it('defaults to the highest bit rate the encoder codes the stream at', () => {
    expect(defaultExportSettings('aac', WINDOWS).encoding).toEqual({ bitRate: 192 });
    const mono = browserAacContextOf(WINDOWS_AAC_BIT_RATES, { layout: StandardLayouts.mono });
    expect(defaultExportSettings('aac', mono).encoding).toEqual({ bitRate: 192 });
    expect(validateExportSettings(defaultExportSettings('aac', WINDOWS), WINDOWS).ok).toBe(true);
  });

  it('defaults to the highest the encoder codes for the channels a conversion gives', () => {
    const wide = browserAacContextOf([
      ...WINDOWS_AAC_BIT_RATES.filter((band) => band.channels !== 1),
      { channels: 1, sampleRates: { minimum: 48_000, maximum: 48_000 }, constant: [64, 80] },
    ]);
    const folded = resolvePreset(
      {
        id: 'mono',
        name: 'Mono',
        format: 'aac',
        settings: { channels: { kind: 'fold', to: StandardLayouts.mono } },
      },
      wide,
    );
    expect(folded.encoding).toEqual({ bitRate: 80 });
    expect(offeredBitRates(folded, wide)).toEqual([64, 80]);
  });

  it('refuses a bit rate the encoder does not code, naming those it does, before rendering', () => {
    expect(refusals(validateExportSettings(aac(256), WINDOWS))).toEqual([
      [
        'import-export.encoding-invalid',
        "This browser's encoder codes AAC of 2 channels at 48000 Hz at 96, 128, 160 or 192 kbit/s, not at 256.",
      ],
    ]);
    expect(refusals(validateExportSettings(aac(100), WINDOWS))).toHaveLength(1);
    expect(validateExportSettings(aac(128), WINDOWS).ok).toBe(true);
  });

  it('refuses a stream the encoder codes at no bit rate, naming the streams it codes', () => {
    const lcr = browserAacContextOf(WINDOWS_AAC_BIT_RATES, { layout: StandardLayouts.lcr });
    expect(refusals(validateExportSettings(aac(192, lcr), lcr))).toEqual([
      [
        'import-export.stream-not-encoded',
        "This browser's encoder codes no AAC of 3 channels at 48000 Hz; it codes AAC of 1, 2 or 6 channels at 44100 or 48000 Hz.",
      ],
    ]);
    const low = { ...aac(96), sampleRate: rate(32_000) };
    expect(refusals(validateExportSettings(low, WINDOWS)).map(([code]) => code)).toEqual([
      'import-export.stream-not-encoded',
    ]);
  });

  it("refuses what AAC's own syntax does not hold before what the encoder takes", () => {
    expect(refusals(validateExportSettings(aac(577), WINDOWS)).map(([code]) => code)).toEqual([
      'import-export.encoding-invalid',
    ]);
    expect(refusals(validateExportSettings(aac(577), WINDOWS))[0]?.[1]).toBe(
      'AAC of 2 channels at 48000 Hz takes a whole number of kbit/s from 8 to 576.',
    );
  });

  it('refuses by the same rule where the codec worker is asked unvalidated', () => {
    const write = WINDOWS.codecs('aac-lc')?.write;
    const facts = { sampleRate: rate(48_000), channels: 2, write };
    expect(encodingProblems({ format: 'aac', encoding: { bitRate: 256 } }, facts)).toHaveLength(1);
    expect(encodingProblems({ format: 'aac', encoding: { bitRate: 192 } }, facts)).toEqual([]);
  });

  it('reports the AAC preset whose bit rate the encoder does not code, never changing it', () => {
    const preset = BUILT_IN_PRESETS.find((one) => one.id === 'distribution-aac');
    if (preset === undefined) throw new Error('The AAC preset is missing.');
    const settings = resolvePreset(preset, WINDOWS);
    expect(settings.encoding).toEqual({ bitRate: 256 });
    expect(refusals(validateExportSettings(settings, WINDOWS)).map(([code]) => code)).toEqual([
      'import-export.encoding-invalid',
    ]);
  });
});

describe("AAC's bit rate, where its encoder states none", () => {
  it('defaults to 128 kbit/s a channel, within what AAC holds at the rate', () => {
    expect(defaultExportSettings('aac', contextOf()).encoding).toEqual({ bitRate: 256 });
    const low = contextOf({ hertz: 8_000 });
    expect(defaultExportSettings('aac', low).encoding).toEqual({ bitRate: 96 });
    expect(validateExportSettings(defaultExportSettings('aac', low), low).ok).toBe(true);
  });

  it('offers no list, leaving the bit rate to AAC’s own bounds', () => {
    expect(offeredBitRates(defaultExportSettings('aac', contextOf()), contextOf())).toBeUndefined();
  });
});
