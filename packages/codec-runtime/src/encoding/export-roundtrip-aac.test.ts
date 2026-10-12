/**
 * AAC exports through a fake of the browser's WebCodecs encoder (ADR-0091):
 * the M4A file states the AudioSpecificConfig the encoder answered, its
 * priming from the first chunk's timestamp, and the length it was given; a
 * full queue holds the next block back; and an encoder's failure, or its
 * absence, is the export's.
 */

import { StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { codecModule } from '../testing/codec-module.js';
import { fakeWebCodecs } from '../testing/fake-web-codecs.js';
import {
  encodeWhole,
  exportRequest,
  testServices,
  testSignal,
} from '../testing/export-encoding.js';
import { memoryBytes } from '../testing/memory-bytes.js';
import { openExportEncoder } from './open-export-encoder.js';

const RATE = 48_000;

const AAC = { format: 'aac', encoding: { bitRate: 192 } } as const;

describe('AAC exports through the browser’s encoder', () => {
  it('states the encoder’s configuration, its priming and the length given, in M4A', async () => {
    const frames = 20_000;
    const { webCodecs, log } = fakeWebCodecs({ priming: 1_024 });
    const file = await encodeWhole(
      exportRequest(AAC, RATE),
      testSignal(2, frames, RATE),
      testServices(webCodecs),
      2_000,
    );
    expect(log.configured).toEqual({
      codec: 'mp4a.40.2',
      sampleRate: RATE,
      numberOfChannels: 2,
      bitrate: 192_000,
    });
    expect(log.closed).toBe(true);
    // Each block waited while more than two were queued.
    expect(log.highestQueue).toBeLessThanOrEqual(3);
    const module = await codecModule();
    const session = expectSuccess(module.openDecoder(memoryBytes(file)));
    expect(session.description).toMatchObject({
      codec: 'aac-lc',
      container: 'mp4',
      sampleRate: RATE,
      channelCount: 2,
      priming: 1_024,
      totalFrames: frames,
    });
    session.release();
  });

  it('names the browser’s encoder by its family and major version', async () => {
    const { webCodecs } = fakeWebCodecs({ priming: 0 });
    const opened = expectSuccess(
      await openExportEncoder(exportRequest(AAC, RATE), testServices(webCodecs)),
    );
    expect(opened.encoder).toEqual({
      implementation: 'browser',
      version: 'WebCodecs (Chrome) 131',
    });
  });

  it('states no priming where the first chunk starts at the first frame', async () => {
    const { webCodecs } = fakeWebCodecs({ priming: 0 });
    const file = await encodeWhole(
      exportRequest(AAC, RATE),
      testSignal(2, 5_000, RATE),
      testServices(webCodecs),
    );
    const module = await codecModule();
    const session = expectSuccess(module.openDecoder(memoryBytes(file)));
    expect(session.description).toMatchObject({ priming: 0, totalFrames: 5_000 });
    session.release();
  });

  it('fails the export where the encoder fails, and releases it', async () => {
    const { webCodecs, log } = fakeWebCodecs({ priming: 1_024, failAfter: 3 });
    const writer = expectSuccess(
      await openExportEncoder(exportRequest(AAC, RATE), testServices(webCodecs)),
    ).writer;
    const source = testSignal(2, 10_000, RATE);
    const written = await writer.write(source, 10_000);
    const finished = written.ok ? await writer.finish() : written;
    expect(expectFailureCode(finished)).toBe('codec-runtime.browser-encoder-failed');
    expect(log.closed).toBe(true);
  });

  it('fails the export with the browser’s reason where it refuses the configuration after taking it', async () => {
    const refusal = 'Unsupported bitrate. Supported values: 96000, 128000, 160000, 192000';
    const { webCodecs } = fakeWebCodecs({ priming: 1_024, refuseConfiguration: refusal });
    const writer = expectSuccess(
      await openExportEncoder(exportRequest(AAC, RATE), testServices(webCodecs)),
    ).writer;

    const written = await writer.write(testSignal(2, 4_000, RATE), 4_000);

    expect(written).toMatchObject({
      ok: false,
      failures: [
        {
          code: 'codec-runtime.browser-encoder-failed',
          summary: `The browser's AAC encoder failed: ${refusal}`,
        },
      ],
    });
  });

  it('fails a block waiting for the queue to drain where the encoder fails instead', async () => {
    const { webCodecs } = fakeWebCodecs({ priming: 1_024, failWithQueued: 3 });
    const writer = expectSuccess(
      await openExportEncoder(exportRequest(AAC, RATE), testServices(webCodecs)),
    ).writer;
    const block = testSignal(2, 1_000, RATE);

    expectSuccess(await writer.write(block, 1_000));
    expectSuccess(await writer.write(block, 1_000));

    expect(expectFailureCode(await writer.write(block, 1_000))).toBe(
      'codec-runtime.browser-encoder-failed',
    );
  });

  it('is unavailable, naming the formats that are, where the browser has no encoder', async () => {
    const opened = await openExportEncoder(
      exportRequest(AAC, RATE, StandardLayouts.stereo),
      testServices(),
    );
    expect(expectFailureCode(opened)).toBe('codec-runtime.encoder-unavailable');
  });
});
