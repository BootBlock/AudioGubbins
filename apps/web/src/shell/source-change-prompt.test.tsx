import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';

import { observable } from '../state/observable.js';
import type { OpenProjectState } from '../state/open-project-store.js';
import type { SourceChangeState } from '../state/source-changes.js';
import { renderInTheShell } from '../testing/in-the-shell.js';
import { addLinkedAsset, linkedFile } from '../testing/linked-assets.js';
import { projectWorld } from '../testing/project-context.js';
import { SourceChangePrompt } from './source-change-prompt.js';

const KICK = unsafeBrandId<'AssetId'>('0a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d');
const SNARE = unsafeBrandId<'AssetId'>('1a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d');

const SAME = {
  byteLength: 'same',
  fastFingerprint: 'different',
  contentId: 'unknown',
  containerKind: 'same',
  mediaType: 'same',
  lastModified: 'different',
  handleKey: 'same',
  relativePath: 'unknown',
} as const;

/** Draws the prompt over the changes given, and what it runs. */
function promptOver(state: SourceChangeState) {
  const run = vi.fn((_id: string, _args?: unknown) => true);
  renderInTheShell(
    <SourceChangePrompt
      sources={observable(state)}
      project={observable<OpenProjectState>({ kind: 'none' })}
      run={run}
    />,
  );
  return { run };
}

describe('the question about linked files that changed', () => {
  it('is not asked where no linked file changed', () => {
    promptOver({ changes: [], applied: [], checking: false });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says how a file chosen to link differs, and links it only when asked to anyway', async () => {
    const { run } = promptOver({
      checking: false,
      applied: [],
      changes: [
        {
          asset: KICK,
          name: 'Kick',
          classification: { kind: 'missing', reason: 'not-found' },
          plan: {
            choices: [
              { kind: 'relink', available: true },
              { kind: 'keep-offline', available: true },
            ],
          },
          offered: {
            identity: {
              fileName: 'snare.wav',
              byteLength: 256,
              lastModified: 5,
              mediaType: 'audio/wav',
              signature: '02020202',
              fastFingerprint: 'b'.repeat(64),
            },
            file: linkedFile('snare.wav', 'kept-3', 2),
            difference: 'modified',
          },
        },
      ],
    });

    const dialogue = screen.getByRole('dialog', { name: 'Linked files have changed' });
    expect(
      within(dialogue).getByText(
        'The file you chose is not the one the project used: its content differs. Link it anyway, or choose another file.',
      ),
    ).toBeVisible();
    await userEvent.click(
      within(dialogue).getByRole('button', { name: 'Link "snare.wav" anyway' }),
    );
    expect(run).toHaveBeenLastCalledWith('source.link-offered', { asset: KICK });
  });

  it('names each file, says what became of it, and offers its choices in order', async () => {
    const { run } = promptOver({
      checking: false,
      applied: [],
      changes: [
        {
          asset: KICK,
          name: 'Kick',
          classification: { kind: 'modified', evidence: SAME },
          plan: {
            choices: [
              { kind: 'adopt', available: true },
              { kind: 'relink', available: true },
              { kind: 'freeze', available: false, reason: 'no-retained-copy' },
              { kind: 'keep-offline', available: true },
            ],
          },
        },
      ],
    });

    const dialogue = screen.getByRole('dialog', { name: 'Linked files have changed' });
    expect(
      within(dialogue).getByText(
        'The file of "Kick" has been changed since the project last used it.',
      ),
    ).toBeVisible();
    const choices = within(dialogue).getByRole('group', { name: 'What to do about "Kick"' });
    expect(
      within(choices)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      'Use the new version',
      'Choose another file…',
      'Keep the version the project used',
      'Keep it offline',
    ]);
    expect(
      within(choices).getByRole('button', { name: 'Keep the version the project used' }),
    ).toHaveAccessibleDescription(
      'No copy of the version the project used was kept, so it cannot be kept playing.',
    );

    await userEvent.click(within(choices).getByRole('button', { name: 'Use the new version' }));
    expect(run).toHaveBeenLastCalledWith('source.resolve', { asset: KICK, choice: 'adopt' });
  });

  it('says what an asset’s own setting did without asking, and decides later when closed', async () => {
    const { run } = promptOver({
      checking: false,
      changes: [],
      applied: [{ asset: SNARE, name: 'Snare', kind: 'freeze' }],
    });

    expect(
      screen.getByText(
        '"Snare" was dealt with as its own setting says: keep the version the project used.',
      ),
    ).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(run).toHaveBeenCalledWith('source.decide-later');
  });

  it('asks for leave to read a file again where the browser needs it, from a button', async () => {
    const { run } = promptOver({
      checking: false,
      applied: [],
      changes: [
        {
          asset: KICK,
          name: 'Kick',
          classification: { kind: 'missing', reason: 'access-needed' },
          plan: { choices: [{ kind: 'relink', available: true }] },
        },
        {
          asset: SNARE,
          name: 'Snare',
          classification: { kind: 'missing', reason: 'permission-refused' },
          plan: { choices: [{ kind: 'relink', available: true }] },
        },
      ],
    });

    expect(
      screen.getByText('AudioGubbins needs your leave to read the file of "Kick" again.'),
    ).toBeVisible();
    expect(screen.getByText('Leave to read the file of "Snare" was refused.')).toBeVisible();
    const snare = screen.getByRole('group', { name: 'What to do about "Snare"' });
    expect(within(snare).queryByRole('button', { name: 'Give access' })).toBeNull();

    const kick = screen.getByRole('group', { name: 'What to do about "Kick"' });
    await userEvent.click(within(kick).getByRole('button', { name: 'Give access' }));
    expect(run).toHaveBeenCalledWith('source.give-access', { asset: KICK });
  });

  it('chooses what the asset does the next time its file changes, offering only what it can do', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    const asset = await addLinkedAsset(window, linkedFile('kick.wav', 'kept-1'), { name: 'Kick' });
    const run = vi.fn((_id: string, _args?: unknown) => true);
    renderInTheShell(
      <SourceChangePrompt
        sources={observable<SourceChangeState>({
          checking: false,
          applied: [],
          changes: [
            {
              asset,
              name: 'Kick',
              classification: { kind: 'missing', reason: 'not-found' },
              plan: { choices: [{ kind: 'relink', available: true }] },
            },
          ],
        })}
        project={window.projects.project}
        run={run}
      />,
    );

    const next = screen.getByRole('combobox', { name: 'The next time its file changes' });
    expect(next).toHaveTextContent('Ask me');
    expect(
      screen.getByText(
        'Keeping the version the project used needs a copy of it, which this asset does not keep.',
      ),
    ).toBeVisible();
    next.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Ask me',
      'Use the new version',
    ]);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(run).toHaveBeenLastCalledWith('source.set-policy', { asset, policy: 'adopt' });
  });
});
