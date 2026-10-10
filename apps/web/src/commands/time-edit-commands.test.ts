import { describe, expect, it } from 'vitest';

import {
  ENGINE_VERSIONS,
  REFERENCE_DSP,
  allocateBlock,
  describedSource,
} from '@audiogubbins/audio-engine';
import { PLAIN_PLAN_PROCESSING } from '@audiogubbins/audio-engine/testing';
import {
  derivedSampleCount,
  silencePlan,
  type EditOperation,
  type Region,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { PanelKinds, panelsIn } from '@audiogubbins/workspace';

import type { EditorAsset } from '../assets/editor-asset.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';

holdPlatformFiles();

const RATE = 48_000;
const LENGTH = 6 * RATE;
const SELECTED = { start: 48_000, end: 96_000 };

/** The loop imported, open in an editor a thousand pixels wide. */
async function editedLoop(
  regions: readonly { readonly name: string; readonly start: number; readonly end: number }[] = [],
): Promise<AudioWindow> {
  const audio = await windowWithAudio({ regions });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', { width: 1000, height: 300 }, audio.asset().length);
  context.editorViews.focus('editor');
  return audio;
}

function chainOf(audio: AudioWindow): readonly EditOperation[] {
  return audio.session.getSnapshot().model.state.project.assets.get(audio.assetId)?.edits ?? [];
}

function regionsOf(audio: AudioWindow): readonly Region[] {
  return [...audio.session.getSnapshot().model.state.project.regions.values()];
}

/** What `id` refused with `args`, which must be a refusal, and that it changed nothing. */
function refusalOf(
  audio: AudioWindow,
  id: string,
  args?: Readonly<Record<string, string | number>>,
): string {
  const outcome = audio.window.run(id, args);
  if (outcome.kind !== 'refused') throw new Error(`${id} was not refused.`);
  expect(chainOf(audio)).toEqual([]);
  return outcome.failures[0].summary;
}

/** Frames `[start, end)` of `asset`'s sound, read as the engine reads it, through its plan. */
async function framesOf(
  asset: EditorAsset,
  start: number,
  end: number,
): Promise<readonly Float32Array[]> {
  const source = expectSuccess(
    describedSource(asset.describe(), asset.layout, REFERENCE_DSP, PLAIN_PLAN_PROCESSING),
  );
  const block = allocateBlock(asset.layout, asset.sampleRate, end - start);
  const read = await source.read(derivedSampleCount(start), block);
  source.release();
  expect(read).toBe(end - start);
  return block.channels;
}

/** The bits of each channel, so a −0 is told from a +0. */
function bitsOf(channels: readonly Float32Array[]): number[][] {
  return channels.map((channel) => [
    ...new Uint32Array(channel.buffer, channel.byteOffset, channel.length),
  ]);
}

/** Whether the panel the person works in is the Inspector. */
function inInspector(audio: AudioWindow): boolean {
  const { layout } = audio.window.context.workspace.get();
  return panelsIn(layout).some(
    (panel) => panel.kind === PanelKinds.Inspector && panel.id === layout.activePanelId,
  );
}

describe('edit.insert-silence (REQ-AUDIO-018)', () => {
  it('inserts a second of digital silence at the playhead, at the asset’s rate and channels', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.set-playhead', { position: 24_000 });
    const before = audio.asset();

    const said = await audio.window.runAndHear('edit.insert-silence');

    expect(said).toBe('Inserted 0:01.000 of silence into Loop.');
    const [operation] = chainOf(audio);
    expect(chainOf(audio)).toHaveLength(1);
    expect(operation).toMatchObject({
      kind: 'insert',
      at: 24_000,
      payload: silencePlan(before.sampleRate, before.layout, derivedSampleCount(RATE)),
    });
    expect(operation).not.toHaveProperty('resampler');
    const after = await audio.changed(before);
    expect(after.length).toBe(LENGTH + RATE);
    expect(bitsOf(await framesOf(after, 24_000, 24_000 + RATE))).toEqual(
      bitsOf([new Float32Array(RATE), new Float32Array(RATE)]),
    );
    expect(bitsOf(await framesOf(after, 24_000 + RATE, 24_000 + RATE + 500))).toEqual(
      bitsOf(await framesOf(before, 24_000, 24_500)),
    );
  });

  it('replaces the selected range with the length named, as one change one undo takes back', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', SELECTED);

    expect(await audio.window.runAndHear('edit.insert-silence', { seconds: 0.25 })).toBe(
      'Replaced the selection with 0:00.250 of silence.',
    );
    expect(chainOf(audio)).toEqual([
      expect.objectContaining({ kind: 'delete', range: SELECTED }),
      expect.objectContaining({ kind: 'insert', at: SELECTED.start }),
    ]);
    const [, insertion] = chainOf(audio);
    expect(insertion?.kind === 'insert' && insertion.payload.streams[0].segments[0]?.length).toBe(
      12_000,
    );

    await audio.window.runAndHear('edit.undo');
    expect(chainOf(audio)).toEqual([]);
  });

  it('refuses a length that is no number above zero, or shorter than a frame, never moving it into range', async () => {
    const audio = await editedLoop();

    for (const seconds of [0, -1, Number.NaN]) {
      expect(refusalOf(audio, 'edit.insert-silence', { seconds })).toBe(
        'A length of silence is a number above zero.',
      );
    }
    expect(refusalOf(audio, 'edit.insert-silence', { seconds: 'long' })).toBe(
      'A length of silence is a number above zero.',
    );
    expect(refusalOf(audio, 'edit.insert-silence', { seconds: 1e-6 })).toMatch(
      /^A length of silence is at least one frame/,
    );
  });

  it('refuses to replace a range selected on some channels alone, as a paste over it is refused', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', { ...SELECTED, channels: '0' });

    expect(refusalOf(audio, 'edit.insert-silence')).toMatch(
      /^A change of time acts on every channel/,
    );
    audio.window.run('edit.copy');
    expect(refusalOf(audio, 'edit.paste')).toMatch(/^A change of time acts on every channel/);
  });

  it('inserts into the asset from a region’s view, and says so', async () => {
    const audio = await editedLoop([{ name: 'Body', start: 48_000, end: 240_000 }]);
    const [region] = regionsOf(audio);
    if (region === undefined) throw new Error('No region.');
    audio.window.run('region.open', { region: region.id });
    audio.window.run('editor.set-playhead', { position: 1_000 });

    expect(await audio.window.runAndHear('edit.insert-silence')).toMatch(/changes all of “Loop”/);
    expect(chainOf(audio)).toEqual([expect.objectContaining({ kind: 'insert', at: 49_000 })]);
  });
});

