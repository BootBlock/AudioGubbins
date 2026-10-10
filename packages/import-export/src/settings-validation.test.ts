import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  discreteLayout,
  sampleCount,
  unsafeBrandId,
  type DomainResult,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { CodecDescriptor } from '@audiogubbins/codecs';

import { defaultExportSettings } from './default-settings.js';
import type { ExportContext } from './export-context.js';
import type { ExportSettings, ExportSettingsOf } from './export-settings.js';
import { validateExportSettings } from './settings-validation.js';
import { TEST_CODECS, contextOf, rate } from './testing/export-fixtures.js';

const CONTEXT = contextOf();

/** Every failure code of a result, in order. */
function codes(result: DomainResult<unknown>): readonly string[] {
  return result.ok ? [] : result.failures.map((one) => one.code);
}

function wav(changes: Partial<ExportSettingsOf<'wav'>> = {}): ExportSettings {
  return { ...defaultExportSettings('wav', CONTEXT), ...changes };
}

function checked(settings: ExportSettings, context: ExportContext = CONTEXT): readonly string[] {
  return codes(validateExportSettings(settings, context));
}

function withCodec(descriptor: CodecDescriptor): ExportContext {
  return {
    ...CONTEXT,
    codecs: (id) => (id === descriptor.id ? descriptor : TEST_CODECS.get(id)),
  };
}

describe('validating export settings against the codec', () => {
  it('passes settings that can be made, returning them unchanged', () => {
    const settings = wav();
    expect(expectSuccess(validateExportSettings(settings, CONTEXT))).toBe(settings);
  });

  it('refuses a codec the registry does not know, writes not, or writes in another container', () => {
    expect(checked(wav(), { ...CONTEXT, codecs: () => undefined })).toEqual([
      'import-export.codec-unknown',
    ]);
    const pcm = TEST_CODECS.get('pcm');
    if (pcm?.write === undefined) throw new Error('The test PCM codec writes.');
    expect(checked(wav(), withCodec({ ...pcm, write: undefined }))).toEqual([
      'import-export.codec-not-written',
    ]);
    expect(
      checked(wav(), withCodec({ ...pcm, write: { ...pcm.write, containers: ['aiff'] } })),
    ).toEqual(['import-export.container-not-written']);
  });

  it('refuses a rate the codec does not write, rather than taking another', () => {
    const opus = { ...defaultExportSettings('opus', CONTEXT), sampleRate: rate(44_100) };
    const result = validateExportSettings(opus, CONTEXT);
    expect(codes(result)).toEqual(['import-export.sample-rate-unsupported']);
    expect(result.ok ? '' : result.failures[0].summary).toBe(
      'Opus is written at 8000, 12000, 16000, 24000, 48000 Hz, not at 44100 Hz.',
    );
  });

  it('refuses more channels than the codec holds, and takes them once converted', () => {
    const context = contextOf({ layout: StandardLayouts.surround5_1 });
    const mp3 = defaultExportSettings('mp3', context);
    expect(checked(mp3, context)).toEqual(['import-export.too-many-channels']);
    const downmixed: ExportSettings = {
      ...mp3,
      channels: { kind: 'matrix', matrix: 'itu-bs775-5.1-to-stereo' },
    };
    expect(checked(downmixed, context)).toEqual([]);
  });

  it('reports every problem at once', () => {
    const settings = wav({
      sampleRate: rate(400_000),
      dither: { kind: 'triangular', amplitude: 0, shaping: 'none', seed: 0 },
      fileName: '{nonsense}',
    });
    expect(checked(settings)).toEqual([
      'import-export.sample-rate-unsupported',
      'import-export.dither-without-integers',
      'import-export.dither-amplitude-invalid',
      'import-export.file-name-template-invalid',
    ]);
  });
});

