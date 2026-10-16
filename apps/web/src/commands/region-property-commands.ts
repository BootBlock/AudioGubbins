/**
 * What a region is called, how it loops and how it is tagged (ADR-0051,
 * REQ-EDIT-014), each changed by one project command the history keeps.
 */

import type { Command, CommandInvocation } from '@audiogubbins/commands';
import {
  DEFAULT_LOOP_CROSSFADE_SHAPE,
  FadeShape,
  addSamples,
  anchorResolver,
  flatMapResult,
  placeRegion,
  sampleCount,
  validateLoopLead,
  validateRegion,
  type DomainResult,
  type Region,
  type SampleCount,
} from '@audiogubbins/domain';
import { setRegionInvocation } from '@audiogubbins/project-commands';

import { RANGE_OR_WHOLE, editScope } from './edit-target.js';
import { changeProject } from './project-edits.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { oneRegion, regionCommand, type FoundRegion } from './region-target.js';
import { quoted } from '@audiogubbins/text';

function renameCommand(): Command<ShellContext> {
  return regionCommand(
    'region.rename',
    'Rename the region',
    (context, invocation) => {
      const name = textArgument(invocation, 'name')?.trim();
      if (name === undefined || name.length === 0) return 'Say what to call the region.';
      const found = oneRegion(context, invocation);
      if (typeof found === 'string') return found;
      changeProject(context, found.project.session, {
        description: `Rename ${found.region.displayName}`,
        invocations: [setRegionInvocation({ ...found.region, displayName: name })],
        said: `${quoted(found.region.displayName)} is now called ${quoted(name)}.`,
      });
      return undefined;
    },
    ['region', 'rename', 'name', 'call'],
    false,
  );
}

/** The crossfade's shape a loop command is given, the default where it names none, or `undefined` for no shape. */
function loopShapeArgument(invocation: CommandInvocation): FadeShape | undefined {
  const named = textArgument(invocation, 'shape');
  if (named === undefined) return DEFAULT_LOOP_CROSSFADE_SHAPE;
  return Object.values(FadeShape).find((shape) => shape === named);
}

/** A loop of a region, on its asset's edited timeline as the chain stands. */
export interface LoopOnAsset {
  readonly start: SampleCount;
  readonly end: SampleCount;
  readonly crossfadeLength: SampleCount;
  readonly crossfadeShape: FadeShape;
}

/**
 * A loop of `found`'s region given in the region's own frames, as an analysis
 * of its sound states one, on its asset's timeline where the region is placed
 * now; or why it cannot be.
 */
export function loopOnAsset(
  found: FoundRegion,
  loop: Omit<LoopOnAsset, 'start' | 'end' | 'crossfadeLength'> & {
    readonly start: number;
    readonly end: number;
    readonly crossfadeLength: number;
  },
): LoopOnAsset | string {
  const placed = placeRegion(anchorResolver(found.asset), found.region);
  if (placed === undefined) return 'Nothing of the region is left to loop.';
  const at = (frame: number): DomainResult<SampleCount> =>
    flatMapResult(sampleCount(frame), (offset) => addSamples(placed.start, offset));
  const start = at(loop.start);
  if (!start.ok) return start.failures[0].summary;
  const end = at(loop.end);
  if (!end.ok) return end.failures[0].summary;
  const crossfadeLength = sampleCount(loop.crossfadeLength);
  if (!crossfadeLength.ok) return crossfadeLength.failures[0].summary;
  return {
    start: start.value,
    end: end.value,
    crossfadeLength: crossfadeLength.value,
    crossfadeShape: loop.crossfadeShape,
  };
}

/**
 * `found`'s region looping over `loop`, anchored at its asset's chain as it
 * stands, or why it cannot loop so: the one rule every command that loops a
 * region keeps, a crossfade among it that must fit the loop and the audio
 * before its start (ADR-0103).
 */
export function loopedRegion(found: FoundRegion, loop: LoopOnAsset): DomainResult<Region> {
  const region: Region = {
    ...found.region,
    loop: { basis: found.asset.edits.length, ...loop },
  };
  return flatMapResult(
    validateRegion(found.asset, region, found.project.state.project.effectChains),
    (valid) => validateLoopLead(found.asset, valid),
  );
}

