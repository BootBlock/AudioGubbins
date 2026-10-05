import { describe, expect, it } from 'vitest';

import { sampleRate, type EditOperation, type Region } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sine } from '@audiogubbins/test-fixtures';

import { regionEntryId } from '../assets/project-assets.js';
import { projectWorld } from '../testing/project-context.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';

holdPlatformFiles();

const LENGTH = 6 * 48_000;
const SELECTED = { start: 48_000, end: 96_000 };

/** The loop imported, open in an editor a thousand pixels wide. */
async function editedLoop(
  regions: readonly { readonly name: string; readonly start: number; readonly end: number }[] = [],
): Promise<AudioWindow> {
  const audio = await windowWithAudio({ regions });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', 1000, audio.asset().length);
  context.editorViews.focus('editor');
  return audio;
}

/** The asset's chain as the project holds it now. */
function chainOf(audio: AudioWindow): readonly EditOperation[] {
  return audio.session.getSnapshot().model.state.project.assets.get(audio.assetId)?.edits ?? [];
}

function regionsOf(audio: AudioWindow): readonly Region[] {
  return [...audio.session.getSnapshot().model.state.project.regions.values()];
}

/** Runs `id`, which must start a change, and settles with what it came to say. */
async function ran(
  audio: AudioWindow,
  id: string,
  args?: Readonly<Record<string, string | number | boolean>>,
): Promise<string> {
  return await audio.window.runAndHear(id, args);
}

/** What a level or channel command records, its arguments, and whether it scopes channels. */
const PROCESSING: readonly (readonly [
  id: string,
  args: Readonly<Record<string, string | number>>,
  edit: object,
  scoped: boolean,
])[] = [
  ['edit.silence', {}, { kind: 'silence' }, true],
  ['edit.invert', {}, { kind: 'invert' }, true],
  ['edit.fade-in', {}, { kind: 'fade', direction: 'in', shape: 'linear' }, true],
  [
    'edit.fade-out',
    { shape: 'equal-power' },
    { kind: 'fade', direction: 'out', shape: 'equal-power' },
    true,
  ],
  ['edit.louder', {}, { kind: 'gain', gain: 10 ** (3 / 20) }, true],
  ['edit.quieter', {}, { kind: 'gain', gain: 10 ** (-3 / 20) }, true],
  ['edit.gain', { decibels: 6 }, { kind: 'gain', gain: 10 ** (6 / 20) }, true],
  ['edit.swap-channels', {}, { kind: 'swap-channels', first: 0, second: 1 }, false],
  ['edit.copy-channel', { from: 0, to: 1 }, { kind: 'copy-channel', from: 0, to: 1 }, false],
  ['edit.channel-gains', { gains: '1,0.5' }, { kind: 'channel-gains', gains: [1, 0.5] }, false],
  ['edit.balance', { balance: 0.5 }, { kind: 'channel-gains', gains: [0.5, 1] }, false],
];

describe('the processing commands, selection first (ADR-0042)', () => {
  it.each(PROCESSING)('%s acts on the selected range', async (id, args, edit) => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', SELECTED);

    await ran(audio, id, args);

    expect(chainOf(audio)).toEqual([
      expect.objectContaining({ kind: 'process', range: SELECTED, edit }),
    ]);
  });

  it.each(PROCESSING)(
    '%s acts on the whole sound with nothing selected',
    async (id, args, edit) => {
      const audio = await editedLoop();

      await ran(audio, id, args);

      expect(chainOf(audio)).toEqual([
        expect.objectContaining({ kind: 'process', range: { start: 0, end: LENGTH }, edit }),
      ]);
    },
  );

  it.each(PROCESSING)(
    '%s keeps to the selected channel where it changes level',
    async (id, args, _edit, scoped) => {
      const audio = await editedLoop();
      audio.window.run('editor.select-time', { ...SELECTED, channels: '1' });

      await ran(audio, id, args);

      const [operation] = chainOf(audio);
      expect(
        operation !== undefined && 'channels' in operation ? operation.channels : undefined,
      ).toEqual(scoped ? [1] : undefined);
    },
  );

  it.each(PROCESSING)(
    '%s is the region’s own processing in a view of the region',
    async (id, args, edit) => {
      const audio = await editedLoop([{ name: 'Body', start: 48_000, end: 240_000 }]);
      const [region] = regionsOf(audio);
      if (region === undefined) throw new Error('No region.');
      audio.window.run('region.open', { region: region.id });
      audio.window.run('editor.select-time', { start: 0, end: 48_000 });

      await ran(audio, id, args);

      expect(chainOf(audio)).toEqual([]);
      expect(regionsOf(audio)[0]?.operations).toEqual([
        expect.objectContaining({ basis: 0, range: { start: 48_000, end: 96_000 }, edit }),
      ]);
    },
  );
});

