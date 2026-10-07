/**
 * The rack's way into the person's library (ADR-0060, REQ-AUDIO-086): saving
 * the rack shown as a chain under a name, and, with one processor selected,
 * saving its settings as a preset or applying a preset of its type. Each is
 * the library command of that name; the list of presets is read from the
 * library, never written here.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { OptionSelect, TextField } from '@audiogubbins/design-system';
import type { ProcessorId } from '@audiogubbins/domain';

import { processorIn } from '../../commands/library-access.js';
import type { Observable } from '../../state/observable.js';
import type { SavedProcessingState } from '../../state/saved-processing-store.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import type { ShownRack } from './shown-rack.js';

/** A library that lists nothing, where this browser keeps none. */
export const NO_LIBRARY: Observable<SavedProcessingState> = {
  get: () => ({ entries: [], loaded: true }),
  subscribe: () => () => undefined,
};

/** Saving the selected processor's settings as a preset, and applying one of its type. */
function PresetControls({
  processor,
  shown,
  library,
  commands,
}: {
  readonly processor: ProcessorId;
  readonly shown: ShownRack;
  readonly library: Observable<SavedProcessingState>;
  readonly commands: PanelCommands;
}): ReactNode {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<string | undefined>(undefined);
  const saved = useSyncExternalStore(library.subscribe, library.get);
  const typeKey = processorIn(shown.state, processor)?.typeKey;
  const presets = saved.entries.flatMap((listed) =>
    listed.kind === 'usable' &&
    listed.entry.content.kind === 'preset' &&
    listed.entry.content.processor.typeKey === typeKey
      ? [{ value: listed.entry.id, label: listed.entry.name }]
      : [],
  );
  const chosen = presets.find((option) => option.value === preset)?.value ?? presets[0]?.value;
  const args = { view: shown.panel, processorId: processor };
  return (
    <>
      <div className="ag-inspector-row">
        <TextField label="Save its settings as" value={name} onValueChange={setName} />
        <CommandButton
          id="library.save-preset"
          label="Save as preset"
          commands={commands}
          args={{ ...args, name }}
          compact
        />
      </div>
      {chosen === undefined ? (
        <p className="ag-panel-note">Your library keeps no preset of this processor.</p>
      ) : (
        <div className="ag-inspector-row">
          <OptionSelect label="Preset" value={chosen} options={presets} onValueChange={setPreset} />
          <CommandButton
            id="library.apply-preset"
            label="Apply preset"
            commands={commands}
            args={{ ...args, entry: chosen }}
            compact
          />
        </div>
      )}
    </>
  );
}

/** Saving the rack to the library under a name, and a selected processor's settings as a preset. */
export function LibraryControls({
  shown,
  library,
  commands,
}: {
  readonly shown: ShownRack;
  readonly library: Observable<SavedProcessingState>;
  readonly commands: PanelCommands;
}): ReactNode {
  const [name, setName] = useState('');
  const [only, ...more] = shown.selected;
  const one = more.length === 0 ? only : undefined;
  return (
    <section className="ag-inspector-section" aria-label="Your library">
      <h3 className="ag-inspector-heading">Your library</h3>
      <div className="ag-inspector-row">
        <TextField label="Save the rack as" value={name} onValueChange={setName} />
        <CommandButton
          id="library.save-chain"
          label="Save chain"
          commands={commands}
          args={{ view: shown.panel, name }}
          compact
        />
      </div>
      {one === undefined ? (
        <p className="ag-panel-note">
          Select one processor to save its settings or apply a preset.
        </p>
      ) : (
        <PresetControls processor={one} shown={shown} library={library} commands={commands} />
      )}
    </section>
  );
}
