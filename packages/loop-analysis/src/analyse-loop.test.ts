import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP, type PcmSource } from '@audiogubbins/audio-engine';
import { FailureKind, createCancellationSource, derivedSampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { analyseLoop, type LoopTools } from './analyse-loop.js';
import { defaultLoopSearch, type LoopAnalysisRequest } from './loop-request.js';
import { fixtureSource, seamlessSine } from './testing/loop-fixtures.js';

/**
 * A search measures hundreds of pairs: a second or two alone, and several
 * under the whole suite's load, past Vitest's five-second default.
 */
const SEARCHING = { timeout: 60_000 };

const FIXTURE = seamlessSine();
const SOURCE = fixtureSource(FIXTURE);
const REQUEST: LoopAnalysisRequest = {
  loop: FIXTURE.loop,
  search: defaultLoopSearch(FIXTURE.sampleRate),
};

function tools(overrides: Partial<LoopTools> = {}): LoopTools {
  return {
    dsp: REFERENCE_DSP,
    signal: createCancellationSource().signal,
    yieldToHost: () => Promise.resolve(),
    onProgress: () => undefined,
    ...overrides,
  };
}

async function failureOf(
  heard: PcmSource,
  plain: PcmSource,
  overrides: Partial<LoopTools> = {},
): Promise<{ readonly code: string; readonly kind: string } | undefined> {
  const result = await analyseLoop(heard, plain, REQUEST, tools(overrides));
  return result.ok ? undefined : { code: result.failures[0].code, kind: result.failures[0].kind };
}

describe('a loop analysis that cannot finish', SEARCHING, () => {
  it('is cancelled before it reads', async () => {
    const cancellation = createCancellationSource();
    cancellation.cancel();
    expect(await failureOf(SOURCE, SOURCE, { signal: cancellation.signal })).toEqual({
      code: 'loop.cancelled',
      kind: FailureKind.Retryable,
    });
  });

  it('is cancelled part way, as soon as it next looks', async () => {
    const cancellation = createCancellationSource();
    let reported = 0;
    const failed = await failureOf(SOURCE, SOURCE, {
      signal: cancellation.signal,
      onProgress: () => {
        reported += 1;
        if (reported === 2) cancellation.cancel();
      },
    });
    expect(failed?.code).toBe('loop.cancelled');
    expect(reported).toBe(2);
  });

  it("fails with the source's reason where a read fails, and where it ends early", async () => {
    const failing: PcmSource = { ...SOURCE, read: () => Promise.reject(new Error('disk gone')) };
    expect(await failureOf(failing, SOURCE)).toEqual({
      code: 'loop.read-failed',
      kind: FailureKind.Retryable,
    });
    const short: PcmSource = { ...SOURCE, read: () => Promise.resolve(10) };
    expect((await failureOf(SOURCE, short))?.code).toBe('loop.read-failed');
  });

  it('refuses two sources that cannot be one region heard two ways', async () => {
    const shorter: PcmSource = { ...SOURCE, length: derivedSampleCount(FIXTURE.loop.end) };
    expect((await failureOf(SOURCE, shorter))?.code).toBe('loop.sources-differ');
    const endless: PcmSource = { ...SOURCE, length: undefined };
    expect((await failureOf(endless, endless))?.code).toBe('loop.sources-differ');
  });
});

describe('a finished loop analysis', SEARCHING, () => {
  it('reports progress that never goes back and ends at its total', async () => {
    const reports: [number, number][] = [];
    expectSuccess(
      await analyseLoop(
        SOURCE,
        SOURCE,
        REQUEST,
        tools({ onProgress: (done, total) => reports.push([done, total]) }),
      ),
    );
    expect(reports.length).toBeGreaterThan(2);
    reports.forEach(([done, total], index) => {
      expect(total).toBe(reports[0]?.[1]);
      expect(done).toBeGreaterThanOrEqual(reports[index - 1]?.[0] ?? 0);
    });
    const [done, total] = reports[reports.length - 1] ?? [0, 1];
    expect(done).toBe(total);
  });

  it('measures the seam on the audio heard, and the crossfade on the audio without it', async () => {
    // Heard, the seamless sine; without its crossfade, the same with the span
    // that fades in silent, which correlates with nothing.
    const crossfadeLength = 480;
    const [samples] = FIXTURE.channels;
    const silenced = Float32Array.from(samples ?? []);
    silenced.fill(0, FIXTURE.loop.start - crossfadeLength, FIXTURE.loop.start);
    const plain = fixtureSource({ ...FIXTURE, channels: [silenced] });
    const analysis = expectSuccess(
      await analyseLoop(SOURCE, plain, { loop: { ...FIXTURE.loop, crossfadeLength } }, tools()),
    );
    expect(analysis.current.discontinuity.verdict).toBe('pass');
    expect(analysis.current.crossfade?.correlation).toBe(0);
    expect(analysis.current.crossfade?.lengthFrames).toBe(crossfadeLength);
  });

  it('hands back the heard tail and head of the seam, W frames each', async () => {
    const analysis = expectSuccess(
      await analyseLoop(SOURCE, SOURCE, { loop: FIXTURE.loop }, tools()),
    );
    const { start, end } = FIXTURE.loop;
    const window = analysis.windowFrames;
    const [samples] = FIXTURE.channels;
    expect(analysis.seam.tail).toEqual([samples?.slice(end - window, end)]);
    expect(analysis.seam.head).toEqual([samples?.slice(start, start + window)]);
    expect(analysis.candidates).toEqual([]);
  });

  it('is the same value analysed twice', async () => {
    expect(await analyseLoop(SOURCE, SOURCE, REQUEST, tools())).toEqual(
      await analyseLoop(SOURCE, SOURCE, REQUEST, tools()),
    );
  });
});
