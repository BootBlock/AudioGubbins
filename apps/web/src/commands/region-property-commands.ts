/**
 * What a region is called, how it loops and how it is tagged (ADR-0051,
 * REQ-EDIT-014), each changed by one project command the history keeps.
 */

import type { Command } from '@audiogubbins/commands';
import { sampleCount, validateRegion, type Region } from '@audiogubbins/domain';
import { setRegionInvocation } from '@audiogubbins/project-commands';

import { quoted } from '../wording.js';
import { RANGE_OR_WHOLE, editScope } from './edit-target.js';
import { changeProject } from './project-edits.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { oneRegion, regionCommand } from './region-target.js';

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
      const looped = validateRegion(
        found.asset,
        {
          ...found.region,
          loop: {
            basis: found.asset.edits.length,
            start: scope.target.range.start,
            end: scope.target.range.end,
            crossfadeLength: crossfade.value,
          },
        },
        found.project.state.project.effectChains,
      );
      if (!looped.ok) return looped.failures[0].summary;
      changeProject(context, found.project.session, {
        description: `Loop ${found.region.displayName}`,
        invocations: [setRegionInvocation(looped.value)],
        said: `${found.region.displayName} loops ${scope.whole ? 'whole' : 'over the selection'}.`,
      });
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
