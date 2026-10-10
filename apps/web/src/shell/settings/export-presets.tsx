/**
 * The person's own export presets, in Settings (ADR-0092): each with what it
 * sets, and the command that removes it. A preset is saved from the Export
 * dialog, where the settings it keeps are set.
 */

import type { ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';

import { ExportCommand } from '../../commands/import-export-ids.js';
import type { OwnExportPreset } from '../../state/stored-export-presets.js';
import { ownPresetSentence } from '../export/export-words.js';
import type { RunCommand } from './section.js';

/** The presets section (see the module comment). */
export function ExportPresetsSection({
  presets,
  run,
}: {
  readonly presets: readonly OwnExportPreset[];
  readonly run: RunCommand;
}): ReactNode {
  return (
    <section className="ag-settings-section" aria-label="Your export presets">
      {presets.length === 0 ? (
        <p className="ag-settings-note">
          You keep no presets of your own yet. Save one from the Export dialog, under Every setting.
        </p>
      ) : (
        <ul className="ag-export-edits" aria-label="Presets">
          {presets.map((preset) => (
            <li key={preset.id}>
              <p className="ag-export-preset-name">{preset.name}</p>
              <p className="ag-settings-note">{ownPresetSentence(preset.settings)}</p>
              <Button
                compact
                onClick={() => {
                  run(ExportCommand.RemovePreset, { preset: preset.id });
                }}
              >
                {`Remove ${preset.name}`}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
