/**
 * Hearing the two states of an A/B comparison (REQ-STOR-195): the asset or
 * region in the editor in use, played as it stands in the side heard, built
 * from that side's state as the editor builds the project's own entries
 * (`projectEntries`) and played by the transport at its own rate.
 *
 * Neither state changes: the side's state is worked out in the storage worker
 * and only read here. Switching sides while one is heard goes on with the
 * other from where the listener is, which is what an A/B comparison is for.
 */

import { CommandCategory, type Command } from '@audiogubbins/commands';
import { AUDIO_PLAYBACK } from '@audiogubbins/capabilities';
import { TransportMode } from '@audiogubbins/audio-engine';
import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  type AssetId,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import type { SideName } from '@audiogubbins/history';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';

import { assetProgramme } from '../audio/asset-playback.js';
import type { Programme } from '../audio/programme.js';
import type { EditorAsset } from '../assets/editor-asset.js';
import { projectEntries, type MediaAvailability } from '../assets/project-assets.js';
import { modeOf, needing } from './audio-commands.js';
import { focusedEditor, parkHeld } from './editor-target.js';
import { sayWhenSettled, sessionOf } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** What starts the key of a programme that plays a side of a comparison. */
const AUDITION = 'compared-';

/** The programme that plays `asset` as side `side` has it, apart from the asset's own. */
function sideProgramme(asset: EditorAsset, side: SideName): Programme {
  return {
    ...assetProgramme(asset),
    key: `${AUDITION}${side}:${asset.id}`,
    playing: `${asset.name} is playing as side ${side.toUpperCase()} has it.`,
  };
}

/** The side of a comparison the transport plays, where it plays one. */
export function sideAuditioned(context: ShellContext): SideName | undefined {
  const key = context.playback.programme();
  if (key?.startsWith(AUDITION) !== true || modeOf(context) !== TransportMode.Playing) {
    return undefined;
  }
  return key.charAt(AUDITION.length) === 'b' ? 'b' : 'a';
}

/**
 * Plays `view`, the asset or region in the editor in use, as side `side` has
 * it, from `from`, with the files the page holds as `media` says; or why it
 * cannot be heard there.
 */
async function auditioned(
  context: ShellContext,
  parts: {
    readonly session: RemoteProjectSession;
    readonly media: (asset: AssetId) => MediaAvailability;
  },
  view: EditorAsset,
  side: SideName,
  from: number,
): Promise<DomainResult<void>> {
  const state = await parts.session.comparedState(side);
  if (!state.ok) return state;
  const entry = projectEntries(state.value, parts.media).entries.get(view.id);
  const named = `side ${side.toUpperCase()}`;
  if (entry === undefined) {
    return fail(
      failure('audition.absent', FailureKind.Rejected, `${view.name} is not in ${named}.`),
    );
  }
  if (entry.kind !== 'open') {
    return fail(
      failure(
        'audition.unavailable',
        FailureKind.Retryable,
        `${entry.name} cannot be heard as ${named} has it yet. ${entry.reason}`,
      ),
    );
  }
  const at: SampleCount = derivedSampleCount(Math.min(from, entry.asset.length));
  parkHeld(context);
  context.playback.play(sideProgramme(entry.asset, side), at);
  return succeed(undefined);
}

/**
 * Hears side `side` of the open comparison, in the editor in use, from
 * `from`, or from the view's playhead; answers why it cannot.
 */
export function auditionSide(
  context: ShellContext,
  side: SideName | undefined,
  from?: number,
): string | undefined {
  const target = focusedEditor(context);
  if (typeof target === 'string') return target;
  if (target.asset.owner.kind !== 'project') {
    return `${target.asset.name} is not part of the project, so it has no states to compare.`;
  }
  const session = sessionOf(context);
  const stores = context.projects;
  if (typeof session === 'string') return session;
  if (stores === undefined) return 'This browser cannot keep projects.';
  const comparison = session.getSnapshot().model.comparison;
  if (comparison === undefined) {
    return 'No comparison is open. Compare two states in the History panel first.';
  }
  sayWhenSettled(
    context,
    auditioned(
      context,
      { session, media: stores.media.of },
      target.asset,
      side ?? comparison.listening,
      from ?? context.cues.of(target.asset.id),
    ),
    () => undefined,
  );
  return undefined;
}

function auditionCommand(): Command<ShellContext> {
  return shellCommand(
    'history.audition',
    'Play the side heard',
    CommandCategory.Transport,
    (context, invocation) => {
      const named = textArgument(invocation, 'side');
      if (named !== undefined && named !== 'a' && named !== 'b') return 'Choose side A or side B.';
      return auditionSide(context, named);
    },
    {
      keywords: ['compare', 'a/b', 'audition', 'listen', 'play', 'side'],
      description:
        'Plays the audio in the editor in use as the side of the comparison being heard has it, changing neither.',
      availability: needing(AUDIO_PLAYBACK, (context) => {
        const session = sessionOf(context);
        if (typeof session === 'string') return session;
        return session.getSnapshot().model.comparison === undefined
          ? 'No comparison is open.'
          : undefined;
      }),
    },
  );
}

/** Hearing the sides of a comparison. */
export function auditionCommands(): readonly Command<ShellContext>[] {
  return [auditionCommand()];
}
