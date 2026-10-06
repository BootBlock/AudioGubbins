import { describe, expect, it } from 'vitest';

import { writeWav } from '@audiogubbins/codecs/testing';
import {
  AssetOrigin,
  StandardLayouts,
  assetPlan,
  derivedSampleCount,
  sampleRate,
  slicePlan,
  unsafeBrandId,
  type Asset,
  type ChannelLayout,
  type EditOperation,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  PLAN_WITHOUT_CHAINS,
  expectFailureCode,
  expectSuccess,
  renderPlan,
} from '@audiogubbins/domain/testing';

import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { PLAIN_PLAN_PROCESSING } from '../testing/plan-processing.js';
import { ResamplingQuality } from '../dsp/canonical-dsp.js';
import { editedSource } from './edited-source.js';
import { MediaReadFailure, type MediaEntry } from './plan-content.js';
import { allocateBlock, frameBlock } from './frame-block.js';
import type { MediaFile } from './media-file.js';
import { memorySource } from './memory-source.js';
import { PcmDescriptionKind, describedSource, pcmDescription } from './pcm-description.js';
import type { PcmSource } from './pcm-source.js';
import { resampledSource } from './resampled-source.js';

const RATE = expectSuccess(sampleRate(48_000));
const OTHER = expectSuccess(sampleRate(44_100));

/** A file in memory, which counts the bytes it is asked for. */
function memoryFile(bytes: Uint8Array): MediaFile & { readonly asked: () => number } {
  let asked = 0;
  return {
    size: bytes.length,
    slice: (start, end) => ({
      arrayBuffer: () => {
        asked += end - start;
        return Promise.resolve(bytes.slice(start, end).buffer);
      },
    }),
    asked: () => asked,
  };
}

/** A file whose reads wait until `let` is called, then read `file`. */
function heldFile(file: MediaFile): MediaFile & { readonly let: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    size: file.size,
    slice: (start, end) => ({
      arrayBuffer: async () => {
        await gate;
        return await file.slice(start, end).arrayBuffer();
      },
    }),
    let: () => {
      release();
    },
  };
}

/** Deterministic samples, exactly representable at 32 bits. */
function samplesOf(length: number, channels: number, seed: number): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) =>
    Float32Array.from({ length }, (__, frame) =>
      Math.fround(Math.sin((frame + 1) * (seed + channel)) * 0.5),
    ),
  );
}

function assetOf(
  name: string,
  length: number,
  rate: SampleRate,
  layout: ChannelLayout,
  edits: readonly EditOperation[] = [],
): Asset {
  return {
    id: unsafeBrandId<'AssetId'>(
      `0000eeee-${Array.from(new TextEncoder().encode(name), (byte) => byte.toString(16)).join('')}`,
    ),
    displayName: name,
    origin: AssetOrigin.Imported,
    sampleRate: rate,
    channelLayout: layout,
    length: derivedSampleCount(length),
    storageKey: `content:${name}`,
    edits,
  };
}

function entryOf(
  asset: Asset,
  samples: readonly Float32Array[],
): MediaEntry & { readonly file: ReturnType<typeof memoryFile> } {
  const file = memoryFile(
    writeWav({
      sampleRate: asset.sampleRate,
      encoding: { kind: 'float', bits: 32 },
      channels: samples,
    }),
  );
  return {
    asset: asset.id,
    identity: `memory:${asset.id}`,
    sampleRate: asset.sampleRate,
    channels: samples.length,
    length: asset.length,
    file,
  };
}

/** Everything a source holds, read in blocks of `size`. */
async function readAll(source: PcmSource, size: number): Promise<Float32Array[]> {
  const length = source.length ?? 0;
  const out = source.layout.roles.map(() => new Float32Array(length));
  const block = allocateBlock(source.layout, source.sampleRate, size);
  for (let start = 0; start < length; start += size) {
    const read = await source.read(derivedSampleCount(start), block);
    block.channels.forEach((channel, index) => out[index]?.set(channel.subarray(0, read), start));
  }
  return out;
}

