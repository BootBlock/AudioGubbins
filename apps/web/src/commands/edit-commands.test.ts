import { describe, expect, it } from 'vitest';

import type { EditOperation, Region } from '@audiogubbins/domain';

import { regionEntryId } from '../assets/project-assets.js';
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
  ['edit.copy-channel', { from: 'left', to: 2 }, { kind: 'copy-channel', from: 0, to: 1 }, false],
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
      if (operation?.kind !== 'process') throw new Error(`${id} recorded no processing.`);
      expect(operation.channels).toEqual(scoped ? [1] : undefined);
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

  it('copies the whole sound with nothing selected', async () => {
    const audio = await editedLoop();
    audio.window.run('editor.set-playhead', { position: 0 });

    expect(audio.window.run('edit.copy').kind).toBe('applied');
    expect(audio.window.said).toContain('Copied all of Loop.');
    await ran(audio, 'edit.paste');

    expect(audio.asset().length).toBe(2 * LENGTH);
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
  /** What each conversion is given, and the roles and matrix it records. */
  const CONVERSIONS: readonly (readonly [
    id: string,
    args: Readonly<Record<string, string>>,
    roles: readonly string[],
    matrix: readonly (readonly number[])[],
  ])[] = [
    ['edit.to-mono', {}, ['mono'], [[0.5, 0.5]]],
    ['edit.convert-layout', { layout: 'mono' }, ['mono'], [[0.5, 0.5]]],
    [
      'edit.remap-channels',
      { order: 'Right, 1' },
      ['left', 'right'],
      [
        [0, 1],
        [1, 0],
      ],
    ],
  ];

  it.each(
    CONVERSIONS.flatMap(([id, ...rest]) => [
      [id, 'with the selection', ...rest] as const,
      [id, 'with nothing selected', ...rest] as const,
    ]),
  )(
    '%s converts the whole sound %s, keeping the roles of its layout',
    async (id, selection, args, roles, matrix) => {
      const audio = await editedLoop();
      if (selection === 'with the selection') audio.window.run('editor.select-time', SELECTED);

      await ran(audio, id, args);

      expect(chainOf(audio)).toEqual([
        expect.objectContaining({ kind: 'convert-layout', layout: { roles }, matrix }),
      ]);
      expect(audio.asset().layout.roles).toEqual(roles);
    },
  );

  it('makes a mono sound stereo, each side its one channel', async () => {
    const audio = await editedLoop();
    await ran(audio, 'edit.to-mono');

    await ran(audio, 'edit.to-stereo');

    expect(chainOf(audio).at(-1)).toMatchObject({
      kind: 'convert-layout',
      layout: { roles: ['left', 'right'] },
      matrix: [[1], [1]],
    });
    expect(audio.asset().layout.roles).toEqual(['left', 'right']);
  });

  it.each([
    ['edit.swap-channels', { first: 0, second: 1 }],
    ['edit.copy-channel', { from: 'Centre', to: 'Left' }],
  ])('%s asks for channels by name or by number from 1', async (id, args) => {
    const audio = await editedLoop();

    expect(audio.window.run(id, args)).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary: 'Say which two channels, by name, such as Left, or by number, counting from 1.',
        },
      ],
    });
    expect(chainOf(audio)).toEqual([]);
  });
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

  it('stops a region looping, which one undo puts back', async () => {
    const audio = await editedLoop([{ name: 'Body', start: 48_000, end: 240_000 }]);
    const [region] = regionsOf(audio);
    if (region === undefined) throw new Error('No region.');
    audio.window.run('region.open', { region: region.id });
    audio.window.run('editor.select-time', { start: 0, end: 48_000 });
    await ran(audio, 'region.loop', { crossfade: 64 });
    const looped = regionsOf(audio)[0]?.loop;
    expect(looped).toBeDefined();

    expect(await ran(audio, 'region.clear-loop')).toBe('Body no longer loops.');
    expect(regionsOf(audio)[0]?.loop).toBeUndefined();
    expect(audio.window.run('region.clear-loop')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'Body does not loop.' }],
    });
    await ran(audio, 'edit.undo');

    expect(regionsOf(audio)[0]?.loop).toEqual(looped);
  });
});
