import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP, type PcmSource } from '@audiogubbins/audio-engine';
import { createCancellationSource } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { analyseLoop, heardCapture } from './analyse-loop.js';
import { searchCapture } from './candidate-search.js';
import { capturedFrames } from './loop-capture.js';
import { defaultLoopSearch } from './loop-request.js';
import { fixtureSource, seamlessSine } from './testing/loop-fixtures.js';

/**
 * A search measures hundreds of pairs: a second or two alone, and several
 * under the whole suite's load, past Vitest's five-second default.
 */
const SEARCHING = { timeout: 60_000 };

/** A source that records the frames of every read made of it. */
function counted(source: PcmSource): {
  readonly source: PcmSource;
  readonly reads: [number, number][];
} {
  const reads: [number, number][] = [];
  return {
    reads,
    source: {
      ...source,
      read: (start, into, signal) => {
        reads.push([start, start + into.frames]);
        return source.read(start, into, signal);
      },
    },
  };
}

/** Whether no frame of `reads` is read twice. */
function disjoint(reads: readonly (readonly [number, number])[]): boolean {
  const sorted = [...reads].sort((a, b) => a[0] - b[0]);
  return sorted.every(([from], index) => index === 0 || from >= (sorted[index - 1]?.[1] ?? 0));
}

describe('what a loop analysis reads', SEARCHING, () => {
  it('reads each source once, in bounded chunks, however many pairs it measures', async () => {
    const fixture = seamlessSine();
    const regionLength = fixture.channels[0]?.length ?? 0;
    const crossfadeLength = 480;
    const loop = { ...fixture.loop, crossfadeLength };
    const search = defaultLoopSearch(fixture.sampleRate);
    const heard = counted(fixtureSource(fixture));
    const plain = counted(fixtureSource(fixture));
    const analysis = expectSuccess(
      await analyseLoop(
        heard.source,
        plain.source,
        { loop, search },
        {
          dsp: REFERENCE_DSP,
          signal: createCancellationSource().signal,
          yieldToHost: () => Promise.resolve(),
          onProgress: () => undefined,
        },
      ),
    );
    expect(analysis.candidates.length).toBeGreaterThan(0);
    for (const [from, to] of [...heard.reads, ...plain.reads]) {
      expect(to - from).toBeLessThanOrEqual(32_768);
    }
    // The loop heard: one pass over it and its margins.
    expect(disjoint(heard.reads)).toBe(true);
    expect(heard.reads.reduce((frames, [from, to]) => frames + to - from, 0)).toBe(
      capturedFrames(heardCapture(loop, regionLength, fixture.sampleRate)),
    );
    // The loop without its crossfade: the crossfade's two spans, then one pass
    // the search measures every pair from.
    const [fadingOut, fadingIn, ...pass] = plain.reads;
    expect(fadingOut).toEqual([loop.end - crossfadeLength, loop.end]);
    expect(fadingIn).toEqual([loop.start - crossfadeLength, loop.start]);
    expect(disjoint(pass)).toBe(true);
    expect(pass.reduce((frames, [from, to]) => frames + to - from, 0)).toBe(
      capturedFrames(searchCapture(loop, search, regionLength, fixture.sampleRate)),
    );
  });
});