describe("validating each format's encoding", () => {
  it.each([
    [
      'an MP3 bit rate off the table',
      { format: 'mp3', encoding: { mode: 'constant', bitRate: 300 } },
    ],
    [
      'an MP3 variable quality past 9',
      { format: 'mp3', encoding: { mode: 'variable', quality: 10 } },
    ],
    [
      'an MP3 average bit rate past the table',
      { format: 'mp3', encoding: { mode: 'average', bitRate: 330 } },
    ],
    [
      'a FLAC compression level past 8',
      { format: 'flac', encoding: { bits: 24, compressionLevel: 9 } },
    ],
    ['a fractional FLAC level', { format: 'flac', encoding: { bits: 24, compressionLevel: 2.5 } }],
    [
      'a Vorbis quality past 10',
      { format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 10.5 } },
    ],
    [
      'a Vorbis bit rate below 16 a channel',
      { format: 'ogg-vorbis', encoding: { mode: 'bit-rate', nominalBitRate: 31 } },
    ],
    [
      'a Vorbis bit rate past 250 a channel',
      { format: 'ogg-vorbis', encoding: { mode: 'bit-rate', nominalBitRate: 501 } },
    ],
    [
      'an Opus bit rate past 255 a channel',
      {
        format: 'opus',
        encoding: { bitRate: 511, application: 'audio', frameDuration: 20, complexity: 10 },
      },
    ],
    [
      'an Opus bit rate below 6',
      {
        format: 'opus',
        encoding: { bitRate: 5, application: 'voip', frameDuration: 20, complexity: 10 },
      },
    ],
    [
      'an Opus complexity past 10',
      {
        format: 'opus',
        encoding: { bitRate: 64, application: 'audio', frameDuration: 10, complexity: 11 },
      },
    ],
    [
      'an AAC bit rate past 6144 bits a channel frame',
      { format: 'aac', encoding: { bitRate: 577 } },
    ],
    ['an AAC bit rate below 8', { format: 'aac', encoding: { bitRate: 7 } }],
  ] as const)('refuses %s', (_name, choice) => {
    const settings = { ...defaultExportSettings(choice.format, CONTEXT), ...choice } as const;
    expect(checked(settings as ExportSettings)).toEqual(['import-export.encoding-invalid']);
  });

  it.each([
    [
      'MP3 at 320 kbit/s and 48 kHz',
      { format: 'mp3', encoding: { mode: 'constant', bitRate: 320 } },
    ],
    [
      'MP3 averaging 8 kbit/s at 48 kHz',
      { format: 'mp3', encoding: { mode: 'average', bitRate: 32 } },
    ],
    ['FLAC at level 0', { format: 'flac', encoding: { bits: 16, compressionLevel: 0 } }],
    ['Vorbis at quality -1', { format: 'ogg-vorbis', encoding: { mode: 'quality', quality: -1 } }],
    [
      'Vorbis at 32 kbit/s for two channels',
      { format: 'ogg-vorbis', encoding: { mode: 'bit-rate', nominalBitRate: 32 } },
    ],
    [
      'Opus at 510 kbit/s for two channels',
      {
        format: 'opus',
        encoding: {
          bitRate: 510,
          application: 'restricted-low-delay',
          frameDuration: 2.5,
          complexity: 0,
        },
      },
    ],
    ['AAC at 576 kbit/s for two channels at 48 kHz', { format: 'aac', encoding: { bitRate: 576 } }],
  ] as const)('takes %s', (_name, choice) => {
    const settings = { ...defaultExportSettings(choice.format, CONTEXT), ...choice } as const;
    expect(checked(settings as ExportSettings)).toEqual([]);
  });

  it("holds MP3's bit rate to the table of the rate's MPEG version", () => {
    const at = (hertz: number, bitRate: number): readonly string[] =>
      checked({
        ...defaultExportSettings('mp3', CONTEXT),
        sampleRate: rate(hertz),
        encoding: { mode: 'constant', bitRate },
      });
    expect(at(22_050, 320)).toEqual(['import-export.encoding-invalid']);
    expect(at(22_050, 144)).toEqual([]);
    expect(at(44_100, 144)).toEqual(['import-export.encoding-invalid']);
    expect(at(8_000, 8)).toEqual([]);
  });
});

