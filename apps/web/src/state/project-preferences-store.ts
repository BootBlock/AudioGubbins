/**
 * What the person chose about their projects outside any one project: whether a
 * file is brought in as a copy or as a link by default (REQ-STOR-025), one of
 * the choices the import pipeline takes, and which project to open again at the
 * next start (REQ-STOR-021).
 *
 * Each is one value, stored as it is written: a choice from a short list and a
 * project's identifier, each checked as it is read, so there is no structure to
 * version and a value this build does not know gives way to the default. A link
 * needs a file the browser lets AudioGubbins find again, which only the pickers
 * give, so where the browser has none a link is never the choice.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import { isWellFormedId, unsafeBrandId, type ProjectId } from '@audiogubbins/domain';
import { SourceHandling } from '@audiogubbins/media-store';

import { observable, type Observable } from './observable.js';
import { PersistedPart, type StateStorage } from './state-storage.js';

/** The person's choices about their projects. */
export interface ProjectPreferences {
  readonly sourceHandling: SourceHandling;

  /** Whether this browser can link a file at all. */
  readonly canLink: boolean;

  /** The project to open at the next start, where one was open. */
  readonly lastProject?: ProjectId;
}

/** Holds the choices and writes them back. */
export interface ProjectPreferencesStore extends Observable<ProjectPreferences> {
  /** Chooses how a file is brought in, or says why it cannot be linked here. */
  readonly setSourceHandling: (handling: SourceHandling) => string | undefined;

  /** Remembers the project open now, or that none is. */
  readonly remember: (project: ProjectId | undefined) => void;
}

const SOURCE_HANDLING_KEY = 'audiogubbins.source-handling';
const LAST_PROJECT_KEY = 'audiogubbins.last-project';

/** Why a link cannot be chosen in this browser. */
export const CANNOT_LINK =
  'This browser cannot give AudioGubbins a file it can find again, so files are always copied.';

function isSourceHandling(value: string): value is SourceHandling {
  return Object.values<string>(SourceHandling).includes(value);
}

/** The choices as stored, each checked, with the default in place of what cannot be used. */
function readPreferences(storage: StateStorage, canLink: boolean, logger: Logger) {
  const handling = storage.read(SOURCE_HANDLING_KEY);
  const last = storage.read(LAST_PROJECT_KEY);
  if (handling !== null && !isSourceHandling(handling)) {
    logger.info('The stored way of bringing files in was not one this build knows.');
  }
  const chosen = handling !== null && isSourceHandling(handling) ? handling : SourceHandling.Copy;
  const preferences: ProjectPreferences = {
    sourceHandling: canLink ? chosen : SourceHandling.Copy,
    canLink,
    ...(last !== null && isWellFormedId(last)
      ? { lastProject: unsafeBrandId<'ProjectId'>(last) }
      : {}),
  };
  return preferences;
}

/** Creates the store, reading what was stored. */
export function createProjectPreferencesStore(
  storage: StateStorage,
  canLink: boolean,
  logger: Logger,
): ProjectPreferencesStore {
  const state = observable(readPreferences(storage, canLink, logger));

  return {
    get: state.get,
    subscribe: state.subscribe,

    setSourceHandling: (handling) => {
      if (handling === SourceHandling.Link && !canLink) return CANNOT_LINK;
      state.update((current) => ({ ...current, sourceHandling: handling }));
      storage.save(PersistedPart.SourceHandling, { [SOURCE_HANDLING_KEY]: handling });
      return undefined;
    },

    remember: (project) => {
      if (state.get().lastProject === project) return;
      state.update(({ lastProject: _forgotten, ...rest }) =>
        project === undefined ? rest : { ...rest, lastProject: project },
      );
      storage.save(PersistedPart.LastProject, { [LAST_PROJECT_KEY]: project ?? null });
    },
  };
}
