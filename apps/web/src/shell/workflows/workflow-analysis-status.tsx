/**
 * The analyses a workflow needs before it plans (ADR-0105): how many of the
 * sounds are analysed as they are now, the progress of a run with a way to
 * stop it, and why any sound cannot be analysed or was not.
 */

import type { ReactNode } from 'react';

import {
  Button,
  Icon,
  IconSize,
  ProgressBar,
  ProgressPlace,
  Spinner,
} from '@audiogubbins/design-system';
import type { DomainResult } from '@audiogubbins/domain';
import { counted, quoted } from '@audiogubbins/text';
import type { ProjectState } from '@audiogubbins/project-format';

import type { WorkflowAnalysisState } from '../../analysis/workflow-analysing.js';
import type { NeedStatus } from '../../commands/workflow-analyses.js';
import { WorkflowCommand } from '../../commands/workflow-command-ids.js';
import type { PanelCommands } from '../command-button.js';
import { memberName } from './workflow-words.js';

function progressWords(
  running: Extract<WorkflowAnalysisState, { readonly kind: 'running' }>,
): string {
  return `Analysing ${quoted(running.current)}, ${String(running.done + 1)} of ${String(running.total)}.`;
}

/** The button that runs or stops the analyses, holding the command's reason where it cannot run. */
function AnalysisButton({
  id,
  label,
  commands,
}: {
  readonly id: string;
  readonly label: string;
  readonly commands: PanelCommands;
}): ReactNode {
  const reason = commands.unavailableReason(id);
  return (
    <Button
      compact
      {...(reason === undefined ? {} : { unavailableReason: reason })}
      onClick={() => {
        commands.run(id);
      }}
    >
      {label}
    </Button>
  );
}

/** Why any sound cannot be analysed, or was not, each in a sentence. */
function problemsOf(statuses: readonly NeedStatus[], state: ProjectState): readonly string[] {
  return statuses.flatMap((status) => {
    if (status.kind === 'unreachable') {
      return [`${memberName(status.need.target, state)}: ${status.reason}`];
    }
    if (status.kind === 'to-analyse' && status.failed !== undefined) {
      return [`${memberName(status.need.target, state)} could not be analysed. ${status.failed}`];
    }
    return [];
  });
}

/** The mark before the line: a spinner while the analyses run, and whether every sound is analysed. */
function AnalysesMark({
  running,
  all,
}: {
  readonly running: boolean;
  readonly all: boolean;
}): ReactNode {
  if (running) return <Spinner size={IconSize.Inline} />;
  return (
    <Icon
      name={all ? 'success' : 'waiting'}
      size={IconSize.Inline}
      {...(all ? { className: 'ag-workflow-analysed' } : {})}
    />
  );
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
  const problems = problemsOf(statuses, state);
  return (
    <section
      className="ag-workflow-analyses"
      aria-label="Analyses"
      {...(running.kind === 'running' ? { 'data-ag-running': '' } : {})}
    >
      <div className="ag-workflow-analyses-line">
        <AnalysesMark running={running.kind === 'running'} all={current === statuses.length} />
        <p role="status" className="ag-workflow-progress">
          {running.kind === 'running'
            ? progressWords(running)
            : `${counted(current, 'sound is', 'sounds are')} analysed as ${current === 1 ? 'it is' : 'they are'} now, of ${String(statuses.length)}.`}
        </p>
        <AnalysisButton
          id={running.kind === 'running' ? WorkflowCommand.CancelAnalysis : WorkflowCommand.Analyse}
          label={running.kind === 'running' ? 'Stop analysing' : 'Analyse'}
          commands={commands}
        />
      </div>
      {running.kind === 'running' && (
        <ProgressBar
          label="Analyses done"
          place={ProgressPlace.Row}
          value={running.done / Math.max(1, running.total)}
        />
      )}
      {problems.length > 0 && (
        <ul className="ag-dialogue-reasons">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
