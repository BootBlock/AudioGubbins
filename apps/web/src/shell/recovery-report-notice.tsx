/**
 * What recovery found when the open project was opened, said in the banner
 * until the person dismisses it (REQ-STOR-021, REQ-STOR-101).
 *
 * Shown only where recovery found anything, since a project that opened as it
 * was saved has nothing to report. Nothing it describes was repaired silently
 * or deleted: set-aside changes stay in storage, and the report says so.
 */

import type { ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import type { ProjectRecoveryReport } from '@audiogubbins/storage';

import { recoverySentences } from './project-words.js';
import type { RunCommand } from './settings/section.js';

/** The report, and the button that puts it away. */
export function RecoveryReportNotice({
  report,
  name,
  run,
}: {
  readonly report: ProjectRecoveryReport;

  /** The project's name, quoted. */
  readonly name: string;
  readonly run: RunCommand;
}): ReactNode {
  return (
    <div className="ag-project-banner-report" role="group" aria-label="What was recovered">
      <p className="ag-project-banner-text" data-ag-status="reduced">
        {`When ${name} was opened, some of it had to be recovered. ${recoverySentences(report).join(' ')}`}
      </p>
      <Button compact onClick={() => run('project.dismiss-recovery')}>
        Dismiss
      </Button>
    </div>
  );
}
