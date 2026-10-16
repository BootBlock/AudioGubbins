import { beforeAll, describe, expect, it } from 'vitest';

import { PcmDescriptionKind, REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { FadeShape, MAXIMUM_QUALITY, createCancellationSource } from '@audiogubbins/domain';
import { crossingThreads } from '@audiogubbins/domain/testing';
import {
  analyseLoop,
  defaultLoopSearch,
  type LoopAnalysis,
  type LoopCandidate,
} from '@audiogubbins/loop-analysis';
import { fixtureSource, quarterPeriodShort } from '@audiogubbins/loop-analysis/testing';

import { readFromDetectionWorker, readToDetectionWorker } from './detection-message-reading.js';
import { FromDetectionWorkerKind, ToDetectionWorkerKind } from './detection-messages.js';

/**
 * A searched analysis of a loop a quarter period short with a crossfade, so
 * every part of an answer is present: the crossfade's suitability, five
 * candidates, the first given a suggested crossfade and the start moved for
 * it, as a whole-sound loop's is.
 */
let analysis: LoopAnalysis;

beforeAll(async () => {
  const fixture = quarterPeriodShort();
  const source = fixtureSource(fixture);
  const analysed = await analyseLoop(
    source,
    source,
    {
      loop: { ...fixture.loop, crossfadeLength: 480 },
      search: defaultLoopSearch(fixture.sampleRate),
    },
    {
      dsp: REFERENCE_DSP,
      signal: createCancellationSource().signal,
      yieldToHost: () => Promise.resolve(),
      onProgress: () => undefined,
    },
  );
  if (!analysed.ok) throw new Error(analysed.failures[0].summary);
  const [first, ...rest] = analysed.value.candidates;
  if (first === undefined) throw new Error('The search found no candidate.');
  const suggested: LoopCandidate = {
    ...first,
    crossfade: { lengthFrames: 240, shape: FadeShape.SCurve },
    makesRoomForCrossfade: true,
  };
  analysis = { ...analysed.value, candidates: [suggested, ...rest] };
}, 60_000);

/** `analysis` answered for a job, as it arrives on the page. */
function answered(value: unknown): unknown {
  const message = { kind: FromDetectionWorkerKind.LoopAnalysed, job: 'job-1', analysis: value };
  return structuredClone(message);
}

/** What reading `value` as an answer refuses, or `undefined` where it reads it. */
function refusal(value: unknown): string | undefined {
  const read = readFromDetectionWorker(answered(value));
  return read.ok ? undefined : read.failures[0].summary;
}

describe('reading a loop analysis from the worker', () => {
  it('reads every metric, candidate and seam array of a whole analysis as it was sent', () => {
    const read = readFromDetectionWorker(answered(analysis));

    expect(analysis.current.crossfade).toBeDefined();
    expect(analysis.candidates).toHaveLength(5);
    expect(read.ok ? read.value : read.failures).toEqual({
      kind: FromDetectionWorkerKind.LoopAnalysed,
      job: 'job-1',
      analysis,
    });
  });

  it('refuses a verdict, unit or reference it does not know', () => {
    const current = analysis.current;
    expect(refusal({ ...analysis, verdict: 'not-applicable' })).toMatch(/verdict/);
    expect(
      refusal({ ...analysis, current: { ...current, netDc: { ...current.netDc, unit: 'LUFS' } } }),
    ).toMatch(/unit/);
    expect(
      refusal({
        ...analysis,
        current: {
          ...current,
          discontinuity: { ...current.discontinuity, reference: 'elsewhere' },
        },
      }),
    ).toMatch(/discontinuity\.reference/);
  });

  it('refuses a metric that is not a finite number', () => {
    const current = analysis.current;
    expect(
      refusal({
        ...analysis,
        current: {
          ...current,
          cycleStability: {
            ...current.cycleStability,
            drift: { ...current.cycleStability.drift, value: Number.NaN },
          },
        },
      }),
    ).toMatch(/value/);
  });

  it('refuses a seam without a tail and a head for every channel', () => {
    expect(refusal({ ...analysis, seam: { ...analysis.seam, head: [] } })).toMatch(/seam/);
  });

  it('refuses more candidates than a search returns', () => {
    const many = Array.from({ length: 17 }, () => analysis.candidates[0]);
    expect(refusal({ ...analysis, candidates: many })).toMatch(/candidates/);
  });

  it('refuses a boundary moved by a fraction of a frame', () => {
    const [first] = analysis.candidates;
    const moved = { ...first, moved: { start: 0.5, end: 0 } };
    expect(refusal({ ...analysis, candidates: [moved] })).toMatch(/moved|start/);
  });
});

describe('reading a loop analysis request to the worker', () => {
  const description = {
    kind: PcmDescriptionKind.Pcm,
    sampleRate: 48_000,
    channels: [new Float32Array(16)],
  };

  /** A request to analyse `request`, as it arrives in the worker. */
  function requested(request: unknown): unknown {
    return crossingThreads(
      {
        kind: ToDetectionWorkerKind.AnalyseLoop,
        job: 'job-1',
        target: 'region:1',
        channels: 1,
        heard: description,
        plain: description,
        quality: MAXIMUM_QUALITY,
        request,
      },
      [],
    );
  }

  it('reads a loop alone, and a loop with a search', () => {
    const loop = { start: 100, end: 900, crossfadeLength: 50, crossfadeShape: FadeShape.Linear };
    const search = { radiusFrames: 960, keepLength: true, candidates: 3 };
    const alone = readToDetectionWorker(requested({ loop }));
    const searched = readToDetectionWorker(requested({ loop, search }));

    expect(alone.ok && alone.value.kind === 'analyse-loop' ? alone.value.request : alone).toEqual({
      loop,
    });
    expect(
      searched.ok && searched.value.kind === 'analyse-loop' ? searched.value.request : searched,
    ).toEqual({ loop, search });
  });

  it('refuses a crossfade shape the domain has not, and a boundary that is not a frame', () => {
    const loop = { start: 100, end: 900, crossfadeLength: 0, crossfadeShape: 'cubic' };
    expect(readToDetectionWorker(requested({ loop })).ok).toBe(false);
    expect(
      readToDetectionWorker(
        requested({ loop: { ...loop, crossfadeShape: FadeShape.Linear, start: -1 } }),
      ).ok,
    ).toBe(false);
  });
});
