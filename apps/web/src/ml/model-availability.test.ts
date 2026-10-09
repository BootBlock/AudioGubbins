import { afterEach, describe, expect, it, vi } from 'vitest';

import { processorsOf } from '@audiogubbins/domain';
import { MemorySource, sampleManifest } from '@audiogubbins/model-packs/testing';
import { sine } from '@audiogubbins/test-fixtures';

import { projectWorld } from '../testing/project-context.js';
import {
  holdPlatformFiles,
  rackedWithDeepFilterNet,
  windowWithAudio,
} from '../testing/project-audio.js';

holdPlatformFiles();

/**
 * A project that names a model pack this browser does not hold (REQ-AUDIO-139,
 * ADR-0062): opening it, and racking a sound with the processor that needs the
 * pack, fetches nothing, however the page and the storage worker behind it are
 * composed, the pack manager's catalogue among them, and the project stays as
 * it is, its instance and settings kept, while what the processor would make is
 * shown as unavailable, saying which condition holds.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

// Each test imports audio and runs its storage worker in the test's own
// thread, which takes seconds under the whole suite's load.
describe(
  'a project naming a model pack this browser does not hold',
  { timeout: 30_000, tags: ['ml-locality'] },
  () => {
    it('fetches nothing, keeps the project, and says the sound cannot be heard for want of the model', async () => {
      const requests: unknown[] = [];
      vi.stubGlobal('fetch', (...asked: unknown[]) => {
        requests.push(asked);
        return Promise.reject(new TypeError('No request may be made.'));
      });
      // A catalogue that offers the very pack the processor needs.
      const offered = new MemorySource([
        { manifest: sampleManifest({ id: 'deepfilternet-3' }), files: new Map() },
      ]);
      const audio = await windowWithAudio({
        world: projectWorld(undefined, () => offered),
        fixture: sine(440, { length: 48_000 }),
        name: 'Voice',
      });
      // Followed, as the page follows what is kept once anything shows it.
      audio.window.packs.subscribe(() => undefined);

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
      expect(offered.catalogues).toBe(0);
      expect(offered.reads).toEqual([]);
      expect(audio.window.packs.get().catalogue).toEqual({ kind: 'unasked' });
    });

    it('fetches nothing as a project naming the pack is opened again, and says the sound cannot be heard', async () => {
      const offered = new MemorySource([
        { manifest: sampleManifest({ id: 'deepfilternet-3' }), files: new Map() },
      ]);
      const audio = await windowWithAudio({
        world: projectWorld(undefined, () => offered),
        fixture: sine(440, { length: 48_000 }),
        name: 'Voice',
      });
      audio.window.packs.subscribe(() => undefined);
      const rack = await rackedWithDeepFilterNet(audio);
      const { window } = audio;
      const project = window.projects.project.session()?.project ?? '';
      await window.runAndHear('file.close-project');
      // Recorded from before the project is opened, which reads its chains.
      const requests: unknown[] = [];
      vi.stubGlobal('fetch', (...asked: unknown[]) => {
        requests.push(asked);
        return Promise.reject(new TypeError('No request may be made.'));
      });

      await window.runAndHear('file.open', { project });

      const catalogue = window.context.assets;
      await expect
        .poll(() => catalogue.get().unopened.get(audio.entry)?.reason, { timeout: 5000 })
        .toMatch(/^DeepFilterNet 3 cannot run because the model it needs is not available\. /);
      const state = window.projects.project.session()?.getSnapshot().model.state;
      expect(state?.project.effectChains.get(rack.id)).toEqual(rack);
      expect(requests).toEqual([]);
      expect(offered.catalogues).toBe(0);
      expect(offered.reads).toEqual([]);
    });

    it('opens a sound whose rack bypasses the processor, since a processor that does not run needs no model', async () => {
      const audio = await windowWithAudio({
        fixture: sine(440, { length: 48_000 }),
        name: 'Voice',
      });
      const before = audio.asset();

      await rackedWithDeepFilterNet(audio, { enabled: false });

      const opened = await audio.changed(before);
      expect(opened.id).toBe(audio.entry);
      expect(audio.window.context.assets.get().unopened.has(audio.entry)).toBe(false);
    });
  },
);
