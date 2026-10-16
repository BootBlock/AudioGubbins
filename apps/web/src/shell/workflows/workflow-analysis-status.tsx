/**
 * The analyses a workflow needs before it plans (ADR-0105): how many of the
 * sounds are analysed as they are now, the progress of a run with a way to
 * stop it, and why any sound cannot be analysed or was not.
 */

import type { ReactNode } from 'react';

import type { DomainResult } from '@audiogubbins/domain';
import { counted, quoted } from '@audiogubbins/text';
import type { ProjectState } from '@audiogubbins/project-format';

import type { WorkflowAnalysisState } from '../../analysis/workflow-analysing.js';
import type { NeedStatus } from '../../commands/workflow-analyses.js';
import { WorkflowCommand } from '../../commands/workflow-command-ids.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { memberName } from './workflow-words.js';

function progressWords(
  running: Extract<WorkflowAnalysisState, { readonly kind: 'running' }>,
): string {
  return `Analysing ${quoted(running.current)}, ${String(running.done + 1)} of ${String(running.total)}.`;
}

export function WorkflowAnalysisStatus({
  needs,
  running,
  state,
  commands,
}: {
  readonly needs: DomainResult<readonly NeedStatus[]>;
  readonly running: WorkflowAnalysisState;
  readonly state: ProjectState;
  readonly commands: PanelCommands;
}): ReactNode {
  if (!needs.ok || needs.value.length === 0) return null;
  const statuses = needs.value;
  const current = statuses.filter((status) => status.kind === 'current').length;
  const problems = statuses.flatMap((status) => {
    if (status.kind === 'unreachable') {
      return [`${memberName(status.need.target, state)}: ${status.reason}`];
    }
    if (status.kind === 'to-analyse' && status.failed !== undefined) {
      return [`${memberName(status.need.target, state)} could not be analysed. ${status.failed}`];
    }
    return [];
  });
  return (
    <section className="ag-workflow-section" aria-label="Analyses">
      <p role="status" className="ag-workflow-progress">
        {running.kind === 'running'
          ? progressWords(running)
          : `${counted(current, 'sound is', 'sounds are')} analysed as ${current === 1 ? 'it is' : 'they are'} now, of ${String(statuses.length)}.`}
      </p>
      {running.kind === 'running' && (
        <progress value={running.done} max={running.total} aria-label="Analyses done" />
      )}
      {problems.length > 0 && (
        <ul className="ag-workflow-blockers">
          {problems.map((problem) => (
            <li key={problem} data-ag-status="unavailable">
              {problem}
            </li>
          ))}
        </ul>
      )}
      <div className="ag-workflow-actions">
        {running.kind === 'running' ? (
          <CommandButton
            id={WorkflowCommand.CancelAnalysis}
            label="Stop analysing"
            commands={commands}
          />
        ) : (
          <CommandButton id={WorkflowCommand.Analyse} label="Analyse" commands={commands} />
        )}
      </div>
    </section>
  );
}
