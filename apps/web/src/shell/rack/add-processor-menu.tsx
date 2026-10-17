/**
 * The menu that adds a processor (REQ-AUDIO-017): every type this build has,
 * grouped by category in the catalogue's order, each with its glyph where the
 * vocabulary has one, and each entry the command that adds one where the
 * menu's arguments place it, unavailable with the command's own reason.
 */

import type { ReactNode } from 'react';

import { Button, ButtonTone, Icon, IconButton, Menu } from '@audiogubbins/design-system';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

import { CATEGORY_NAMES, processorLabel } from '../../commands/rack-words.js';
import type { PanelCommands } from '../command-button.js';
import { PROCESSOR_GLYPHS } from './processor-glyphs.js';

/** How the control that opens the menu is drawn: the panel's call to action, a button, or a glyph. */
export const AddLook = {
  CallToAction: 'call-to-action',
  Secondary: 'secondary',
  Glyph: 'glyph',
} as const;

/** How the control that opens the menu is drawn. */
export type AddLook = (typeof AddLook)[keyof typeof AddLook];

/** The control that opens the menu, named `label`, drawn as `look` says. */
function trigger(label: string, look: AddLook): ReactNode {
  switch (look) {
    case AddLook.Glyph:
      return <IconButton icon="add" label={label} compact />;
    case AddLook.CallToAction:
      return (
        <Button compact tone={ButtonTone.Primary}>
          <Icon name="add" />
          {label}
        </Button>
      );
    case AddLook.Secondary:
      return (
        <Button compact tone={ButtonTone.Neutral}>
          <Icon name="add" />
          {label}
        </Button>
      );
  }
}

/** The menu that adds a processor where `args` place it, its types by category in the catalogue's order. */
export function AddProcessorMenu({
  label,
  args,
  commands,
  look = AddLook.Secondary,
}: {
  readonly label: string;
  readonly args: Readonly<Record<string, string | number>>;
  readonly commands: PanelCommands;
  readonly look?: AddLook;
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
      trigger={trigger(label, look)}
      groups={[...categories].map(([key, category]) => ({
        key,
        label: category.label,
        items: category.typeKeys.map((typeKey) => {
          const icon = PROCESSOR_GLYPHS.get(typeKey);
          return {
            key: typeKey,
            label: processorLabel(typeKey),
            ...(icon === undefined ? {} : { icon }),
            ...(reason === undefined ? {} : { unavailableReason: reason }),
            onSelect: () => {
              commands.run('rack.add-processor', { ...args, typeKey });
            },
          };
        }),
      }))}
    />
  );
}
