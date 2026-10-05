/**
 * What a cleanup came to, and why audio was kept, in the words the Storage
 * panel shows and the command that carries the cleanup out says, so both tell
 * the person the same (REQ-STOR-106, REQ-STOR-200).
 *
 * Every step left undone is said with its reason: a project another tab
 * writes, a history that moved on from its plan, what was kept because
 * something was being saved that would have looked left over, and audio kept
 * because it could not be purged safely. A cleanup that did less than planned
 * never reads as one that did it all.
 */

import type { CleanupRefusal, StepOutcome } from '@audiogubbins/storage';
import { counted } from '@audiogubbins/text';

import { describeBytes } from './wording.js';

/** Why audio cannot be purged now, in a sentence. */
export function refusalSentence(refusal: CleanupRefusal): string {
  switch (refusal.kind) {
    case 'unreadable':
      return `Audio cannot be purged now: ${counted(refusal.roots.length, 'stored file', 'stored files')} could not be read, and might need it.`;
    case 'no-coordination':
      return 'Audio cannot be purged in this browser, because it cannot keep other tabs from storing audio meanwhile.';
    case 'storing':
      return 'Something is being saved now, so no audio can be purged. Try again shortly.';
  }
}

/**
 * Why a step that removes what a crash left removed nothing: something was
 * being saved that would have looked left over until it was whole.
 */
function keptWhileSaving(step: StepOutcome['step']): string {
  const what =
    step === 'unfinished-projects'
      ? 'projects whose making or purge was cut short were'
      : 'backups the policy no longer keeps were';
  return `Something is being saved now, so ${what} kept. Try again shortly.`;
}

/** What a cleanup came to: what it freed, then each thing it left and why. */
export function cleanedSentences(outcomes: readonly StepOutcome[]): readonly string[] {
  const freed = outcomes.reduce((sum, one) => sum + one.freed, 0);
  const busy = new Set(outcomes.flatMap((one) => one.busy));
  const unapplied = new Set(outcomes.flatMap((one) => one.unapplied ?? []));
  const sentences = [`The cleanup freed ${describeBytes(freed)}.`];
  if (busy.size > 0) {
    sentences.push(
      `${counted(busy.size, 'project', 'projects')} another tab has open ${busy.size === 1 ? 'was' : 'were'} left as ${busy.size === 1 ? 'it was' : 'they were'}.`,
    );
  }
  if (unapplied.size > 0) {
    sentences.push(
      `The history of ${counted(unapplied.size, 'project', 'projects')} changed after the cleanup was planned, so it was kept. Plan the cleanup again to compact it.`,
    );
  }
  for (const { step, refused } of outcomes) {
    if (refused === undefined) continue;
    sentences.push(
      step === 'unreferenced-media' ? refusalSentence(refused) : keptWhileSaving(step),
    );
  }
  return sentences;
}
