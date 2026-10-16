/**
 * What every command of a guided workflow's dialog reads (ADR-0105): the
 * dialog's store and the session it changes, the open dialog and the project
 * as it is now, and the dialog's reading of them, as the dialog shows it.
 */

import type { ProjectState } from '@audiogubbins/project-format';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';

import type { OpenWorkflowDialog, WorkflowDraftStore } from '../state/workflow-draft-store.js';
import { readyProjects, sessionOf } from './project-access.js';
import type { ShellContext } from './shell-context.js';
import { readWorkflow, type WorkflowReading } from './workflow-planning.js';

/** The workflow dialog's store, and the session it changes, or why there is none. */
export interface DialogParts {
  readonly store: WorkflowDraftStore;
  readonly session: RemoteProjectSession;
}

export function dialogParts(context: ShellContext): DialogParts | string {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  return { store: stores.workflowDraft, session };
}

/** The open dialog, its parts and the project as it is now, or why none is open. */
export interface OpenParts extends DialogParts {
  readonly open: OpenWorkflowDialog;
  readonly state: ProjectState;
}

export function openParts(context: ShellContext): OpenParts | string {
  const parts = dialogParts(context);
  if (typeof parts === 'string') return parts;
  const open = parts.store.get();
  if (open.kind !== 'open') return 'No workflow is open.';
  return { ...parts, open, state: parts.session.getSnapshot().model.state };
}

/** What the open dialog's workflow needs and plans, read as its dialog shows it. */
export function readingOf(context: ShellContext, parts: OpenParts): WorkflowReading {
  return readWorkflow(context, parts.open, parts.state, parts.store.planned);
}
