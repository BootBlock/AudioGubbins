/**
 * The offer of a recording cut short (`ADR-0071`, `REQ-REC-096`): recovering
 * it, which makes the asset and take it was for, named and placed as when it
 * began, and says it ended unexpectedly; or discarding it, which removes it for
 * good, and so is asked first and done only on the person's confirmation.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import { endedUnexpectedly } from '@audiogubbins/project-format';
import type { InterruptedRecording } from '@audiogubbins/storage';
import { quoted } from '@audiogubbins/text';

import type { InterruptedRecordings } from '../state/interrupted-recordings.js';
import { endingText, recordedText } from '../recording/take-words.js';
import { idArgument, readyProjects, sayWhenSettled } from './project-access.js';
import { availableUnless, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The commands of the offer, each naming the recording by its `session` argument. */
export const RECOVER_INTERRUPTED = 'recording.recover-interrupted';
export const DISCARD_INTERRUPTED = 'recording.discard-interrupted';
export const CONFIRM_DISCARD_INTERRUPTED = 'recording.confirm-discard-interrupted';
export const KEEP_INTERRUPTED = 'recording.keep-interrupted';

/** When a recording started, as a reader says it. */
const STARTED = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** What an interrupted recording is called in a sentence: its take's name, its length and its start. */
export function interruptedName(recording: InterruptedRecording): string {
  const started = STARTED.format(recording.recordedAt);
  const length = recordedText(recording.frames / recording.sampleRate);
  return `${quoted(recording.take.name)}, the recording of ${length} started ${started}`;
}

/** The offer and the recording `invocation` names in it, or why there is none. */
function offered(
  context: ShellContext,
  invocation: CommandInvocation,
): { readonly offers: InterruptedRecordings; readonly recording: InterruptedRecording } | string {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  const named = idArgument<'RecordingSessionId'>(invocation, 'session', 'recording');
  if ('refused' in named) return named.refused;
  const recording = stores.interrupted.offered(named.id);
  if (recording === undefined) return 'That recording is not one of those offered for recovery.';
  return { offers: stores.interrupted, recording };
}

/** Available where any recording is offered. */
function anyOffered(context: ShellContext): ReturnType<typeof availableUnless> {
  return availableUnless(
    (context.projects?.interrupted.get().recordings.length ?? 0) > 0
      ? undefined
      : 'No recording is waiting to be recovered.',
  );
}

/** Every command of the offer. */
export function interruptedRecordingCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      RECOVER_INTERRUPTED,
      'Recover a recording cut short',
      CommandCategory.File,
      (context, invocation) => {
        const found = offered(context, invocation);
        if (typeof found === 'string') return found;
        sayWhenSettled(
          context,
          found.offers.recover(found.recording.session),
          ({ take, recording }) =>
            endedUnexpectedly(recording.ending)
              ? `${quoted(take.name)} is recovered. It ended because ${endingText(recording.ending)}, so it may need review.`
              : `${quoted(take.name)} is recovered.`,
        );
        return undefined;
      },
      {
        keywords: ['recover', 'recording', 'crash', 'interrupted', 'take'],
        discoverable: false,
        availability: anyOffered,
      },
    ),
    shellCommand(
      DISCARD_INTERRUPTED,
      'Discard a recording cut short',
      CommandCategory.File,
      (context, invocation) => {
        const found = offered(context, invocation);
        if (typeof found === 'string') return found;
        const asked = found.offers.askDiscard(found.recording.session);
        if (!asked.ok) return asked.failures[0].summary;
        context.interaction.announce(
          `Discard ${interruptedName(found.recording)} for good? Nothing can bring it back. Confirm to discard it, or keep it.`,
        );
        return undefined;
      },
      {
        keywords: ['discard', 'recording', 'delete', 'interrupted'],
        discoverable: false,
        availability: anyOffered,
      },
    ),
    shellCommand(
      CONFIRM_DISCARD_INTERRUPTED,
      'Discard the recording for good',
      CommandCategory.File,
      (context) => {
        const offers = context.projects?.interrupted;
        const session = offers?.get().confirming;
        if (offers === undefined || session === undefined) {
          return 'No recording is waiting to be discarded.';
        }
        sayWhenSettled(context, offers.discard(session), () => 'The recording is discarded.');
        return undefined;
      },
      {
        keywords: ['discard', 'confirm', 'recording'],
        availability: (context) =>
          availableUnless(
            context.projects?.interrupted.get().confirming === undefined
              ? 'No recording is waiting to be discarded.'
              : undefined,
          ),
      },
    ),
    shellCommand(
      KEEP_INTERRUPTED,
      'Keep the recording',
      CommandCategory.File,
      (context) => {
        const offers = context.projects?.interrupted;
        if (offers?.get().confirming === undefined)
          return 'No recording is waiting to be discarded.';
        offers.keep();
        context.interaction.announce('The recording is kept, and still offered for recovery.');
        return undefined;
      },
      {
        keywords: ['keep', 'cancel', 'recording'],
        availability: (context) =>
          availableUnless(
            context.projects?.interrupted.get().confirming === undefined
              ? 'No recording is waiting to be discarded.'
              : undefined,
          ),
      },
    ),
  ];
}
