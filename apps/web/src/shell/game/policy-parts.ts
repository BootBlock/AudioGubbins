/**
 * What the Game policy section reads beside its subject, read from the stores
 * it follows: the project as it stands and its groups, the export presets a
 * profile may be set from, and the saved chains, the built-in game chains
 * among them, a group's processing may be set from.
 */

import { useMemo, useSyncExternalStore } from 'react';

import type { ProjectState } from '@audiogubbins/project-format';

import { profilePresets } from '../../commands/game-profiles.js';
import { gamePolicyView } from '../../state/game-policy-view.js';
import type { Observable } from '../../state/observable.js';
import type { UserPreferences } from '../../state/preferences-store.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { SavedProcessingState } from '../../state/saved-processing-store.js';
import type { PanelCommands } from '../command-button.js';
import type { PolicyParts } from './policy-facts.js';

/** The stores the section's parts are read from. */
export interface PolicySources {
  readonly projects: ProjectStores | undefined;
  readonly preferences: Observable<UserPreferences>;
  readonly commands: PanelCommands;
}

const NOTHING_SAVED: SavedProcessingState = { entries: [], loaded: true };

/** Stands in for the saved chains where this browser keeps no projects. */
const NO_LIBRARY: Observable<SavedProcessingState> = {
  get: () => NOTHING_SAVED,
  subscribe: () => () => undefined,
};

/** The section's parts over `state`, following every store they are read from. */
export function usePolicyParts(sources: PolicySources, state: ProjectState): PolicyParts {
  const preferences = useSyncExternalStore(sources.preferences.subscribe, sources.preferences.get);
  const library = sources.projects?.savedProcessing ?? NO_LIBRARY;
  const saved = useSyncExternalStore(library.subscribe, library.get);
  const presets = useMemo(
    () => profilePresets(preferences.exportPresets),
    [preferences.exportPresets],
  );
  return {
    state,
    view: gamePolicyView(state),
    commands: sources.commands,
    presets,
    library: saved.entries,
  };
}
