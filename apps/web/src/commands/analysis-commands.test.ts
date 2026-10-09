import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  derivedSampleCount,
  processorsOf,
  treatmentChain,
  type EditOperation,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { LearnedState } from '@audiogubbins/detection-runtime';
import { FAULTY_LENGTH, faultySignal } from '@audiogubbins/detection-runtime/testing';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { TEST_RATE } from '@audiogubbins/processors/testing';
import { setRackInvocation } from '@audiogubbins/project-commands';
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

  it('learns a range’s noise profile from the audio a rack edit over it reads, before the asset’s rack', async () => {
    const audio = await openScratchy();
    const range = { start: 24_000, end: 120_000 };
    /** The noise reduction the Restoration assistant recommends for the range, and what it learned. */
    const noiseStep = async () => {
      audio.window.run('editor.select-time', range);
      await analyse(audio);
      const detection = audio.window.context.detection.of(audio.entry);
      const report =
        detection?.kind === 'done'
          ? detection.result.reports.find((one) => one.recommendation.assistant === 'restoration')
          : undefined;
      const index = report?.recommendation.steps.findIndex(
        (step) => step.typeKey === 'noise-reduction',
      );
      const learned: LearnedState | undefined =
        index === undefined ? undefined : report?.learned[index];
      return {
        learnFrom: index === undefined ? undefined : report?.recommendation.steps[index]?.learnFrom,
        state: learned?.kind === 'learned' ? learned.state : undefined,
      };
    };
    const unracked = await noiseStep();
    expect(unracked.state?.kind).toBe('noise-profile');

    // A rack 12 dB down, which the findings hear and a rack edit over the
    // range does not, since it acts before the rack.
    const quieter = expectSuccess(
      treatmentChain(
        [{ typeKey: 'gain', values: { gain: -12 } }],
        [undefined],
        PROCESSOR_CATALOGUE,
        audio.window.context.ids,
      ),
    );
    const asset = stateOf(audio).state.project.assets.get(audio.assetId);
    if (asset === undefined) throw new Error('The asset is in the project.');
    const changed = audio.changed(audio.asset());
    expectSuccess(await audio.session.run(setRackInvocation({ kind: 'asset', asset }, quieter)));
    await changed;
    const racked = await noiseStep();

    expect(racked.learnFrom).toEqual(unracked.learnFrom);
    expect(racked.state).toEqual(unracked.state);
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

/** Frames of `seconds` at the test rate. */
const seconds = (count: number): number => Math.round(count * TEST_RATE);

/**
 * Speech as far as the silence detector hears it: a −20 dBFS tone from 0.3 s
 * to 1.3 s and from 2.3 s to 3.3 s, digital silence before, between and after,
 * to 3.7 s.
 */
const PAUSED: SignalFixture = {
  name: 'paused',
  sampleRate: TEST_RATE,
  channelLayout: StandardLayouts.mono,
  channels: [
    Float32Array.from({ length: seconds(3.7) }, (_, frame) => {
      const sounding =
        (frame >= seconds(0.3) && frame < seconds(1.3)) ||
        (frame >= seconds(2.3) && frame < seconds(3.3));
      // From a crest, so each stretch of tone starts and ends loud.
      return sounding ? 0.1 * Math.cos((2 * Math.PI * 440 * frame) / TEST_RATE) : 0;
    }),
  ],
  length: derivedSampleCount(seconds(3.7)),
};

describe('removing the silence found', { timeout: 60_000 }, () => {
  async function openPaused(): Promise<AudioWindow> {
    const audio = await windowWithAudio({ fixture: PAUSED, name: 'Paused' });
    const { context } = audio.window;
    context.editorViews.open('editor', audio.asset());
    context.editorViews.measured('editor', 1000, audio.asset().length);
    context.editorViews.focus('editor');
    await analyse(audio);
    return audio;
  }

  it('trims the edges and shortens the pause as trim and delete edits, in one step one undo reverses', async () => {
    const audio = await openPaused();
    const before = stateOf(audio).history.cursor;

    const said = await audio.window.runAndHear('analysis.remove-silence');

    expect(said).toBe('Removed the silence from all of Paused: 3 stretches.');
    // The pause of a second keeps a quarter of it, an eighth either side.
    expect(editsOf(audio)).toEqual([
      expect.objectContaining({
        kind: 'delete',
        range: { start: seconds(1.3) + seconds(0.125), end: seconds(2.3) - seconds(0.125) },
      }),
      expect.objectContaining({
        kind: 'trim',
        range: { start: seconds(0.3), end: seconds(3.3) - seconds(0.75) },
      }),
    ]);
    const { history } = stateOf(audio);
    const step = history.nodes.get(history.cursor);
    expect(step?.kind === 'change' ? [step.parent, step.description] : []).toEqual([
      before,
      'Remove silence',
    ]);

    await audio.window.runAndHear('edit.undo');

    expect(editsOf(audio)).toEqual([]);
  });

  it('takes out only the edges, or only the pause, where asked', async () => {
    const audio = await openPaused();

    await audio.window.runAndHear('analysis.remove-silence', { part: 'edges' });
    expect(editsOf(audio)).toEqual([
      expect.objectContaining({
        kind: 'trim',
        range: { start: seconds(0.3), end: seconds(3.3) },
      }),
    ]);
    await audio.window.runAndHear('edit.undo');

    await audio.window.runAndHear('analysis.remove-silence', { part: 'within' });
    expect(editsOf(audio).map((edit) => edit.kind)).toEqual(['delete']);
  });

  it('refuses a part it does not know, and to take out silence found before an edit since', async () => {
    const audio = await openPaused();
    expect(audio.window.run('analysis.remove-silence', { part: 'middle' })).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'Name the silence to take out: at the edges, within, or both.' }],
    });
    await audio.window.runAndHear('analysis.remove-silence', { part: 'edges' });

    expect(audio.window.run('analysis.remove-silence', { part: 'within' })).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            'Paused has changed since it was analysed. Analyse it again before applying what was found.',
        },
      ],
    });
  });

  it('analyses again at settings other than the analysis used, rather than removing what it found', async () => {
    const audio = await openPaused();
    const first = audio.window.context.detection.of(audio.entry);

    const said = await audio.window.runAndHear('analysis.remove-silence', {
      part: 'within',
      'silence-shortest-pause': 0.9,
      'silence-pause-kept': 0.5,
    });

    expect(said).toBe(
      'Analysing all of Paused again at these settings. Remove the silence once the Analysis panel shows what was found.',
    );
    expect(editsOf(audio)).toEqual([]);
    const again = audio.window.context.detection.of(audio.entry);
    expect(again).not.toBe(first);
    expect(again?.detectors).toEqual({ silence: { 'shortest-pause': 0.9, 'pause-kept': 0.5 } });
    await expect
      .poll(() => audio.window.context.detection.of(audio.entry)?.kind, { timeout: 20_000 })
      .toBe('done');

    await audio.window.runAndHear('analysis.remove-silence', {
      part: 'within',
      'silence-shortest-pause': 0.9,
      'silence-pause-kept': 0.5,
    });

    // Half a second kept of the second-long pause, a quarter either side.
    expect(editsOf(audio)).toEqual([
      expect.objectContaining({
        kind: 'delete',
        range: { start: seconds(1.3) + seconds(0.25), end: seconds(2.3) - seconds(0.25) },
      }),
    ]);
  });

  it('refuses a silence setting out of its range, or that is no number, and changes nothing', async () => {
    const audio = await openPaused();
    expect(audio.window.run('analysis.remove-silence', { 'silence-threshold': -10 })).toMatchObject(
      {
        kind: 'refused',
        failures: [{ summary: "The Silence detector's threshold is from -120 to -20 dBFS." }],
      },
    );
    expect(audio.window.run('analysis.detect', { 'silence-shortest-pause': 'long' })).toMatchObject(
      {
        kind: 'refused',
        failures: [{ summary: 'The silence-shortest-pause setting is a number.' }],
      },
    );
    expect(
      audio.window.run('analysis.detect', { assistants: 'repair', 'silence-threshold': -50 }),
    ).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            'No assistant asked for runs the silence detector, so its settings cannot be used.',
        },
      ],
    });
    expect(editsOf(audio)).toEqual([]);
  });

  it('analyses again when a silence setting changes, and says it is current when none does', async () => {
    const audio = await openPaused();
    const said = (args: Record<string, number>) => audio.window.run('analysis.detect', args).kind;

    expect(said({ 'silence-threshold': -60 })).toBe('unchanged');
    expect(said({ 'silence-threshold': -50 })).toBe('applied');
    expect(audio.window.context.detection.of(audio.entry)?.detectors).toEqual({
      silence: { threshold: -50 },
    });
  });

  it('analyses again at a setting the scope the shown analysis used, whatever is selected now', async () => {
    const audio = await openPaused();
    const before = audio.window.context.detection.of(audio.entry);
    audio.window.run('editor.select-time', { start: 0, end: seconds(1) });

    const said = await audio.window.runAndHear('analysis.analyse-again', {
      'silence-shortest-pause': 2,
    });

    expect(said).toBe('Analysing all of Paused again at these settings.');
    const again = audio.window.context.detection.of(audio.entry);
    expect(again?.scope).toEqual(before?.scope);
    expect(again?.assistants).toEqual(before?.assistants);
    expect(again?.detectors).toEqual({ silence: { 'shortest-pause': 2 } });
    await expect
      .poll(() => audio.window.context.detection.of(audio.entry)?.kind, { timeout: 20_000 })
      .toBe('done');
    expect(audio.window.run('analysis.analyse-again', { 'silence-shortest-pause': 2 }).kind).toBe(
      'unchanged',
    );
  });

  it('refuses a pause kept not shorter than the shortest pause when the command runs, by the detector’s rule', async () => {
    const audio = await openPaused();
    const reason =
      'The pause kept must be shorter than the shortest pause, or no pause would be shortened.';
    const refused = { kind: 'refused', failures: [{ summary: reason }] };
    const first = audio.window.context.detection.of(audio.entry);

    expect(audio.window.run('analysis.detect', { 'silence-pause-kept': 0.5 })).toMatchObject(
      refused,
    );
    expect(
      audio.window.run('analysis.analyse-again', { 'silence-shortest-pause': 0.2 }),
    ).toMatchObject(refused);
    expect(
      audio.window.run('analysis.remove-silence', { 'silence-pause-kept': 0.75 }),
    ).toMatchObject(refused);
    expect(audio.window.context.detection.of(audio.entry)).toBe(first);
    expect(editsOf(audio)).toEqual([]);
  });
});
