import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  derivedSampleCount,
  processorsOf,
  type EditOperation,
  type EffectChain,
} from '@audiogubbins/domain';
import { FAULTY_LENGTH, faultySignal } from '@audiogubbins/detection-runtime/testing';
import { TEST_RATE } from '@audiogubbins/processors/testing';
import type { SignalFixture } from '@audiogubbins/test-fixtures';

import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';

holdPlatformFiles();

/** Four seconds of music with clicks, clipping, hum and hiss, as a WAV file holds it. */
const SCRATCHY: SignalFixture = {
  name: 'scratchy',
  sampleRate: TEST_RATE,
  channelLayout: StandardLayouts.mono,
  channels: [faultySignal()],
  length: derivedSampleCount(FAULTY_LENGTH),
};

/** The scratchy recording imported, open in an editor a thousand pixels wide. */
async function openScratchy(
  regions: readonly { readonly name: string; readonly start: number; readonly end: number }[] = [],
): Promise<AudioWindow> {
  const audio = await windowWithAudio({ fixture: SCRATCHY, name: 'Scratchy', regions });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', 1000, audio.asset().length);
  context.editorViews.focus('editor');
  return audio;
}

/** Analyses what the editor shows, as selected, and settles once the assistants have answered. */
async function analyse(audio: AudioWindow, target = audio.entry): Promise<void> {
  await audio.window.runAndHear('analysis.detect');
  await expect
    .poll(() => audio.window.context.detection.of(target)?.kind, { timeout: 20_000 })
    .toBe('done');
}

function stateOf(audio: AudioWindow) {
  return audio.session.getSnapshot().model;
}

function chainsOf(audio: AudioWindow): readonly EffectChain[] {
  return [...stateOf(audio).state.project.effectChains.values()];
}

function editsOf(audio: AudioWindow): readonly EditOperation[] {
  return stateOf(audio).state.project.assets.get(audio.assetId)?.edits ?? [];
}

function rackOf(audio: AudioWindow) {
  return stateOf(audio).state.project.assets.get(audio.assetId)?.rack;
}

function typesOf(chain: EffectChain | undefined): readonly string[] {
  return chain === undefined ? [] : [...processorsOf(chain.slots)].map((one) => one.typeKey);
}

/** How many detections the window's worker was asked to read. */
function detectionsRead(audio: AudioWindow): number {
  return audio.window.detectionWorkers
    .flatMap((worker) => worker.sent)
    .filter((message) => message.kind === 'detect').length;
}

