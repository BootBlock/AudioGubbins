/**
 * What the menu bar contains.
 *
 * A menu entry is a command and, where the command acts on one thing of many,
 * the target it acts on: a workspace to switch to, a panel to show. The label,
 * the shortcut and the reason a command cannot be chosen are read from the
 * registry, and a target brings its own name and its own reason from the
 * contract that owns it (REQ-EDIT-073). Nothing here decides whether something
 * is allowed, so a menu can never disagree with the palette or with a shortcut
 * about it.
 *
 * Two of the menus are built from state rather than from a fixed list. The
 * workspaces a user can switch to and the panels they can open both change
 * while the application runs, and REQ-UX-058 requires switching between layouts
 * to be something they can actually do.
 */

import {
  commandId,
  shortcutOffered,
  type CommandId,
  type CommandRegistry,
  type KeyboardConvention,
  type ShortcutProfile,
} from '@audiogubbins/commands';
import type { MenuGroup, MenuItemDescriptor } from '@audiogubbins/design-system';
import type { KeyboardLayout } from '@audiogubbins/input';
import {
  activePanelOf,
  listedName,
  titleOf,
  type PanelDescriptor,
  type PanelKind,
} from '@audiogubbins/workspace';

import { showPanelCommandId } from '../commands/panel-commands.js';
import type { ShellContext } from '../commands/shell-context.js';
import type { WorkspaceState } from '../state/workspace-store.js';

/** One menu of the menu bar. */
export interface ShellMenu {
  readonly label: string;
  readonly groups: readonly MenuGroup[];
}

/** What the menus need in order to describe themselves. */
export interface MenuSources {
  readonly registry: CommandRegistry<ShellContext>;
  readonly context: ShellContext;
  readonly profile: ShortcutProfile;
  readonly convention: KeyboardConvention;

  /** What the user's keyboard layout types, which each shortcut is written in. */
  readonly layout: KeyboardLayout;

  readonly descriptors: ReadonlyMap<PanelKind, PanelDescriptor>;

  /**
   * The workspace state the menus describe.
   *
   * Passed rather than read from the context, although the context can reach
   * it. A store keeps its identity when its contents change, so a menu built
   * from one would be rebuilt by nothing: the Workspace menu lists the layouts
   * the user has and the panels that are open, and both move while the
   * application runs.
   */
  readonly workspace: WorkspaceState;

  /** Runs a command, optionally naming what it should act on. */
  readonly run: (id: CommandId, args?: Readonly<Record<string, string>>) => void;
}

