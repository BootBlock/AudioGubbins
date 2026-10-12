/**
 * The spectral edits through their commands (ADR-0081, REQ-AUDIO-016): each
 * made of the spectral selection as one project change undo reverses, placed
 * over the selection widened by half a frame, its gain typed in decibels and
 * kept as a factor, its chain entering the project with it; refused with the
 * reason, and nothing changed, where the domain refuses it; compared with the
 * state before it, and heard as the original with it bypassed.
 */

import { describe, expect, it } from 'vitest';

import { decibelsToGain } from '@audiogubbins/audio-engine';
import {
  DEFAULT_SPECTRAL_RESOLUTION,
  MaskEffect,
  NO_FEATHER,
  spectralPlacement,
  type EditOperation,
  type Region,
  type SpectralMask,
  type SpectralOperationKind,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleCount } from '@audiogubbins/domain';

import { followPlayingAsset } from '../audio/playing-asset.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import type { projectWorld } from '../testing/project-context.js';

holdPlatformFiles();

const at = (frames: number) => expectSuccess(sampleCount(frames));

/** A rectangle of the loop's time and frequency, as a selection holds it. */
function area(start: number, end: number, low: number, high: number): SpectralMask {
  return {
    shapes: [
      {
        kind: 'rectangle',
        effect: MaskEffect.Add,
        range: { start: at(start), end: at(end) },
        band: { low, high },
      },
    ],
    feather: NO_FEATHER,
  };
}

const SELECTED = area(48_000, 96_000, 300, 900);

/** The loop imported, open in the editor in use, with `mask` selected on `channels`. */
async function selectedLoop(
  options: {
    readonly mask?: SpectralMask;
    readonly channels?: string;
    readonly world?: ReturnType<typeof projectWorld>;
  } = {},
): Promise<AudioWindow> {
  const audio = await windowWithAudio(options.world === undefined ? {} : { world: options.world });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', { width: 1000, height: 300 }, audio.asset().length);
  context.editorViews.focus('editor');
  const mask = options.mask ?? SELECTED;
  audio.window.run('editor.select-spectral', {
    mask: JSON.stringify({ shapes: mask.shapes, feather: mask.feather }),
    combination: 'replace',
    ...(options.channels === undefined ? {} : { channels: options.channels }),
  });
  return audio;
}

function chainOf(audio: AudioWindow): readonly EditOperation[] {
  return audio.session.getSnapshot().model.state.project.assets.get(audio.assetId)?.edits ?? [];
}

/** Where the domain places a spectral edit `kind` of `mask` at the default resolution. */
function placed(mask: SpectralMask, kind: SpectralOperationKind, length: number) {
  const placement = spectralPlacement(mask, DEFAULT_SPECTRAL_RESOLUTION, kind, length);
  if (placement === undefined) throw new Error('The area reaches no audio.');
  return placement;
}

