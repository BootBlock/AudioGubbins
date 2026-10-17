/**
 * One chain of a rack as the Effects rack panel draws it (ADR-0060): its slots
 * in signal order as a row of cards, a parallel group's branches nested in its
 * card, each processor with its power switch, its name, which selects it, its
 * solo and a handle that moves it by pointer or arrow keys, what it sets at a
 * glance, why it cannot run where its model is missing, its mix, and the
 * buttons that move and remove it; and the controls of each processor selected,
 * under the row (`processor-controls.tsx`).
 *
 * Every control runs a command, naming its slot, so a control acts on the
 * slot it is drawn beside whatever is selected (`slot-controls.tsx`). The
 * lists are keyed by slot, so a change updates them in place and a moved
 * slot keeps the focus it had.
 */

import { useId, type DragEvent, type ReactNode } from 'react';

import { Badge, Button, Icon, IconSize, OptionSelect } from '@audiogubbins/design-system';
import {
  SummingLaw,
  processorsOf,
  type ChainSlot,
  type ParallelGroup,
  type ProcessorInstance,
  type SlotPlace,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { quoted } from '@audiogubbins/text';

import { LAW_NAMES } from '../../commands/rack-arguments.js';
import { processorLabel } from '../../commands/rack-words.js';
import { AddLook, AddProcessorMenu } from './add-processor-menu.js';
import { SLOT_DRAG, placeArgs, type ChainParts } from './chain-parts.js';
import { ProcessorControls } from './processor-controls.js';
import { PROCESSOR_GLYPHS } from './processor-glyphs.js';
import { ProcessorSummary } from './slot-summary.js';
import { MoveHandle, SlotActions, SlotMix, SlotPower, SlotSolo } from './slot-controls.js';

/** The foot of every card: whether it is bypassed, and its mix. */
function SlotFoot({
  slot,
  name,
  parts,
  children,
}: {
  readonly slot: ChainSlot;
  readonly name: string;
  readonly parts: ChainParts;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <>
      <div className="ag-rack-slot-foot">
        {children}
        {!slot.enabled && <Badge>Bypassed</Badge>}
        <SlotMix slot={slot} name={name} parts={parts} />
      </div>
      <SlotActions slot={slot} parts={parts} />
    </>
  );
}

/** One processor of the chain, as its card. */
function ProcessorRow({
  processor,
  parts,
  nested,
}: {
  readonly processor: ProcessorInstance;
  readonly parts: ChainParts;
  /** Whether it is a branch's, nested in its group's card. */
  readonly nested: boolean;
}): ReactNode {
  const descriptor = PROCESSOR_CATALOGUE.get(processor.typeKey);
  const label = processorLabel(processor.typeKey);
  const name = quoted(label);
  const selected = parts.selected.includes(processor.id);
  const cannot = parts.gate(processor);
  return (
    <>
      <div className="ag-rack-slot-head">
        <SlotPower slot={processor} name={name} parts={parts} />
        <Button
          compact
          tone="quiet"
          aria-pressed={selected}
          label={`${label}${selected ? ', selected' : ''}`}
          onClick={(event) => {
            parts.commands.run('editor.select-processor', {
              view: parts.panel,
              processorId: processor.id,
              extend: event.shiftKey || event.ctrlKey || event.metaKey,
            });
          }}
        >
          {label}
        </Button>
        <SlotSolo slot={processor} name={name} parts={parts} />
        <MoveHandle slot={processor} name={name} parts={parts} />
      </div>
      {/* A card nested in a branch stays small: what it sets is in its full
          controls, under the row once it is selected. */}
      {descriptor !== undefined && !nested && (
        <div className="ag-rack-slot-body">
          <ProcessorSummary
            descriptor={descriptor}
            parts={{ processor, panel: parts.panel, commands: parts.commands }}
            sampleRate={parts.sampleRate}
          />
        </div>
      )}
      {cannot !== undefined && (
        <p className="ag-rack-slot-cannot">
          <Icon name="unavailable" size={IconSize.Inline} />
          {`It cannot run: ${cannot}`}
        </p>
      )}
      <SlotFoot slot={processor} name={name} parts={parts} />
    </>
  );
}

const LAW_OPTIONS = Object.values(SummingLaw).map((law) => ({ value: law, label: LAW_NAMES[law] }));

/** A parallel group of the chain, as its card: its controls, and each branch as a list of its own. */
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
        <SlotPower slot={group} name={name} parts={parts} />
        <span className="ag-rack-slot-name">Parallel group</span>
        <SlotSolo slot={group} name={name} parts={parts} />
        <MoveHandle slot={group} name={name} parts={parts} />
      </div>
      <div className="ag-rack-branches">
        {group.branches.map((branch, index) => (
          <section
            // A branch has no identity but its place in its group.
            key={index}
            className="ag-rack-branch"
            aria-label={`Branch ${String(index + 1)}`}
          >
            <div className="ag-rack-branch-head">
              <h4 className="ag-rack-branch-name">{`Branch ${String(index + 1)}`}</h4>
              <AddProcessorMenu
                label={`Add to branch ${String(index + 1)}`}
                args={placeArgs(parts, { id: group.id, branch: index })}
                commands={parts.commands}
                look={AddLook.Glyph}
              />
            </div>
            <SlotList
              slots={branch.slots}
              group={{ id: group.id, branch: index }}
              parts={parts}
              empty="Empty: it passes the group’s input on, the dry path."
            />
          </section>
        ))}
      </div>
      <SlotFoot slot={group} name={name} parts={parts}>
        <OptionSelect
          label="Adds its branches by"
          value={group.summing}
          options={LAW_OPTIONS}
          onValueChange={(law) => {
            parts.commands.run('rack.set-group-law', { view: parts.panel, slot: group.id, law });
          }}
        />
      </SlotFoot>
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
  if (slots.length === 0) return <p className="ag-rack-empty">{empty}</p>;
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
    <ol className="ag-rack-slots" data-ag-nested={group === undefined ? undefined : ''}>
      {slots.map((slot, index) => (
        <li
          key={slot.id}
          className="ag-rack-slot"
          data-ag-kind={slot.kind}
          data-ag-bypassed={!slot.enabled}
          data-ag-selected={slot.kind === 'processor' && parts.selected.includes(slot.id)}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(SLOT_DRAG)) event.preventDefault();
          }}
          onDrop={(event) => {
            dropAt(event, index);
          }}
        >
          {slot.kind === 'processor' ? (
            <ProcessorRow processor={slot} parts={parts} nested={group !== undefined} />
          ) : (
            <GroupRow group={slot} parts={parts} />
          )}
        </li>
      ))}
    </ol>
  );
}