describe('validating the channel conversion', () => {
  it('refuses a map naming a channel the audio lacks, or the wrong number of channels', () => {
    expect(
      checked(wav({ channels: { kind: 'map', channels: [2], to: StandardLayouts.mono } })),
    ).toEqual(['import-export.layout-unconvertible']);
    expect(
      checked(wav({ channels: { kind: 'map', channels: [0, 1], to: StandardLayouts.mono } })),
    ).toEqual(['import-export.layout-unconvertible']);
    expect(
      checked(wav({ channels: { kind: 'map', channels: [1], to: StandardLayouts.mono } })),
    ).toEqual([]);
  });

  it('refuses a named matrix written for another layout', () => {
    expect(
      checked(wav({ channels: { kind: 'matrix', matrix: 'itu-bs775-5.1-to-stereo' } })),
    ).toEqual(['import-export.layout-unconvertible']);
    expect(checked(wav({ channels: { kind: 'matrix', matrix: 'mid-side-encode' } }))).toEqual([]);
  });

  it('refuses a fold between layouts with no stated conversion', () => {
    const discrete = expectSuccess(discreteLayout(2));
    expect(checked(wav({ channels: { kind: 'fold', to: discrete } }))).toEqual([
      'import-export.layout-unconvertible',
    ]);
    expect(checked(wav({ channels: { kind: 'fold', to: StandardLayouts.mono } }))).toEqual([]);
  });
});

describe('validating the dither', () => {
  const triangular = { kind: 'triangular', amplitude: 1, shaping: 'none', seed: 0 } as const;

  it('refuses dither before a floating-point encoder, and takes it before an integer one', () => {
    expect(checked(wav({ dither: triangular }))).toEqual(['import-export.dither-without-integers']);
    expect(checked(wav({ encoding: { kind: 'integer', bits: 24 }, dither: triangular }))).toEqual(
      [],
    );
    expect(checked(wav({ encoding: { kind: 'a-law' }, dither: triangular }))).toEqual([]);
    expect(checked({ ...defaultExportSettings('opus', CONTEXT), dither: triangular })).toEqual([
      'import-export.dither-without-integers',
    ]);
  });

  it('refuses an amplitude or a seed out of range', () => {
    const integer = { kind: 'integer', bits: 16 } as const;
    expect(checked(wav({ encoding: integer, dither: { ...triangular, amplitude: 4.5 } }))).toEqual([
      'import-export.dither-amplitude-invalid',
    ]);
    expect(
      checked(wav({ encoding: integer, dither: { ...triangular, amplitude: Number.NaN } })),
    ).toEqual(['import-export.dither-amplitude-invalid']);
    expect(checked(wav({ encoding: integer, dither: { ...triangular, seed: 2 ** 32 } }))).toEqual([
      'import-export.dither-seed-invalid',
    ]);
    expect(checked(wav({ encoding: integer, dither: { ...triangular, seed: 1.5 } }))).toEqual([
      'import-export.dither-seed-invalid',
    ]);
  });

  it('refuses the E-weighted shaping away from the 44.1 kHz it was designed for', () => {
    const shaped = { ...triangular, shaping: 'lipshitz-e-weighted' } as const;
    const integer = { kind: 'integer', bits: 16 } as const;
    expect(checked(wav({ encoding: integer, dither: shaped }))).toEqual([
      'import-export.shaping-rate-unsupported',
    ]);
    expect(checked(wav({ encoding: integer, dither: shaped, sampleRate: rate(44_100) }))).toEqual(
      [],
    );
    expect(
      checked(wav({ encoding: integer, dither: { ...shaped, shaping: 'first-order' } })),
    ).toEqual([]);
  });
});

