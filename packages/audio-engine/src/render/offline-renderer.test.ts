import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  labelledLayout,
  mapResult,
  sampleRate,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { createCancellationSource, Cancelled } from '../cancellation.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { BUILT_IN_NODES } from '../nodes/built-in-nodes.js';
import { BuiltInNodeType } from '../nodes/built-in-node-type.js';
import type { MeterReading } from '../nodes/node-implementation.js';
import { countingDsp } from '../testing/counting-dsp.js';
import { graphOf, named, nodeOf, wire } from '../testing/graph-builders.js';
import { collectingSink, distinctAudio, jobOf, sourceOf } from '../testing/render-harness.js';
import { renderOffline } from './offline-renderer.js';
import type { RenderProgress } from './render-job.js';

const STEMS: ChannelLayout = expectSuccess(labelledLayout(['kick', 'snare', 'bass', 'vocal']));

/** input → gain → output, all of `layout`. */
function through(layout: ChannelLayout) {
  return graphOf(
    [
      nodeOf('in', BuiltInNodeType.GraphInput, layout, { outputs: ['out'] }),
      nodeOf('unity', BuiltInNodeType.Gain, layout, { inputs: ['in'], outputs: ['out'] }),
      nodeOf('out', BuiltInNodeType.Output, layout, { inputs: ['in'] }),
    ],
    [wire('in.out', 'unity.in'), wire('unity.out', 'out.in')],
  );
}

describe('the offline renderer', () => {
  it.each([
    ['mono', StandardLayouts.mono],
    ['stereo', StandardLayouts.stereo],
    ['5.1', StandardLayouts.surround5_1],
    ['a custom labelled layout', STEMS],
  ])('renders %s without truncating or reordering a channel', async (_name, layout) => {
    const audio = distinctAudio(layout, 2_500);
    const out = collectingSink();
    expectSuccess(
      await renderOffline(
        jobOf(through(layout), {
          sources: { in: sourceOf(audio) },
          sinks: { out },
          length: 2_500,
          chunkFrames: 700,
        }),
        REFERENCE_DSP,
        BUILT_IN_NODES,
      ),
    );
    expect(out.channels()).toEqual(audio.channels);
  });

  it('holds one chunk at a time, reports progress and hands control back between chunks', async () => {
    const out = collectingSink();
    const progress: RenderProgress[] = [];
    let yielded = 0;
    expectSuccess(
      await renderOffline(
        jobOf(through(StandardLayouts.stereo), {
          sources: { in: sourceOf(distinctAudio(StandardLayouts.stereo, 1_000)) },
          sinks: { out },
          length: 1_000,
          chunkFrames: 300,
        }),
        REFERENCE_DSP,
        BUILT_IN_NODES,
        {
          onProgress: (step) => progress.push(step),
          yieldToHost: () => {
            yielded += 1;
            return Promise.resolve();
          },
        },
      ),
    );
    expect(out.writes()).toBe(4);
    expect(progress.map((step) => step.framesRendered)).toEqual([300, 600, 900, 1_000]);
    expect(progress.every((step) => step.framesTotal === 1_000)).toBe(true);
    expect(yielded).toBe(4);
  });

  it('delivers each meter what it measured', async () => {
    const layout = StandardLayouts.stereo;
    const readings: { peak: number[]; frames: number }[] = [];
    const graph = graphOf(
      [
        nodeOf('in', BuiltInNodeType.GraphInput, layout, { outputs: ['out'] }),
        nodeOf('level', BuiltInNodeType.Meter, layout, { inputs: ['in'] }),
        nodeOf('out', BuiltInNodeType.Output, layout, { inputs: ['in'] }),
      ],
      [wire('in.out', 'level.in'), wire('in.out', 'out.in')],
    );
    const job = {
      ...jobOf(graph, {
        sources: { in: sourceOf(distinctAudio(layout, 400)) },
        sinks: { out: collectingSink() },
        length: 400,
        chunkFrames: 200,
      }),
      meters: new Map([
        [
          named('level'),
          {
            receive: (reading: MeterReading) =>
              readings.push({ peak: [...reading.peak], frames: reading.frames }),
          },
        ],
      ]),
    };
    expectSuccess(await renderOffline(job, REFERENCE_DSP, BUILT_IN_NODES));
    expect(readings.map((reading) => reading.frames)).toEqual([200, 200]);
    expect(readings[1]?.peak).toEqual([(1_000 + 399) / 65_536, (2_000 + 399) / 65_536]);
  });

  it('refuses a job it cannot render, saying why', async () => {
    const layout = StandardLayouts.stereo;
    const source = sourceOf(distinctAudio(layout, 10));
    const render = (job: Parameters<typeof renderOffline>[0]) =>
      renderOffline(job, REFERENCE_DSP, BUILT_IN_NODES).then(expectFailureCode);

    expect(
      await render(
        jobOf(through(layout), {
          sources: { in: source },
          sinks: { out: collectingSink() },
          length: 10,
          chunkFrames: 0,
        }),
      ),
    ).toBe('render.chunk-invalid');
    expect(
      await render(jobOf(through(layout), { sources: { in: source }, sinks: {}, length: 10 })),
    ).toBe('render.sink-unbound');
    expect(
      await render(
        jobOf(through(layout), {
          sources: { in: source, elsewhere: source },
          sinks: { out: collectingSink() },
          length: 10,
        }),
      ),
    ).toBe('render.source-unplaced');
    expect(
      await render(jobOf(through(layout), { sinks: { out: collectingSink() }, length: 10 })),
    ).toBe('node.feed-unbound');
    expect(
      await render(
        // A graph with no sink, whose audio would go nowhere.
        jobOf(
          graphOf([nodeOf('in', BuiltInNodeType.GraphInput, layout, { outputs: ['out'] })], []),
          {
            sinks: {},
            length: 10,
          },
        ),
      ),
    ).toBe('render.graph-refused');
  });

  it('stops between chunks when cancelled, releasing what it made', async () => {
    const { dsp, held } = countingDsp();
    const layout = StandardLayouts.stereo;
    const slower = expectSuccess(
      mapResult(sampleRate(44_100), (rate) => distinctAudio(layout, 10_000, rate)),
    );
    const cancellation = createCancellationSource();
    const rendering = renderOffline(
      jobOf(through(layout), {
        sources: { in: sourceOf(slower) },
        sinks: { out: collectingSink() },
        length: 9_000,
        chunkFrames: 1_000,
      }),
      dsp,
      BUILT_IN_NODES,
      {
        signal: cancellation.signal,
        onProgress: (step) => {
          if (step.framesRendered === 2_000) cancellation.cancel();
        },
      },
    );
    await expect(rendering).rejects.toBeInstanceOf(Cancelled);
    expect(held()).toBe(0);
  });
});
