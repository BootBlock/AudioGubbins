/**
 * The Effects rack panel (ADR-0060, REQ-AUDIO-017, REQ-AUDIO-019): the rack
 * of the asset or region the editor in use acts on (`shown-rack.ts`), its
 * chain drawn in order with parallel groups nested (`chain-section.tsx`,
 * `chain-view.tsx`), the ranges of the target a chain processes, each opened
 * as a chain the same way, and what is done with a rack: adding a processor
 * by category, copying and pasting, saving it and its processors to the
 * library (`library-controls.tsx`), comparing it with before its latest
 * change, and hearing the original beside it.
 *
 * It reads the stores and runs commands; it writes nothing itself (`CLAUDE.md`
 * G2), and it follows every change to them, an undo included.
 */

import { useId, type ReactNode } from 'react';

import { chainsOfTarget, targetName } from '../../commands/rack-target.js';
import { CommandButton, useCommandReasons } from '../command-button.js';
import { SharedReasonNotes } from '../settings/reasoned-button.js';
import { AddProcessorMenu } from './add-processor-menu.js';
import { ChainSection, RangeRacks } from './chain-section.js';
import { HearingSwitch } from './hearing-switch.js';
import { LibraryControls, NO_LIBRARY } from './library-controls.js';
import { useShown, type RackContext, type ShownRack } from './shown-rack.js';

/** The commands of the bar at the head of the rack, and what each button says. */
const BAR: readonly (readonly [id: string, label: string])[] = [
  ['rack.copy', 'Copy'],
  ['rack.compare-before-change', 'Compare with before'],
  ['rack.remove-rack', 'Take the rack away'],
];

const BAR_IDS = BAR.map(([id]) => id);

/** What is done with the rack as a whole, whose reasons are said once above it. */
function RackBar({
  shown,
  context,
}: {
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  const reasons = useCommandReasons(context, BAR_IDS);
  return (
    <>
      <HearingSwitch hearing={context.hearing} commands={context} />
      <SharedReasonNotes reasons={reasons} />
      <div className="ag-inspector-row">
        {BAR.map(([id, label]) => (
          <CommandButton
            key={id}
            id={id}
            label={label}
            commands={context}
            args={{ view: shown.panel }}
            compact
            shared={reasons}
          />
        ))}
      </div>
    </>
  );
}

/** The rack of a target of the project. */
function ProjectRack({
  shown,
  context,
}: {
  readonly shown: ShownRack;
  readonly context: RackContext;
}): ReactNode {
  const heading = useId();
  const { rack, ranges } = chainsOfTarget(shown.target);
  const chain = rack === undefined ? undefined : shown.state.project.effectChains.get(rack);
  const args = { view: shown.panel };
  return (
    <>
      <section className="ag-inspector-section" aria-labelledby={heading}>
        <h3 className="ag-inspector-heading" id={heading}>
          {`Rack of ${targetName(shown.target)}`}
        </h3>
        <RackBar shown={shown} context={context} />
        {rack === undefined || chain === undefined ? (
          <>
            <p>It has no rack. Add a processor to give it one, or paste one.</p>
            <div className="ag-inspector-row">
              <AddProcessorMenu label="Add a processor" args={args} commands={context} />
              <CommandButton id="rack.paste" label="Paste" commands={context} args={args} compact />
            </div>
          </>
        ) : (
          <ChainSection id={rack} chain={chain} shown={shown} context={context} />
        )}
        <AddProcessorMenu
          label="Add over the selection"
          args={{ ...args, place: 'selection' }}
          commands={context}
        />
      </section>
      <RangeRacks ranges={ranges} shown={shown} context={context} />
      <LibraryControls
        shown={shown}
        library={context.projects?.savedProcessing ?? NO_LIBRARY}
        commands={context}
      />
    </>
  );
}

/** The Effects rack panel. */
export function RackPanel({
  title,
  context,
}: {
  readonly title: string;
  readonly context: RackContext;
}): ReactNode {
  const shown = useShown(context);
  return (
    <section className="ag-panel ag-rack">
      <h2 className="ag-panel-title">{title}</h2>
      {shown.kind === 'nothing' && <p>Open audio in an editor to see its rack here.</p>}
      {shown.kind === 'session' && (
        <>
          <p className="ag-editor-asset-name">{shown.view.name}</p>
          <p className="ag-panel-note">
            It is not part of the project, so it has no rack. Import a file to process it.
          </p>
        </>
      )}
      {shown.kind === 'project' && <ProjectRack shown={shown} context={context} />}
    </section>
  );
}
