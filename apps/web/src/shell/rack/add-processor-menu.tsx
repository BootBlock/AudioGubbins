/**
 * The menu that adds a processor (REQ-AUDIO-017): every type this build has,
 * grouped by category in the catalogue's order, each entry the command that
 * adds one where the menu's arguments place it, unavailable with the
 * command's own reason.
 */

import type { ReactNode } from 'react';

import { Button, Menu } from '@audiogubbins/design-system';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

import { CATEGORY_NAMES, processorLabel } from '../../commands/rack-words.js';
import type { PanelCommands } from '../command-button.js';

/** The menu that adds a processor where `args` place it, its types by category in the catalogue's order. */
export function AddProcessorMenu({
  label,
  args,
  commands,
}: {
  readonly label: string;
  readonly args: Readonly<Record<string, string | number>>;
  readonly commands: PanelCommands;
}): ReactNode {
  const reason = commands.unavailableReason('rack.add-processor');
  const categories = new Map<string, { label: string; typeKeys: string[] }>();
  for (const descriptor of PROCESSOR_CATALOGUE.values()) {
    const held = categories.get(descriptor.category) ?? {
      label: CATEGORY_NAMES[descriptor.category],
      typeKeys: [],
    };
    held.typeKeys.push(descriptor.typeKey);
    categories.set(descriptor.category, held);
  }
  return (
    <Menu
      label={label}
      trigger={
        <Button compact tone="neutral">
          {label}
        </Button>
      }
      groups={[...categories].map(([key, category]) => ({
        key,
        label: category.label,
        items: category.typeKeys.map((typeKey) => ({
          key: typeKey,
          label: processorLabel(typeKey),
          ...(reason === undefined ? {} : { unavailableReason: reason }),
          onSelect: () => {
            commands.run('rack.add-processor', { ...args, typeKey });
          },
        })),
      }))}
    />
  );
}
