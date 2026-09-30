/**
 * What a cleanup came to, and why audio was kept, in the words the Storage
 * panel shows and the command that carries the cleanup out says, so both tell
 * the person the same (REQ-STOR-106, REQ-STOR-200).
 *
 * Every step left undone is said with its reason: a project another tab
 * writes, a history that moved on from its plan, and audio kept because it
 * could not be purged safely. A cleanup that did less than planned never reads
 * as one that did it all.
 */

import type { MediaPurgeRefusal, StepOutcome } from '@audiogubbins/storage';

import { describeBytes } from './wording.js';

/** Why audio cannot be purged now, in a sentence. */
export function refusalSentence(refusal: MediaPurgeRefusal): string {
  switch (refusal.kind) {
    case 'unreadable':
      return `Audio cannot be purged now: ${String(refusal.roots.length)} stored ${refusal.roots.length === 1 ? 'file' : 'files'} could not be read, and might need it.`;
    case 'no-coordination':
      return 'Audio cannot be purged in this browser, because it cannot keep other tabs from storing audio meanwhile.';
    case 'storing':
      return 'Another tab is storing audio now, so none can be purged. Try again shortly.';
  }
}

/** How many projects, as a sentence counts them. */
function projects(count: number): string {
  return count === 1 ? '1 project' : `${String(count)} projects`;
}

/** What a cleanup came to: what it freed, then each thing it left and why. */
export function cleanedSentences(outcomes: readonly StepOutcome[]): readonly string[] {
  const freed = outcomes.reduce((sum, one) => sum + one.freed, 0);
  const busy = new Set(outcomes.flatMap((one) => one.busy));
  const unapplied = new Set(outcomes.flatMap((one) => one.unapplied ?? []));
  const sentences = [`The cleanup freed ${describeBytes(freed)}.`];
  if (busy.size > 0) {
    sentences.push(
      `${projects(busy.size)} another tab has open ${busy.size === 1 ? 'was' : 'were'} left as ${busy.size === 1 ? 'it was' : 'they were'}.`,
    );
  }
  if (unapplied.size > 0) {
    sentences.push(
      `The history of ${projects(unapplied.size)} changed after the cleanup was planned, so it was kept. Plan the cleanup again to compact it.`,
    );
  }
  for (const { refused } of outcomes) {
    if (refused !== undefined) sentences.push(refusalSentence(refused));
  }
  return sentences;
}
