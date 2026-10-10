import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { defaultExportSettings } from '@audiogubbins/import-export';

import { ExportCommand } from '../../commands/import-export-ids.js';
import { exportContextOver } from '../../testing/export-contexts.js';
import { ownPresetId, presetSettings } from '../../state/stored-export-presets.js';
import { ExportPresetsSection } from './export-presets.js';

describe('the person’s export presets in Settings', () => {
  it('lists each preset with what it sets, and removes one by its command', async () => {
    const run = vi.fn((_id: string, _args?: unknown) => true);
    const settings = presetSettings(defaultExportSettings('flac', exportContextOver()));
    render(
      <ExportPresetsSection
        presets={[{ id: ownPresetId('Masters'), name: 'Masters', settings }]}
        run={run}
      />,
    );

    const list = screen.getByRole('list', { name: 'Presets' });
    expect(within(list).getByText('Masters')).toBeVisible();
    expect(
      within(list).getByText(/^Sets FLAC, 16-bit, compression level 5 at 48 kHz/u),
    ).toBeVisible();

    await userEvent.click(within(list).getByRole('button', { name: 'Remove Masters' }));
    expect(run.mock.calls).toEqual([[ExportCommand.RemovePreset, { preset: 'own:Masters' }]]);
  });

  it('says where a preset is saved from while there is none', () => {
    render(<ExportPresetsSection presets={[]} run={() => true} />);
    expect(screen.getByText(/You keep no presets of your own yet/u)).toBeVisible();
  });
});
