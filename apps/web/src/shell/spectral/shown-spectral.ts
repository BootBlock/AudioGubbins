/**
 * What the Spectral panel shows (ADR-0082): the view of the editor in use,
 * its spectral selection, the settings its spectral tools draw with, and,
 * where it shows audio of the project, the asset or region it shows and the
 * project as it stands. Read from the stores on every change to any of them,
 * an undo included; never written.
 */

import { useSyncExternalStore } from 'react';

import type { EditorViewState } from '@audiogubbins/editor-view';
import type { PressurePreference } from '@audiogubbins/input';
import type { ProjectState } from '@audiogubbins/project-format';
import type { SelectionSet } from '@audiogubbins/timeline';

import type { EditorAsset, ProjectOwner } from '../../assets/editor-asset.js';
import type { ModelGate } from '../../assets/model-gate.js';
import type { EditorPanelParts } from '../../editor/panel-parts.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { Hearing } from '../../state/hearing-store.js';
import type { Observable } from '../../state/observable.js';
import type { UserPreferences } from '../../state/preferences-store.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { PanelCommands } from '../command-button.js';

/** What the Spectral panel reads, and how its controls run commands. */
export interface SpectralContext extends PanelCommands {
  readonly projects: ProjectStores | undefined;
  readonly editor: {
    readonly stores: Pick<EditorPanelParts['stores'], 'editorViews' | 'selections'>;
    readonly assets: Pick<AssetCatalogue, 'get' | 'subscribe' | 'find'>;
  };
  /** Why a processor cannot run for want of its model, said before a clean-up runs one. */
  readonly modelGate: Observable<ModelGate>;
  /** Whether the transport plays the processed sound or the original. */
  readonly hearing: Observable<Hearing>;
  /** The person's preferences, whose pressure choice the panel shows. */
  readonly preferences: Observable<UserPreferences>;
}

/** The view the panel shows, and what it reads of it. */
export interface ShownView {
  readonly panel: string;
  readonly view: EditorAsset;
  readonly state: EditorViewState;
  readonly selection: SelectionSet;
  readonly pressure: PressurePreference;
  /** The project's asset or region shown, and the project, where the view shows one. */
  readonly project: { readonly owner: ProjectOwner; readonly state: ProjectState } | undefined;
}

/** A store that never changes, standing in for the project where this browser keeps none. */
const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/** Reads what the editor in use shows, following every store it is made from. */
export function useShownView(context: SpectralContext): ShownView | undefined {
  const { editorViews, selections } = context.editor.stores;
  const { assets } = context.editor;
  const views = useSyncExternalStore(editorViews.subscribe, editorViews.get);
  useSyncExternalStore(assets.subscribe, assets.get);
  useSyncExternalStore(selections.subscribe, selections.get);
  const preferences = useSyncExternalStore(context.preferences.subscribe, context.preferences.get);
  const open = useSyncExternalStore(
    context.projects?.project.subscribe ?? NO_PROJECT.subscribe,
    context.projects?.project.get ?? NO_PROJECT.get,
  );
  const panel = views.focused;
  const entry = panel === undefined ? undefined : editorViews.entry(panel);
  const view = entry === undefined ? undefined : assets.find(entry.asset);
  if (panel === undefined || entry === undefined || view === undefined) return undefined;
  const state = open?.kind === 'open' ? open.snapshot.model.state : undefined;
  const { owner } = view;
  return {
    panel,
    view,
    state: entry.state,
    selection: selections.of(view.id),
    pressure: preferences.pressure,
    project: owner.kind === 'project' && state !== undefined ? { owner, state } : undefined,
  };
}
