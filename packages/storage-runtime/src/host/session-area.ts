/**
 * The operations of a project open to write, served to the page: each the
 * session's own, on the session its handle names (REQ-STOR-021, REQ-STOR-055,
 * REQ-STOR-193 to REQ-STOR-198).
 *
 * The session runs them one at a time, in the order the page asked, and
 * publishes as it changes, which sends the page its update before the answer.
 * An export is recorded with an identifier and a time the worker gives it, as
 * it gives every other event of the journal, so one generator and one clock
 * stand behind all of them.
 */

import type { ProjectSession } from '@audiogubbins/storage';

import type { ProjectHandle } from '../protocol/project-operations.js';
import type { AreaHandlers } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';

/** The operations of a session, which every project operation is but these. */
type SessionHandlers = Omit<
  AreaHandlers<'projects'>,
  | 'projects.open'
  | 'projects.abandon'
  | 'projects.close'
  | 'projects.closeView'
  | 'projects.requestTransfer'
>;

/** The operations of a project open to write, over the worker's services. */
export function sessionHandlers(
  services: Pick<HostServices, 'ids' | 'clock'>,
  projects: OpenProjects,
): SessionHandlers {
  const session = (handle: ProjectHandle): ProjectSession => projects.session(handle);
  // Each handler finds the session as it is called, so one naming a handle no
  // longer held throws, which the caller hears as the fault it is.
  return {
    'projects.run': ({ handle, invocation }) => session(handle).run(invocation),
    'projects.runGroup': ({ handle, description, invocations }) =>
      session(handle).runGroup(description, invocations),
    'projects.undo': ({ handle }) => session(handle).undo(),
    'projects.redo': ({ handle }) => session(handle).redo(),
    'projects.goTo': ({ handle, node }) => session(handle).goTo(node),
    'projects.nameBranch': ({ handle, node, name }) => session(handle).nameBranch(node, name),
    'projects.createSnapshot': ({ handle, request }) => session(handle).createSnapshot(request),
    'projects.deleteSnapshot': ({ handle, snapshot }) => session(handle).deleteSnapshot(snapshot),
    'projects.recordExport': ({ handle, draft }) =>
      session(handle).recordExport({
        ...draft,
        id: services.ids.next<'ExportRecordId'>(),
        at: services.clock.now(),
      }),
    'projects.compare': ({ handle, a, b }) => session(handle).compare(a, b),
    'projects.comparedDifference': ({ handle }) => session(handle).comparedDifference(),
    'projects.comparedState': ({ handle, side }) => session(handle).comparedState(side),
    'projects.switchSide': ({ handle, side }) => session(handle).switchSide(side),
    'projects.closeComparison': ({ handle }) => session(handle).closeComparison(),
    'projects.promote': ({ handle, side }) => session(handle).promote(side),
    'projects.planCompaction': ({ handle, request }, { signal }) =>
      session(handle).planCompaction(request, signal),
    'projects.compactHistory': ({ handle, plan, confirmation }) =>
      session(handle).compactHistory(plan, confirmation),
    'projects.setRetentionPolicy': ({ handle, policy, confirmation }) =>
      session(handle).setRetentionPolicy(policy, confirmation),
    'projects.setBackupPolicy': ({ handle, policy }) => session(handle).setBackupPolicy(policy),
    'projects.checkpoint': ({ handle }) => session(handle).checkpoint(),
    'projects.retry': ({ handle }) => session(handle).retry(),
    'projects.answerTransfer': ({ handle, request, answer }) =>
      session(handle).answerTransfer(request, answer),
  };
}
