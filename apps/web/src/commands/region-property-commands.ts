/**
 * What a region is called, how it loops and how it is tagged (ADR-0051,
 * REQ-EDIT-014), each changed by one project command the history keeps.
 */

import type { Command } from '@audiogubbins/commands';
import { derivedSampleCount } from '@audiogubbins/domain';
import { setRegionInvocation } from '@audiogubbins/project-commands';

import { quoted } from '../wording.js';
import { RANGE_OR_WHOLE, editScope } from './edit-target.js';
import { numberArgument } from './editor-target.js';
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
      const crossfade = numberArgument(invocation, 'crossfade') ?? 0;
      const length = scope.target.range.end - scope.target.range.start;
      if (!Number.isInteger(crossfade) || crossfade < 0 || crossfade > length) {
        return 'A loop’s crossfade is a whole number of frames no longer than the loop.';
      }
      const loop = {
        basis: found.asset.edits.length,
        start: scope.target.range.start,
        end: scope.target.range.end,
        crossfadeLength: derivedSampleCount(crossfade),
      };
      changeProject(context, found.project.session, {
        description: `Loop ${found.region.displayName}`,
        invocations: [setRegionInvocation({ ...found.region, loop })],
        said: `${found.region.displayName} loops ${scope.whole ? 'whole' : 'over the selection'}.`,
      });
      return undefined;
    },
    ['region', 'loop', 'repeat', 'cycle'],
  );
}

function clearLoopCommand(): Command<ShellContext> {
  return regionCommand(
    'region.clear-loop',
    'Stop the region looping',
    (context, invocation) => {
      const found = oneRegion(context, invocation);
      if (typeof found === 'string') return found;
      const { loop: _loop, ...unlooped } = found.region;
      if (_loop === undefined) return `${found.region.displayName} does not loop.`;
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
