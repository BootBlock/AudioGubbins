/**
 * The loudness conformance report's commands (ADR-0101): measuring every
 * member of an asset group as the final render hears it, on the detection
 * worker, for the Asset groups panel to set beside the loudness target each
 * resolves to, and stopping a measurement under way.
 *
 * A measurement is a value of the session: nothing is normalised because a
 * member measured off its target. The Normalise Game SFX workflow realises a
 * target, through the project's commands.
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import { memberKey, type GroupMember } from '@audiogubbins/game-audio';

import type { MeasuredMember } from '../analysis/loudness-measuring.js';
import { assetEntryId, regionEntryId } from '../assets/project-entry.js';
import { gameScope, groupAvailability, groupName, memberName, targetGroup } from './game-target.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The entry the editor opens `member` as. */
function entryOf(member: GroupMember): string {
  return member.kind === 'region' ? regionEntryId(member.region) : assetEntryId(member.asset);
}

function measureCommand(): Command<ShellContext> {
  return shellCommand(
    'game.measure-loudness',
    'Measure the loudness of the group’s members',
    CommandCategory.Tools,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      const memberships = scope.view.membersOf(group.id);
      if (memberships.length === 0) {
        return `The group ${groupName(scope.view, group.id)} has no member to measure.`;
      }
      const measured: MeasuredMember[] = [];
      const unheard: string[] = [];
      for (const { member } of memberships) {
        const name = memberName(scope.state.project, member);
        const audio = context.assets.find(entryOf(member));
        if (audio === undefined) unheard.push(name);
        else measured.push({ key: memberKey(member), name, audio });
      }
      if (unheard.length > 0) {
        return `${unheard.join(', ')} cannot be heard yet, so the group is not measured; wait for ${unheard.length === 1 ? 'it' : 'them'} to open.`;
      }
      context.loudness.measure(measured, context.audioSettings.get().renderQuality);
      context.interaction.announce(
        `Measuring the loudness of the group ${groupName(scope.view, group.id)}’s members against their targets.`,
      );
      return undefined;
    },
    {
      availability: groupAvailability,
      keywords: ['loudness', 'lufs', 'measure', 'conformance', 'target', 'true peak', 'group'],
      description:
        'Measures the integrated loudness and true peak of each member of the asset group chosen, as the final render hears it, against the loudness target it resolves to.',
    },
  );
}

function cancelCommand(): Command<ShellContext> {
  return shellCommand(
    'game.cancel-loudness',
    'Stop measuring loudness',
    CommandCategory.Tools,
    (context) => {
      if (!context.loudness.cancel()) {
        return unchanged('game.loudness-not-measuring', 'No loudness is being measured.');
      }
      context.interaction.announce('Stopped measuring loudness.');
      return undefined;
    },
    { keywords: ['loudness', 'stop', 'cancel', 'measure'] },
  );
}

/** The loudness conformance commands. */
export function loudnessCommands(): readonly Command<ShellContext>[] {
  return [measureCommand(), cancelCommand()];
}
