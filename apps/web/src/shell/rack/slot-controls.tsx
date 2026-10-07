/**
 * What every slot of a rack has, processor or group (ADR-0060): a handle that
 * moves it by pointer or by the arrow keys, its switch, solo and mix, and the
 * buttons that move it along its list and remove it. Each runs the command of
 * its name, naming the slot.
 */

import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';

import { Button, ToggleSwitch, ValueSlider } from '@audiogubbins/design-system';
import type { ChainSlot } from '@audiogubbins/domain';

import { CommandButton } from '../command-button.js';
import { SLOT_DRAG, type ChainParts } from './chain-parts.js';

/** The handle that moves a slot: dragged by a pointer, or stepped by the arrow keys. */
export function MoveHandle({
  slot,
  name,
  parts,
}: {
  readonly slot: ChainSlot;
  readonly name: string;
  readonly parts: ChainParts;
}): ReactNode {
  const move = (direction: 'up' | 'down'): void => {
    parts.commands.run('rack.move-processor', { view: parts.panel, slot: slot.id, direction });
  };
  return (
    <Button
      compact
      tone="quiet"
      label={`Move ${name}: drag it, or press the up or down arrow`}
      draggable
      onDragStart={(event: DragEvent<HTMLButtonElement>) => {
        event.dataTransfer.setData(SLOT_DRAG, slot.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        move(event.key === 'ArrowUp' ? 'up' : 'down');
      }}
    >
      ⠿
    </Button>
  );
}

/** The switch, solo and mix every slot has. */
export function SlotSwitches({
  slot,
  name,
  parts,
}: {
  readonly slot: ChainSlot;
  readonly name: string;
  readonly parts: ChainParts;
}): ReactNode {
  const { commands, panel } = parts;
  const [moving, setMoving] = useState<number | undefined>(undefined);
  const mix = Math.round((moving ?? slot.mix) * 100);
  return (
    <>
      <div className="ag-inspector-row">
        <ToggleSwitch
          label={`Use ${name}`}
          checked={slot.enabled}
          onCheckedChange={(enabled) => {
            commands.run('rack.set-enabled', { view: panel, slot: slot.id, enabled });
          }}
          description={slot.enabled ? 'On.' : 'Bypassed: it passes its input on unchanged.'}
        />
        <ToggleSwitch
          label={`Solo ${name}`}
          checked={slot.soloed}
          onCheckedChange={(soloed) => {
            commands.run('rack.set-soloed', { view: panel, slot: slot.id, soloed });
          }}
        />
      </div>
      <ValueSlider
        label={`Mix of ${name}`}
        value={mix}
        minimum={0}
        maximum={100}
        step={1}
        onValueChange={(percent) => {
          setMoving(percent / 100);
        }}
        onValueCommit={(percent) => {
          setMoving(undefined);
          commands.run('rack.set-mix', { view: panel, slot: slot.id, mix: percent / 100 });
        }}
        describeValue={(percent) => `${String(percent)} per cent processed`}
        displayValue={`${String(mix)}%`}
      />
    </>
  );
}

/** The buttons that move a slot up and down its list and remove it. */
export function SlotActions({
  slot,
  parts,
}: {
  readonly slot: ChainSlot;
  readonly parts: ChainParts;
}) {
  const { commands, panel } = parts;
  return (
    <div className="ag-inspector-row">
      <CommandButton
        id="rack.move-processor"
        label="Move up"
        commands={commands}
        args={{ view: panel, slot: slot.id, direction: 'up' }}
        compact
      />
      <CommandButton
        id="rack.move-processor"
        label="Move down"
        commands={commands}
        args={{ view: panel, slot: slot.id, direction: 'down' }}
        compact
      />
      <CommandButton
        id="rack.remove-processor"
        label="Remove"
        commands={commands}
        args={{ view: panel, slot: slot.id }}
        tone="destructive"
        compact
      />
    </div>
  );
}