describe('a spectral edit of the selection', () => {
  it.each([
    ['spectral.attenuate', {}, { kind: 'attenuate', gain: decibelsToGain(-12) }, 1],
    ['spectral.attenuate', { decibels: -6 }, { kind: 'attenuate', gain: decibelsToGain(-6) }, 1],
    // The platform's power of ten gives another last bit at −96 dB: the factor
    // kept is the engine's canonical conversion, the same on every machine.
    ['spectral.attenuate', { decibels: -96 }, { kind: 'attenuate', gain: decibelsToGain(-96) }, 1],
    ['spectral.remove', {}, { kind: 'attenuate', gain: 0 }, 1],
    ['spectral.isolate', {}, { kind: 'isolate', gain: 0 }, 1],
    ['spectral.isolate', { decibels: -20 }, { kind: 'isolate', gain: decibelsToGain(-20) }, 1],
    // A heal's four border frames at the widest hop, half a frame each, too.
    ['spectral.heal', {}, { kind: 'heal' }, 5],
  ] as const)(
    '%s %o is one change over the area widened by %i half frames',
    async (id, args, operation, halves) => {
      const audio = await selectedLoop({ channels: '1' });
      const { start, end, mask } = placed(SELECTED, operation.kind, audio.asset().length);

      await audio.window.runAndHear(id, args);

      expect(chainOf(audio)).toEqual([
        expect.objectContaining({
          kind: 'process',
          range: { start, end },
          channels: [1],
          edit: { kind: 'spectral', mask, resolution: DEFAULT_SPECTRAL_RESOLUTION, operation },
        }),
      ]);
      expect(start).toBe(48_000 - (halves * DEFAULT_SPECTRAL_RESOLUTION) / 2);
      await audio.window.runAndHear('edit.undo');
      expect(chainOf(audio)).toEqual([]);
    },
  );

  it('analyses at the resolution named', async () => {
    const audio = await selectedLoop();
    await audio.window.runAndHear('spectral.heal', { resolution: 512 });
    const [operation] = chainOf(audio);
    expect(operation?.kind === 'process' && operation.edit).toMatchObject({ resolution: 512 });
    // Half a frame, and a heal's four border frames at the widest hop, a half frame each.
    expect(operation?.kind === 'process' && operation.range.start).toBe(48_000 - 5 * 256);
  });

  it('refuses what the domain refuses, saying why, and changes nothing', async () => {
    const audio = await selectedLoop();
    expect(audio.window.run('spectral.heal', { resolution: 1000 })).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            'A spectral edit analyses in frames of a power of two from 256 to 16,384 samples.',
        },
      ],
    });
    expect(audio.window.run('spectral.attenuate', { decibels: 3 })).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            'A spectral reduction lowers the level: give a number of decibels below nothing.',
        },
      ],
    });
    expect(audio.window.run('spectral.process', { typeKey: 'compressor' })).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'Choose a restoration processor to clean the area up with.' }],
    });
    expect(chainOf(audio)).toEqual([]);
  });

  it('acts on a spectral selection alone, never on the time selected since', async () => {
    const audio = await selectedLoop();
    audio.window.run('editor.select-time', { start: 1_000, end: 2_000 });
    expect(audio.window.run('spectral.remove')).toMatchObject({
      kind: 'refused',
      failures: [
        { summary: 'This acts on a spectral area; the active selection is a time range.' },
      ],
    });
  });

  it('is the region’s own processing in a view of the region', async () => {
    const audio = await windowWithAudio({
      regions: [{ name: 'Body', start: 48_000, end: 240_000 }],
    });
    const [region] = audio.session.getSnapshot().model.state.project.regions.values();
    if (region === undefined) throw new Error('No region.');
    const { context } = audio.window;
    context.editorViews.open('editor', audio.asset());
    context.editorViews.focus('editor');
    audio.window.run('region.open', { region: region.id });
    const shown = area(24_000, 48_000, 300, 900);
    audio.window.run('editor.select-spectral', {
      mask: JSON.stringify(shown),
      combination: 'replace',
    });

    await audio.window.runAndHear('spectral.heal');

    const { start, end, mask } = placed(shown, 'heal', 192_000);
    const operations: Region['operations'] | undefined = audio.session
      .getSnapshot()
      .model.state.project.regions.get(region.id)?.operations;
    expect(operations).toEqual([
      expect.objectContaining({
        basis: 0,
        range: { start: start + 48_000, end: end + 48_000 },
        edit: expect.objectContaining({ mask }),
      }),
    ]);
    expect(chainOf(audio)).toEqual([]);
  });
});

describe('cleaning up the spectral selection', () => {
  it('runs a restoration processor in a chain of its own, entering and leaving with the edit', async () => {
    const audio = await selectedLoop();

    expect(await audio.window.runAndHear('spectral.process', { typeKey: 'de-click' })).toMatch(
      /^Cleaned up an area of Loop with /,
    );

    const { project } = audio.session.getSnapshot().model.state;
    const [operation] = chainOf(audio);
    if (operation?.kind !== 'process' || operation.edit.kind !== 'spectral') {
      throw new Error('No spectral edit was made.');
    }
    const { operation: made } = operation.edit;
    if (made.kind !== 'process') throw new Error('The edit runs no chain.');
    expect(project.effectChains.get(made.chain)?.slots).toEqual([
      expect.objectContaining({ typeKey: 'de-click' }),
    ]);
    await audio.window.runAndHear('edit.undo');
    expect(audio.session.getSnapshot().model.state.project.effectChains.has(made.chain)).toBe(
      false,
    );
  });

  it('says first that a model it cannot run would not be heard, changing nothing until told knowingly', async () => {
    const audio = await selectedLoop();

    expect(audio.window.run('spectral.process', { typeKey: 'deepfilternet-3' })).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary: expect.stringMatching(
            /^DeepFilterNet 3 cannot run because the model it needs is not available\. .+ Nothing changed: clean up with it knowingly to apply it now, heard once it can run\.$/,
          ),
        },
      ],
    });
    expect(chainOf(audio)).toEqual([]);

    const said = await audio.window.runAndHear('spectral.process', {
      typeKey: 'deepfilternet-3',
      knowingly: true,
    });

    expect(said).toMatch(
      /It is not heard yet: DeepFilterNet 3 cannot run because the model it needs is not available\./,
    );
    await expect
      .poll(() => audio.window.context.assets.get().unopened.get(audio.entry)?.reason, {
        timeout: 5000,
      })
      .toMatch(/^DeepFilterNet 3 cannot run because the model it needs is not available\. /);
  });
});