// Each test imports four seconds of audio and analyses it with every assistant
// on the reference DSP, in the test's own thread, which takes seconds under
// the whole suite's load.
describe('applying what the assistants recommend', { timeout: 60_000 }, () => {
  it('gives the whole asset the recommended chain as its rack, in one step one undo reverses', async () => {
    const audio = await openScratchy();
    await analyse(audio);
    const before = stateOf(audio).history.cursor;

    const said = await audio.window.runAndHear('analysis.apply', { assistant: 'repair' });

    expect(said).toBe('Applied the Repair recommendation to all of Scratchy: de-click.');
    const [chain] = chainsOf(audio);
    expect(chainsOf(audio)).toHaveLength(1);
    expect(typesOf(chain)).toEqual(['de-click']);
    expect(rackOf(audio)).toBe(chain?.id);
    const { history } = stateOf(audio);
    const step = history.nodes.get(history.cursor);
    expect(step?.kind === 'change' ? [step.parent, step.description] : []).toEqual([
      before,
      'Apply the Repair recommendation',
    ]);

    await audio.window.runAndHear('edit.undo');

    expect(stateOf(audio).history.cursor).toBe(before);
    expect(chainsOf(audio)).toEqual([]);
    expect(rackOf(audio)).toBeUndefined();
  });

  it('processes the selected range it analysed as a rack edit, its noise profile learned', async () => {
    const audio = await openScratchy();
    const range = { start: 24_000, end: 120_000 };
    audio.window.run('editor.select-time', range);
    await analyse(audio);

    await audio.window.runAndHear('analysis.apply', { assistant: 'restoration' });

    const [chain] = chainsOf(audio);
    expect(typesOf(chain)).toEqual(['de-hum', 'noise-reduction']);
    const noise = chain?.slots[1];
    expect(noise?.kind === 'processor' ? noise.state?.kind : undefined).toBe('noise-profile');
    expect(editsOf(audio)).toEqual([
      expect.objectContaining({ kind: 'process', range, edit: { kind: 'rack', chain: chain?.id } }),
    ]);
    expect(rackOf(audio)).toBeUndefined();

    await audio.window.runAndHear('edit.undo');

    expect(chainsOf(audio)).toEqual([]);
    expect(editsOf(audio)).toEqual([]);
  });

  it('makes a region’s range its own processing, in the asset’s frames', async () => {
    const audio = await openScratchy([{ name: 'Middle', start: 24_000, end: 168_000 }]);
    const [region] = stateOf(audio).state.project.regions.values();
    if (region === undefined) throw new Error('No region.');
    audio.window.run('region.open', { region: region.id });
    audio.window.run('editor.select-time', { start: 0, end: 48_000 });
    await analyse(audio, `region:${region.id}`);

    await audio.window.runAndHear('analysis.apply', { assistant: 'repair' });

    const [chain] = chainsOf(audio);
    expect(editsOf(audio)).toEqual([]);
    expect(stateOf(audio).state.project.regions.get(region.id)?.operations).toEqual([
      expect.objectContaining({
        basis: 0,
        range: { start: 24_000, end: 72_000 },
        edit: { kind: 'rack', chain: chain?.id },
      }),
    ]);
  });

  it('keeps a rack the asset had before the treatment, in a chain of the asset’s own', async () => {
    const audio = await openScratchy();
    await analyse(audio);
    await audio.window.runAndHear('analysis.apply', { assistant: 'repair' });
    const [first] = chainsOf(audio);
    // Analysed again as it now sounds, with its de-click.
    await analyse(audio);

    await audio.window.runAndHear('analysis.apply', { assistant: 'restoration' });

    const [rack] = chainsOf(audio);
    expect(chainsOf(audio)).toHaveLength(1);
    expect(rackOf(audio)).toBe(rack?.id);
    expect(rack?.id).not.toBe(first?.id);
    expect(typesOf(rack)).toEqual(['de-click', 'de-hum', 'noise-reduction']);
    const [kept] = rack?.slots ?? [];
    expect(kept?.id).not.toBe(first?.slots[0]?.id);

    await audio.window.runAndHear('edit.undo');

    expect(chainsOf(audio).map((chain) => chain.id)).toEqual([first?.id]);
    expect(rackOf(audio)).toBe(first?.id);
  });

  it('refuses to apply what was found in audio an edit has changed since', async () => {
    const audio = await openScratchy();
    await analyse(audio);
    await audio.window.runAndHear('analysis.apply', { assistant: 'repair' });

    const again = audio.window.run('analysis.apply', { assistant: 'repair' });

    expect(again).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            'Scratchy has changed since it was analysed. Analyse it again before applying what was found.',
        },
      ],
    });
  });

  it('refuses an assistant that recommends nothing, and one it was not asked to run', async () => {
    const audio = await openScratchy();
    await analyse(audio);

    expect(audio.window.run('analysis.apply', { assistant: 'classification' })).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'The Classification assistant recommends nothing to apply.' }],
    });
    expect(audio.window.run('analysis.apply', { assistant: 'mastering' })).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'Name an assistant whose recommendation to apply.' }],
    });
  });
});

describe('analysing the audio', { timeout: 60_000 }, () => {
  it('reads an unchanged asset once, again after an edit, and not again once it is undone', async () => {
    const audio = await openScratchy();
    await analyse(audio);
    expect(detectionsRead(audio)).toBe(1);

    const changed = audio.changed(audio.asset());
    await audio.window.runAndHear('edit.louder');
    await changed;
    await analyse(audio);
    expect(detectionsRead(audio)).toBe(2);

    const restored = audio.changed(audio.asset());
    await audio.window.runAndHear('edit.undo');
    await restored;
    await analyse(audio);
    expect(detectionsRead(audio)).toBe(2);
  });

  it('finds the asset already analysed as it is, and says so rather than reading it again', async () => {
    const audio = await openScratchy();
    await analyse(audio);

    expect(audio.window.run('analysis.detect')).toMatchObject({
      kind: 'unchanged',
    });
    expect(detectionsRead(audio)).toBe(1);
  });

  it('stops a detection it is asked to, forgetting it', async () => {
    const audio = await openScratchy();
    await audio.window.runAndHear('analysis.detect');
    expect(audio.window.context.detection.of(audio.entry)?.kind).toBe('running');

    expect(await audio.window.runAndHear('analysis.cancel')).toBe('Stopped analysing Scratchy.');

    expect(audio.window.context.detection.of(audio.entry)).toBeUndefined();
    expect(audio.window.run('analysis.cancel')).toMatchObject({ kind: 'refused' });
  });
});
