/**
 * One chain of a rack as the Effects rack panel draws it (ADR-0060): its slots
 * in signal order, a parallel group's branches nested under it, each processor
 * with its name, which selects it, its switch and solo, its mix, why it cannot
 * run where its model is missing, a handle that moves it by pointer or arrow
 * keys, and its controls once selected.
 *
 * Every control runs a command, naming its slot, so a control acts on the
 * slot it is drawn beside whatever is selected (`slot-controls.tsx`). The
 * lists are keyed by slot, so a change updates them in place and a moved
 * slot keeps the focus it had.
 */

import type { DragEvent, ReactNode } from 'react';

import { Button, OptionSelect } from '@audiogubbins/design-system';
import {
  SummingLaw,
  type ChainSlot,
  type ParallelGroup,
  type ProcessorInstance,
  type SlotPlace,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { quoted } from '@audiogubbins/text';

import { LAW_NAMES } from '../../commands/rack-arguments.js';
import { processorLabel } from '../../commands/rack-words.js';
import { AddProcessorMenu } from './add-processor-menu.js';
import { SLOT_DRAG, placeArgs, type ChainParts } from './chain-parts.js';
import { ProcessorControls } from './processor-controls.js';
import { MoveHandle, SlotActions, SlotSwitches } from './slot-controls.js';

/** One processor of the chain. */
function ProcessorRow({
  processor,
  parts,
}: {
  readonly processor: ProcessorInstance;
  readonly parts: ChainParts;
}): ReactNode {
  const descriptor = PROCESSOR_CATALOGUE.get(processor.typeKey);
  const name = quoted(processorLabel(processor.typeKey));
  const selected = parts.selected.includes(processor.id);
  const cannot = parts.gate(processor);
  return (
    <>
      <div className="ag-rack-slot-head">
        <MoveHandle slot={processor} name={name} parts={parts} />
        <Button
          compact
          tone="quiet"
          aria-pressed={selected}
          label={`${processorLabel(processor.typeKey)}${selected ? ', selected' : ''}`}
          onClick={(event) => {
            parts.commands.run('editor.select-processor', {
              view: parts.panel,
              processorId: processor.id,
              extend: event.shiftKey || event.ctrlKey || event.metaKey,
            });
          }}
        >
          {processorLabel(processor.typeKey)}
        </Button>
        {!processor.enabled && <span className="ag-panel-note">Bypassed</span>}
      </div>
      {cannot !== undefined && <p className="ag-panel-note">{`It cannot run: ${cannot}`}</p>}
      <SlotSwitches slot={processor} name={name} parts={parts} />
      <SlotActions slot={processor} parts={parts} />
      {selected && descriptor !== undefined && (
        <ProcessorControls
          processor={processor}
          descriptor={descriptor}
          panel={parts.panel}
          commands={parts.commands}
        />
      )}
    </>
  );
}

const LAW_OPTIONS = Object.values(SummingLaw).map((law) => ({ value: law, label: LAW_NAMES[law] }));

/** A parallel group of the chain: its controls, and each branch as a list of its own. */
function GroupRow({
  group,
  parts,
}: {
  readonly group: ParallelGroup;
  readonly parts: ChainParts;
}): ReactNode {
  const name = 'the parallel group';
  return (
    <>
      <div className="ag-rack-slot-head">
        <MoveHandle slot={group} name={name} parts={parts} />
        <span className="ag-analysis-step-name">Parallel group</span>
        <OptionSelect
          label="Adds its branches by"
          value={group.summing}
          options={LAW_OPTIONS}
          onValueChange={(law) => {
            parts.commands.run('rack.set-group-law', { view: parts.panel, slot: group.id, law });
          }}
        />
      </div>
      <SlotSwitches slot={group} name={name} parts={parts} />
      <SlotActions slot={group} parts={parts} />
      {group.branches.map((branch, index) => (
        <section
          // A branch has no identity but its place in its group.
          key={index}
          className="ag-rack-branch"
          aria-label={`Branch ${String(index + 1)}`}
        >
          <h4 className="ag-inspector-heading">{`Branch ${String(index + 1)}`}</h4>
          <SlotList
            slots={branch.slots}
            group={{ id: group.id, branch: index }}
            parts={parts}
            empty="Empty: it passes the group’s input on, the dry path."
          />
          <AddProcessorMenu
            label={`Add to branch ${String(index + 1)}`}
            args={placeArgs(parts, { id: group.id, branch: index })}
            commands={parts.commands}
          />
        </section>
      ))}
    </>
  );
}

/**
 * The slots of one list of the chain, in signal order: the chain's own, or a
 * branch's. A slot dropped on another goes before it, in its list.
 */
export function SlotList({
  slots,
  group,
  parts,
  empty,
}: {
  readonly slots: readonly ChainSlot[];
  readonly group: SlotPlace['group'];
  readonly parts: ChainParts;
  readonly empty: string;
}): ReactNode {
  if (slots.length === 0) return <p className="ag-panel-note">{empty}</p>;
  const dropAt = (event: DragEvent<HTMLLIElement>, at: number): void => {
    const id = event.dataTransfer.getData(SLOT_DRAG);
    if (id === '') return;
    event.preventDefault();
    // The place is stated as the list stands without the slot moved, so one
    // moved down its own list goes before the slot dropped on, one place up.
    const from = slots.findIndex((slot) => slot.id === id);
    const index = from !== -1 && from < at ? at - 1 : at;
    parts.commands.run('rack.move-processor', { ...placeArgs(parts, group, index), slot: id });
  };
  return (
    <ol className="ag-rack-slots">
      {slots.map((slot, index) => (
        <li
          key={slot.id}
          className="ag-rack-slot"
          data-ag-bypassed={!slot.enabled}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(SLOT_DRAG)) event.preventDefault();
          }}
          onDrop={(event) => {
            dropAt(event, index);
          }}
        >
          {slot.kind === 'processor' ? (
            <ProcessorRow processor={slot} parts={parts} />
          ) : (
            <GroupRow group={slot} parts={parts} />
          )}
        </li>
      ))}
    </ol>
  );
}