describe('comparing a spectral edit, and hearing it bypassed', () => {
  it('compares the project with before the latest spectral edit', async () => {
    const audio = await selectedLoop();
    const before = audio.session.getSnapshot().model.history.cursor;
    expect(audio.window.run('spectral.compare-before-edit')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'The history holds no spectral edit of this sound to compare with.' }],
    });
    await audio.window.runAndHear('spectral.heal');
    const healed = audio.session.getSnapshot().model.history.cursor;
    // A later change of the whole sound, which the comparison reaches past.
    audio.window.run('editor.clear-spectral-selection');
    await audio.window.runAndHear('edit.gain', { decibels: -3 });
    const after = audio.session.getSnapshot().model.history.cursor;

    expect(await audio.window.runAndHear('spectral.compare-before-edit')).toMatch(
      /^Comparing the project as it is, side A, with before /,
    );

    const { comparison } = audio.session.getSnapshot().model;
    expect([comparison?.a.node, comparison?.b.node]).toEqual([after, before]);
    expect(healed).not.toBe(after);
    expect(audio.window.run('spectral.compare-before-edit').kind).toBe('unchanged');
  });

  it('compares the project with before the spectral edit named, though a later one was made', async () => {
    const audio = await selectedLoop();
    const before = audio.session.getSnapshot().model.history.cursor;
    await audio.window.runAndHear('spectral.heal');
    const healed = audio.session.getSnapshot().model.history.cursor;
    await audio.window.runAndHear('spectral.remove');
    const removed = audio.session.getSnapshot().model.history.cursor;
    const [heal, removal] = chainOf(audio);
    if (heal === undefined || removal === undefined) throw new Error('Two edits were made.');

    expect(
      await audio.window.runAndHear('spectral.compare-before-edit', { operationId: heal.id }),
    ).toMatch(/^Comparing the project as it is, side A, with before /);
    const { comparison } = audio.session.getSnapshot().model;
    expect([comparison?.a.node, comparison?.b.node]).toEqual([removed, before]);

    await audio.window.runAndHear('spectral.compare-before-edit', { operationId: removal.id });
    const latest = audio.session.getSnapshot().model.comparison;
    expect([latest?.a.node, latest?.b.node]).toEqual([removed, healed]);
    expect(
      audio.window.run('spectral.compare-before-edit', { operationId: 'not-an-edit' }),
    ).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'That is not a spectral edit of Loop.' }],
    });
  });

  it('hears the original with a spectral edit bypassed, though no chain processes the sound', async () => {
    const audio = await selectedLoop();
    const { context } = audio.window;
    followPlayingAsset(context.assets, context.hearing, context.playback);
    const before = audio.asset();
    await audio.window.runAndHear('spectral.remove');
    const edited = await audio.changed(before);
    await audio.window.runAndHear('transport.play');
    const [opened] = audio.window.audio.playback.opened;
    if (opened === undefined) throw new Error('Playback opened a session.');
    const { session } = opened;
    const loads = session.loads.length;

    expect(edited.original).toBeDefined();
    expect(audio.window.run('transport.listen-original').kind).toBe('applied');

    await expect.poll(() => session.loads.length).toBe(loads + 1);
    const heard = session.loads.at(-1)?.sources[0];
    const plan = heard !== undefined && 'plan' in heard ? heard.plan : undefined;
    expect(plan?.streams.some((stream) => stream.processing !== undefined)).toBe(false);
    expect(plan).toEqual(before.owner.kind === 'project' ? before.owner.plan : undefined);
  });
});