/** Builds every menu of the menu bar. */
export function shellMenus(sources: MenuSources): readonly ShellMenu[] {
  const { registry, context, profile, convention, layout, descriptors, workspace, run } = sources;

  /**
   * The shortcut shown beside an entry, when the command has one the user can
   * press. A binding the browser or the system takes is not one: shown, it
   * would teach a press that closes the tab.
   */
  const shortcutFor = (id: CommandId): string | undefined =>
    shortcutOffered(profile, id, convention, layout);

  /**
   * The command a menu entry names.
   *
   * A menu naming a command that is not registered is a wiring mistake in this
   * build, not something a user did, so it fails loudly rather than leaving the
   * entry out, where a menu would be missing an action with nothing anywhere to
   * say so. A test builds every menu against the real registry, so no such
   * build ships.
   */
  const commandFor = (id: string) => {
    const command = registry.get(commandId(id));
    if (command === undefined) {
      throw new Error(`The menu names a command that is not registered: "${id}".`);
    }
    return command;
  };

  /** An entry that runs a command with no target. */
  const entry = (id: string): MenuItemDescriptor => {
    const command = commandFor(id);

    const availability = command.availability(context);
    const shortcut = shortcutFor(command.id);

    return {
      key: command.id,
      label: command.label,
      ...(shortcut === undefined ? {} : { shortcut }),
      ...(availability.available ? {} : { unavailableReason: availability.reason }),
      onSelect: () => {
        run(command.id);
      },
    };
  };

  /**
   * An entry that runs a command against a named target.
   *
   * The label and the reason come from the target rather than from the command,
   * because six entries running one command all carry its label otherwise, and
   * a menu of six identical rows is no menu at all.
   */
  const targetEntry = (
    id: string,
    key: string,
    label: string,
    unavailableReason: string | undefined,
    args: Readonly<Record<string, string>>,
  ): MenuItemDescriptor => {
    const command = commandFor(id);

    return {
      key,
      label,
      ...(unavailableReason === undefined ? {} : { unavailableReason }),
      onSelect: () => {
        run(command.id, args);
      },
    };
  };

  const group = (key: string, ids: readonly string[]): MenuGroup => ({
    key,
    items: ids.map(entry),
  });

  /** A group whose entries need its name to be understood. */
  const labelled = (key: string, label: string, ids: readonly string[]): MenuGroup => ({
    ...group(key, ids),
    label,
  });

  /**
   * The heading of the entries that move and size the panel in use.
   *
   * Names the panel, since opening the menu bar moves focus out of the dock and
   * nothing else in the menu says which panel "this panel" is: unnamed, the
   * user would learn it only from the sentence after the move.
   */
  const arrangementHeading = (): string => {
    const panel = activePanelOf(workspace.layout);
    return panel === undefined
      ? 'Arrange this panel'
      : `Arrange the ${titleOf(panel, descriptors)} panel`;
  };

  /**
   * One entry per workspace, so switching is one gesture rather than three,
   * each named as the settings list it, a built-in one marked.
   */
  const workspaceList = (): MenuGroup => ({
    key: 'workspaces',
    label: 'Switch to a workspace',
    items: workspace.available.map((layout) =>
      targetEntry(
        'workspace.switch-to',
        `workspace:${layout.id}`,
        listedName(layout),
        context.workspace.switchProblem(layout.id),
        { layoutId: layout.id },
      ),
    ),
  });

  /** One entry per panel, so a panel the user closed has a way back. */
  const panelList = (): MenuGroup => ({
    key: 'panels',
    label: 'Show a panel',
    items: [...descriptors.values()].map((descriptor) =>
      targetEntry(
        showPanelCommandId(descriptor.kind),
        `panel:${descriptor.kind}`,
        descriptor.title,
        context.workspace.openingProblem(descriptor.kind),
        {},
      ),
    ),
  });

  return [
    {
      label: 'View',
      groups: [
        group('theme', ['view.theme-dark', 'view.theme-light', 'view.theme-system']),
        group('brightness', ['view.brighten', 'view.darken']),
        group('density', ['view.density-comfortable', 'view.density-compact']),
        group('palette', ['view.command-palette']),
      ],
    },
    {
      label: 'Workspace',
      groups: [
        workspaceList(),
        group('switching', ['workspace.switch-to']),
        panelList(),
        group('panel-actions', ['workspace.close-panel']),

        // Moving and sizing a panel, which the engine offers only to a mouse:
        // there is no drag-and-drop from a keyboard and none from a finger.
        labelled('arrangement', arrangementHeading(), [
          'workspace.move-panel-left',
          'workspace.move-panel-centre',
          'workspace.move-panel-right',
          'workspace.move-panel-bottom',
          'workspace.move-panel-floating',
          'workspace.grow-panel',
          'workspace.shrink-panel',
          'workspace.nudge-panel-left',
          'workspace.nudge-panel-right',
          'workspace.nudge-panel-up',
          'workspace.nudge-panel-down',
          'workspace.move-tab-earlier',
          'workspace.move-tab-later',
        ]),
        labelled('layout', 'This workspace', [
          'workspace.save-as',
          'workspace.duplicate',
          'workspace.reset',
          'workspace.delete',
          'workspace.restore',
        ]),
      ],
    },
    {
      label: 'Help',
      groups: [
        group('diagnostics', [
          'help.start-diagnostic-mode',
          'help.stop-diagnostic-mode',
          'help.clear-logs',
        ]),
        group('report', ['help.open-diagnostic-export']),
        group('settings', ['settings.open']),
      ],
    },
  ];
}
