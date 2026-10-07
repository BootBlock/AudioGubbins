/**
 * What the Effects rack panel shows (ADR-0060): the rack of the asset or
 * region the editor in use acts on, by the rule the rack commands follow
 * (`rack-target.ts`), and what the panel reads to show it. Read from the
 * stores on every change to any of them, an undo included; never written.
 */

import { useSyncExternalStore } from 'react';

import type { ProcessorId } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import type { RackTarget } from '@audiogubbins/project-commands';
import type { TimeFormat } from '@audiogubbins/timeline';

import type { EditorAsset } from '../../assets/editor-asset.js';
import type { ModelGate } from '../../assets/model-gate.js';
import { rackTargetIn } from '../../commands/rack-target.js';
import type { EditorPanelParts } from '../../editor/panel-parts.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import type { Hearing } from '../../state/hearing-store.js';
import type { Observable } from '../../state/observable.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { PanelCommands } from '../command-button.js';

/** What the Effects rack panel reads, and how its controls run commands. */
export interface RackContext extends PanelCommands {
  readonly projects: ProjectStores | undefined;
  readonly editor: {
    readonly stores: Pick<EditorPanelParts['stores'], 'editorViews' | 'selections'>;
    readonly assets: Pick<AssetCatalogue, 'get' | 'subscribe' | 'find'>;
  };
  /** Why a processor cannot run for want of its model. */
  readonly modelGate: Observable<ModelGate>;
  /** The preview and render quality, which say how a preview differs from a render. */
  readonly audioSettings: Observable<AudioSettings>;
  /** Whether the transport plays the processed sound or the original. */
  readonly hearing: Observable<Hearing>;
}

/** A rack of the project, as the panel shows it. */
export interface ShownRack {
  readonly panel: string;
  readonly view: EditorAsset;
  readonly timeFormat: TimeFormat;
  readonly state: ProjectState;
  readonly target: RackTarget;
  readonly selected: readonly ProcessorId[];
}

/** What the panel shows: nothing, audio of the session, or a rack of the project. */
export type Shown =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'session'; readonly view: EditorAsset }
  | ({ readonly kind: 'project' } & ShownRack);

/** A store that never changes, standing in for the project where this browser keeps none. */
const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/** Reads the rack the editor in use acts on, following every store it is made from. */
export function useShown(context: RackContext): Shown {
  const { editorViews, selections } = context.editor.stores;
  const { assets } = context.editor;
  const views = useSyncExternalStore(editorViews.subscribe, editorViews.get);
  useSyncExternalStore(assets.subscribe, assets.get);
  useSyncExternalStore(selections.subscribe, selections.get);
  const open = useSyncExternalStore(
    context.projects?.project.subscribe ?? NO_PROJECT.subscribe,
    context.projects?.project.get ?? NO_PROJECT.get,
  );
  const panel = views.focused;
  const entry = panel === undefined ? undefined : editorViews.entry(panel);
  const view = entry === undefined ? undefined : assets.find(entry.asset);
  if (panel === undefined || entry === undefined || view === undefined) return { kind: 'nothing' };
  const { owner } = view;
  const state = open?.kind === 'open' ? open.snapshot.model.state : undefined;
  if (owner.kind !== 'project' || state === undefined) return { kind: 'session', view };
  const selection = selections.of(view.id);
  return {
    kind: 'project',
    panel,
    view,
    timeFormat: entry.state.timeFormat,
    state,
    target: rackTargetIn(owner, selection, state.project),
    selected: selection.objects?.kind === 'processors' ? selection.objects.ids : [],
  };
}
