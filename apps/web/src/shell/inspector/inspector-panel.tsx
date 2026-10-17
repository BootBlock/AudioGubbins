/**
 * The Inspector panel (WU-05.D): the properties of what the editor last in use
 * acts on. That is what a command would act on in words, the asset's source and
 * audio shape with its edits, its level, time and rate controls, and the
 * region's name, tags, loop and own processing, each changed through the
 * command of the same name, so the Inspector, the palette and a shortcut make
 * one change (REQ-EDIT-008). With processors selected it shows their settings,
 * by the controls the Effects rack shows them with; otherwise what the rack of
 * the asset or region runs, and the command that shows the rack (REQ-EDIT-072).
 * A subject of the project is drawn by `project-subject.tsx`.
 *
 * For a region or an asset of the project it shows its game policy too: the
 * asset group it is in, and every field it resolves with where each value
 * comes from, overridden and reset there (`../game/member-policy.tsx`).
 *
 * Recording, an export the person asked to have described, and an asset
 * group chosen, are subjects of their own, shown in place of the editor's
 * (`own-subjects.tsx`).
 *
 * It reads the stores and runs commands; it writes nothing itself (`CLAUDE.md`
 * G2), and it follows every change to them, an undo included.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { EmptyState, Hint } from '@audiogubbins/design-system';
import type { ProjectState } from '@audiogubbins/project-format';

import type { EditorPanelParts } from '../../editor/panel-parts.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { PanelCommands } from '../command-button.js';
import { MemberPolicy } from '../game/member-policy.js';
import { inspected, type Inspected } from './inspected.js';
import { InspectorSubject } from './inspector-part.js';
import { OwnSubjectView, useOwnSubject, type OwnSubjectParts } from './own-subjects.js';
import { ProjectSubject, type ProjectSubjectParts } from './project-subject.js';

/** A store that never changes, standing in for the project where this browser keeps none. */
const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/**
 * What the Inspector reads: the editor's views and assets, what a subject of
 * the project is read from (`project-subject.tsx`), and what its subjects of
 * their own are read from (`own-subjects.tsx`).
 */
export interface InspectorParts extends OwnSubjectParts, ProjectSubjectParts {
  readonly editorViews: EditorPanelParts['stores']['editorViews'];
  readonly assets: Pick<AssetCatalogue, 'get' | 'subscribe' | 'find'>;
}

/**
 * Reads what the editor last in use acts on, and the project as it stands,
 * following every store either is made from.
 */
function useInspected(
  parts: InspectorParts,
  projects: ProjectStores | undefined,
): { readonly subject: Inspected; readonly state: ProjectState | undefined } {
  const { editorViews, selections } = parts;
  const views = useSyncExternalStore(editorViews.subscribe, editorViews.get);
  useSyncExternalStore(parts.assets.subscribe, parts.assets.get);
  useSyncExternalStore(selections.subscribe, selections.get);
  const open = useSyncExternalStore(
    projects?.project.subscribe ?? NO_PROJECT.subscribe,
    projects?.project.get ?? NO_PROJECT.get,
  );
  const panel = views.focused;
  const entry = panel === undefined ? undefined : editorViews.entry(panel);
  const asset = entry === undefined ? undefined : parts.assets.find(entry.asset);
  const view =
    panel === undefined || entry === undefined || asset === undefined
      ? undefined
      : { panel, asset, state: entry.state };
  const state = open?.kind === 'open' ? open.snapshot.model.state : undefined;
  return {
    subject: inspected(
      view,
      asset === undefined ? { recency: [] } : selections.of(asset.id),
      state,
    ),
    state,
  };
}

/** What the Inspector shows of what the editor last in use acts on. */
function EditorSubject({
  subject,
  state,
  parts,
  commands,
}: {
  readonly subject: Inspected;
  readonly state: ProjectState | undefined;
  readonly parts: InspectorParts;
  readonly commands: PanelCommands;
}): ReactNode {
  switch (subject.kind) {
    case 'nothing':
      return (
        <EmptyState
          icon="inspector"
          title="No audio open"
          text="Open audio in an editor to see its properties here."
        />
      );
    case 'session':
      return (
        <InspectorSubject
          icon="audio-file"
          title={subject.view.name}
          detail={subject.view.description}
          hint={
            <Hint label="Why it keeps no edits">
              It is not part of the project, so it keeps no edits. Import a file to edit it.
            </Hint>
          }
        />
      );
    case 'project':
      return <ProjectSubject subject={subject} state={state} parts={parts} commands={commands} />;
  }
}

/** The Inspector panel. */
export function InspectorPanel({
  title,
  projects,
  parts,
  commands,
}: {
  readonly title: string;
  readonly projects: ProjectStores | undefined;
  readonly parts: InspectorParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const { subject, state } = useInspected(parts, projects);
  const own = useOwnSubject(parts);
  return (
    <section className="ag-panel ag-inspector">
      <h2 className="ag-panel-title">{title}</h2>
      <div className="ag-inspector-body">
        {own === undefined ? (
          <>
            <EditorSubject subject={subject} state={state} parts={parts} commands={commands} />
            {subject.kind === 'project' && state !== undefined && (
              <MemberPolicy
                member={
                  subject.region === undefined
                    ? { kind: 'asset', asset: subject.asset.id }
                    : { kind: 'region', region: subject.region.region.id }
                }
                state={state}
                sources={{ projects, preferences: parts.preferences, commands }}
              />
            )}
          </>
        ) : (
          <OwnSubjectView own={own} parts={parts} projects={projects} commands={commands} />
        )}
      </div>
    </section>
  );
}
