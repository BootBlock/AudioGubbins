/**
 * What opening an export's encoder refuses, and how its writer ends: a layout
 * the format cannot state, a setting the shipped encoder cannot express, a
 * prebuilt module that is not the build this runtime drives, a block of the
 * wrong shape, and a cancelled write.
 */

import { StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { succeed } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import { exportRequest, testServices, testSignal } from '../testing/export-encoding.js';
import { prebuiltEncoderBytes } from '../testing/prebuilt-encoders.js';
import { openExportEncoder } from './open-export-encoder.js';

const MP3_320 = { format: 'mp3', encoding: { mode: 'constant', bitRate: 320 } } as const;

describe('opening an export’s encoder', () => {
  it('refuses a layout the format cannot state before loading its encoder', async () => {
    let loaded = false;
    const services = {
      ...testServices(),
      prebuiltEncoder: () => {
        loaded = true;
        return Promise.resolve(succeed(prebuiltEncoderBytes('lame')));
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

  it('refuses a prebuilt module of another encoder, or bytes that are no module', async () => {
    for (const code of [prebuiltEncoderBytes('libvorbis'), Uint8Array.of(0, 97, 115, 109)]) {
      const opened = await openExportEncoder(exportRequest(MP3_320, 48_000), {
        ...testServices(),
        prebuiltEncoder: () => Promise.resolve(succeed(code)),
      });
      expect(expectFailureCode(opened)).toBe('codec-runtime.prebuilt-encoder-refused');
    }
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
    );
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
    );
    const controller = new AbortController();
    const reason = new Error('The export was cancelled.');
    controller.abort(reason);
    await expect(writer.write(testSignal(2, 100, 48_000), 100, controller.signal)).rejects.toBe(
      reason,
    );
    expect(expectFailureCode(await writer.finish())).toBe('codec-runtime.writer-ended');
  });
});
