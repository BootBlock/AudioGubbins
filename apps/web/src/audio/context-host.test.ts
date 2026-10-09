import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { fakeContextHost } from '../testing/recording-fakes.js';

function host() {
  return fakeContextHost(
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('audio'),
  );
}

describe("the page's one audio context", () => {
  it('is shared by playback and an input joining it, so they keep one clock', () => {
    const { host: shared } = host();
    const played = shared.own('balanced', 48_000);
    const joined = shared.join({ replaced: () => undefined }, 'interactive');
    expect(joined.lifecycle).toBe(played.lifecycle);
  });

  it('is kept for an input after playback lets go, and closed once nothing holds it', async () => {
    const { host: shared, contexts } = host();
    const played = shared.own('balanced', undefined);
    const joined = shared.join({ replaced: () => undefined }, 'balanced');
    expect(joined.lifecycle.context().ok).toBe(true);
    played.release();
    expect(shared.current()).toBe(joined.lifecycle);
    joined.release();
    await Promise.resolve();
    expect(shared.current()).toBeUndefined();
    expect(contexts[0]?.closes).toBe(1);
  });

  it('is made again for playback at another rate, telling the input first', () => {
    const { host: shared } = host();
    const told: string[] = [];
    const joined = shared.join({ replaced: () => told.push('replaced') }, 'balanced');
    expect(joined.lifecycle.context().ok).toBe(true);
    const played = shared.own('balanced', 96_000);
    expect(told).toEqual(['replaced']);
    expect(played.lifecycle).not.toBe(joined.lifecycle);
  });

  it('keeps the context for playback at the rate it already runs at', () => {
    const { host: shared } = host();
    const told: string[] = [];
    const joined = shared.join({ replaced: () => told.push('replaced') }, 'balanced');
    expect(joined.lifecycle.context().ok).toBe(true);
    expect(shared.own('balanced', 48_000).lifecycle).toBe(joined.lifecycle);
    expect(told).toEqual([]);
  });

  it('refuses a second owner, which would be playback asking twice without letting go', () => {
    const { host: shared } = host();
    shared.own('balanced', undefined);
    expect(() => shared.own('balanced', undefined)).toThrow('owned already');
  });
});
