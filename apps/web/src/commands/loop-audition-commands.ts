/**
 * Hearing a region's loop (ADR-0103, "Audition by cycling"): its cycles after
 * a lead-in, the stress test of its seam, half a second either side repeated,
 * or either of a candidate's loop, until stopped (`loop-audition.ts`).
 *
 * Nothing here changes the project. A candidate is heard from the region's
 * plan made as it would be with the candidate's loop, its suggested crossfade
 * realised where asked, without writing it to the region, so what is heard is
 * what applying it would make.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import { AUDIO_PLAYBACK } from '@audiogubbins/capabilities';
import { anchorResolver, placeRegion, regionPlan } from '@audiogubbins/domain';
import type { LoopAuditionMode } from '@audiogubbins/loop-analysis';

import type { AuditionRequest } from '../audio/loop-audition.js';
import { planContextOf } from '../assets/project-assets.js';
import { needing } from './audio-commands.js';
import {
  candidateOnAsset,
  foundLoop,
  namedCandidate,
  type FoundLoop,
} from './loop-analysis-commands.js';
import { loopedRegion } from './region-property-commands.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The lead-in before the first cycle, at most, in seconds. */
const LEAD_IN_SECONDS = 1;

/** How much of each side of the seam its stress test plays, in seconds. */
const SEAM_SIDE_SECONDS = 0.5;

/** The audition `kind` names at `sampleRate`. */
function modeOf(kind: LoopAuditionMode['kind'], sampleRate: number): LoopAuditionMode {
  return kind === 'cycles'
    ? { kind, leadInFrames: Math.round(LEAD_IN_SECONDS * sampleRate) }
    : { kind, sideFrames: Math.round(SEAM_SIDE_SECONDS * sampleRate) };
}

/** What is heard of `loop`'s region as it loops now, by `kind`. */
function ownAudition(loop: FoundLoop, kind: LoopAuditionMode['kind']): AuditionRequest {
  const { looped } = loop;
  return {
    region: looped.region.id,
    name: looped.region.displayName,
    sound: looped.sound,
    describedWith: looped.describedWith,
    heard: looped.heard,
    loop: looped.loop,
    mode: modeOf(kind, looped.sound.sampleRate),
  };
}

/** The command that hears the region's own loop by `kind`. */
function ownAuditionCommand(
  id: string,
  label: string,
  kind: LoopAuditionMode['kind'],
  keywords: readonly string[],
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Transport,
    (context, invocation) => {
      const loop = foundLoop(context, invocation);
      if (typeof loop === 'string') return loop;
      return context.loopAudition.start(ownAudition(loop, kind));
    },
    { keywords, availability: needing(AUDIO_PLAYBACK, () => undefined) },
  );
}

/** What is heard of the candidate `invocation` names, or why it cannot be heard. */
function candidateAudition(
  context: ShellContext,
  invocation: CommandInvocation,
): AuditionRequest | string {
  const loop = foundLoop(context, invocation);
  if (typeof loop === 'string') return loop;
  const candidate = namedCandidate(context, loop, invocation);
  if (typeof candidate === 'string') return candidate;
  const withCrossfade = invocation.arguments?.['crossfade'] === true;
  if (withCrossfade && candidate.crossfade === undefined) {
    return `Candidate ${String(candidate.rank)} loops without a crossfade, so none is suggested for it.`;
  }
  const onAsset = candidateOnAsset(loop, candidate, withCrossfade);
  if (typeof onAsset === 'string') return onAsset;
  const region = loopedRegion(loop.found, onAsset);
  if (!region.ok) return region.failures[0].summary;
  const { asset, project } = loop.found;
  const resolver = anchorResolver(asset);
  const placed = placeRegion(resolver, region.value)?.loop;
  if (placed === undefined) return 'Nothing of the candidate’s loop is left in the region.';
  const heard = regionPlan(asset, region.value, planContextOf(project.state), resolver);
  if (!heard.ok) return heard.failures[0].summary;
  const named = textArgument(invocation, 'mode');
  if (named !== undefined && named !== 'cycles' && named !== 'seam') {
    return 'A candidate is heard by its cycles or by its seam.';
  }
  return {
    ...ownAudition(loop, named ?? 'cycles'),
    heard: heard.value,
    loop: placed,
    candidate: candidate.rank,
  };
}

function candidateAuditionCommand(): Command<ShellContext> {
  return shellCommand(
    'loop.audition-candidate',
    'Hear a loop candidate',
    CommandCategory.Transport,
    (context, invocation) => {
      const request = candidateAudition(context, invocation);
      if (typeof request === 'string') return request;
      return context.loopAudition.start(request);
    },
    {
      keywords: ['loop', 'candidate', 'hear', 'audition', 'listen', 'cycle'],
      description:
        'Cycles a candidate the loop search found, or stress-tests its seam with mode "seam", with its suggested crossfade where crossfade is true, without changing the region.',
      availability: needing(AUDIO_PLAYBACK, () => undefined),
    },
  );
}

function stopCommand(): Command<ShellContext> {
  return shellCommand(
    'loop.stop-audition',
    'Stop hearing the loop',
    CommandCategory.Transport,
    (context) => {
      if (!context.loopAudition.stop()) return 'No loop is being heard.';
      context.interaction.announce('Stopped hearing the loop.');
      return undefined;
    },
    {
      keywords: ['stop', 'loop', 'audition', 'cycle', 'seam'],
      availability: needing(AUDIO_PLAYBACK, (context) =>
        context.loopAudition.get() === undefined ? 'No loop is being heard.' : undefined,
      ),
    },
  );
}

/** The commands that hear a region's loop, or a candidate's, by cycling it. */
export function loopAuditionCommands(): readonly Command<ShellContext>[] {
  return [
    ownAuditionCommand('loop.audition-cycles', 'Hear the loop cycling', 'cycles', [
      'loop',
      'hear',
      'audition',
      'cycle',
      'repeat',
      'listen',
    ]),
    ownAuditionCommand('loop.audition-seam', 'Stress-test the loop’s seam', 'seam', [
      'loop',
      'seam',
      'stress',
      'test',
      'boundary',
      'hear',
    ]),
    candidateAuditionCommand(),
    stopCommand(),
  ];
}