describe('edit.stretch (REQ-AUDIO-018)', () => {
  it('stretches the selected range by a ratio, by this build’s stretch', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', SELECTED);

    expect(await audio.window.runAndHear('edit.stretch', { ratio: 1.5 })).toBe(
      'Stretched 0:01.000 of Loop to 0:01.500.',
    );
    expect(chainOf(audio)).toEqual([
      expect.objectContaining({
        kind: 'stretch',
        range: SELECTED,
        length: 72_000,
        version: ENGINE_VERSIONS.stretch,
      }),
    ]);
  });

  it('stretches the whole sound to a length in seconds with nothing selected', async () => {
    const audio = await editedLoop();
    const before = audio.asset();

    await audio.window.runAndHear('edit.stretch', { seconds: 3 });

    expect(chainOf(audio)).toEqual([
      expect.objectContaining({
        kind: 'stretch',
        range: { start: 0, end: LENGTH },
        length: 144_000,
      }),
    ]);
    expect((await audio.changed(before)).length).toBe(144_000);
  });

  it('opens the Inspector to ask for a value it was not given', async () => {
    const audio = await editedLoop();
    expect(inInspector(audio)).toBe(false);

    expect(refusalOf(audio, 'edit.stretch')).toBe(
      'Say the length to stretch to, or the ratio to stretch by. Type it in the Inspector, under Time and rate.',
    );
    expect(inInspector(audio)).toBe(true);
  });

  it('says what to type when the Inspector is the panel in use already, rather than that it is open', async () => {
    // Seen in the browser: the Inspector's own refusal to open again was said
    // in place of what to type in it.
    const audio = await editedLoop();
    audio.window.run(`workspace.show-${PanelKinds.Inspector}`);
    expect(inInspector(audio)).toBe(true);

    expect(refusalOf(audio, 'edit.stretch')).toBe(
      'Say the length to stretch to, or the ratio to stretch by. Type it in the Inspector, under Time and rate.',
    );
    expect(refusalOf(audio, 'edit.convert-rate')).toBe(
      'Say the sample rate to convert to. Choose it in the Inspector, under Time and rate.',
    );
  });

  it('refuses a stretch past what one can make, both values, and a value that is no number above zero', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', SELECTED);

    expect(refusalOf(audio, 'edit.stretch', { ratio: 8.5 })).toBe(
      'A stretch changes a length by at most 8 times either way, so 0:01.000 stretches to between 0:00.125 and 0:08.000.',
    );
    expect(refusalOf(audio, 'edit.stretch', { seconds: 0.1 })).toMatch(
      /^A stretch changes a length by at most 8/,
    );
    expect(refusalOf(audio, 'edit.stretch', { seconds: 2, ratio: 2 })).toBe(
      'Give a length to stretch to or a ratio to stretch by, not both.',
    );
    expect(refusalOf(audio, 'edit.stretch', { ratio: -2 })).toBe(
      'A ratio to stretch by is a number above zero.',
    );
    expect(refusalOf(audio, 'edit.stretch', { seconds: 'slow' })).toBe(
      'A length to stretch to is a number above zero.',
    );
  });

  it('changes nothing for the length the range has already', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', SELECTED);

    expect(audio.window.run('edit.stretch', { ratio: 1 })).toMatchObject({ kind: 'unchanged' });
    expect(chainOf(audio)).toEqual([]);
  });

  it('refuses to stretch some channels alone', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', { ...SELECTED, channels: '1' });

    expect(refusalOf(audio, 'edit.stretch', { ratio: 2 })).toMatch(
      /^A change of time acts on every channel/,
    );
  });
});

