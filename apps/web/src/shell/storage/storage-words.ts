/**
 * What the Storage panel calls each part of the storage and each step of a
 * cleanup, and what each step costs (REQ-STOR-200, REQ-STOR-106, REQ-STOR-102,
 * REQ-STOR-027).
 *
 * The categories are the ones a person decides what to keep by, named for what
 * they are to that person rather than for where they lie. Every step says what
 * is lost by it before anything is removed, in a sentence and then item by
 * item: each project, each backup, each part of a history and each model pack
 * it takes. A model pack is offered by name and version, and one the plan
 * keeps says why (REQ-AUDIO-139).
 */

import type { ProjectId } from '@audiogubbins/domain';
import type {
  CacheCategory,
  CleanupPlan,
  CleanupStep,
  PackKept,
  PlannedPack,
  RecoverabilityLoss,
  StorageUsage,
} from '@audiogubbins/storage';
import { counted, quoted } from '@audiogubbins/text';

import { describeBytes } from '../../wording.js';
import { lostSentence } from '../history/history-words.js';

/** What each cache is called. */
const CACHE_NAMES: Readonly<Record<CacheCategory, string>> = {
  temporary: 'Temporary files',
  render: 'Rendered audio',
  analysis: 'Analysis',
  waveform: 'Waveforms',
  spectrogram: 'Spectrograms',
  intermediate: 'Intermediate results',
};

/** What a cache is called. */
function cacheName(category: CacheCategory): string {
  return CACHE_NAMES[category];
}

/** One part of the storage, as the panel lists it. */
export interface UsagePart {
  readonly name: string;
  readonly bytes: number;
}

/** Every part of the storage, in the order a person reads them: what they made first. */
export function partsOf(usage: StorageUsage): readonly UsagePart[] {
  return [
    { name: 'Audio in use', bytes: usage.sourceMedia },
    { name: 'Named snapshots', bytes: usage.namedSnapshots },
    { name: 'Other branches of the history', bytes: usage.alternativeBranches },
    { name: 'Save points and recovery records', bytes: usage.recoveryCheckpoints },
    { name: 'Recent changes not yet in a save point', bytes: usage.journal },
    { name: 'Recordings not yet made into audio', bytes: usage.recordings },
    { name: 'Backups', bytes: usage.backups },
    { name: 'Audio kept for snapshots', bytes: usage.retainedDeletedMedia.namedSnapshots },
    { name: 'Audio kept for undo', bytes: usage.retainedDeletedMedia.undo },
    {
      name: 'Audio kept only by other branches',
      bytes: usage.retainedDeletedMedia.alternativeBranches,
    },
    {
      name: 'Audio kept only by backups and recent changes',
      bytes: usage.retainedDeletedMedia.elsewhere,
    },
    { name: 'Audio nothing uses', bytes: usage.unreferencedMedia },
    { name: 'Model packs', bytes: usage.packs.installed },
    { name: 'Model pack downloads not finished', bytes: usage.packs.partial },
    ...[...usage.caches].map(([category, bytes]) => ({ name: cacheName(category), bytes })),
  ];
}

/** What a step removes, as a person calls it. */
export function stepName(step: CleanupStep): string {
  switch (step.kind) {
    case 'cache':
      return cacheName(step.category);
    case 'pack-downloads':
      return 'Model pack downloads not finished';
    case 'unfinished-projects':
      return 'Projects whose making or purge was cut short';
    case 'model-packs':
      return 'Model packs you chose to remove';
    case 'expired-backups':
      return 'Backups their policy no longer keeps';
    case 'expired-history':
      return 'History the retention settings let go';
    case 'set-aside-records':
      return 'Changes set aside when a project was recovered';
    case 'unreferenced-media':
      return 'Audio nothing uses';
  }
}

/** What each step costs. */
const LOSSES: Readonly<Record<RecoverabilityLoss, string>> = {
  nothing: 'Made again when it is needed, so nothing is lost.',
  'download-progress':
    'Nothing uses a pack until its download finishes, so nothing is lost, but downloading it again starts from the beginning.',
  'unfinished-projects': 'Nothing you kept: these were never finished, or you chose to purge them.',
  'model-packs':
    'The processors that need these packs cannot run until you download the packs again.',
  'backup-generations': 'You could no longer restore a project to these backups.',
  history: 'Undoing that far, and the branches and export states it takes, go for good.',
  'set-aside-changes': 'What these changes held could no longer be looked at.',
  'unreferenced-media': 'The audio itself goes for good. Nothing refers to it any more.',
};

