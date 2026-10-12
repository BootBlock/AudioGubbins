/**
 * Describing an export in the Inspector (REQ-EDIT-072, REQ-EDIT-073): the
 * page's export, running, waiting or last ended, from the palette, or an
 * export the open project's history records, from the History panel. Each
 * makes the export the Inspector's subject (`export-focus.ts`) and brings the
 * Inspector into view; it changes no project.
 */

import { AVAILABLE, CommandCategory, unavailable, type Command } from '@audiogubbins/commands';
import type { ProjectModel } from '@audiogubbins/storage';
import { activePanelOf, PanelKinds } from '@audiogubbins/workspace';

import type { ExportSubject } from '../export/export-focus.js';
import { ExportCommand } from './import-export-ids.js';
import { idArgument, readyProjects } from './project-access.js';
import { availableUnless, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Why the page's export cannot be described, or `undefined` where it can. */
function batchProblem(context: ShellContext): string | undefined {
  const state = context.exports?.get();
  return state === undefined || state.kind === 'idle'
    ? 'No export has run since the page opened.'
    : undefined;
}

/** Whether two subjects name the same export. */
function sameSubject(one: ExportSubject | undefined, other: ExportSubject): boolean {
  if (one?.kind !== other.kind) return false;
  return one.kind === 'batch' || (other.kind === 'record' && one.record === other.record);
}

/**
 * Makes `subject` what the Inspector describes, bringing the Inspector into
 * view; refused where it is so already, since running it again would change
 * nothing.
 */
function describe(context: ShellContext, subject: ExportSubject): string | undefined {
  const { workspace, exportFocus } = context;
  const inView = activePanelOf(workspace.get().layout)?.kind === PanelKinds.Inspector;
  if (inView && sameSubject(exportFocus.subject.get(), subject)) {
    return 'The Inspector describes that export already.';
  }
  // The workspace refuses to open a panel in use already, which needs nothing.
  const refusal = inView ? undefined : workspace.openPanel(PanelKinds.Inspector);
  if (refusal !== undefined) return refusal;
  exportFocus.inspect(subject);
  return undefined;
}

function inspectCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.Inspect,
    'Describe the export in the Inspector',
    CommandCategory.View,
    // The bus runs it only where its availability allows, so an export has run.
    (context) => describe(context, { kind: 'batch' }),
    {
      keywords: ['inspect', 'inspector', 'properties', 'describe', 'export', 'progress'],
      availability: (context) => availableUnless(batchProblem(context)),
    },
  );
}

/** The model of the project open here, whether or not this tab may change it, or why none is open. */
function openModel(context: ShellContext): ProjectModel | string {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  const open = stores.project.get();
  return open.kind === 'open' ? open.snapshot.model : 'No project is open.';
}

function inspectRecordCommand(): Command<ShellContext> {
  return shellCommand(
    ExportCommand.InspectRecord,
    'Describe an export of the history in the Inspector',
    CommandCategory.View,
    (context, invocation) => {
      const model = openModel(context);
      if (typeof model === 'string') return model;
      const named = idArgument<'ExportRecordId'>(invocation, 'record', 'export');
      if ('refused' in named) return named.refused;
      if (!model.exports.some((record) => record.id === named.id)) {
        return 'That export is not in the history of the project open now.';
      }
      return describe(context, { kind: 'record', record: named.id });
    },
    {
      keywords: ['inspect', 'inspector', 'properties', 'describe', 'export', 'history'],
      discoverable: false,
      availability: (context) => {
        const model = openModel(context);
        return typeof model === 'string' ? unavailable(model) : AVAILABLE;
      },
    },
  );
}

/** The commands that describe an export in the Inspector. */
export function exportInspectionCommands(): readonly Command<ShellContext>[] {
  return [inspectCommand(), inspectRecordCommand()];
}