/** The commands that change time over a range, and what each records. */
const TIMED: readonly (readonly [id: string, kind: EditOperation['kind'], whole: boolean])[] = [
  ['edit.delete', 'delete', false],
  ['edit.cut', 'delete', false],
  ['edit.trim', 'trim', false],
  ['edit.reverse', 'reverse', true],
];

describe('the commands that change time, selection first (ADR-0042)', () => {
  it.each(TIMED)('%s acts on the selected range', async (id, kind) => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', SELECTED);

    await ran(audio, id);

    expect(chainOf(audio)).toEqual([expect.objectContaining({ kind, range: SELECTED })]);
  });

  it.each(TIMED)(
    '%s with nothing selected acts on all of it, or refuses to',
    async (id, kind, whole) => {
      const audio = await editedLoop();

      if (whole) {
        await ran(audio, id);
        expect(chainOf(audio)).toEqual([
          expect.objectContaining({ kind, range: { start: 0, end: LENGTH } }),
        ]);
      } else {
        expect(audio.window.run(id)).toMatchObject({
          kind: 'refused',
          failures: [{ summary: expect.stringMatching(/Nothing is selected/) }],
        });
        expect(chainOf(audio)).toEqual([]);
      }
    },
  );

  it.each(TIMED)('%s refuses to change time on some channels alone', async (id) => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', { ...SELECTED, channels: '0' });

    expect(audio.window.run(id)).toMatchObject({
      kind: 'refused',
      failures: [{ summary: expect.stringMatching(/^A change of time acts on every channel/) }],
    });
    expect(chainOf(audio)).toEqual([]);
  });

  it('deletes from the asset in a view of a region, and says so', async () => {
    const audio = await editedLoop([{ name: 'Body', start: 48_000, end: 240_000 }]);
    const [region] = regionsOf(audio);
    if (region === undefined) throw new Error('No region.');
    audio.window.run('region.open', { region: region.id });
    audio.window.run('editor.select-time', { start: 0, end: 48_000 });

    const said = await ran(audio, 'edit.delete');

    expect(said).toMatch(/changes all of "Loop"/);
    expect(chainOf(audio)).toEqual([
      expect.objectContaining({ kind: 'delete', range: { start: 48_000, end: 96_000 } }),
    ]);
  });

  it('trims a region by its boundaries in its own view, leaving the asset whole', async () => {
    const audio = await editedLoop([{ name: 'Body', start: 48_000, end: 240_000 }]);
    const [region] = regionsOf(audio);
    if (region === undefined) throw new Error('No region.');
    audio.window.run('region.open', { region: region.id });
    audio.window.run('editor.select-time', { start: 4800, end: 9600 });

    await ran(audio, 'edit.trim');

    expect(chainOf(audio)).toEqual([]);
    expect(regionsOf(audio)[0]).toMatchObject({ start: 52_800, end: 57_600 });
  });
});

describe('the clipboard (ADR-0053)', () => {
  it('copies the selection and pastes it at the playhead, as one insertion', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', SELECTED);
    expect(audio.window.run('edit.copy').kind).toBe('applied');
    audio.window.run('editor.clear-selection');
    audio.window.run('editor.set-playhead', { position: 0 });

    await ran(audio, 'edit.paste');

    expect(chainOf(audio)).toEqual([expect.objectContaining({ kind: 'insert', at: 0 })]);
    expect(audio.asset().length).toBe(LENGTH + 48_000);
  });

  it('pastes over the selected range, replacing it', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', SELECTED);
    audio.window.run('edit.copy');
    audio.window.run('editor.select-time', { start: 0, end: 4800 });

    await ran(audio, 'edit.paste');

    expect(chainOf(audio).map((operation) => operation.kind)).toEqual(['delete', 'insert']);
    expect(audio.asset().length).toBe(LENGTH - 4800 + 48_000);
  });

  it('cuts as one change, which one undo puts back', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.select-time', SELECTED);

    await ran(audio, 'edit.cut');
    expect(audio.asset().length).toBe(LENGTH - 48_000);
    await ran(audio, 'edit.undo');

    expect(chainOf(audio)).toEqual([]);
    expect(audio.window.context.clipboard.get().copied).toBeDefined();
  });

  it('pastes audio at another rate only by the command that converts it, which a paste names', async () => {
    const world = projectWorld();
    const slower = await windowWithAudio({
      world,
      name: 'Slower',
      fixture: sine(441, { length: 4410, sampleRate: expectSuccess(sampleRate(44_100)) }),
    });
    slower.window.context.editorViews.open('editor', slower.asset());
    slower.window.context.editorViews.focus('editor');
    expect(slower.window.run('edit.copy').kind).toBe('applied');
    const { copied } = slower.window.context.clipboard.get();
    if (copied === undefined) throw new Error('Nothing was copied.');
    const audio = await windowWithAudio({ world });
    audio.window.context.editorViews.open('editor', audio.asset());
    audio.window.context.editorViews.focus('editor');
    audio.window.context.clipboard.hold(copied, 'all of Slower');
    audio.window.run('editor.set-playhead', { position: 0 });

    expect(audio.window.run('edit.paste')).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            'The copied audio is at 44.1 kHz and this audio is at 48 kHz. To convert it to 48 kHz as it is pasted, use Paste, converting the sample rate.',
        },
      ],
    });
    const before = audio.asset();
    await ran(audio, 'edit.paste-converting-rate');

    expect(chainOf(audio)).toEqual([
      expect.objectContaining({ kind: 'insert', at: 0, convertRate: true }),
    ]);
    // The asset reopens once the page holds every file it reads, the pasted media's among them.
    expect((await audio.changed(before)).length).toBe(LENGTH + 4800);
  });

  it('refuses a paste with nothing copied', async () => {
    const audio = await editedLoop();

    expect(audio.window.run('edit.paste')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'Nothing is copied. Copy or cut some audio first.' }],
    });
  });
});

