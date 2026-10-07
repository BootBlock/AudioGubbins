import { afterEach, describe, expect, it, vi } from 'vitest';

import { processorsOf } from '@audiogubbins/domain';
import { sine } from '@audiogubbins/test-fixtures';

import {
  holdPlatformFiles,
  rackedWithDeepFilterNet,
  windowWithAudio,
} from '../testing/project-audio.js';

holdPlatformFiles();

/**
 * A project that names a model pack this browser does not hold
 * (REQ-AUDIO-139, ADR-0062): opening it, and racking a sound with the
 * processor that needs the pack, fetches nothing, however the page and the
 * storage worker behind it are composed, and the project stays as it is, its
 * instance and settings kept, while what the processor would make is shown as
 * unavailable, saying which condition holds.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

// Each test imports audio and runs its storage worker in the test's own
// thread, which takes seconds under the whole suite's load.
describe('a project naming a model pack this browser does not hold', { timeout: 30_000 }, () => {
  it('fetches nothing, keeps the project, and says the sound cannot be heard for want of the model', async () => {
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', (...asked: unknown[]) => {
      requests.push(asked);
      return Promise.reject(new TypeError('No request may be made.'));
    });
    const audio = await windowWithAudio({ fixture: sine(440, { length: 48_000 }), name: 'Voice' });

    const rack = await rackedWithDeepFilterNet(audio);

    const catalogue = audio.window.context.assets;
    await expect
      .poll(() => catalogue.get().unopened.get(audio.entry)?.reason, { timeout: 5000 })
      .toMatch(/^DeepFilterNet 3 cannot run because the model it needs is not available\. /);
    expect(catalogue.find(audio.entry)).toBeUndefined();
    const { state } = audio.session.getSnapshot().model;
    expect(
      [...processorsOf(state.project.effectChains.get(rack.id)?.slots ?? [])].map(
        (one) => one.typeKey,
      ),
    ).toEqual(['deepfilternet-3']);
    expect(requests).toEqual([]);
  });

  it('opens a sound whose rack bypasses the processor, since a processor that does not run needs no model', async () => {
    const audio = await windowWithAudio({ fixture: sine(440, { length: 48_000 }), name: 'Voice' });
    const before = audio.asset();

    await rackedWithDeepFilterNet(audio, { enabled: false });

    const opened = await audio.changed(before);
    expect(opened.id).toBe(audio.entry);
    expect(audio.window.context.assets.get().unopened.has(audio.entry)).toBe(false);
  });
});
