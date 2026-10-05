/**
 * What the shell says about the open project: how this tab may use it and who
 * else has it (REQ-STOR-098), and what recovery found when it was opened
 * (REQ-STOR-021, REQ-STOR-101).
 *
 * Plain language, and nothing of the journal's workings: a person hears that
 * changes were set aside, not which records of which epoch. Written apart from
 * the surfaces that show it, so the banner, its announcements and their tests
 * read one set of sentences.
 */

import type {
  LeaseOwner,
  ProjectAccess,
  ProjectRecoveryReport,
  ReadOnlyReason,
} from '@audiogubbins/storage';
import { counted } from '@audiogubbins/text';

import { recoveryFindings, type RecoveryFinding } from '../state/recovery-findings.js';

/** A phrase with its first letter made a capital, to begin a sentence with. */
function capitalised(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Who has a project, as a phrase inside a sentence. */
function ownerPhrase(owner: LeaseOwner | undefined): string {
  return owner?.label ?? 'another tab';
}

/** Why a project is open to read here, in a sentence. */
function readOnlySentence(reason: ReadOnlyReason, name: string): string {
  switch (reason.kind) {
    case 'busy':
      return `${name} is open to read here, because ${ownerPhrase(reason.owner)} is changing it.`;
    case 'released':
      return `No tab is changing ${name} now, so you can open it to change it here.`;
    case 'requested':
      return `${name} is open to read, as you asked.`;
    case 'no-coordination':
      return `${name} is open to read, because this browser cannot make sure only one tab changes it. The Capabilities panel says why.`;
  }
}

/** How this tab may use the open project, in a sentence, where there is anything to say. */
export function accessSentence(access: ProjectAccess, name: string): string | undefined {
  switch (access.kind) {
    case 'writable':
      return undefined;
    case 'read-only':
      return readOnlySentence(access.reason, name);
    case 'lost': {
      const lost =
        access.unsaved === 0
          ? ''
          : ` ${counted(access.unsaved, 'change', 'changes')} not yet saved here ${access.unsaved === 1 ? 'was' : 'were'} lost.`;
      return `${capitalised(ownerPhrase(access.loss.by))} took ${name} over, so this tab can no longer change it.${lost}`;
    }
    case 'handed-over':
      return `You handed ${name} over to another tab.`;
    case 'closed':
      return `${name} is closed.`;
  }
}

/** What another tab asks, in a sentence, for the tab changing the project. */
export function requestSentence(from: LeaseOwner, name: string): string {
  return `${capitalised(ownerPhrase(from))} asks to change ${name}. Hand it over, and this tab can only read it until you ask for it back.`;
}

/**
 * What recovery found and did when the project was opened, a sentence each,
 * where it found anything.
 */
export function recoverySentences(report: ProjectRecoveryReport): readonly string[] {
  return recoveryFindings(report).map(findingSentence);
}

/** One thing recovery found, in a sentence. */
function findingSentence(finding: RecoveryFinding): string {
  switch (finding.kind) {
    case 'fallback':
      return 'The newest save could not be read, so the project was opened from the one before it.';
    case 'rebuilt-cursor-state':
      return 'The state you were at was damaged, and was rebuilt from the changes before it.';
    case 'journal-break':
      return `The most recent changes could not all be read. ${counted(finding.discarded, 'change', 'changes')} after the damage ${finding.discarded === 1 ? 'was' : 'were'} set aside rather than applied, and nothing was deleted.`;
    case 'fenced':
      return `${counted(finding.changes, 'change', 'changes')} written by a tab after another took the project over ${finding.changes === 1 ? 'was' : 'were'} left out.`;
    case 'missing-states':
      return `${counted(finding.states, 'kept state is', 'kept states are')} missing, so going back to ${finding.states === 1 ? 'it' : 'them'} replays the changes instead.`;
  }
}
