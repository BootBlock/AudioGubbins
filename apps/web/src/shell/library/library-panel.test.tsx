import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  FailureKind,
  createDeterministicIdGenerator,
  failure,
  instantiateProcessor,
  type LibraryEntry,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import type { ListedEntry } from '@audiogubbins/storage';
import { sine } from '@audiogubbins/test-fixtures';

import type { ShellContext } from '../../commands/shell-context.js';
import { observable, type Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import type { SavedProcessingState } from '../../state/saved-processing-store.js';
import { holdPlatformFiles, windowWithAudio } from '../../testing/project-audio.js';
import { buildShellContext } from '../../testing/shell-context.js';
import { LibraryPanel, type LibraryParts, type LibraryStores } from './library-panel.js';

holdPlatformFiles();

/**
 * The Library panel (ADR-0060, REQ-EDIT-012): what it lists of the person's
 * saved chains and presets, and that each thing it offers is the library's
 * command of that name, the removal only from its second asking, with the
 * focus kept where the person was.
 */

const IDS = createDeterministicIdGenerator(9_000);

function processor(typeKey: string): ProcessorInstance {
  const descriptor = PROCESSOR_CATALOGUE.get(typeKey);
  if (descriptor === undefined) throw new Error(`The build has no ${typeKey}.`);
  return instantiateProcessor(IDS.next(), descriptor);
}

/** A gain, then a compressor that is bypassed: what "Warm vocal" holds. */
function warmVocal(): LibraryEntry['content'] {
  return {
    kind: 'chain',
    chain: {
      id: IDS.next<'EffectChainId'>(),
      slots: [processor('gain'), { ...processor('compressor'), enabled: false }],
    },
  };
}

function usable(name: string, content: LibraryEntry['content']): ListedEntry {
  return {
    kind: 'usable',
    entry: {
      id: IDS.next<'LibraryEntryId'>(),
      name,
      savedAt: Date.UTC(2026, 9, 7, 9, 30),
      content,
    },
  };
}

const UNREADABLE: ListedEntry = {
  kind: 'unusable',
  id: IDS.next<'LibraryEntryId'>(),
  reason: failure(
    'library.entry-schema',
    FailureKind.Unrecoverable,
    'It was saved by a later version of AudioGubbins.',
  ),
};

type Ran = (readonly [string, CommandInvocation['arguments']])[];

const NO_PROJECT: Observable<OpenProjectState> = observable<OpenProjectState>({ kind: 'none' });

/** Draws the panel over `parts`, its commands recorded rather than run. */
function panelOver(context: ShellContext, library: Partial<LibraryStores>): { readonly ran: Ran } {
  const ran: Ran = [];
  render(
    <LibraryPanel
      title="Library"
      parts={{
        library: {
          savedProcessing: observable<SavedProcessingState>({ entries: [], loaded: true }),
          project: NO_PROJECT,
          ...library,
        },
        unavailable: undefined,
        editorViews: context.editorViews,
        assets: context.assets,
      }}
      commands={{
        run: (id, args) => {
          ran.push([id, args]);
        },
        unavailableReason: () => undefined,
      }}
    />,
  );
  return { ran };
}

/** The group of the entry called `name`. */
function entryNamed(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

/** A window with a second of a tone and two regions open in an editor, and two saved entries. */
async function libraryWithAudio() {
  const audio = await windowWithAudio({
    fixture: sine(440, { length: 48_000 }),
    name: 'Tone',
    regions: [
      { name: 'First', start: 0, end: 12_000 },
      { name: 'Second', start: 12_000, end: 24_000 },
    ],
  });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.focus('editor');
  const library = audio.window.projects.savedProcessing;
  const chain = expectSuccess(await library.save('Warm vocal', warmVocal()));
  const preset = expectSuccess(
    await library.save('Six up', { kind: 'preset', processor: processor('gain') }),
  );
  const { ran } = panelOver(context, {
    savedProcessing: library,
    project: audio.window.projects.project,
  });
  return { audio, chain, preset, ran };
}

describe('the Library panel', { timeout: 30_000 }, () => {
  it('reads the library and the project and cannot write them, changing anything only by a command', () => {
    expectTypeOf<LibraryStores['savedProcessing']>().toEqualTypeOf<
      Observable<SavedProcessingState>
    >();
    expectTypeOf<LibraryStores['project']>().toEqualTypeOf<Observable<OpenProjectState>>();
    expectTypeOf<LibraryParts['library']>().toEqualTypeOf<LibraryStores | undefined>();
  });

  it('lists chains and presets by kind, with when each was saved and what it holds, and an entry it cannot use with the reason', () => {
    const { context } = buildShellContext();
    panelOver(context, {
      savedProcessing: observable<SavedProcessingState>({
        entries: [
          usable('Warm vocal', warmVocal()),
          usable('Six up', { kind: 'preset', processor: processor('gain') }),
          UNREADABLE,
        ],
        loaded: true,
      }),
    });

    expect(screen.getByRole('heading', { name: 'Saved chains (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Presets (1)' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Cannot be used in this version (1)' }),
    ).toBeInTheDocument();
    expect(entryNamed('Warm vocal')).toHaveTextContent(
      /Saved .+\. Holds Gain, then Compressor \(bypassed\)\./u,
    );
    expect(entryNamed('Six up')).toHaveTextContent(/The settings of a Gain\./u);
    expect(entryNamed('An entry that cannot be read')).toHaveTextContent(
      'It was saved by a later version of AudioGubbins.',
    );
    // Nothing is shown in an editor, so nothing can be applied, and it says why.
    const apply = within(entryNamed('Warm vocal')).getByRole('button', { name: 'Apply' });
    expect(apply).toHaveAttribute('aria-disabled', 'true');
    expect(apply).toHaveAccessibleDescription(
      'Open audio of the project in an editor to apply it there.',
    );
  });

  it('applies a chain to what the editor shows, or to the targets ticked, shared where asked, and a preset, each by its command', async () => {
    const { audio, chain, preset, ran } = await libraryWithAudio();
    const regions = [...audio.session.getSnapshot().model.state.project.regions.values()];
    const warm = entryNamed('Warm vocal');

    await userEvent.click(within(warm).getByRole('button', { name: 'Apply to “Tone”' }));
    await userEvent.click(within(warm).getByRole('switch', { name: 'Share one chain' }));
    await userEvent.click(within(warm).getByRole('button', { name: 'Apply to several…' }));
    expect(within(warm).getByRole('heading', { name: 'Apply “Warm vocal” to' })).toHaveFocus();
    for (const region of regions) {
      await userEvent.click(
        within(warm).getByRole('switch', { name: `${region.displayName}, a region of Tone` }),
      );
    }
    await userEvent.click(within(warm).getByRole('button', { name: 'Apply to 2 chosen' }));
    await userEvent.click(
      within(entryNamed('Six up')).getByRole('button', { name: 'Apply to the selected processor' }),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Save the rack of “Tone” as' }),
      'Bright',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save the rack' }));

    expect(ran).toEqual([
      ['library.apply-chain', { entry: chain.id, view: 'editor', share: false }],
      [
        'library.apply-chain',
        {
          entry: chain.id,
          targets: regions.map((region) => `region:${region.id}`).join(','),
          share: true,
        },
      ],
      ['library.apply-preset', { entry: preset.id, view: 'editor' }],
      ['library.save-chain', { view: 'editor', name: 'Bright' }],
    ]);
  });

  it('removes an entry only from its second asking, keeping the focus where the person was', async () => {
    const { chain, ran } = await libraryWithAudio();
    const warm = entryNamed('Warm vocal');
    const ask = within(warm).getByRole('button', { name: 'Remove…' });

    await userEvent.click(ask);
    expect(within(warm).getByRole('button', { name: 'Remove for good' })).toHaveFocus();
    await userEvent.click(within(warm).getByRole('button', { name: 'Keep it' }));
    expect(within(warm).getByRole('button', { name: 'Remove…' })).toHaveFocus();
    expect(ran).toEqual([]);

    await userEvent.click(within(warm).getByRole('button', { name: 'Remove…' }));
    await userEvent.click(within(warm).getByRole('button', { name: 'Remove for good' }));

    expect(ran).toEqual([['library.remove', { entry: chain.id }]]);
    expect(screen.getByRole('heading', { name: 'Saved chains (1)' })).toHaveFocus();
  });

  it('renames an entry to the name typed, giving the focus back to what opened it', async () => {
    const { chain, ran } = await libraryWithAudio();
    const warm = entryNamed('Warm vocal');

    await userEvent.click(within(warm).getByRole('button', { name: 'Rename…' }));
    const field = within(warm).getByRole('textbox', { name: 'New name for “Warm vocal”' });
    expect(field).toHaveFocus();
    expect(field).toHaveValue('Warm vocal');
    await userEvent.clear(field);
    await userEvent.type(field, 'Warmer{Enter}');

    expect(ran).toEqual([['library.rename', { entry: chain.id, name: 'Warmer' }]]);
    expect(within(warm).getByRole('button', { name: 'Rename…' })).toHaveFocus();
  });

  it('brings the list up to date in place, an entry the library kept drawn by the element it was', () => {
    const { context } = buildShellContext();
    const first = usable('Warm vocal', warmVocal());
    const second = usable('Bright', warmVocal());
    const saved = observable<SavedProcessingState>({ entries: [first, second], loaded: true });
    panelOver(context, { savedProcessing: saved });
    const drawn = entryNamed('Bright');

    act(() => {
      saved.set({ entries: [second], loaded: true });
    });

    expect(screen.queryByRole('group', { name: 'Warm vocal' })).not.toBeInTheDocument();
    expect(entryNamed('Bright')).toBe(drawn);
  });
});