describe('edit.convert-rate (REQ-AUDIO-018, REQ-ARCH-085)', () => {
  it('converts the whole asset by this build’s resampler, its regions kept in place', async () => {
    const audio = await editedLoop([{ name: 'Body', start: 48_000, end: 96_000 }]);
    const before = audio.asset();

    expect(await audio.window.runAndHear('edit.convert-rate', { rate: 44_100 })).toBe(
      'Converted Loop from 48 kHz to 44.1 kHz.',
    );
    expect(chainOf(audio)).toEqual([
      expect.objectContaining({
        kind: 'convert-rate',
        sampleRate: 44_100,
        version: ENGINE_VERSIONS.resampler,
      }),
    ]);
    const after = await audio.changed(before);
    expect(after.sampleRate).toBe(44_100);
    expect(after.length).toBe(LENGTH * (44_100 / 48_000));
    expect(after.regions.map((region) => [region.start, region.length])).toEqual([
      [44_100, 44_100],
    ]);
  });

  it('refuses a rate no audio can have, and one that is no whole number', async () => {
    const audio = await editedLoop();

    expect(refusalOf(audio, 'edit.convert-rate', { rate: 7_999 })).toBe(
      'A sample rate must be between 8000 and 768000 Hz.',
    );
    expect(refusalOf(audio, 'edit.convert-rate', { rate: 44_100.5 })).toBe(
      'A sample rate must be a whole number of frames per second.',
    );
    expect(refusalOf(audio, 'edit.convert-rate', { rate: '44100' })).toBe(
      'A sample rate is a whole number of hertz, such as 48000.',
    );
  });

  it('changes nothing for the rate the asset is at, and asks in the Inspector for none', async () => {
    const audio = await editedLoop();

    expect(audio.window.run('edit.convert-rate', { rate: RATE })).toMatchObject({
      kind: 'unchanged',
    });
    expect(inInspector(audio)).toBe(false);
    expect(refusalOf(audio, 'edit.convert-rate')).toBe(
      'Say the sample rate to convert to. Choose it in the Inspector, under Time and rate.',
    );
    expect(inInspector(audio)).toBe(true);
  });
});
