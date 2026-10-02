/**
 * Whether the backups the open project's policy asks for are being made, as
 * the status bar says it beside whether its changes are saved (REQ-STOR-105,
 * REQ-STOR-021).
 *
 * A backup made on its own is never seen being made, so one that was not is
 * said where a change not saved is said, with why and the action that tries
 * again, until one is made; and said aloud once for each reason, since the
 * person would otherwise go on working with no backup they know of.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import type { Announce } from '../commands/voiced-execution.js';
import type { BackupState } from '../state/backup-store.js';
import type { Observable } from '../state/observable.js';
import { QuickAction } from './panels.js';
import type { RunCommand } from './settings/section.js';

/** The status, where a backup the policy asked for was not made. */
export function BackupStatus({
  backups,
  run,
  announce,
}: {
  readonly backups: Observable<BackupState>;
  readonly run: RunCommand;
  readonly announce: Announce;
}): ReactNode {
  const { missed } = useSyncExternalStore(backups.subscribe, backups.get);
  const said = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (missed !== undefined && said.current !== missed) {
      announce(`A backup was not made. ${missed}`, true);
    }
    said.current = missed;
  }, [missed, announce]);

  if (missed === undefined) return null;
  return (
    <span className="ag-status-notice">
      <span className="ag-status-item" data-ag-status="unavailable">
        {`Backup not made. ${missed}`}
      </span>
      <QuickAction label="Back up now" onPress={() => run('file.back-up-now')} />
    </span>
  );
}
