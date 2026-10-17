/**
 * What a workflow's dialog shows once its step has applied (ADR-0105): the
 * step's name as the History panel lists it, the export Export for Godot
 * offers as its own action, never inside the step, since an export is never
 * undone (ADR-0092), and the loudness measurement Normalise Game SFX starts
 * at once for conformance, which changes nothing of the project.
 */

import { useEffect, useRef, type ReactNode } from 'react';

import { memberKey, type GroupMember } from '@audiogubbins/game-audio';
import { Button, ButtonTone, Icon, IconSize } from '@audiogubbins/design-system';
import { counted, quoted } from '@audiogubbins/text';

import { FollowUpCommand } from '../../commands/workflow-command-ids.js';
import type { WorkflowStep } from '../../state/workflow-draft-store.js';
import type { PanelCommands } from '../command-button.js';

/** The members' keys as the follow-up commands take them. */
function membersArgument(members: readonly GroupMember[]): string {
  return members.map(memberKey).join(',');
}

export function WorkflowFollowUps({
  step,
  commands,
}: {
  readonly step: Extract<WorkflowStep, { readonly kind: 'applied' }>;
  readonly commands: PanelCommands;
}): ReactNode {
  const { exportAfter, measureAfter, description } = step;
  const exportArgs = { members: membersArgument(exportAfter) };
  const exportReason = commands.unavailableReason(FollowUpCommand.ExportMembers, exportArgs);
  // Measured once for the step that applied, however often the dialog draws.
  const measured = useRef<WorkflowStep | undefined>(undefined);
  useEffect(() => {
    if (measureAfter.length === 0 || measured.current === step) return;
    measured.current = step;
    commands.run(FollowUpCommand.MeasureLoudness, { members: membersArgument(measureAfter) });
  }, [step, measureAfter, commands]);
  return (
    <section className="ag-workflow-done" aria-label="Done">
      <span className="ag-workflow-done-mark" aria-hidden="true">
        <Icon name="checked" size={IconSize.Feature} />
      </span>
      <p role="status" className="ag-workflow-done-text">
        {`Applied as one step, ${quoted(description)} in the History panel; one undo reverses it. What it made is in the Inspector, to change as any edit is.`}
      </p>
      {measureAfter.length > 0 && (
        <p className="ag-dialogue-note">
          {`Measuring the loudness of ${counted(measureAfter.length, 'sound', 'sounds')}, to show how each conforms to its target.`}
        </p>
      )}
      {exportAfter.length > 0 && (
        <div className="ag-dialogue-row">
          <Button
            tone={ButtonTone.Primary}
            {...(exportReason === undefined ? {} : { unavailableReason: exportReason })}
            onClick={() => {
              commands.run(FollowUpCommand.ExportMembers, exportArgs);
            }}
          >
            <Icon name="export" />
            {`Export ${counted(exportAfter.length, 'sound', 'sounds')} now`}
          </Button>
        </div>
      )}
    </section>
  );
}
