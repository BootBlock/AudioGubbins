import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { ExportSettings } from '@audiogubbins/import-export';

import { stagedSizeBound } from './staged-size.js';

const HEAD = 64 * 1024;
const RATE = 48_000;
const STEREO = StandardLayouts.stereo;

/** The settings of `format`, as encoded, at 48 kHz. */
function settingsOf(
  encoded: Pick<ExportSettings, 'format' | 'encoding'>,
  hertz = RATE,
): ExportSettings {
  return {
    ...encoded,
    sampleRate: expectSuccess(sampleRate(hertz)),
    channels: { kind: 'keep' },
    dither: { kind: 'none' },
    range: { kind: 'project' },
    metadata: { policy: 'full', edits: [] },
    fileName: '{project}',
  } as ExportSettings;
}

describe('the most an export can stage (ADR-0092)', () => {
  it('bounds uncompressed PCM by its samples at their width, beside its head', () => {
    const wav = settingsOf({ format: 'wav', encoding: { kind: 'integer', bits: 24 } });

    expect(stagedSizeBound(wav, RATE, STEREO, {})).toBe(HEAD + RATE * 2 * 3);
  });

  it('counts a companded or ADPCM sample at a byte, which holds its block headers', () => {
    const adpcm = settingsOf({ format: 'wav', encoding: { kind: 'ima-adpcm' } });

    expect(stagedSizeBound(adpcm, RATE, STEREO, {})).toBe(HEAD + RATE * 2);
  });

  it('never bounds FLAC below its samples stored verbatim, a bit wider for the side channel', () => {
    const flac = settingsOf({ format: 'flac', encoding: { bits: 16, compressionLevel: 5 } });

    expect(stagedSizeBound(flac, RATE, STEREO, {})).toBeGreaterThan(
      HEAD + Math.ceil((RATE * 2 * 17) / 8),
    );
  });

  it('bounds MP3 by its largest frame for each frame of its length, whatever the setting', () => {
    const vbr = settingsOf({ format: 'mp3', encoding: { mode: 'variable', quality: 0 } });
    const frames = 60 * RATE;
    const bound = stagedSizeBound(vbr, frames, STEREO, {});

    // At least 320 kbit/s for a minute, and far below 16-bit PCM.
    expect(bound).toBeGreaterThanOrEqual(HEAD + (320_000 / 8) * 60);
    expect(bound).toBeLessThan(frames * 2 * 2);
  });

  it('bounds Opus by 16-bit PCM at the rate it always codes at', () => {
    const opus = settingsOf(
      {
        format: 'opus',
        encoding: { bitRate: 510_000, application: 'audio', frameDuration: 20, complexity: 10 },
      },
      24_000,
    );

    expect(stagedSizeBound(opus, 24_000, STEREO, {})).toBeGreaterThanOrEqual(HEAD + 48_000 * 2 * 2);
  });

  it('makes room for the metadata a file carries, cover art whole', () => {
    const wav = settingsOf({ format: 'wav', encoding: { kind: 'float', bits: 32 } });
    const bare = stagedSizeBound(wav, RATE, STEREO, {});
    const art = new Uint8Array(100_000);

    expect(
      stagedSizeBound(wav, RATE, STEREO, {
        text: { title: 'Harbour at dusk' },
        coverArt: { mediaType: 'image/png', description: '', bytes: art },
      }) - bare,
    ).toBeGreaterThanOrEqual('Harbour at dusk'.length * 3 + art.length);
  });
});