function bitsOf(channels: readonly Float32Array[]): number[][] {
  return channels.map((channel) => [
    ...new Uint32Array(channel.buffer, channel.byteOffset, channel.length),
  ]);
}

const id = (name: string) => unsafeBrandId<'EditOperationId'>(`0000ffff-${name}`);

describe('an edited source', () => {
  const samples = samplesOf(5_000, 2, 3);
  const source = assetOf('source', 5_000, RATE, StandardLayouts.stereo);
  const copied = expectSuccess(
    slicePlan(expectSuccess(assetPlan(source, PLAN_WITHOUT_CHAINS)), 1_000, 1_600),
  );
  const edited: Asset = {
    ...source,
    edits: [
      {
        id: id('cut'),
        kind: 'delete',
        range: { start: derivedSampleCount(200), end: derivedSampleCount(900) },
      },
      {
        id: id('turn'),
        kind: 'reverse',
        range: { start: derivedSampleCount(1_000), end: derivedSampleCount(2_500) },
      },
      {
        id: id('paste'),
        kind: 'insert',
        at: derivedSampleCount(3_000),
        payload: copied,
        convertRate: false,
      },
      {
        id: id('fade'),
        kind: 'process',
        range: { start: derivedSampleCount(2_000), end: derivedSampleCount(3_300) },
        edit: { kind: 'fade', direction: 'out', shape: 'equal-power' },
      },
      {
        id: id('swap'),
        kind: 'process',
        range: { start: derivedSampleCount(100), end: derivedSampleCount(4_000) },
        edit: { kind: 'swap-channels', first: 0, second: 1 },
      },
    ],
  };

  it('reads the same bits as the plan rendered whole, whatever the block size', async () => {
    const expected = bitsOf(
      renderPlan(
        expectSuccess(assetPlan(edited, PLAN_WITHOUT_CHAINS)),
        new Map([[source.id, samples]]),
      ),
    );
    for (const size of [1, 97, 1_024, 10_000]) {
      const made = expectSuccess(
        editedSource(
          expectSuccess(assetPlan(edited, PLAN_WITHOUT_CHAINS)),
          [entryOf(source, samples)],
          StandardLayouts.stereo,
          REFERENCE_DSP,
          PLAIN_PLAN_PROCESSING,
        ),
      );
      expect(bitsOf(await readAll(made, size)), `blocks of ${String(size)}`).toEqual(expected);
    }
  });

  it('hears a stretched range at its new length, and what is around it unchanged and moved', async () => {
    const long = samplesOf(9_600, 2, 5);
    const plain = assetOf('long', 9_600, RATE, StandardLayouts.stereo);
    const stretched: Asset = {
      ...plain,
      edits: [
        {
          id: id('stretch'),
          kind: 'stretch',
          range: { start: derivedSampleCount(2_000), end: derivedSampleCount(6_000) },
          length: derivedSampleCount(8_000),
        },
      ],
    };
    const made = expectSuccess(
      editedSource(
        expectSuccess(assetPlan(stretched, PLAN_WITHOUT_CHAINS)),
        [entryOf(plain, long)],
        StandardLayouts.stereo,
        REFERENCE_DSP,
        PLAIN_PLAN_PROCESSING,
      ),
    );
    expect(made.length).toBe(13_600);
    const [left] = await readAll(made, 1_000);
    const heard = left ?? new Float32Array();
    expect(bitsOf([heard.subarray(0, 2_000)])).toEqual(
      bitsOf([(long[0] ?? heard).subarray(0, 2_000)]),
    );
    expect(bitsOf([heard.subarray(10_000)])).toEqual(bitsOf([(long[0] ?? heard).subarray(6_000)]));
    const middle = heard.subarray(4_000, 8_000);
    expect(middle.some((sample) => Math.abs(sample) > 0.1)).toBe(true);
  });

  it('reads only the bytes of the frames it is asked for', async () => {
    const entry = entryOf(source, samples);
    const made = expectSuccess(
      editedSource(
        expectSuccess(assetPlan(source, PLAN_WITHOUT_CHAINS)),
        [entry],
        StandardLayouts.stereo,
        REFERENCE_DSP,
        PLAIN_PLAN_PROCESSING,
      ),
    );
    await made.read(derivedSampleCount(4_000), allocateBlock(StandardLayouts.stereo, RATE, 100));
    // The header, then one range of a hundred stereo 32-bit frames.
    expect(entry.file.asked()).toBeLessThan(entry.file.size / 4);
  });

  it('hears audio pasted from another rate through the canonical resampler, converted as one stream', async () => {
    const quiet = samplesOf(441, 2, 7);
    const other = assetOf('other', 441, OTHER, StandardLayouts.stereo);
    const payload = expectSuccess(
      slicePlan(expectSuccess(assetPlan(other, PLAN_WITHOUT_CHAINS)), 0, 441),
    );
    const pasted: Asset = {
      ...source,
      edits: [
        {
          id: id('paste'),
          kind: 'insert',
          at: derivedSampleCount(100),
          payload,
          convertRate: true,
        },
      ],
    };
    const made = expectSuccess(
      editedSource(
        expectSuccess(assetPlan(pasted, PLAN_WITHOUT_CHAINS)),
        [entryOf(source, samples), entryOf(other, quiet)],
        StandardLayouts.stereo,
        REFERENCE_DSP,
        PLAIN_PLAN_PROCESSING,
      ),
    );
    const heard = await readAll(made, 256);
    const converted = expectSuccess(
      resampledSource(
        REFERENCE_DSP,
        expectSuccess(
          memorySource(expectSuccess(frameBlock(StandardLayouts.stereo, OTHER, quiet))),
        ),
        RATE,
        ResamplingQuality.Maximum,
      ),
    );
    const expected = await readAll(converted, 480);
    expect(heard[0]?.length).toBe(5_480);
    expect(bitsOf(heard.map((channel) => channel.subarray(100, 580)))).toEqual(bitsOf(expected));
    expect(bitsOf(heard.map((channel) => channel.subarray(0, 100)))).toEqual(
      bitsOf(samples.map((channel) => channel.subarray(0, 100))),
    );
  });

  it('refuses a file that no longer has the rate its asset recorded', async () => {
    const entry = { ...entryOf(source, samples), sampleRate: OTHER };
    const made = expectSuccess(
      editedSource(
        expectSuccess(assetPlan({ ...source, sampleRate: OTHER }, PLAN_WITHOUT_CHAINS)),
        [entry],
        StandardLayouts.stereo,
        REFERENCE_DSP,
        PLAIN_PLAN_PROCESSING,
      ),
    );
    const reading = made.read(
      derivedSampleCount(0),
      allocateBlock(StandardLayouts.stereo, OTHER, 10),
    );
    await expect(reading).rejects.toBeInstanceOf(MediaReadFailure);
    await expect(reading).rejects.toMatchObject({ failure: { code: 'media.not-recorded-file' } });
  });

  it('stops a read that is cancelled', async () => {
    const made = expectSuccess(
      editedSource(
        expectSuccess(assetPlan(edited, PLAN_WITHOUT_CHAINS)),
        [entryOf(source, samples)],
        StandardLayouts.stereo,
        REFERENCE_DSP,
        PLAIN_PLAN_PROCESSING,
      ),
    );
    const controller = new AbortController();
    controller.abort(new Error('Stopped.'));
    await expect(
      made.read(
        derivedSampleCount(0),
        allocateBlock(StandardLayouts.stereo, RATE, 10),
        controller.signal,
      ),
    ).rejects.toThrow('Stopped.');
  });

  it('reads on after a read cancelled while its file was opening', async () => {
    const entry = entryOf(source, samples);
    const held = heldFile(entry.file);
    const made = expectSuccess(
      editedSource(
        expectSuccess(assetPlan(source, PLAN_WITHOUT_CHAINS)),
        [{ ...entry, file: held }],
        StandardLayouts.stereo,
        REFERENCE_DSP,
        PLAIN_PLAN_PROCESSING,
      ),
    );
    const controller = new AbortController();
    const block = allocateBlock(StandardLayouts.stereo, RATE, 10);

    const cancelled = made.read(derivedSampleCount(0), block, controller.signal);
    controller.abort(new Error('Stopped.'));
    held.let();

    await expect(cancelled).rejects.toThrow('Stopped.');
    await expect(made.read(derivedSampleCount(0), block)).resolves.toBe(10);
    expect(block.channels[0]?.[3]).toBe(samples[0]?.[3]);
  });

  it('opens its file again after an opening that failed', async () => {
    const entry = entryOf(source, samples);
    let failing = true;
    const flaky: MediaFile = {
      size: entry.file.size,
      slice: (start, end) => ({
        arrayBuffer: () =>
          failing
            ? Promise.reject(new Error('The file could not be reached.'))
            : entry.file.slice(start, end).arrayBuffer(),
      }),
    };
    const made = expectSuccess(
      editedSource(
        expectSuccess(assetPlan(source, PLAN_WITHOUT_CHAINS)),
        [{ ...entry, file: flaky }],
        StandardLayouts.stereo,
        REFERENCE_DSP,
        PLAIN_PLAN_PROCESSING,
      ),
    );
    const block = allocateBlock(StandardLayouts.stereo, RATE, 10);

    await expect(made.read(derivedSampleCount(0), block)).rejects.toThrow();
    failing = false;

    await expect(made.read(derivedSampleCount(0), block)).resolves.toBe(10);
  });

  it('refuses a plan that reads a file it was not given', () => {
    expect(
      expectFailureCode(
        editedSource(
          expectSuccess(assetPlan(edited, PLAN_WITHOUT_CHAINS)),
          [],
          StandardLayouts.stereo,
          REFERENCE_DSP,
          PLAIN_PLAN_PROCESSING,
        ),
      ),
    ).toBe('editing.plan-malformed');
  });
});