/** Loops `found`'s region as `looped` has it, as one change the history keeps, saying `said` once made. */
export function setLoop(
  context: ShellContext,
  found: FoundRegion,
  looped: Region,
  said: string,
): void {
  changeProject(context, found.project.session, {
    description: `Loop ${found.region.displayName}`,
    invocations: [setRegionInvocation(looped)],
    said,
  });
}

function loopCommand(): Command<ShellContext> {
  return regionCommand(
    'region.loop',
    'Loop the selection of the region',
    (context, invocation) => {
      const found = oneRegion(context, invocation);
      if (typeof found === 'string') return found;
      if (found.project.owner.region?.id !== found.region.id) {
        return 'Open the region in a view of its own, and select the part to loop there.';
      }
      const scope = editScope(context, invocation, RANGE_OR_WHOLE);
      if (typeof scope === 'string') return scope;
      const given = invocation.arguments?.['crossfade'];
      // An argument left out is no crossfade; one that is not a number, as an
      // empty field gives, is refused rather than read as none.
      const crossfade = sampleCount(
        given === undefined ? 0 : typeof given === 'number' ? given : Number.NaN,
      );
      if (!crossfade.ok) return crossfade.failures[0].summary;
      const shape = loopShapeArgument(invocation);
      if (shape === undefined) return `A crossfade is ${Object.values(FadeShape).join(', ')}.`;
      const looped = loopedRegion(found, {
        start: scope.target.range.start,
        end: scope.target.range.end,
        crossfadeLength: crossfade.value,
        crossfadeShape: shape,
      });
      if (!looped.ok) return looped.failures[0].summary;
      setLoop(
        context,
        found,
        looped.value,
        `${found.region.displayName} loops ${scope.whole ? 'whole' : 'over the selection'}.`,
      );
      return undefined;
    },
    ['region', 'loop', 'repeat', 'cycle'],
  );
}

/** Why a loop cannot be cleared from `region`, or `undefined` where it loops. */
export function loopAbsence(region: Region): string | undefined {
  return region.loop === undefined ? `${region.displayName} does not loop.` : undefined;
}

function clearLoopCommand(): Command<ShellContext> {
  return regionCommand(
    'region.clear-loop',
    'Stop the region looping',
    (context, invocation) => {
      const found = oneRegion(context, invocation);
      if (typeof found === 'string') return found;
      const absent = loopAbsence(found.region);
      if (absent !== undefined) return absent;
      const { loop: _cleared, ...unlooped } = found.region;
      changeProject(context, found.project.session, {
        description: `Stop ${found.region.displayName} looping`,
        invocations: [setRegionInvocation(unlooped)],
        said: `${found.region.displayName} no longer loops.`,
      });
      return undefined;
    },
    ['region', 'loop', 'clear', 'stop'],
  );
}

/** Tags as a region keeps them: trimmed, each once, sorted. */
function tagsOf(text: string): readonly string[] {
  const tags = text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return [...new Set(tags)].sort();
}

function tagCommand(): Command<ShellContext> {
  return regionCommand(
    'region.set-tags',
    'Set the region’s tags',
    (context, invocation) => {
      const text = textArgument(invocation, 'tags');
      if (text === undefined) return 'Say which tags the region has, separated by commas.';
      const found = oneRegion(context, invocation);
      if (typeof found === 'string') return found;
      const tags = tagsOf(text);
      changeProject(context, found.project.session, {
        description: `Tag ${found.region.displayName}`,
        invocations: [setRegionInvocation({ ...found.region, tags })],
        said:
          tags.length === 0
            ? `${found.region.displayName} has no tags.`
            : `${found.region.displayName} is tagged ${tags.join(', ')}.`,
      });
      return undefined;
    },
    ['region', 'tag', 'label', 'category'],
    false,
  );
}

/** The commands that name, loop and tag a region. */
export function regionPropertyCommands(): readonly Command<ShellContext>[] {
  return [renameCommand(), loopCommand(), clearLoopCommand(), tagCommand()];
}
