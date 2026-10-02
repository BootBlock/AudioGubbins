/**
 * Which tab may change a project, and what the person does about it: asking the
 * tab changing it to hand it over, handing it over or keeping it when asked,
 * taking it over after an explicit decision, and opening it again to read or to
 * change once that changes (REQ-STOR-098); and the open project's recovery
 * report and saving (REQ-STOR-021, REQ-STOR-101).
 *
 * Taking over stops the other tab at once, and what it had not saved is lost
 * with it, so it is available only once a request went unanswered, by a tab
 * gone, stopped or too busy to answer, and run only from the confirmation that
 * says so, never offered on its own in the palette.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import { succeed } from '@audiogubbins/domain';
import type { ProjectAccess, ProjectSnapshot, TransferAnswer } from '@audiogubbins/storage';

import type { OpenProjectState } from '../state/open-project-store.js';
import { quoted } from '../wording.js';
import { readyProjects, sayWhenSettled, sessionOf } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The open project's snapshot, where one is open. */
function openSnapshot(context: ShellContext): ProjectSnapshot | undefined {
  const open: OpenProjectState | undefined = context.projects?.project.get();
  return open?.kind === 'open' ? open.snapshot : undefined;
}

/** Available where the open project's access is one `allowed` accepts. */
function whenAccess(
  context: ShellContext,
  allowed: (access: ProjectAccess) => boolean,
  otherwise: string,
): CommandAvailability {
  const snapshot = openSnapshot(context);
  if (snapshot === undefined) return unavailable('No project is open.');
  return allowed(snapshot.access) ? AVAILABLE : unavailable(otherwise);
}

/** Whether another tab is changing the project this tab reads. */
const readByBusy = (access: ProjectAccess): boolean =>
  access.kind === 'read-only' && access.reason.kind === 'busy';

/** Whether this tab no longer writes a project it wrote. */
const ended = (access: ProjectAccess): boolean =>
  access.kind === 'lost' || access.kind === 'handed-over';

function requestControlCommand(): Command<ShellContext> {
  return shellCommand(
    'project.request-control',
    'Ask to change this project',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      const snapshot = openSnapshot(context);
      if (typeof stores === 'string') return stores;
      if (snapshot === undefined) return 'No project is open.';
      const name = quoted(snapshot.model.state.project.displayName);
      sayWhenSettled(context, stores.project.requestControl(), (outcome) => {
        if (outcome === 'granted') return `You can change ${name} now.`;
        if (outcome === 'declined') return `The other tab kept ${name}.`;
        return `The tab changing ${name} did not answer. You can take it over instead.`;
      });
      return undefined;
    },
    {
      keywords: ['project', 'ask', 'request', 'control', 'tab', 'transfer'],
      availability: (context) =>
        whenAccess(context, readByBusy, 'No other tab is changing this project.'),
    },
  );
}

function takeOverCommand(): Command<ShellContext> {
  return shellCommand(
    'project.take-over',
    'Take over this project',
    CommandCategory.File,
    (context) => {
      const stores = readyProjects(context);
      const snapshot = openSnapshot(context);
      if (typeof stores === 'string') return stores;
      if (snapshot === undefined) return 'No project is open.';
      const name = quoted(snapshot.model.state.project.displayName);
      const work = stores.project.open(snapshot.project, { access: 'write', steal: true });
      sayWhenSettled(context, work, (kind) =>
        kind === 'writable'
          ? `${name} is yours to change. The other tab can no longer change it.`
          : `${name} could not be taken over, and is open to read.`,
      );
      return undefined;
    },
    {
      discoverable: false,
      availability: (context) => {
        const busy = whenAccess(context, readByBusy, 'No other tab is changing this project.');
        if (!busy.available) return busy;
        const open = context.projects?.project.get();
        return open?.kind === 'open' && open.request === 'unanswered'
          ? AVAILABLE
          : unavailable(
              'Ask the tab changing it first. It can be taken over once a request goes unanswered.',
            );
      },
    },
  );
}

