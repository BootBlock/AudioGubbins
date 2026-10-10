/**
 * What opening an export's encoder refuses, and how its writer ends: a layout
 * the format cannot state, a setting the shipped encoder cannot express, a
 * prebuilt module that is not the build this runtime drives, a block of the
 * wrong shape, and a cancelled write; and the encoder each format names.
 */

import { StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { succeed } from '@audiogubbins/domain';
import type { FormatEncoding } from '@audiogubbins/import-export';
import { PRODUCT_VERSION } from '@audiogubbins/version';
import { describe, expect, it } from 'vitest';

import { exportRequest, testServices, testSignal } from '../testing/export-encoding.js';
import { prebuiltEncoderBytes } from '../testing/prebuilt-encoders.js';
import { FLACENC_ENCODER, ROPUS_ENCODER, type EncoderIdentity } from './encoder-identity.js';
import { openExportEncoder } from './open-export-encoder.js';

const MP3_320 = { format: 'mp3', encoding: { mode: 'constant', bitRate: 320 } } as const;

describe('opening an export’s encoder', () => {
  it('refuses a layout the format cannot state before loading its encoder', async () => {
    let loaded = false;
    const services = {
      ...testServices(),
      prebuiltModule: async () => {
        loaded = true;
        return succeed(await WebAssembly.compile(prebuiltEncoderBytes('mp3')));
      },
    };
    const opened = await openExportEncoder(
      exportRequest(MP3_320, 48_000, StandardLayouts.surround5_1),
      services,
    );
    expect(expectFailureCode(opened)).toBe('codecs.layout-unwritable');
    expect(loaded).toBe(false);
  });

  it('refuses the settings the shipped encoders cannot express, naming them', async () => {
    for (const [encoding, setting] of [
      [{ format: 'mp3', encoding: { mode: 'average', bitRate: 192 } }, 'mp3.average'],
      [
        { format: 'ogg-vorbis', encoding: { mode: 'bit-rate', nominalBitRate: 192 } },
        'ogg-vorbis.bit-rate',
      ],
    ] as const) {
      const opened = await openExportEncoder(exportRequest(encoding, 48_000), testServices());
      expect(expectFailureCode(opened)).toBe('codec-runtime.setting-unexpressible');
      expect(opened.ok ? undefined : opened.failures[0].details?.['setting']).toBe(setting);
    }
  });

  it('refuses a prebuilt module of another encoder', async () => {
    const vorbis = await WebAssembly.compile(prebuiltEncoderBytes('vorbis'));
    const opened = await openExportEncoder(exportRequest(MP3_320, 48_000), {
      ...testServices(),
      prebuiltModule: () => Promise.resolve(succeed(vorbis)),
    });
    expect(expectFailureCode(opened)).toBe('codec-runtime.prebuilt-encoder-refused');
  });

  it('refuses a target its encoding does not make', async () => {
    const request = exportRequest(MP3_320, 48_000);
    const opened = await openExportEncoder(
      { ...request, target: { ...request.target, codec: 'vorbis' } },
      testServices(),
    );
    expect(expectFailureCode(opened)).toBe('codec-runtime.target-disagrees');
  });

  it('refuses an MP3 bit rate the rate’s MPEG version does not code, which LAME would replace', async () => {
    const opened = await openExportEncoder(exportRequest(MP3_320, 16_000), testServices());
    expect(expectFailureCode(opened)).toBe('codec-runtime.settings-refused');
  });

  it('answers the prebuilt encoder’s refusal of settings it will not encode', async () => {
    // The libvorbis build encodes one or two channels; validation refuses more first.
    const opened = await openExportEncoder(
      exportRequest(
        { format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 5 } },
        48_000,
        StandardLayouts.lcr,
      ),
      testServices(),
    );
    expect(expectFailureCode(opened)).toBe('codec-runtime.prebuilt-encoder-failed');
  });
});

describe('an export’s writer', () => {
  it('refuses a block of the wrong channels, and then takes no more', async () => {
    const writer = expectSuccess(
      await openExportEncoder(
        exportRequest({ format: 'flac', encoding: { bits: 16, compressionLevel: 5 } }, 48_000),
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

  it('names flacenc at the depths it encodes, and the codec module’s own encoder at 32 bits', async () => {
    for (const bits of [16, 24] as const) {
      expect(await encoderOf({ format: 'flac', encoding: { bits, compressionLevel: 5 } })).toEqual(
        FLACENC_ENCODER,
      );
    }
    expect(
      await encoderOf({ format: 'flac', encoding: { bits: 32, compressionLevel: 5 } }),
    ).toEqual({ implementation: 'codec-module', version: `AudioGubbins ${PRODUCT_VERSION}` });
  });

  it('names ropus for Opus, LAME for MP3 and libvorbis for Vorbis', async () => {
    expect(
      await encoderOf({
        format: 'opus',
        encoding: { bitRate: 128, application: 'audio', frameDuration: 20, complexity: 10 },
      }),
    ).toEqual(ROPUS_ENCODER);
    expect(await encoderOf(MP3_320)).toEqual({
      implementation: 'prebuilt-module',
      version: 'LAME 3.100',
    });
    expect(
      await encoderOf({ format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 5 } }),
    ).toEqual({ implementation: 'prebuilt-module', version: 'libvorbis 1.3.7' });
  });
});
