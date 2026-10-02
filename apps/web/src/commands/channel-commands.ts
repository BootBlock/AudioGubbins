/**
 * The channel commands (REQ-EDIT-015, ADR-0051): swapping and copying
 * channels, each channel's own gain and a stereo balance over the selection,
 * and converting the whole sound's layout: down to mono, up to stereo, to any
 * layout the domain states a conversion to, or remapping its channels.
 *
 * A change between channels keeps the layout's roles: the content moves, the
 * channels stay what they were. A conversion takes the matrix the domain
 * states for the two layouts (`conversionMatrix`), or is refused with its
 * reason, and acts on the whole asset, which a region's view says.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import {
  StandardLayouts,
  channelCount,
  conversionMatrix,
  layoutsMatch,
  type ChannelEdit,
  type ChannelLayout,
} from '@audiogubbins/domain';

import { channelNames } from '../assets/channel-names.js';
import { RANGE_OR_WHOLE, editScope, editedView } from './edit-target.js';
import { channelsArgument, numberArgument } from './editor-target.js';
import {
  chainInvocation,
  changeProject,
  needsProjectAsset,
  onWholeAsset,
  processInvocation,
} from './project-edits.js';
import { shellCommand, textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

function channelCommand(
  id: string,
  label: string,
  run: (context: ShellContext, invocation: CommandInvocation) => BodyAnswer,
  keywords: readonly string[],
  discoverable = true,
): Command<ShellContext> {
  return shellCommand(id, label, CommandCategory.Edit, run, {
    availability: needsProjectAsset,
    keywords,
    discoverable,
  });
}

/** A change between channels, and what it is called. */
interface Made {
  readonly edit: ChannelEdit;
  readonly words: string;
}

/** Changes between the channels of the selection as `make` says, or why it cannot. */
function betweenChannels(
  context: ShellContext,
  invocation: CommandInvocation,
  make: (layout: ChannelLayout, names: readonly string[]) => Made | string,
): BodyAnswer {
  const scope = editScope(context, invocation, RANGE_OR_WHOLE);
  if (typeof scope === 'string') return scope;
  const { layout } = scope.view.asset;
  const made = make(layout, channelNames(layout));
  if (typeof made === 'string') return made;
  const { edit, words } = made;
  changeProject(context, scope.project.session, {
    description: words,
    invocations: [
      processInvocation(context, scope.project.owner, {
        range: scope.range,
        channels: undefined,
        edit,
      }),
    ],
    said: `${words}${scope.whole ? '' : ' over the selection'}.`,
  });
  return undefined;
}

/** Two channels an invocation names, as `first` and `second`, or the two of a stereo sound. */
function twoChannels(
  invocation: CommandInvocation,
  layout: ChannelLayout,
  names: readonly [string, string],
): readonly [number, number] | string {
  const count = channelCount(layout);
  const [one, other] = names.map((name) => numberArgument(invocation, name));
  if (one === undefined && other === undefined && count === 2) return [0, 1];
  const valid = (channel: number | undefined): channel is number =>
    channel !== undefined && Number.isInteger(channel) && channel >= 0 && channel < count;
  if (!valid(one) || !valid(other)) return 'Say which two channels, by their numbers from 0.';
  return one === other ? 'Choose two different channels.' : [one, other];
}

function swapCommand(): Command<ShellContext> {
  return channelCommand(
    'edit.swap-channels',
    'Swap the channels',
    (context, invocation) =>
      betweenChannels(context, invocation, (layout, names) => {
        const pair = twoChannels(invocation, layout, ['first', 'second']);
        if (typeof pair === 'string') return pair;
        const [first, second] = pair;
        return {
          edit: { kind: 'swap-channels', first, second },
          words: `Swapped ${names[first] ?? 'a channel'} with ${names[second] ?? 'another'}`,
        };
      }),
    ['swap', 'channels', 'left', 'right', 'exchange'],
  );
}

function copyChannelCommand(): Command<ShellContext> {
  return channelCommand(
    'edit.copy-channel',
    'Copy one channel onto another',
    (context, invocation) =>
      betweenChannels(context, invocation, (layout, names) => {
        const pair = twoChannels(invocation, layout, ['from', 'to']);
        if (typeof pair === 'string') return pair;
        const [from, to] = pair;
        return {
          edit: { kind: 'copy-channel', from, to },
          words: `Copied ${names[from] ?? 'a channel'} onto ${names[to] ?? 'another'}`,
        };
      }),
    ['copy', 'channel', 'duplicate', 'dual mono'],
    false,
  );
}

/** The largest factor a channel's own gain may be, as any edit's gain is bounded. */
const LOUDEST_CHANNEL = 1000;