describe('an edited description crossing a thread', () => {
  const samples = samplesOf(100, 2, 5);
  const source = assetOf('crossing', 100, RATE, StandardLayouts.stereo);

  it('reads back the plan and the files it was sent with, and makes their source', async () => {
    // The file crosses as the page holds it, a Blob, which a structured clone
    // carries by reference to the same bytes.
    const bytes = writeWav({
      sampleRate: RATE,
      encoding: { kind: 'float', bits: 32 },
      channels: samples,
    });
    const description = {
      kind: PcmDescriptionKind.Edited,
      sampleRate: RATE,
      plan: expectSuccess(assetPlan(source, PLAN_WITHOUT_CHAINS)),
      media: [{ ...entryOf(source, samples), file: new Blob([new Uint8Array(bytes)]) }],
    };
    const read = expectSuccess(pcmDescription(structuredClone(description)));
    expect(read.kind).toBe(PcmDescriptionKind.Edited);
    const made = expectSuccess(
      describedSource(read, StandardLayouts.stereo, REFERENCE_DSP, PLAIN_PLAN_PROCESSING),
    );
    expect(bitsOf(await readAll(made, 33))).toEqual(bitsOf(samples));
  });

  it('refuses a plan that is not one, and media that are not files', () => {
    expect(
      expectFailureCode(
        pcmDescription({ kind: 'edited', sampleRate: 48_000, plan: { streams: 'no' }, media: [] }),
      ),
    ).toBe('pcm.description-unreadable');
    expect(
      expectFailureCode(
        pcmDescription({
          kind: 'edited',
          sampleRate: 48_000,
          plan: expectSuccess(assetPlan(source, PLAN_WITHOUT_CHAINS)),
          media: [{ asset: source.id }],
        }),
      ),
    ).toBe('pcm.description-unreadable');
  });
});