/** The controls of one processor selected, under a heading naming it. */
function SelectedProcessor({
  processor,
  parts,
}: {
  readonly processor: ProcessorInstance;
  readonly parts: ChainParts;
}): ReactNode {
  const heading = useId();
  const descriptor = PROCESSOR_CATALOGUE.get(processor.typeKey);
  if (descriptor === undefined) return null;
  return (
    <section
      className="ag-rack-processor"
      aria-labelledby={heading}
      data-ag-bypassed={!processor.enabled}
    >
      <h3 className="ag-rack-processor-name" id={heading}>
        <Icon name={PROCESSOR_GLYPHS.get(processor.typeKey) ?? 'effects-rack'} />
        {`Processor: ${descriptor.label}${processor.enabled ? '' : ', bypassed'}`}
      </h3>
      <ProcessorControls
        processor={processor}
        descriptor={descriptor}
        panel={parts.panel}
        commands={parts.commands}
        sampleRate={parts.sampleRate}
      />
    </section>
  );
}

/** The controls of each processor of `slots` that is selected, branches included, in signal order. */
export function SelectedProcessors({
  slots,
  parts,
}: {
  readonly slots: readonly ChainSlot[];
  readonly parts: ChainParts;
}): ReactNode {
  return [...processorsOf(slots)]
    .filter((processor) => parts.selected.includes(processor.id))
    .map((processor) => (
      <SelectedProcessor key={processor.id} processor={processor} parts={parts} />
    ));
}
