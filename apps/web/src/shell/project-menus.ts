/**
 * The File and Edit menus: the project system's entries, built by the menu
 * bar's own entry builders so each reads its label, its shortcut and why it
 * cannot be chosen from the command it runs (REQ-EDIT-073, REQ-STOR-026,
 * REQ-STOR-193).
 *
 * The entries that need a name open the Projects dialogue at the section that
 * asks for it. Undo and Redo say what they would undo or redo, as the change
 * described itself, so a person knows before choosing.
 */

import type { MenuGroup, MenuItemDescriptor } from '@audiogubbins/design-system';
import { redoTarget, undoTarget } from '@audiogubbins/history';

import type { ShellContext } from '../commands/shell-context.js';
import { ProjectsSection } from '../state/interaction-store.js';

/** The menu bar's builders, as the project menus use them. */
export interface MenuBuilders {
  readonly context: ShellContext;

  /** An entry running a command with no target. */
  readonly entry: (id: string) => MenuItemDescriptor;

  /** An entry running a command against a target, named as the target. */
  readonly targetEntry: (
    id: string,
    key: string,
    label: string,
    unavailableReason: string | undefined,
    args: Readonly<Record<string, string>>,
  ) => MenuItemDescriptor;

  /** A group whose entries need its name to be understood. */
  readonly labelled: (key: string, label: string, ids: readonly string[]) => MenuGroup;
}

/** One menu of the menu bar. */
interface ProjectMenu {
  readonly label: string;
  readonly groups: readonly MenuGroup[];
}

/** An entry opening the Projects dialogue at a section. */
function dialogueEntry(
  builders: MenuBuilders,
  section: ProjectsSection,
  label: string,
): MenuItemDescriptor {
  const opening = builders.entry('file.projects');
  return builders.targetEntry(
    'file.projects',
    `projects:${section}`,
    label,
    opening.unavailableReason,
    { section },
  );
}

/** The Undo or Redo entry, naming the change it would undo or redo. */
function stepEntry(builders: MenuBuilders, id: 'edit.undo' | 'edit.redo'): MenuItemDescriptor {
  const plain = builders.entry(id);
  const open = builders.context.projects?.project.get();
  if (open?.kind !== 'open' || plain.unavailableReason !== undefined) return plain;
  const { history } = open.snapshot.model;
  const change = id === 'edit.undo' ? undoTarget(history) : redoTarget(history);
  return change === undefined ? plain : { ...plain, label: `${plain.label} ${change.description}` };
}

/** The File menu. */
function fileMenu(builders: MenuBuilders): ProjectMenu {
  const { entry, labelled } = builders;
  return {
    label: 'File',
    groups: [
      {
        key: 'projects',
        items: [
          dialogueEntry(builders, ProjectsSection.New, 'New project…'),
          dialogueEntry(builders, ProjectsSection.Open, 'Open project…'),
          entry('file.quick-edit'),
          entry('file.close-project'),
        ],
      },
      {
        key: 'this-project',
        label: 'This project',
        items: [
          dialogueEntry(builders, ProjectsSection.Current, 'Rename, fork or export…'),
          entry('file.import-audio'),
          entry('file.back-up-now'),
          entry('file.consolidate'),
          entry('file.delete-project'),
        ],
      },
      labelled('transfer', 'Export and import', [
        'file.export-bundle',
        'file.export-folder',
        'file.import-bundle',
        'file.import-folder',
      ]),
      labelled('ownership', 'Which tab changes it', [
        'project.request-control',
        'project.open-to-change',
        'project.open-to-read',
      ]),
      labelled('stored', 'Stored data', ['storage.review']),
    ],
  };
}

/** The Edit menu. */
function editMenu(builders: MenuBuilders): ProjectMenu {
  return {
    label: 'Edit',
    groups: [
      {
        key: 'steps',
        items: [stepEntry(builders, 'edit.undo'), stepEntry(builders, 'edit.redo')],
      },
      builders.labelled('clipboard', 'Clipboard', [
        'edit.cut',
        'edit.copy',
        'edit.paste',
        'edit.delete',
        'edit.trim',
        'edit.split',
      ]),
      builders.labelled('level', 'Level', [
        'edit.silence',
        'edit.fade-in',
        'edit.fade-out',
        'edit.louder',
        'edit.quieter',
        'edit.invert',
        'edit.reverse',
      ]),
      builders.labelled('channels', 'Channels', [
        'edit.swap-channels',
        'edit.to-mono',
        'edit.to-stereo',
      ]),
      builders.labelled('regions', 'Regions', [
        'region.create',
        'region.open',
        'region.loop',
        'region.clear-loop',
        'region.remove',
      ]),
      builders.labelled('comparison', 'Comparison', [
        'history.switch-side',
        'history.close-comparison',
      ]),
    ],
  };
}

/** The File and Edit menus. */
export function projectMenus(builders: MenuBuilders): readonly ProjectMenu[] {
  return [fileMenu(builders), editMenu(builders)];
}
