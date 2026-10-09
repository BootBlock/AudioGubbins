/**
 * Whether recording is what the person is working on, for the Inspector to
 * show the recording configuration (`REQ-EDIT-072`).
 *
 * It follows the panel in use, as the editor last in use is followed: a
 * Recording panel brought into use makes recording the Inspector's subject and
 * an editor brought into use makes it the editor's, while any other panel, the
 * Inspector itself among them, leaves the subject as it was. Arming an input
 * makes recording the subject too, wherever it was armed from. A take or a
 * take stack inspected from the Recording panel is the subject until another
 * is, or the recording configuration is asked for again.
 */

import type { TakeId, TakeStackId } from '@audiogubbins/domain';
import { activePanelOf, PanelKinds } from '@audiogubbins/workspace';

import { observable, type Observable } from '../state/observable.js';
import type { WorkspaceStore } from '../state/workspace-store.js';
import type { InputView } from './input-view.js';

/** A take stack, or a take of one, as the Inspector shows it. */
export interface TakeSubject {
  readonly stack: TakeStackId;
  readonly take?: TakeId;
}

/** Whether recording is the Inspector's subject, and which take or stack it shows. */
export interface RecordingFocus {
  readonly focus: Observable<boolean>;
  /** The take or stack inspected, or none for the recording configuration. */
  readonly subject: Observable<TakeSubject | undefined>;
  /** Makes recording the subject, showing `subject`, or the configuration for none. */
  readonly inspect: (subject: TakeSubject | undefined) => void;
  readonly stop: () => void;
}

/** Follows the workspace and the input; answers whether recording is the subject, and how to stop. */
export function followRecordingFocus(
  workspace: WorkspaceStore,
  input: Observable<InputView>,
): RecordingFocus {
  const focus = observable(false);
  const subject = observable<TakeSubject | undefined>(undefined);
  const followPanel = (): void => {
    const kind = activePanelOf(workspace.get().layout)?.kind;
    if (kind === PanelKinds.Recording) focus.set(true);
    else if (kind === PanelKinds.Editor) focus.set(false);
  };
  let armed = input.get().session.kind === 'armed';
  const followInput = (): void => {
    const nowArmed = input.get().session.kind === 'armed';
    if (nowArmed && !armed) focus.set(true);
    armed = nowArmed;
  };
  followPanel();
  const stopPanel = workspace.subscribe(followPanel);
  const stopInput = input.subscribe(followInput);
  return {
    focus,
    subject,
    inspect: (inspected) => {
      subject.set(inspected);
      focus.set(true);
    },
    stop: () => {
      stopPanel();
      stopInput();
    },
  };
}