describe('the channel layout (REQ-EDIT-015)', () => {
  it.each([
    ['edit.to-mono', {}, ['mono']],
    ['edit.convert-layout', { layout: 'mono' }, ['mono']],
    ['edit.remap-channels', { order: '1,0' }, ['left', 'right']],
  ] as const)(
    '%s converts the whole sound, keeping the roles of its layout',
    async (id, args, roles) => {
      const audio = await editedLoop();
      audio.window.run('editor.select-time', SELECTED);

      await ran(audio, id, args);

      expect(chainOf(audio)).toEqual([
        expect.objectContaining({ kind: 'convert-layout', layout: { roles } }),
      ]);
      expect(audio.asset().layout.roles).toEqual(roles);
    },
  );
});

describe('regions (REQ-EDIT-014)', () => {
  it('makes a region of the selection, and refuses with nothing selected', async () => {
    const audio = await editedLoop();
    expect(audio.window.run('region.create').kind).toBe('refused');
    audio.window.run('editor.select-time', SELECTED);

    await ran(audio, 'region.create');

    expect(regionsOf(audio)).toEqual([
      expect.objectContaining({ displayName: 'Region 1', start: 48_000, end: 96_000 }),
    ]);
  });

  it('splits the regions at the playhead, each keeping the processing over its part', async () => {
    const audio = await editedLoop([{ name: 'Body', start: 48_000, end: 240_000 }]);
    const [region] = regionsOf(audio);
    if (region === undefined) throw new Error('No region.');
    audio.window.run('region.open', { region: region.id });
    audio.window.run('editor.select-time', { start: 0, end: 4800 });
    await ran(audio, 'edit.silence');
    audio.window.run('editor.open-asset', { asset: audio.entry });

    await ran(audio, 'edit.split', { at: 96_000 });

    const parts = regionsOf(audio).toSorted((one, other) => one.start - other.start);
    expect(
      parts.map((part) => [part.displayName, part.start, part.end, part.operations.length]),
    ).toEqual([
      ['Body', 48_000, 96_000, 1],
      ['Body (2)', 96_000, 240_000, 0],
    ]);
  });

  it('cuts a sound with no region at the playhead into two regions over all of it', async () => {
    const audio = await editedLoop();

    await ran(audio, 'edit.split', { at: 96_000 });

    expect(regionsOf(audio).map((one) => [one.start, one.end])).toEqual([
      [0, 96_000],
      [96_000, LENGTH],
    ]);
  });

  it('names, loops, tags and removes a region, each through the project', async () => {
    const audio = await editedLoop([{ name: 'Body', start: 48_000, end: 240_000 }]);
    const [region] = regionsOf(audio);
    if (region === undefined) throw new Error('No region.');
    audio.window.run('region.open', { region: region.id });
    expect(audio.window.context.editorViews.entry('editor')?.asset).toBe(regionEntryId(region.id));

    await ran(audio, 'region.rename', { name: 'Sustain' });
    audio.window.run('editor.select-time', { start: 0, end: 48_000 });
    await ran(audio, 'region.loop', { crossfade: 64 });
    await ran(audio, 'region.set-tags', { tags: 'loop, pad, loop' });

    expect(regionsOf(audio)[0]).toMatchObject({
      displayName: 'Sustain',
      loop: { basis: 0, start: 48_000, end: 96_000, crossfadeLength: 64 },
      tags: ['loop', 'pad'],
    });

    await ran(audio, 'region.remove');
    expect(regionsOf(audio)).toEqual([]);
  });
});
