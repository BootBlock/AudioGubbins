import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { fakeContextHost } from '../testing/recording-fakes.js';
import type { ContextReplacement } from './context-host.js';

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
    const joined = shared.join({ replaced: (why) => told.push(why.kind) }, 'balanced');
    expect(joined.lifecycle.context().ok).toBe(true);
    const played = shared.own('balanced', 96_000);
    expect(told).toEqual(['playback']);
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

  it('is made again at the rate the person chose, telling the input why first', () => {
    const { host: shared, contexts } = host();
    const told: ContextReplacement[] = [];
    const joined = shared.join({ replaced: (why) => told.push(why) }, 'balanced');
    expect(joined.lifecycle.context().ok).toBe(true);

    shared.chooseRate(44_100);

    expect(told).toEqual([{ kind: 'rate-chosen', rate: 44_100 }]);
    expect(contexts[0]?.closes).toBe(1);
    // The next input to join, and playback of what has no rate, run at the rate chosen.
    const rejoined = shared.join({ replaced: () => undefined }, 'balanced');
    expect(expectSuccess(rejoined.lifecycle.context()).sampleRate).toBe(44_100);
    expect(shared.own('balanced', undefined).lifecycle).toBe(rejoined.lifecycle);
  });

  it('keeps a context already at the rate chosen', () => {
    const { host: shared } = host();
    const told: string[] = [];
    const joined = shared.join({ replaced: (why) => told.push(why.kind) }, 'balanced');
    expect(joined.lifecycle.context().ok).toBe(true);
    shared.chooseRate(48_000);
    expect(told).toEqual([]);
    expect(shared.current()).toBe(joined.lifecycle);
  });

  it("lets playback of an asset make the context at the asset's own rate over the rate chosen", () => {
    const { host: shared } = host();
    shared.chooseRate(44_100);
    const told: string[] = [];
    const joined = shared.join({ replaced: (why) => told.push(why.kind) }, 'balanced');
    const played = shared.own('balanced', 96_000);
    expect(told).toEqual(['playback']);
    expect(played.lifecycle).not.toBe(joined.lifecycle);
  });

  it('refuses to choose a rate under playback, which lets go of its context first', () => {
    const { host: shared } = host();
    shared.own('balanced', 48_000).lifecycle.context();
    expect(() => {
      shared.chooseRate(44_100);
    }).toThrow('playback lets go of it');
  });

  it('refuses a second owner, which would be playback asking twice without letting go', () => {
    const { host: shared } = host();
    shared.own('balanced', undefined);
    expect(() => shared.own('balanced', undefined)).toThrow('owned already');
  });
});
