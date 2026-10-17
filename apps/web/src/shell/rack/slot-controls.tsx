/**
 * What every slot of a rack has, processor or group (ADR-0060): its power
 * switch, its solo and a handle that moves it by pointer or by the arrow
 * keys, at the head of its card; its mix at its foot; and the buttons that
 * move it along its list and remove it. Each runs the command of its name,
 * naming the slot, unavailable with the command's own reason.
 */

import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';

import { ButtonTone, IconButton, PowerSwitch, ValueSlider } from '@audiogubbins/design-system';
import type { ChainSlot } from '@audiogubbins/domain';

import { optionalReason } from '../optional-reason.js';
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
    <IconButton
      icon="drag-handle"
      compact
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
    />
  );
}

/** The power switch that uses or bypasses a slot. */
export function SlotPower({
  slot,
  name,
  parts,
}: {
  readonly slot: ChainSlot;
  readonly name: string;
  readonly parts: ChainParts;
}): ReactNode {
  const { commands, panel } = parts;
  return (
    <PowerSwitch
      label={`Use ${name}`}
      checked={slot.enabled}
      {...(slot.enabled ? {} : { hint: 'Bypassed: it passes its input on unchanged.' })}
      onCheckedChange={(enabled) => {
        commands.run('rack.set-enabled', { view: panel, slot: slot.id, enabled });
      }}
    />
  );
}

/** The solo that hears a slot alone. */
export function SlotSolo({
  slot,
  name,
  parts,
}: {
  readonly slot: ChainSlot;
  readonly name: string;
  readonly parts: ChainParts;
}): ReactNode {
  const { commands, panel } = parts;
  return (
    <IconButton
      icon="solo"
      compact
      label={`Solo ${name}`}
      pressed={slot.soloed}
      onClick={() => {
        commands.run('rack.set-soloed', { view: panel, slot: slot.id, soloed: !slot.soloed });
      }}
    />
  );
}

/** How much of a slot's processed sound is heard against its input, as a slider. */
export function SlotMix({
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
  );
}

/** The buttons that move a slot up and down its list and remove it. */
export function SlotActions({
  slot,
  parts,
}: {
  readonly slot: ChainSlot;
  readonly parts: ChainParts;
}): ReactNode {
  const { commands, panel } = parts;
  const button = (
    id: string,
    label: string,
    icon: 'step-up' | 'step-down' | 'delete',
    args: Readonly<Record<string, string>>,
  ): ReactNode => (
    <IconButton
      icon={icon}
      compact
      label={label}
      {...(icon === 'delete' ? { tone: ButtonTone.QuietDestructive } : {})}
      {...optionalReason(commands.unavailableReason(id, args))}
      onClick={() => {
        commands.run(id, args);
      }}
    />
  );
  return (
    <div className="ag-rack-slot-actions">
      {button('rack.move-processor', 'Move up', 'step-up', {
        view: panel,
        slot: slot.id,
        direction: 'up',
      })}
      {button('rack.move-processor', 'Move down', 'step-down', {
        view: panel,
        slot: slot.id,
        direction: 'down',
      })}
      {button('rack.remove-processor', 'Remove', 'delete', { view: panel, slot: slot.id })}
    </div>
  );
}