function channelGainsCommand(): Command<ShellContext> {
  return channelCommand(
    'edit.channel-gains',
    'Set each channel’s gain',
    (context, invocation) =>
      betweenChannels(context, invocation, (layout) => {
        const gains = (textArgument(invocation, 'gains') ?? '').split(',').map(Number);
        if (
          gains.length !== channelCount(layout) ||
          gains.some((gain) => !Number.isFinite(gain) || gain < 0 || gain > LOUDEST_CHANNEL)
        ) {
          return `Give one gain from 0 to ${String(LOUDEST_CHANNEL)} for each of the ${String(channelCount(layout))} channels, separated by commas.`;
        }
        return { edit: { kind: 'channel-gains', gains }, words: 'Set each channel’s gain' };
      }),
    ['gain', 'channel', 'level', 'trim'],
    false,
  );
}

function balanceCommand(): Command<ShellContext> {
  return channelCommand(
    'edit.balance',
    'Balance left and right',
    (context, invocation) =>
      betweenChannels(context, invocation, (layout) => {
        if (!layoutsMatch(layout, StandardLayouts.stereo)) {
          return 'Balance is for a stereo sound. Set each channel’s gain for any other.';
        }
        const balance = numberArgument(invocation, 'balance');
        if (balance === undefined || balance < -1 || balance > 1) {
          return 'Say the balance, from -1 for all left to 1 for all right.';
        }
        return {
          edit: {
            kind: 'channel-gains',
            gains: [Math.min(1, 1 - balance), Math.min(1, 1 + balance)],
          },
          words: 'Balanced left and right',
        };
      }),
    ['balance', 'pan', 'left', 'right'],
    false,
  );
}

/** The layouts a sound can be converted to, by the name a command gives. */
const LAYOUTS: Readonly<Record<string, ChannelLayout>> = StandardLayouts;

/** Converts the whole sound to `layout` by the matrix the domain states, or says why it cannot. */
function converted(
  context: ShellContext,
  invocation: CommandInvocation,
  layout: ChannelLayout,
  matrix?: readonly (readonly number[])[],
): BodyAnswer {
  const found = editedView(context, invocation);
  if (typeof found === 'string') return found;
  const { view, project } = found;
  const from = view.asset.layout;
  if (matrix === undefined && layoutsMatch(from, layout)) {
    return `${view.asset.name} already has that layout.`;
  }
  const stated = matrix === undefined ? conversionMatrix(from, layout) : undefined;
  if (stated !== undefined && !stated.ok) return stated.failures[0].summary;
  const rows = matrix ?? stated?.value;
  if (rows === undefined) return 'There is no conversion to that layout.';
  const { owner } = project;
  changeProject(context, project.session, {
    description: 'Convert the layout',
    invocations: [
      chainInvocation(context, owner, { kind: 'convert-layout', layout, matrix: rows }),
    ],
    said: onWholeAsset(
      owner,
      `${view.asset.name} now has ${String(channelCount(layout))} ${channelCount(layout) === 1 ? 'channel' : 'channels'}: ${channelNames(layout).join(', ')}.`,
    ),
  });
  return undefined;
}

function layoutCommand(
  id: string,
  label: string,
  layout: ChannelLayout,
  keywords: readonly string[],
) {
  return channelCommand(
    id,
    label,
    (context, invocation) => converted(context, invocation, layout),
    keywords,
  );
}

function convertCommand(): Command<ShellContext> {
  return channelCommand(
    'edit.convert-layout',
    'Convert the channel layout',
    (context, invocation) => {
      const named = textArgument(invocation, 'layout');
      const layout = named === undefined ? undefined : LAYOUTS[named];
      if (layout === undefined) {
        return `Say which layout: ${Object.keys(LAYOUTS).join(', ')}.`;
      }
      return converted(context, invocation, layout);
    },
    ['layout', 'convert', 'upmix', 'downmix', 'surround'],
    false,
  );
}

function remapCommand(): Command<ShellContext> {
  return channelCommand(
    'edit.remap-channels',
    'Remap the channels',
    (context, invocation) => {
      const found = editedView(context, invocation);
      if (typeof found === 'string') return found;
      const { layout } = found.view.asset;
      const count = channelCount(layout);
      const order = channelsArgument(invocation, 'order', count);
      if (order?.length !== count || new Set(order).size !== count) {
        return `Give the ${String(count)} channels in their new order, each once, by their numbers from 0.`;
      }
      // Channel `index` of the new layout takes the old channel `order[index]`,
      // and keeps its own role.
      const matrix = order.map((old) =>
        Array.from({ length: count }, (_, column) => (column === old ? 1 : 0)),
      );
      return converted(context, invocation, layout, matrix);
    },
    ['remap', 'reorder', 'channels', 'route'],
    false,
  );
}

/** The channel commands. */
export function channelCommands(): readonly Command<ShellContext>[] {
  return [
    swapCommand(),
    copyChannelCommand(),
    channelGainsCommand(),
    balanceCommand(),
    layoutCommand('edit.to-mono', 'Mix down to mono', StandardLayouts.mono, [
      'mono',
      'downmix',
      'sum',
    ]),
    layoutCommand('edit.to-stereo', 'Make stereo', StandardLayouts.stereo, [
      'stereo',
      'upmix',
      'widen',
    ]),
    convertCommand(),
    remapCommand(),
  ];
}