/** Asking for a project, and taking it over. */
function askingCommands(): readonly Command<ShellContext>[] {
  return [requestControlCommand(), takeOverCommand()];
}

/** Answering another tab's request, as the tab changing the project. */
function answeringCommand(
  id: string,
  label: string,
  answer: TransferAnswer,
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.File,
    (context, invocation) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const { access, model } = session.getSnapshot();
      const requests = access.kind === 'writable' ? access.transferRequests : [];
      const named = textArgument(invocation, 'request');
      const request = requests.find((one) => named === undefined || one.id === named);
      if (request === undefined) return 'No other tab is asking for this project.';
      const name = quoted(model.state.project.displayName);
      sayWhenSettled(context, session.answerTransfer(request, answer), () =>
        answer === 'granted'
          ? `${name} is handed over, and open to read here.`
          : `You kept ${name}. The other tab is told.`,
      );
      return undefined;
    },
    {
      discoverable: false,
      availability: (context) =>
        whenAccess(
          context,
          (access) => access.kind === 'writable' && access.transferRequests.length > 0,
          'No other tab is asking for this project.',
        ),
    },
  );
}

/** Opening the project again once how this tab may use it has changed. */
function reopeningCommands(): readonly Command<ShellContext>[] {
  const reopen = (
    id: string,
    label: string,
    access: 'read' | 'write',
    allowed: (a: ProjectAccess) => boolean,
    otherwise: string,
  ) =>
    shellCommand(
      id,
      label,
      CommandCategory.File,
      (context) => {
        const stores = readyProjects(context);
        const snapshot = openSnapshot(context);
        if (typeof stores === 'string') return stores;
        if (snapshot === undefined) return 'No project is open.';
        const name = quoted(snapshot.model.state.project.displayName);
        sayWhenSettled(context, stores.project.open(snapshot.project, { access }), (kind) =>
          kind === 'writable' ? `${name} is open to change.` : `${name} is open to read.`,
        );
        return undefined;
      },
      {
        keywords: ['project', 'reopen', access === 'read' ? 'read' : 'change'],
        availability: (context) => whenAccess(context, allowed, otherwise),
      },
    );
  return [
    reopen(
      'project.open-to-read',
      'Open this project to read',
      'read',
      ended,
      'This tab still has the project open as it was.',
    ),
    reopen(
      'project.open-to-change',
      'Open this project to change',
      'write',
      (access) =>
        access.kind === 'read-only' &&
        (access.reason.kind === 'released' || access.reason.kind === 'requested'),
      'The project cannot be opened to change here now.',
    ),
  ];
}

/** The open project's recovery report and saving. */
function upkeepCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      'project.dismiss-recovery',
      'Dismiss the recovery report',
      CommandCategory.File,
      (context) => {
        context.projects?.project.dismissReport();
      },
      {
        discoverable: false,
        availability: (context) => {
          const open = context.projects?.project.get();
          return open?.kind === 'open' && open.report !== undefined
            ? AVAILABLE
            : unavailable('There is no recovery report to dismiss.');
        },
      },
    ),

    shellCommand(
      'project.retry-save',
      'Try saving again',
      CommandCategory.File,
      (context) => {
        const session = sessionOf(context);
        if (typeof session === 'string') return session;
        sayWhenSettled(context, session.retry().then(succeed), (status) =>
          status.kind === 'saved' ? 'Every change is saved.' : undefined,
        );
        return undefined;
      },
      {
        keywords: ['save', 'retry', 'storage', 'again'],
        availability: (context) =>
          whenAccess(
            context,
            () => openSnapshot(context)?.save.kind === 'not-saved',
            'Nothing is waiting to be saved again.',
          ),
      },
    ),
  ];
}

/** Every command about which tab changes a project, and its upkeep. */
export function ownershipCommands(): readonly Command<ShellContext>[] {
  return [
    ...askingCommands(),
    answeringCommand('project.hand-over', 'Hand this project over', 'granted'),
    answeringCommand('project.keep', 'Keep this project', 'declined'),
    ...reopeningCommands(),
    ...upkeepCommands(),
  ];
}
