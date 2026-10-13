/**
 * What opening an export's encoder refuses, and how its writer ends: a layout
 * the format cannot state, an encoding value the encoder would not keep, an
 * encoder module of another encoder, a block of the wrong shape, and a
 * cancelled write; and the encoder each format names.
 */

import { WINDOWS_BROWSER_BIT_RATES } from '@audiogubbins/codecs/testing';
import { StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { succeed } from '@audiogubbins/domain';
import type { FormatEncoding } from '@audiogubbins/import-export';
import { PRODUCT_VERSION } from '@audiogubbins/version';
import { describe, expect, it } from 'vitest';

import { encoderModuleBytes } from '../testing/encoder-modules.js';
import { exportRequest, testServices, testSignal } from '../testing/export-encoding.js';
import { FLACENC_ENCODER, ROPUS_ENCODER, type EncoderIdentity } from './encoder-identity.js';
import { openExportEncoder } from './open-export-encoder.js';

const MP3_320 = { format: 'mp3', encoding: { mode: 'constant', bitRate: 320 } } as const;

/** The test's services, counting the encoder modules loaded. */
function counted() {
  const loaded: string[] = [];
  const services = {
    ...testServices(),
    encoderModule: async (name: 'mp3' | 'vorbis') => {
      loaded.push(name);
      return succeed(await WebAssembly.compile(encoderModuleBytes(name)));
    },
  };
  return { services, loaded };
}

describe('opening an export’s encoder', () => {
  it('refuses a layout the format cannot state before loading its encoder', async () => {
    const { services, loaded } = counted();
    const opened = await openExportEncoder(
      exportRequest(MP3_320, 48_000, StandardLayouts.surround5_1),
      services,
    );
    expect(expectFailureCode(opened)).toBe('codecs.layout-unwritable');
    expect(loaded).toEqual([]);
  });

  it.each([
    [
      'an MP3 bit rate past LAME’s table at 8 kHz',
      { format: 'mp3', encoding: { mode: 'constant', bitRate: 80 } },
      8_000,
    ],
    [
      'an MP3 average bit rate past LAME’s table at 11.025 kHz',
      { format: 'mp3', encoding: { mode: 'average', bitRate: 96 } },
      11_025,
    ],
    [
      'a Vorbis nominal bit rate at 96 kHz, where libvorbis holds none',
      { format: 'ogg-vorbis', encoding: { mode: 'bit-rate', nominalBitRate: 192 } },
      96_000,
    ],
    [
      'a FLAC depth past the 32 bits FLAC states',
      { format: 'flac', encoding: { bits: 33, compressionLevel: 5, keepRiffChunks: false } },
      48_000,
    ],
    [
      'a WAV depth short of 8 bits',
      { format: 'wav', encoding: { kind: 'integer', bits: 7 } },
      48_000,
    ],
    [
      'an AIFF depth of part of a bit',
      { format: 'aiff', encoding: { kind: 'integer', bits: 20.5 } },
      48_000,
    ],
  ] as const)(
    'refuses %s by the rule validation refuses it by, before loading the encoder',
    async (_name, encoding: FormatEncoding, hertz) => {
      const { services, loaded } = counted();
      const opened = await openExportEncoder(exportRequest(encoding, hertz), services);
      expect(expectFailureCode(opened)).toBe('import-export.encoding-invalid');
      expect(loaded).toEqual([]);
    },
  );

  it("refuses AAC the browser's encoder was not found to take, by validation's rule, before opening it", async () => {
    // No browser encoder is given, so a request the rule let through would be
    // refused as unavailable instead.
    const services = { ...testServices(), browserBitRates: WINDOWS_BROWSER_BIT_RATES };
    const aac = (bitRate: number) => ({ format: 'aac', encoding: { bitRate } }) as const;
    const refused = await openExportEncoder(exportRequest(aac(256), 48_000), services);
    expect(expectFailureCode(refused)).toBe('import-export.encoding-invalid');
    const lcr = await openExportEncoder(
      exportRequest(aac(192), 48_000, StandardLayouts.lcr),
      services,
    );
    expect(expectFailureCode(lcr)).toBe('import-export.stream-not-encoded');
    const taken = await openExportEncoder(exportRequest(aac(192), 48_000), services);
    expect(expectFailureCode(taken)).toBe('codec-runtime.encoder-unavailable');
  });

  it('refuses an encoder module of another encoder', async () => {
    const vorbis = await WebAssembly.compile(encoderModuleBytes('vorbis'));
    const opened = await openExportEncoder(exportRequest(MP3_320, 48_000), {
      ...testServices(),
      encoderModule: () => Promise.resolve(succeed(vorbis)),
    });
    expect(expectFailureCode(opened)).toBe('codec-runtime.encoder-module-refused');
  });

  it('refuses a target its encoding does not make', async () => {
    const request = exportRequest(MP3_320, 48_000);
    const opened = await openExportEncoder(
      { ...request, target: { ...request.target, codec: 'vorbis' } },
      testServices(),
    );
    expect(expectFailureCode(opened)).toBe('codec-runtime.target-disagrees');
  });
});

describe('an export’s writer', () => {
  it('refuses a block of the wrong channels, and then takes no more', async () => {
    const writer = expectSuccess(
      await openExportEncoder(
        exportRequest(
          { format: 'flac', encoding: { bits: 16, compressionLevel: 5, keepRiffChunks: false } },
          48_000,
        ),
        testServices(),
      ),
    ).writer;
    expect(expectFailureCode(await writer.write(testSignal(1, 100, 48_000), 100))).toBe(
      'codec-runtime.block-refused',
    );
    expect(expectFailureCode(await writer.write(testSignal(2, 100, 48_000), 100))).toBe(
      'codec-runtime.writer-ended',
    );
  });

  it('rejects with the signal’s reason when cancelled, and takes no more', async () => {
    const writer = expectSuccess(
      await openExportEncoder(exportRequest(MP3_320, 48_000), testServices()),
    ).writer;
    const controller = new AbortController();
    const reason = new Error('The export was cancelled.');
    controller.abort(reason);
    await expect(writer.write(testSignal(2, 100, 48_000), 100, controller.signal)).rejects.toBe(
      reason,
    );
    expect(expectFailureCode(await writer.finish())).toBe('codec-runtime.writer-ended');
  });
});

describe('the encoder an export names', () => {
  const encoderOf = async (encoding: FormatEncoding): Promise<EncoderIdentity> =>
    expectSuccess(await openExportEncoder(exportRequest(encoding, 48_000), testServices())).encoder;

  it('names AudioGubbins’ own writers for WAV, AIFF and AIFF-C', async () => {
    for (const format of ['wav', 'aiff', 'aifc'] as const) {
      expect(await encoderOf({ format, encoding: { kind: 'integer', bits: 24 } })).toEqual({
        implementation: 'application',
        version: `AudioGubbins ${PRODUCT_VERSION}`,
      });
    }
  });

  it('names flacenc at the depths it encodes, and the codec module’s own encoder at every other', async () => {
    for (const bits of [8, 12, 16, 20, 24]) {
      expect(
        await encoderOf({
          format: 'flac',
          encoding: { bits, compressionLevel: 5, keepRiffChunks: false },
        }),
      ).toEqual(FLACENC_ENCODER);
    }
    for (const bits of [4, 7, 13, 21, 28, 32]) {
      expect(
        await encoderOf({
          format: 'flac',
          encoding: { bits, compressionLevel: 5, keepRiffChunks: false },
        }),
      ).toEqual({ implementation: 'codec-module', version: `AudioGubbins ${PRODUCT_VERSION}` });
    }
  });

  it('names ropus for Opus, LAME for MP3 and libvorbis for Vorbis', async () => {
    expect(
      await encoderOf({
        format: 'opus',
        encoding: { bitRate: 128, application: 'audio', frameDuration: 20, complexity: 10 },
      }),
    ).toEqual(ROPUS_ENCODER);
    expect(await encoderOf(MP3_320)).toEqual({
      implementation: 'encoder-module',
      version: 'LAME 3.100',
    });
    expect(
      await encoderOf({ format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 5 } }),
    ).toEqual({ implementation: 'encoder-module', version: 'libvorbis 1.3.7' });
  });
});
