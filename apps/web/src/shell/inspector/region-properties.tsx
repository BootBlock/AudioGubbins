/**
 * A region's properties in the Inspector (REQ-EDIT-014): its name and tags,
 * typed and kept by the region commands, its loop and crossfade, and its own
 * processing in the order it was made. Each field starts from what the project
 * holds, and starts again whenever the project's value changes, by undo or by
 * another view.
 */

import { useId, useState, type ReactNode } from 'react';

import { TextField } from '@audiogubbins/design-system';
import type { Region } from '@audiogubbins/domain';

import { loopAbsence } from '../../commands/region-property-commands.js';
import { counted } from '../../wording.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { regionOperationWords, type EditWording } from './edit-words.js';
import type { InspectedRegion } from './inspected.js';

/** What the region controls are given. */
interface RegionControls {
  readonly panel: string;
  readonly region: Region;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;
}

/** A field kept by `command`, its value given as `argument`, with the button that keeps it. */
function KeptField({
  label,
  command,
  argument,
  initial,
  controls,
}: {
  readonly label: string;
  readonly command: string;
  readonly argument: string;
  readonly initial: string;
  readonly controls: RegionControls;
}): ReactNode {
  const [typed, setTyped] = useState(initial);
  const [kept, setKept] = useState(initial);
  // Started again from the project's value whenever it changes, by this
  // field's own command, an undo or another view, while the field stays where
  // it is, and the focus in it.
  if (kept !== initial) {
    setKept(initial);
    setTyped(initial);
  }
  const args = { view: controls.panel, region: controls.region.id, [argument]: typed };
  return (
    <div className="ag-inspector-row">
      <TextField
        label={label}
        value={typed}
        onValueChange={setTyped}
        onSubmit={() => {
          controls.commands.run(command, args);
        }}
      />
      <CommandButton
        id={command}
        label={controls.labelFor(command)}
        commands={controls.commands}
        args={args}
        compact
      />
    </div>
  );
}

/** The crossfade typed, and the control that loops the selection with it. */
function LoopField({ controls }: { readonly controls: RegionControls }): ReactNode {
  const [crossfade, setCrossfade] = useState('0');
  const args = {
    view: controls.panel,
    region: controls.region.id,
    crossfade: crossfade.trim() === '' ? Number.NaN : Number(crossfade),
  };
  return (
    <div className="ag-inspector-row">
      <TextField
        label="Crossfade in frames"
        value={crossfade}
        onValueChange={setCrossfade}
        onSubmit={() => {
          controls.commands.run('region.loop', args);
        }}
      />
      <CommandButton
        id="region.loop"
        label={controls.labelFor('region.loop')}
        commands={controls.commands}
        args={args}
        compact
      />
    </div>
  );
}

/** Whether the region loops, and the controls that loop it or stop it. */
function LoopControls({
  inspected,
  controls,
  words,
}: {
  readonly inspected: InspectedRegion;
  readonly controls: RegionControls;
  readonly words: EditWording;
}): ReactNode {
  const loop = inspected.placed?.loop;
  const args = { view: controls.panel, region: controls.region.id };
  return (
    <div className="ag-inspector-controls">
      <p>
        {loop === undefined
          ? 'It does not loop.'
          : `It loops between ${words.position(loop.loopStart)} and ${words.position(loop.loopEnd)} of the region, with a crossfade of ${counted(loop.crossfadeLength, 'frame', 'frames')}.`}
      </p>
      {inspected.shownAlone ? (
        <LoopField controls={controls} />
      ) : (
        <div className="ag-inspector-row">
          <p className="ag-panel-note">
            Open the region in a view of its own to loop a part of it.
          </p>
          <CommandButton
            id="region.open"
            label={controls.labelFor('region.open')}
            commands={controls.commands}
            args={args}
            compact
          />
        </div>
      )}
      {/* Kept while the region does not loop, saying so, so the focus stays
          on it once it is pressed. */}
      <CommandButton
        id="region.clear-loop"
        label={controls.labelFor('region.clear-loop')}
        commands={controls.commands}
        args={args}
        refusal={loopAbsence(controls.region)}
        compact
      />
    </div>
  );
}

/** The properties of the region the view acts on. */
export function RegionProperties({
  panel,
  inspected,
  commands,
  labelFor,
  words,
}: {
  readonly panel: string;
  readonly inspected: InspectedRegion;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;
  readonly words: EditWording;
}): ReactNode {
  const { region, placed } = inspected;
  const controls: RegionControls = { panel, region, commands, labelFor };
  const tags = region.tags.join(', ');
  const heading = useId();
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        {`Region: ${region.displayName}`}
      </h3>
      <p>
        {placed === undefined
          ? 'Nothing of it is left: the edits made since it was placed removed all of its audio.'
          : `From ${words.position(placed.start)}, ${counted(placed.length, 'frame', 'frames')} long.`}
      </p>
      {/* Keyed by the region, so a draft typed for one is never shown for
          another, and a change to its value starts the field again in place. */}
      <KeptField
        key={`name:${region.id}`}
        label="Name"
        command="region.rename"
        argument="name"
        initial={region.displayName}
        controls={controls}
      />
      <KeptField
        key={`tags:${region.id}`}
        label="Tags, separated by commas"
        command="region.set-tags"
        argument="tags"
        initial={tags}
        controls={controls}
      />
      <LoopControls key={region.id} inspected={inspected} controls={controls} words={words} />
      <h4 className="ag-inspector-heading">Its own processing</h4>
      {region.operations.length === 0 ? (
        <p>None.</p>
      ) : (
        <ol className="ag-inspector-edits">
          {region.operations.map((operation) => (
            <li key={operation.id}>{regionOperationWords(operation, words)}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
