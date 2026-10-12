/**
 * Whether an export is what the Inspector describes, and which
 * (`REQ-EDIT-072`).
 *
 * An export becomes the Inspector's subject only when the person asks for it
 * to be described, by the command, from the palette or from an export the
 * History panel lists. It gives way as soon as the person turns to something
 * else the Inspector follows: an editor brought into use, or recording making
 * itself the subject, which `claimed` counts so that recording takes the
 * Inspector back even where it was the subject before the export was. Any
 * other panel brought into use, the Inspector and the History panel among
 * them, leaves the subject as it was, as it does for recording.
 */

import type { ExportRecordId } from '@audiogubbins/project-format';
import { activePanelOf, PanelKinds } from '@audiogubbins/workspace';

import { observable, type Observable } from '../state/observable.js';
import type { WorkspaceStore } from '../state/workspace-store.js';

/**
 * An export as the Inspector describes it: the page's own, the batch running,
 * held or last ended, or one the open project's history records.
 */
export type ExportSubject =
  { readonly kind: 'batch' } | { readonly kind: 'record'; readonly record: ExportRecordId };

/** Which export the Inspector describes, if any (see the module comment). */
export interface ExportFocus {
  /** The export described, or none where the Inspector follows the editor or recording. */
  readonly subject: Observable<ExportSubject | undefined>;

  /** Makes `subject` what the Inspector describes, until the person turns elsewhere. */
  readonly inspect: (subject: ExportSubject) => void;
  readonly stop: () => void;
}

/**
 * Follows the workspace and recording's claims on the Inspector; answers which
 * export is the subject, and how to stop following.
 */
export function followExportFocus(
  workspace: Pick<WorkspaceStore, 'get' | 'subscribe'>,
  recordingClaimed: Observable<number>,
): ExportFocus {
  const subject = observable<ExportSubject | undefined>(undefined);
  let active = activePanelOf(workspace.get().layout)?.id;
  const followPanel = (): void => {
    const now = activePanelOf(workspace.get().layout);
    const brought = now?.id !== active;
    active = now?.id;
    if (brought && now?.kind === PanelKinds.Editor) subject.set(undefined);
  };
  const stopPanel = workspace.subscribe(followPanel);
  const stopRecording = recordingClaimed.subscribe(() => {
    subject.set(undefined);
  });
  return {
    subject,
    inspect: (inspected) => {
      subject.set(inspected);
    },
    stop: () => {
      stopPanel();
      stopRecording();
    },
  };
}
