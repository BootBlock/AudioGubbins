import { describe, expect, it } from 'vitest';

import { FadeShape, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import {
  checkLoopRequest,
  defaultLoopSearch,
  type AnalysedLoop,
  type LoopAnalysisRequest,
  type LoopSearch,
} from './loop-request.js';

const RATE = expectSuccess(sampleRate(48_000));
const REGION = 100_000;

function loop(start: number, end: number, crossfadeLength = 0): AnalysedLoop {
  return { start, end, crossfadeLength, crossfadeShape: FadeShape.Linear };
}

function codeOf(request: LoopAnalysisRequest): string | undefined {
  const checked = checkLoopRequest(request, REGION, RATE);
  return checked.ok ? undefined : checked.failures[0].code;
}

function searching(search: Partial<LoopSearch>): LoopAnalysisRequest {
  return { loop: loop(10_000, 50_000), search: { ...defaultLoopSearch(RATE), ...search } };
}

describe('a loop analysis request', () => {
  it('searches 20 ms either way, the length free, for five candidates, unless asked otherwise', () => {
    expect(defaultLoopSearch(RATE)).toEqual({
      radiusFrames: 960,
      keepLength: false,
      candidates: 5,
    });
  });

  it('refuses a loop that is not inside the region, start before end', () => {
    expect(codeOf({ loop: loop(-1, 500) })).toBe('loop.outside-region');
    expect(codeOf({ loop: loop(0, REGION + 1) })).toBe('loop.outside-region');
    expect(codeOf({ loop: loop(500, 500) })).toBe('loop.outside-region');
    expect(codeOf({ loop: loop(0.5, 500) })).toBe('loop.outside-region');
    expect(codeOf({ loop: loop(0, REGION) })).toBeUndefined();
  });

  it('refuses a loop shorter than 16 frames', () => {
    expect(codeOf({ loop: loop(100, 115) })).toBe('loop.too-short');
    expect(codeOf({ loop: loop(100, 116) })).toBeUndefined();
  });

  it('refuses a crossfade longer than the audio before the start or than the loop', () => {
    expect(codeOf({ loop: loop(100, 1_000, 101) })).toBe('loop.crossfade-without-lead');
    expect(codeOf({ loop: loop(5_000, 5_100, 101) })).toBe('loop.crossfade-without-lead');
    expect(codeOf({ loop: loop(100, 1_000, 100) })).toBeUndefined();
  });

  it('refuses a search radius under a frame or over two seconds', () => {
    expect(codeOf(searching({ radiusFrames: 0 }))).toBe('loop.search-radius-invalid');
    expect(codeOf(searching({ radiusFrames: 96_001 }))).toBe('loop.search-radius-invalid');
    expect(codeOf(searching({ radiusFrames: 10.5 }))).toBe('loop.search-radius-invalid');
    expect(codeOf(searching({ radiusFrames: 96_000 }))).toBeUndefined();
  });

  it('refuses a search for fewer than one candidate or more than sixteen', () => {
    expect(codeOf(searching({ candidates: 0 }))).toBe('loop.search-candidates-invalid');
    expect(codeOf(searching({ candidates: 17 }))).toBe('loop.search-candidates-invalid');
    expect(codeOf(searching({ candidates: 16 }))).toBeUndefined();
  });
});
