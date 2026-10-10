import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  labelledLayout,
  sampleCount,
  type ChannelLayout,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  BUILT_IN_NODES,
  frameBlock,
  memorySource,
  renderOffline,
  type RenderSink,
} from '@audiogubbins/audio-engine';
import { countingDsp } from '@audiogubbins/audio-engine/testing';

import { defaultExportSettings } from './default-settings.js';
import { planExport, type PlannedFile } from './export-plan.js';
import type { ExportSettings } from './export-settings.js';
import { FIRST_REGION, contextOf, rate } from './testing/export-fixtures.js';

const CLOCK = { epochMilliseconds: Date.UTC(2026, 9, 10, 12), utcOffsetMinutes: 0 };

function planned(settings: ExportSettings, context = contextOf()): readonly PlannedFile[] {
  return expectSuccess(planExport(settings, context, CLOCK));
}

function only(files: readonly PlannedFile[]): PlannedFile {
  const [file] = files;
  if (file === undefined || files.length !== 1) throw new Error('Expected one planned file.');
  return file;
}

/** Each channel `c` a ramp of `frames` frames, `(c + 1) / 8 · frame / frames`. */
function ramps(layout: ChannelLayout, frames: number, hertz: SampleRate) {
  const channels = layout.roles.map((_, channel) =>
    Float32Array.from(
      { length: frames },
      (_value, frame) => ((channel + 1) / 8) * (frame / frames),
    ),
  );
  return expectSuccess(frameBlock(layout, hertz, channels));
}

/** Renders a planned file through the engine from `audio`, every frame of each channel. */
async function rendered(
  file: PlannedFile,
  audio: ReturnType<typeof ramps>,
): Promise<Float32Array[]> {
  const parts: Float32Array[][] = [];
  const sink: RenderSink = {
    write: (block) => {
      block.channels.forEach((channel, index) =>
        (parts[index] ??= []).push(channel.slice(0, block.frames)),
      );
      return Promise.resolve();
    },
  };
  expectSuccess(
    await renderOffline(
      {
        graph: file.render.graph,
        sampleRate: file.render.sampleRate,
        sources: new Map([[file.render.input, expectSuccess(memorySource(audio))]]),
        sinks: new Map([[file.render.output, sink]]),
        range: file.render.range,
        quality: MAXIMUM_QUALITY,
        chunkFrames: 256,
      },
      countingDsp().dsp,
      BUILT_IN_NODES,
    ),
  );
  return parts.map((pieces) => Float32Array.from(pieces.flatMap((piece) => [...piece])));
}

describe('planning an export', () => {
  it('refuses settings that cannot be made, before anything is planned', () => {
    const settings = { ...defaultExportSettings('opus', contextOf()), sampleRate: rate(44_100) };
    expect(expectFailureCode(planExport(settings, contextOf(), CLOCK))).toBe(
      'import-export.sample-rate-unsupported',
    );
  });

  it('plans a file for each region, named by the template, in timeline order', () => {
    const files = planned({
      ...defaultExportSettings('flac', contextOf()),
      range: { kind: 'every-region' },
      fileName: '{project} {index} {region} {date}',
    });
    expect(files.map((file) => file.name)).toEqual([
      { stem: 'Door slam 1 Slam 2026-10-10', extension: 'flac' },
      { stem: 'Door slam 2 Creak 2026-10-10', extension: 'flac' },
    ]);
    expect(files.map((file) => file.render.range)).toEqual([
      { start: 1_000, length: 20_000 },
      { start: 40_000, length: 30_000 },
    ]);
    expect(files.every((file) => file.target.codec === 'flac')).toBe(true);
  });

  it('places the range at the export rate by the rule for a change of rate', () => {
    const file = only(
      planned(
        {
          ...defaultExportSettings('wav', contextOf({ hertz: 44_100 })),
          sampleRate: rate(48_000),
          range: { kind: 'region', region: FIRST_REGION },
          fileName: '{region}',
        },
        contextOf({ hertz: 44_100 }),
      ),
    );
    // 1000 × 48000 / 44100 = 1088.4 → 1088; 21000 × 48000 / 44100 = 22857.1 → 22857.
    expect(file.render.range).toEqual({ start: 1_088, length: 22_857 - 1_088 });
    expect(file.render.sampleRate).toBe(48_000);
  });

  it('renders the channels as they are where nothing is converted', async () => {
    const context = contextOf();
    const file = only(planned(defaultExportSettings('wav', context), context));
    expect(file.render.graph.nodes).toHaveLength(2);
    expect(file.render.layout).toEqual(StandardLayouts.stereo);
    const audio = ramps(StandardLayouts.stereo, context.source.length, context.source.sampleRate);
    const [left, right] = await rendered(file, audio);
    expect(left).toEqual(audio.channels[0]);
    expect(right).toEqual(audio.channels[1]);
  });

  it("downmixes 5.1 through the engine's ITU-R BS.775 matrix", async () => {
    const context = contextOf({ layout: StandardLayouts.surround5_1 });
    const file = only(
      planned(
        {
          ...defaultExportSettings('wav', context),
          channels: { kind: 'matrix', matrix: 'itu-bs775-5.1-to-stereo' },
        },
        context,
      ),
    );
    expect(file.render.layout).toEqual(StandardLayouts.stereo);
    const audio = ramps(StandardLayouts.surround5_1, 4_800, context.source.sampleRate);
    const [left = new Float32Array()] = await rendered(
      {
        ...file,
        render: {
          ...file.render,
          range: { ...file.render.range, length: expectSuccess(sampleCount(audio.frames)) },
        },
      },
      audio,
    );
    const at = 4_000;
    const input = (channel: number): number => audio.channels[channel]?.[at] ?? 0;
    expect(left[at]).toBe(
      Math.fround(input(0) + input(2) * Math.SQRT1_2 + input(4) * Math.SQRT1_2),
    );
  });

  it('folds by role, encodes mid and side, and extracts a channel, each as a node', () => {
    const context = contextOf();
    const fold = only(
      planned({
        ...defaultExportSettings('wav', context),
        channels: { kind: 'fold', to: StandardLayouts.mono },
      }),
    );
    expect(fold.render.graph.nodes.find((node) => node.id === 'export-conversion')).toMatchObject({
      type: 'matrix',
      settings: { coefficients: [0.5, 0.5] },
    });
    const surround = contextOf({ layout: StandardLayouts.surround5_1 });
    const folded = only(
      planned(
        {
          ...defaultExportSettings('wav', surround),
          channels: { kind: 'fold', to: StandardLayouts.stereo },
        },
        surround,
      ),
    );
    const half = Math.SQRT1_2;
    expect(folded.render.graph.nodes.find((node) => node.id === 'export-conversion')).toMatchObject(
      {
        settings: { coefficients: [1, 0, half, 0, half, 0, 0, 1, half, 0, 0, half] },
      },
    );
    const midSide = only(
      planned({
        ...defaultExportSettings('wav', context),
        channels: { kind: 'matrix', matrix: 'mid-side-encode' },
      }),
    );
    expect(midSide.render.layout).toEqual(expectSuccess(labelledLayout(['mid', 'side'])));
    const right = only(
      planned({
        ...defaultExportSettings('wav', context),
        channels: { kind: 'map', channels: [1], to: StandardLayouts.mono },
      }),
    );
    expect(right.render.graph.nodes.find((node) => node.id === 'export-conversion')).toMatchObject({
      type: 'channel-map',
      settings: { map: [1] },
    });
  });
});
