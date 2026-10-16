/**
 * The loop analysis commands (ADR-0103): measuring a region's loop, searching
 * near it for better loop points, stopping either, and applying a candidate
 * the search found, with or without the micro-crossfade it suggests.
 *
 * Analysing and searching change nothing of the project: they ask the
 * detection worker, and what it answers is the session's (`LoopAnalysing`).
 * Applying is the only command here that changes the project, and it does so
 * by the region's own loop command (`loopedRegion`, `setLoop`): one change the
 * history keeps, which one undo reverses and the Inspector shows. A candidate
 * is applied only from an analysis of the region's sound as it is now, so a
 * loop point never lands where an edit since has moved the audio it was found
 * in. An analysis that is refused, fails or is cancelled leaves the loop as it
 * was, since nothing but these apply commands moves it.
 */

import {
  CommandCategory,
  commandId,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { SampleRate } from '@audiogubbins/domain';
import {
  LOOP_ANALYSIS_VERSION,
  MOST_CANDIDATES,
  defaultLoopSearch,
  widestRadiusFrames,
  type LoopCandidate,
  type LoopSearch,
} from '@audiogubbins/loop-analysis';
import { counted, quoted } from '@audiogubbins/text';

import { loopRequestOf, regionLoopOf, type RegionLoop } from '../analysis/loop-analysing.js';
import { regionEntryId } from '../assets/project-entry.js';
import { isCurrent, type LoopAnalysisRecord } from '../state/loop-analysis-store.js';
import {
  loopOnAsset,
  loopedRegion,
  setLoop,
  type LoopOnAsset,
} from './region-property-commands.js';
import { oneRegion, regionCommand, type FoundRegion } from './region-target.js';
import { availableUnless, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** A looped region a loop command acts on, as it is heard now. */
export interface FoundLoop {
  readonly found: FoundRegion;
  readonly looped: RegionLoop;
}

/**
 * The one looped region a loop command acts on, the one named, shown or
 * selected (`oneRegion`), as heard now, or why there is none.
 */
export function foundLoop(
  context: ShellContext,
  invocation: CommandInvocation,
): FoundLoop | string {
  const found = oneRegion(context, invocation);
  if (typeof found === 'string') return found;
  const entry = regionEntryId(found.region.id);
  const sound = context.assets.find(entry);
  if (sound === undefined) {
    return (
      context.assets.get().unopened.get(entry)?.reason ??
      `${quoted(found.region.displayName)} cannot be heard yet.`
    );
  }
  const looped = regionLoopOf(sound, found.project.state);
  return typeof looped === 'string' ? looped : { found, looped };
}

/** The analysis of `loop`'s region, answered and of its sound as it is now, or why there is none. */
function currentAnalysis(
  context: ShellContext,
  loop: FoundLoop,
): Extract<LoopAnalysisRecord, { readonly kind: 'done' }> | string {
  const name = quoted(loop.found.region.displayName);
  const record = context.loopAnalysis.analyses.of(loop.found.region.id);
  if (record === undefined) return `The loop of ${name} has not been analysed this session.`;
  if (record.kind === 'running') return `The loop of ${name} is still being analysed.`;
  if (record.kind === 'failed')
    return `The loop of ${name} could not be analysed. ${record.reason}`;
  if (!isCurrent(record, loop.looped.identity, LOOP_ANALYSIS_VERSION)) {
    return `The sound of ${name} has changed since its loop was analysed. Analyse it again first.`;
  }
  return record;
}

/**
 * A number an invocation gives as a number or in figures, as a panel's field
 * types it: `undefined` where it gives none, `NaN` where what it gives is not
 * a number, which the command then refuses.
 */
function figuresArgument(invocation: CommandInvocation, name: string): number | undefined {
  const given = invocation.arguments?.[name];
  if (given === undefined) return undefined;
  if (typeof given === 'number') return given;
  return typeof given === 'string' && given.trim() !== '' ? Number(given) : Number.NaN;
}

/** The rank an invocation names, or 1, the best, where it names none. */
function rankArgument(invocation: CommandInvocation): number {
  return figuresArgument(invocation, 'rank') ?? 1;
}

/** The candidate of `loop`'s current analysis the invocation names, or why there is none. */
export function namedCandidate(
  context: ShellContext,
  loop: FoundLoop,
  invocation: CommandInvocation,
): LoopCandidate | string {
  const analysis = currentAnalysis(context, loop);
  if (typeof analysis === 'string') return analysis;
  const { candidates } = analysis.analysis;
  if (candidates.length === 0) {
    return 'No candidate loop points were searched for. Find better loop points first.';
  }
  const rank = rankArgument(invocation);
  const candidate = candidates.find((one) => one.rank === rank);
  return (
    candidate ??
    `Name a candidate from 1 to ${String(candidates.length)}, as the Loop panel numbers them.`
  );
}

/**
 * `candidate` as a loop of `loop`'s region on its asset's timeline: its points,
 * with its suggested crossfade where `withCrossfade`, and otherwise none, as
 * its metrics were measured; or why it cannot be one.
 */
export function candidateOnAsset(
  loop: FoundLoop,
  candidate: LoopCandidate,
  withCrossfade: boolean,
): LoopOnAsset | string {
  const suggested = withCrossfade ? candidate.crossfade : undefined;
  return loopOnAsset(loop.found, {
    start: candidate.start,
    end: candidate.end,
    crossfadeLength: suggested?.lengthFrames ?? 0,
    crossfadeShape: suggested?.shape ?? loop.looped.loop.crossfadeShape,
  });
}

/** The search an invocation asks for, by the defaults where it names nothing, or why it cannot run. */
function searchArgument(
  invocation: CommandInvocation,
  sampleRate: SampleRate,
): LoopSearch | string {
  const defaults = defaultLoopSearch(sampleRate);
  const milliseconds = figuresArgument(invocation, 'radius');
  if (milliseconds !== undefined && !Number.isFinite(milliseconds)) {
    return 'Give the search radius in milliseconds.';
  }
  const radiusFrames =
    milliseconds === undefined
      ? defaults.radiusFrames
      : Math.round((milliseconds * sampleRate) / 1000);
  if (radiusFrames < 1 || radiusFrames > widestRadiusFrames(sampleRate)) {
    return 'A search moves each loop point by at least one frame and at most two seconds.';
  }
  const candidates = figuresArgument(invocation, 'candidates') ?? defaults.candidates;
  if (!Number.isSafeInteger(candidates) || candidates < 1 || candidates > MOST_CANDIDATES) {
    return `A search lists from 1 to ${String(MOST_CANDIDATES)} candidates.`;
  }
  return {
    radiusFrames,
    keepLength: invocation.arguments?.['keep-length'] === true,
    candidates,
  };
}

/** Analyses `loop` for `search`, or answers that the analysis asked for is current or running. */
function analyseLoop(
  context: ShellContext,
  loop: FoundLoop,
  search: LoopSearch | undefined,
): ReturnType<typeof unchanged> | undefined {
  const request = loopRequestOf(loop.looped.loop, search);
  const record = context.loopAnalysis.analyses.of(loop.found.region.id);
  const name = quoted(loop.found.region.displayName);
  if (
    record !== undefined &&
    record.kind !== 'failed' &&
    isCurrent(record, loop.looped.identity, LOOP_ANALYSIS_VERSION) &&
    JSON.stringify(record.request) === JSON.stringify(request)
  ) {
    return unchanged(
      'loop.unchanged',
      record.kind === 'running'
        ? `The loop of ${name} is being analysed already.`
        : `The analysis of the loop of ${name} is current; the Loop panel shows it.`,
    );
  }
  context.loopAnalysis.analyse(loop.looped, request, context.audioSettings.get().renderQuality);
  context.interaction.announce(
    search === undefined
      ? `Analysing the loop of ${name}.`
      : `Analysing the loop of ${name}, and searching near it for better loop points.`,
  );
  return undefined;
}

function analyseCommand(): Command<ShellContext> {
  return regionCommand(
    'loop.analyse',
    'Analyse the region’s loop',
    (context, invocation) => {
      const loop = foundLoop(context, invocation);
      if (typeof loop === 'string') return loop;
      return analyseLoop(context, loop, undefined);
    },
    ['loop', 'analyse', 'seam', 'click', 'seamless', 'check'],
  );
}

function findCandidatesCommand(): Command<ShellContext> {
  return regionCommand(
    'loop.find-candidates',
    'Find better loop points',
    (context, invocation) => {
      const loop = foundLoop(context, invocation);
      if (typeof loop === 'string') return loop;
      const search = searchArgument(invocation, loop.looped.sound.sampleRate);
      if (typeof search === 'string') return search;
      return analyseLoop(context, loop, search);
    },
    ['loop', 'candidate', 'points', 'search', 'seamless', 'crossfade', 'suggest'],
  );
}

/** The region whose loop analysis is running, or why none is. */
function runningAnalysis(
  context: ShellContext,
  invocation: CommandInvocation,
): FoundRegion | string {
  const found = oneRegion(context, invocation);
  if (typeof found === 'string') return found;
  return context.loopAnalysis.isRunning(found.region.id)
    ? found
    : `The loop of ${quoted(found.region.displayName)} is not being analysed.`;
}

/** Stopping an analysis as an availability asks of it: of the region shown or selected. */
const NAMING_NOTHING: CommandInvocation = { commandId: commandId('loop.cancel-analysis') };

function cancelCommand(): Command<ShellContext> {
  return shellCommand(
    'loop.cancel-analysis',
    'Stop analysing the loop',
    CommandCategory.Edit,
    (context, invocation) => {
      const found = runningAnalysis(context, invocation);
      if (typeof found === 'string') return found;
      context.loopAnalysis.cancel(found.region.id);
      context.interaction.announce(
        `Stopped analysing the loop of ${quoted(found.region.displayName)}. Its loop is unchanged.`,
      );
      return undefined;
    },
    {
      availability: (context) => {
        const running = runningAnalysis(context, NAMING_NOTHING);
        return availableUnless(typeof running === 'string' ? running : undefined);
      },
      keywords: ['stop', 'cancel', 'loop', 'analysis'],
    },
  );
}

/** Applies candidate `invocation` names to `loop`'s region, with its crossfade where `withCrossfade`. */
function applyCandidate(
  context: ShellContext,
  invocation: CommandInvocation,
  withCrossfade: boolean,
): string | ReturnType<typeof unchanged> | undefined {
  const loop = foundLoop(context, invocation);
  if (typeof loop === 'string') return loop;
  const candidate = namedCandidate(context, loop, invocation);
  if (typeof candidate === 'string') return candidate;
  if (withCrossfade && candidate.crossfade === undefined) {
    return `Candidate ${String(candidate.rank)} loops without a crossfade, so none is suggested for it.`;
  }
  const own = loop.looped.loop;
  const fadeFrames = withCrossfade ? (candidate.crossfade?.lengthFrames ?? 0) : 0;
  if (
    own.loopStart === candidate.start &&
    own.loopEnd === candidate.end &&
    own.crossfadeLength === fadeFrames &&
    (fadeFrames === 0 || own.crossfadeShape === candidate.crossfade?.shape)
  ) {
    return unchanged(
      'loop.unchanged',
      `${quoted(loop.found.region.displayName)} loops at candidate ${String(candidate.rank)}’s points already.`,
    );
  }
  const onAsset = candidateOnAsset(loop, candidate, withCrossfade);
  if (typeof onAsset === 'string') return onAsset;
  const looped = loopedRegion(loop.found, onAsset);
  if (!looped.ok) return looped.failures[0].summary;
  const name = quoted(loop.found.region.displayName);
  const fade =
    candidate.crossfade === undefined || !withCrossfade
      ? ''
      : `, with a crossfade of ${counted(candidate.crossfade.lengthFrames, 'frame', 'frames')}`;
  setLoop(
    context,
    loop.found,
    looped.value,
    `${name} now loops at candidate ${String(candidate.rank)}’s points, frames ${String(candidate.start)} to ${String(candidate.end)} of the region${fade}.`,
  );
  return undefined;
}

function applyCandidateCommand(): Command<ShellContext> {
  return regionCommand(
    'loop.apply-candidate',
    'Apply a loop candidate',
    (context, invocation) => applyCandidate(context, invocation, false),
    ['loop', 'candidate', 'apply', 'points', 'seamless'],
  );
}

function applyCrossfadeCommand(): Command<ShellContext> {
  return regionCommand(
    'loop.apply-crossfade',
    'Apply a loop candidate with its crossfade',
    (context, invocation) => applyCandidate(context, invocation, true),
    ['loop', 'candidate', 'crossfade', 'micro', 'apply', 'seamless'],
  );
}

/** The commands that analyse a region's loop and apply what the analysis suggests. */
export function loopAnalysisCommands(): readonly Command<ShellContext>[] {
  return [
    analyseCommand(),
    findCandidatesCommand(),
    cancelCommand(),
    applyCandidateCommand(),
    applyCrossfadeCommand(),
  ];
}
