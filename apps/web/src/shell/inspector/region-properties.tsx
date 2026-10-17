/**
 * A region's properties in the Inspector (REQ-EDIT-014): its name and tags,
 * typed and kept by the region commands, its loop and crossfade, how its loop
 * renders the effects upstream of it (ADR-0107), and its own processing in the
 * order it was made. Each field starts from what the project holds, and starts
 * again whenever the project's value changes, by undo or by another view.
 */

import { useState, type ReactNode } from 'react';

import { ButtonTone, OptionSelect, TextField } from '@audiogubbins/design-system';
import {
  DEFAULT_LOOP_CROSSFADE_SHAPE,
  type AnchoredLoop,
  type FadeShape,
  type LoopDefinition,
  type LoopRendering,
  type Region,
} from '@audiogubbins/domain';
import { counted } from '@audiogubbins/text';

import { loopAbsence } from '../../commands/region-property-commands.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { FADE_SHAPE_NAMES, regionOperationWords, type EditWording } from './edit-words.js';
import type { InspectedRegion } from './inspected.js';
import { InspectorPart, InspectorSubpart } from './inspector-part.js';
import {
  PROCESSING_ACROSS_LOOP_LABEL,
  PROCESSING_ACROSS_LOOP_NAMES,
  loopRenderingNote,
} from './loop-processing-words.js';

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
    <div className="ag-inspector-fields">
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

const SHAPE_OPTIONS = [...FADE_SHAPE_NAMES].map(([value, label]) => ({ value, label }));

/** The crossfade typed and its shape, and the control that loops the selection with them. */
function LoopField({ controls }: { readonly controls: RegionControls }): ReactNode {
  const [crossfade, setCrossfade] = useState('0');
  const [shape, setShape] = useState<FadeShape>(DEFAULT_LOOP_CROSSFADE_SHAPE);
  const args = {
    view: controls.panel,
    region: controls.region.id,
    crossfade: crossfade.trim() === '' ? Number.NaN : Number(crossfade),
    shape,
  };
  return (
    <div className="ag-inspector-fields">
      <TextField
        label="Crossfade in frames"
        value={crossfade}
        onValueChange={setCrossfade}
        onSubmit={() => {
          controls.commands.run('region.loop', args);
        }}
      />
      <OptionSelect
        label="Crossfade shape"
        value={shape}
        options={SHAPE_OPTIONS}
        onValueChange={(value) => {
          const chosen = SHAPE_OPTIONS.find((option) => option.value === value);
          if (chosen !== undefined) setShape(chosen.value);
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

const PROCESSING_OPTIONS = [...PROCESSING_ACROSS_LOOP_NAMES].map(([value, label]) => ({
  value,
  label,
}));

/**
 * How the region's loop renders the effects upstream of it, changed by the
 * region's command as it is chosen, and why it is not heard as chosen where it
 * is not (ADR-0107).
 */
function LoopProcessingField({
  loop,
  rendering,
  controls,
}: {
  readonly loop: AnchoredLoop;
  readonly rendering: LoopRendering | undefined;
  readonly controls: RegionControls;
}): ReactNode {
  const note = rendering === undefined ? undefined : loopRenderingNote(rendering);
  return (
    <>
      <OptionSelect
        label={PROCESSING_ACROSS_LOOP_LABEL}
        value={loop.processingAcrossLoop}
        options={PROCESSING_OPTIONS}
        onValueChange={(value) => {
          const chosen = PROCESSING_OPTIONS.find((option) => option.value === value);
          if (chosen === undefined) return;
          controls.commands.run('region.set-loop-processing', {
            view: controls.panel,
            region: controls.region.id,
            processing: chosen.value,
          });
        }}
      />
      {note !== undefined && <p className="ag-inspector-detail">{note}</p>}
    </>
  );
}

/**
 * How a loop sounds, in words: where it lies, its crossfade and the crossfade's
 * shape, and, where an edit since it was set left less audio before its start
 * than its crossfade reads, that the crossfade is heard shortened.
 */
function loopWords(loop: LoopDefinition, words: EditWording): string {
  const where = `It loops between ${words.position(loop.loopStart)} and ${words.position(loop.loopEnd)} of the region`;
  const shape = FADE_SHAPE_NAMES.get(loop.crossfadeShape)?.toLowerCase() ?? loop.crossfadeShape;
  const crossfade =
    loop.crossfadeLength === 0
      ? `${where}, with no crossfade.`
      : `${where}, with a crossfade of ${counted(loop.crossfadeLength, 'frame', 'frames')}, ${shape}.`;
  const kept = loop.crossfadeClampedFrom;
  return kept === undefined
    ? crossfade
    : `${crossfade} It was set to ${counted(kept, 'frame', 'frames')}; the region now holds too little audio before or within the loop for more.`;
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
  const kept = controls.region.loop;
  const args = { view: controls.panel, region: controls.region.id };
  return (
    <div className="ag-inspector-stack">
      <p className="ag-inspector-text">
        {loop === undefined ? 'It does not loop.' : loopWords(loop, words)}
      </p>
      {kept !== undefined && (
        <LoopProcessingField loop={kept} rendering={inspected.rendering} controls={controls} />
      )}
      {inspected.shownAlone ? (
        <LoopField controls={controls} />
      ) : (
        <div className="ag-inspector-fields">
          <p className="ag-inspector-detail">
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
        tone={ButtonTone.QuietDestructive}
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
  return (
    <InspectorPart heading={`Region: ${region.displayName}`} title="Region">
      <p className="ag-inspector-text">
        {placed === undefined
          ? 'Nothing of it is left: the edits made since it was placed removed all of its audio.'
          : `From ${words.position(placed.start)}, ${counted(placed.length, 'frame', 'frames')} long.`}
      </p>
      {/* Keyed by the region, so a draft typed for one is never shown for
          another, and a change to its value starts the field again in
          place. */}
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
      <InspectorSubpart
        heading="Its own processing"
        title="Own processing"
        summary={String(region.operations.length)}
      >
        {region.operations.length === 0 ? (
          <p className="ag-inspector-detail">None.</p>
        ) : (
          <ol className="ag-inspector-steps">
            {region.operations.map((operation) => (
              <li key={operation.id}>{regionOperationWords(operation, words)}</li>
            ))}
          </ol>
        )}
      </InspectorSubpart>
    </InspectorPart>
  );
}
