/**
 * What each panel that takes its parts as one value reads of the panel's
 * context (`panel-context.ts`): only the parts it draws, so a panel is handed
 * nothing it does not read.
 */

import type { AnalysisParts } from './analysis/analysis-panel.js';
import type { GroupsParts } from './game/groups-parts.js';
import type { LibraryParts } from './library/library-panel.js';
import type { LoopParts } from './loop/loop-panel.js';
import type { PanelContext } from './panel-context.js';
import type { PackManagerParts } from './packs/pack-manager-panel.js';

/** What the Analysis panel reads of a panel's context. */
export function analysisPartsOf(context: PanelContext): AnalysisParts {
  return {
    editorViews: context.editor.stores.editorViews,
    assets: context.editor.assets,
    detection: context.detection,
    audioSettings: context.audioSettings,
  };
}

/** What the Loop panel reads of a panel's context. */
export function loopPartsOf(context: PanelContext): LoopParts {
  return {
    editorViews: context.editor.stores.editorViews,
    selections: context.editor.stores.selections,
    assets: context.editor.assets,
    project: context.projects?.project,
    analyses: context.loopAnalyses,
    audition: context.loopAudition,
  };
}

/** What the Library panel reads of a panel's context. */
export function libraryPartsOf({ projects, ...context }: PanelContext): LibraryParts {
  return {
    library:
      projects === undefined
        ? undefined
        : { savedProcessing: projects.savedProcessing, project: projects.project },
    unavailable: context.projectsUnavailable,
    editorViews: context.editor.stores.editorViews,
    assets: context.editor.assets,
  };
}

/** What the Asset groups panel reads of a panel's context. */
export function groupsPartsOf(context: PanelContext): GroupsParts {
  return {
    projects: context.projects,
    groups: context.groups,
    loudness: context.loudness,
    assets: context.editor.assets,
    audioSettings: context.audioSettings,
    codecs: context.codecs,
  };
}

/** What the Model packs panel reads of a panel's context. */
export function packPartsOf(context: PanelContext): PackManagerParts {
  return { packs: context.packs, project: context.projects?.project };
}
