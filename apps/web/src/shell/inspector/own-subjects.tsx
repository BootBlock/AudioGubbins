/**
 * The Inspector's subjects of their own, apart from what the editor acts on
 * (REQ-EDIT-072): an export the person asked to have described, and
 * recording, with its configuration or the take or stack inspected.
 *
 * Whichever made itself the subject last is shown. An export is the subject
 * only until recording claims the Inspector or an editor is brought into use
 * (`export-focus.ts`), so where one is, it was asked for after recording;
 * recording is the subject until an editor is brought into use
 * (`recording-focus.ts`). Where neither is, the Inspector follows the editor.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import type { ExportSubject } from '../../export/export-focus.js';
import type { ExportRunState } from '../../export/export-types.js';
import type { TakeSubject } from '../../recording/recording-focus.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import type { Observable } from '../../state/observable.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { PanelCommands } from '../command-button.js';
import { RecordingConfiguration } from '../recording/recording-configuration.js';
import { TakeInspector } from '../recording/take-inspector.js';
import { ExportDescription } from './export-description.js';

/** What the subjects of their own are read from. */
export interface OwnSubjectParts {
  readonly recording: RecordingParts;
  readonly audioSettings: Observable<AudioSettings>;

  /** The page's export, absent where this browser keeps no projects. */
  readonly exports: Observable<ExportRunState> | undefined;

  /** The export described, while one is the subject. */
  readonly exportSubject: Observable<ExportSubject | undefined>;
}

/** The subject of its own the Inspector shows, where it shows one. */
export type OwnSubject =
  | { readonly kind: 'export'; readonly subject: ExportSubject }
  | { readonly kind: 'recording'; readonly take: TakeSubject | undefined };

/** The subject of its own the Inspector shows, following each store it is read from. */
export function useOwnSubject(parts: OwnSubjectParts): OwnSubject | undefined {
  const { recording } = parts;
  const recordingInFocus = useSyncExternalStore(recording.focus.subscribe, recording.focus.get);
  const take = useSyncExternalStore(recording.inspected.subscribe, recording.inspected.get);
  const exported = useSyncExternalStore(parts.exportSubject.subscribe, parts.exportSubject.get);
  if (exported !== undefined) return { kind: 'export', subject: exported };
  return recordingInFocus ? { kind: 'recording', take } : undefined;
}

/** What the Inspector shows of a subject of its own. */
export function OwnSubjectView({
  own,
  parts,
  projects,
  commands,
}: {
  readonly own: OwnSubject;
  readonly parts: OwnSubjectParts;
  readonly projects: ProjectStores | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  if (own.kind === 'export') {
    return <ExportDescription subject={own.subject} parts={{ exports: parts.exports, projects }} />;
  }
  return own.take === undefined ? (
    <RecordingConfiguration
      recording={parts.recording}
      audioSettings={parts.audioSettings}
      commands={commands}
    />
  ) : (
    <TakeInspector subject={own.take} projects={projects} commands={commands} />
  );
}
