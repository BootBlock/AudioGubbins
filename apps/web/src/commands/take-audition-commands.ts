/**
 * Hearing a take without changing the project (`ADR-0072`, `REQ-REC-089`): a
 * take of a stack plays its own recording; a take of a punch's stack plays the
 * audio punched into with that take chosen, from the punch's pre-roll, so the
 * takes are compared where they are heard.
 *
 * The punch's audio is built from the project as it stands with the stack's
 * choice put to the take auditioned, as the editor builds the project's own
 * entries (`projectEntry`), so it plays as choosing the take would, and no
 * command runs: the project, its history and the stack's own choice stay as
 * they are.
 */

import { CommandCategory, type Command } from '@audiogubbins/commands';
import { AUDIO_PLAYBACK } from '@audiogubbins/capabilities';
import { derivedSampleCount, type Take, type TakeStack } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { assetProgramme } from '../audio/asset-playback.js';
import { projectEntry } from '../assets/project-assets.js';
import { assetEntryId } from '../assets/project-entry.js';
import { punchPlaceOf } from '../recording/take-target.js';
import { needing } from './audio-commands.js';
import { programmeOf } from './recording-where.js';
import { namedTake } from './take-commands.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** `state` with `stack`'s choice put to `take`, which no command makes. */
function withChosen(state: ProjectState, stack: TakeStack, take: Take): ProjectState {
  const takeStacks = new Map(state.project.takeStacks);
  takeStacks.set(stack.id, { ...stack, chosen: take.id });
  return { ...state, project: { ...state.project, takeStacks } };
}

/** Plays `take` of `stack` as the module comment says, or answers why it cannot be heard. */
function audition(
  context: ShellContext,
  state: ProjectState,
  stack: TakeStack,
  take: Take,
): string | undefined {
  if (stack.punch === undefined) {
    const programme = programmeOf(context, take.asset);
    if (typeof programme === 'string') return programme;
    context.playback.play({ ...programme, key: `take:${take.id}` });
    return undefined;
  }
  const place = punchPlaceOf(state.project, stack);
  if (!place.ok) return place.failures[0].summary;
  const media = context.projects?.media.of;
  if (media === undefined) return 'This browser cannot keep projects.';
  const { asset } = place.value;
  const entry = projectEntry(
    withChosen(state, stack, take),
    media,
    context.modelGate.get(),
    assetEntryId(asset.id),
  );
  if (entry?.kind !== 'open') {
    return `${quoted(asset.displayName)} cannot be heard with ${quoted(take.name)} chosen yet. ${entry?.reason ?? ''}`.trim();
  }
  const programme = assetProgramme(entry.asset, context.hearing.get());
  context.playback.play(
    {
      ...programme,
      key: `take:${stack.id}:${take.id}`,
      playing: `${quoted(asset.displayName)} is playing with ${quoted(take.name)} chosen.`,
    },
    derivedSampleCount(place.value.start - Math.min(place.value.start, place.value.preRoll)),
  );
  return undefined;
}

/** The command that hears a take. */
export function takeAuditionCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      'take.audition',
      'Hear a take',
      CommandCategory.Transport,
      (context, invocation) => {
        const named = namedTake(context, invocation);
        if (typeof named === 'string') return named;
        return audition(context, named.session.getSnapshot().model.state, named.stack, named.take);
      },
      {
        keywords: ['audition', 'hear', 'listen', 'play', 'take', 'compare'],
        description:
          "Plays a take, or a punch with the take chosen, without changing the project or the stack's choice.",
        discoverable: false,
        availability: needing(AUDIO_PLAYBACK, () => undefined),
      },
    ),
  ];
}