/** What a step costs, in a sentence. */
export function lossOf(step: CleanupStep): string {
  return LOSSES[step.loses];
}

/** How a step is told apart from the others of its plan, and left out by. */
export function choiceOf(step: CleanupStep): string {
  return step.kind === 'cache' ? `cache:${step.category}` : step.kind;
}

/** How a model pack version is named when it is chosen by an argument of the cleanup command. */
export function packChoice(pack: Pick<PlannedPack, 'ref'>): string {
  return `model-pack:${pack.ref.id}@${pack.ref.version}`;
}

/**
 * How a step is chosen by the arguments of the cleanup command: by its kind,
 * or, for model packs, by each version it removes, which the person chose one
 * by one.
 */
export function choicesOf(step: CleanupStep): readonly string[] {
  return step.kind === 'model-packs' ? step.packs.map(packChoice) : [choiceOf(step)];
}

/** A model pack version, as a person knows it, and its size. */
function packLine(pack: PlannedPack): string {
  return `${pack.name ?? pack.ref.id} ${pack.ref.version}, ${describeBytes(pack.bytes)}`;
}

/** Why a cleanup keeps an installed pack. */
const KEPT: Readonly<Record<PackKept, string>> = {
  needed: 'A project needs this version, so a cleanup never removes it.',
  'needs-unknown': 'Which packs your projects need cannot be told now, so it is kept.',
};

/** Why a cleanup keeps an installed pack, in a sentence. */
export function keptSentence(kept: PackKept): string {
  return KEPT[kept];
}

/**
 * What confirming a plan removes, in a sentence, and the button that does it:
 * what goes for good told apart from model packs, which can be downloaded
 * again. Only for a plan that needs confirming.
 */
export function confirmationWords(plan: CleanupPlan): {
  readonly sentence: string;
  readonly button: string;
} {
  const total = describeBytes(plan.steps.reduce((sum, step) => sum + step.bytes, 0));
  const packBytes = plan.steps
    .filter((step) => step.kind === 'model-packs')
    .reduce((sum, step) => sum + step.bytes, 0);
  const lasting = describeBytes(plan.confirmationBytes - packBytes);
  const packs = describeBytes(packBytes);
  if (packBytes === 0) {
    return {
      sentence: `This frees ${total}, of which ${lasting} cannot be made again and goes for good.`,
      button: `Remove ${lasting} for good`,
    };
  }
  if (packBytes === plan.confirmationBytes) {
    return {
      sentence: `This frees ${total}, of which ${packs} is model packs you would have to download again.`,
      button: `Remove ${packs} of model packs`,
    };
  }
  return {
    sentence: `This frees ${total}: ${lasting} cannot be made again and goes for good, and ${packs} is model packs you would have to download again.`,
    button: `Remove ${describeBytes(plan.confirmationBytes)}, ${lasting} of it for good`,
  };
}

/** A project as a step names it: by its name, where the library holds it. */
type ProjectName = (project: ProjectId) => string | undefined;

/** A project, by name where it has one. */
function named(project: ProjectId, nameOf: ProjectName): string {
  const name = nameOf(project);
  return name === undefined ? 'a project not in the list' : quoted(name);
}

/** What a step takes, item by item, after the sentence that says what it costs. */
export function stepDetails(step: CleanupStep, nameOf: ProjectName): readonly string[] {
  switch (step.kind) {
    case 'cache':
      return [];
    case 'pack-downloads':
    case 'model-packs':
      return step.packs.map(packLine);
    case 'unfinished-projects':
      return [...step.projects].map(([project, left]) =>
        left === 'purging'
          ? `What is left of ${named(project, nameOf)}, whose purge was cut short`
          : `What is left of a project whose making was cut short`,
      );
    case 'expired-backups':
      return [...step.generations].map(
        ([project, numbers]) =>
          `${counted(numbers.length, 'backup', 'backups')} of ${named(project, nameOf)}`,
      );
    case 'expired-history':
      return [...step.compactions].flatMap(([project, plan]) =>
        plan.lost.map(
          (lost) => `${named(project, nameOf)}: ${lostSentence(lost, () => undefined)}`,
        ),
      );
    case 'set-aside-records':
      return [...step.records].map(
        ([project, records]) =>
          `${counted(records.length, 'change', 'changes')} set aside in ${named(project, nameOf)}`,
      );
    case 'unreferenced-media':
      return [counted(step.collection.unreachable.length, 'piece of audio', 'pieces of audio')];
  }
}
