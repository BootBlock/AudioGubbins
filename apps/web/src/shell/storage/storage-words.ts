/**
 * What the Storage panel calls each part of the storage and each step of a
 * cleanup, and what each step costs (REQ-STOR-200, REQ-STOR-106, REQ-STOR-102,
 * REQ-STOR-027).
 *
 * The categories are the ones a person decides what to keep by, named for what
 * they are to that person rather than for where they lie. Every step says what
 * is lost by it before anything is removed.
 */

import type {
  CacheCategory,
  CleanupStep,
  RecoverabilityLoss,
  StorageUsage,
} from '@audiogubbins/storage';

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
    { name: 'Backups', bytes: usage.backups },
    {
      name: 'Audio kept for the history, snapshots and backups',
      bytes: usage.retainedDeletedMedia,
    },
    { name: 'Audio nothing uses', bytes: usage.unreferencedMedia },
    ...[...usage.caches].map(([category, bytes]) => ({ name: cacheName(category), bytes })),
  ];
}

/** What a step removes, as a person calls it. */
export function stepName(step: CleanupStep): string {
  switch (step.kind) {
    case 'cache':
      return cacheName(step.category);
    case 'unfinished-projects':
      return 'Projects whose making was cut short';
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
  'unfinished-projects': 'Nothing you finished: these were never listed as projects.',
  'backup-generations': 'You could no longer restore a project to these backups.',
  history: 'Undoing that far, and the branches and export states it takes, go for good.',
  'set-aside-changes': 'What these changes held could no longer be looked at.',
  'unreferenced-media': 'The audio itself goes for good. Nothing refers to it any more.',
};

/** What a step costs, in a sentence. */
export function lossOf(step: CleanupStep): string {
  return LOSSES[step.loses];
}

/** How a step is named when it is chosen by an argument of the cleanup command. */
export function choiceOf(step: CleanupStep): string {
  return step.kind === 'cache' ? `cache:${step.category}` : step.kind;
}