describe('validating the range', () => {
  it('refuses a region the project no longer has, and every region where there are none', () => {
    expect(
      checked(wav({ range: { kind: 'region', region: unsafeBrandId('region-gone') } })),
    ).toEqual(['import-export.range-region-unknown']);
    const bare: ExportContext = { ...CONTEXT, source: { ...CONTEXT.source, regions: [] } };
    expect(checked(wav({ range: { kind: 'every-region' }, fileName: '{index}' }), bare)).toEqual([
      'import-export.range-no-regions',
    ]);
  });

  it('refuses an empty selection, one past the end, and an empty project', () => {
    const selection = (start: number, length: number): ExportSettings =>
      wav({
        range: {
          kind: 'selection',
          start: expectSuccess(sampleCount(start)),
          length: expectSuccess(sampleCount(length)),
        },
      });
    expect(checked(selection(0, 0))).toEqual(['import-export.range-empty']);
    expect(checked(selection(479_000, 1_001))).toEqual(['import-export.range-outside']);
    expect(checked(selection(479_000, 1_000))).toEqual([]);
    const empty: ExportContext = {
      ...CONTEXT,
      source: { ...CONTEXT.source, length: expectSuccess(sampleCount(0)) },
    };
    expect(checked(wav(), empty)).toEqual(['import-export.range-empty']);
  });
});

describe('validating the metadata', () => {
  it('refuses edits under no metadata, an edit repeated, and a value that is empty or holds a control', () => {
    const set = { kind: 'set', key: 'title', value: 'Slam' } as const;
    expect(checked(wav({ metadata: { policy: 'none', edits: [set] } }))).toEqual([
      'import-export.metadata-edits-with-none',
    ]);
    expect(
      checked(
        wav({ metadata: { policy: 'full', edits: [set, { kind: 'remove', key: 'title' }] } }),
      ),
    ).toEqual(['import-export.metadata-edit-repeated']);
    expect(
      checked(wav({ metadata: { policy: 'full', edits: [{ ...set, value: '  ' }] } })),
    ).toEqual(['import-export.metadata-value-invalid']);
    expect(
      checked(wav({ metadata: { policy: 'full', edits: [{ ...set, value: 'a\u0007b' }] } })),
    ).toEqual(['import-export.metadata-value-invalid']);
    expect(
      checked(
        wav({ metadata: { policy: 'minimal', edits: [{ ...set, value: 'line\nbreak\ttab' }] } }),
      ),
    ).toEqual([]);
  });
});

describe('validating the file name template', () => {
  it('refuses an unknown token and a lone brace, and reads doubled braces as braces', () => {
    expect(checked(wav({ fileName: '{project}-{take}' }))).toEqual([
      'import-export.file-name-template-invalid',
    ]);
    expect(checked(wav({ fileName: '{project' }))).toEqual([
      'import-export.file-name-template-invalid',
    ]);
    expect(checked(wav({ fileName: 'project}' }))).toEqual([
      'import-export.file-name-template-invalid',
    ]);
    expect(checked(wav({ fileName: '   ' }))).toEqual(['import-export.file-name-template-invalid']);
    expect(checked(wav({ fileName: '{{draft}} {project} {date} {format}' }))).toEqual([]);
  });

  it('refuses {region} where no region is exported', () => {
    expect(checked(wav({ fileName: '{region}' }))).toEqual([
      'import-export.file-name-region-without-region',
    ]);
    expect(
      checked(
        wav({
          fileName: '{region}',
          range: { kind: 'region', region: unsafeBrandId('region-first') },
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a name that would not tell the files of every region apart', () => {
    expect(checked(wav({ range: { kind: 'every-region' } }))).toEqual([
      'import-export.file-names-not-distinct',
    ]);
    expect(
      checked(wav({ range: { kind: 'every-region' }, fileName: '{project} {index}' })),
    ).toEqual([]);
    expect(checked(wav({ range: { kind: 'every-region' }, fileName: '{region}' }))).toEqual([]);
  });
});
