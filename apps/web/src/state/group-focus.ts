/**
 * Which asset group the person is working on (ADR-0101): the one chosen in the
 * Asset groups panel's tree, which the group commands act on where they name
 * none, and which the Inspector describes, its policy with the source of every
 * value, until the person turns to something else the Inspector follows.
 *
 * It gives way as an export does (`export-focus.ts`): an editor brought into
 * use, recording making itself the Inspector's subject, or an export asked to
 * be described, takes the Inspector back, and the group stays chosen in the
 * tree, where the commands still find it.
 */

import type { GameAssetGroupId } from '@audiogubbins/game-audio';
import { activePanelOf, PanelKinds } from '@audiogubbins/workspace';

import { observable, type Observable } from './observable.js';
import type { WorkspaceStore } from './workspace-store.js';

/** The group chosen, and whether the Inspector describes it. */
export interface GroupChoice {
  readonly group: GameAssetGroupId;
  readonly inspected: boolean;
}

/** Which group the person is working on (see the module comment). */
export interface GroupFocus {
  readonly chosen: Observable<GroupChoice | undefined>;

  /** Chooses `group`, which the Inspector then describes. */
  readonly choose: (group: GameAssetGroupId) => void;

  /** Chooses no group, as one removed or no longer in the project is. */
  readonly forget: () => void;
  readonly stop: () => void;
}

/** Follows the workspace's, recording's and an export's claims on the Inspector; answers which group is chosen. */
export function followGroupFocus(
  workspace: Pick<WorkspaceStore, 'get' | 'subscribe'>,
  recordingClaimed: Observable<number>,
  exportSubject: Observable<unknown>,
): GroupFocus {
  const chosen = observable<GroupChoice | undefined>(undefined);
  const giveInspectorBack = (): void => {
    const now = chosen.get();
    if (now?.inspected === true) chosen.set({ group: now.group, inspected: false });
  };
  let active = activePanelOf(workspace.get().layout)?.id;
  const stopPanel = workspace.subscribe(() => {
    const now = activePanelOf(workspace.get().layout);
    const brought = now?.id !== active;
    active = now?.id;
    if (brought && now?.kind === PanelKinds.Editor) giveInspectorBack();
  });
  const stopRecording = recordingClaimed.subscribe(giveInspectorBack);
  const stopExport = exportSubject.subscribe(() => {
    if (exportSubject.get() !== undefined) giveInspectorBack();
  });
  return {
    chosen,
    choose: (group) => {
      chosen.set({ group, inspected: true });
    },
    forget: () => {
      chosen.set(undefined);
    },
    stop: () => {
      stopPanel();
      stopRecording();
      stopExport();
    },
  };
}
