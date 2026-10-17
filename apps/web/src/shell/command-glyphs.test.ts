import { describe, expect, it } from 'vitest';

import { shellCommands } from '../commands/shell-commands.js';
import { PANEL_DESCRIPTORS } from '../panel-descriptors.js';
import { COMMAND_GLYPHS } from './command-glyphs.js';

describe('the glyph of each command', () => {
  it('names only commands the application registers', () => {
    // The table is keyed by identifier, so a command renamed or removed would
    // leave its glyph behind under the old name, and the menus, the palette and
    // the buttons would draw the command bare with nothing to say why.
    const registered = new Set<string>(
      shellCommands(PANEL_DESCRIPTORS).map((command) => command.id),
    );
    const strays = [...COMMAND_GLYPHS.keys()].filter((id) => !registered.has(id));

    expect(strays).toEqual([]);
  });
});
