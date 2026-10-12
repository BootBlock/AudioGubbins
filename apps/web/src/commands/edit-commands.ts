/**
 * The edit commands over a range (ADR-0051, REQ-EDIT-014): deleting, trimming,
 * silencing, fading, changing the gain of, inverting and reversing what the
 * selection holds, each one project command the history keeps and undo
 * reverses, and the source never rewritten.
 *
 * Each acts on its target selection first (ADR-0042): the active time range
 * and its channels, or, for the commands whose request says so, the whole
 * sound shown where nothing is selected. Deleting and trimming need a range,
 * so an accidental press never empties a sound. In a region's view a level
 * change is the region's own processing, and a change of time is made on the
 * asset, which is said. The spectral edits, which act on an area of time and
 * frequency, are `spectral-edit-commands.ts`.
 */

import { decibelsToGain, gainToDecibels } from '@audiogubbins/audio-engine';
import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import { FadeDirection, FadeShape, MAXIMUM_EDIT_GAIN, type RangeEdit } from '@audiogubbins/domain';
import { processTargetInvocation } from '@audiogubbins/project-commands';
import { formatPosition } from '@audiogubbins/timeline';

import { SelectionFacet, type MadeFacet, type TargetRequest } from '@audiogubbins/timeline';

import {
  RANGE_ONLY,
  RANGE_OR_WHOLE,
  editScope,
  editedView,
  partOfTheChannels,
  type EditScope,
} from './edit-target.js';
import { numberArgument, selectedTarget } from './editor-target.js';
import { removeMarkers } from './marker-commands.js';
import {
  chainInvocation,
  changeProject,
  needsProjectAsset,
  onWholeAsset,
} from './project-edits.js';
import { removeRegions, setRegionBounds } from './region-commands.js';
import { shellCommand, textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { spectralEditCommands } from './spectral-edit-commands.js';

/** An edit command, available where the editor in use shows an asset of the project. */
function editCommand(
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

/** How long the scope's range is, as its view speaks positions. */
function lengthOf(scope: EditScope): string {
  const { asset, state } = scope.view;
  return formatPosition(scope.shown.end - scope.shown.start, asset.sampleRate, state.timeFormat);
}

/** What the scope is, in a phrase: the selection, or the whole sound. */
function what(scope: EditScope): string {
  return scope.whole
    ? `all of ${scope.view.asset.name}`
    : `${lengthOf(scope)} of ${scope.view.asset.name}`;
}

/** Processes the scope with `edit`, saying `said` once it is made. */
function processed(context: ShellContext, scope: EditScope, edit: RangeEdit, said: string): void {
  changeProject(context, scope.project.session, {
    description: said,
    invocations: [
      processTargetInvocation(scope.target, context.ids.next<'EditOperationId'>(), edit),
    ],
    said: `${said}.`,
  });
}

/** What a delete takes: a time range, or the markers or regions selected, and never everything. */
const DELETED: TargetRequest = {
  accepts: new Set<MadeFacet>([SelectionFacet.Time, SelectionFacet.Objects]),
  whenNothing: 'refuse',
};

function deleteCommand(): Command<ShellContext> {
  return editCommand(
    'edit.delete',
    'Delete the selection',
    (context, invocation) => {
      // The facet made last decides what goes (ADR-0042): the markers or
      // regions selected, or the range.
      const view = editedView(context, invocation);
      if (typeof view === 'string') return view;
      const target = selectedTarget(context, view.view.asset, DELETED);
      if (typeof target === 'string') return target;
      if (target.kind === 'objects') {
        const { objects } = target;
        if (objects.kind === 'regions') return removeRegions(context, invocation);
        if (objects.kind !== 'markers')
          return 'Only markers, regions and audio can be deleted here.';
        return removeMarkers(
          context,
          { asset: view.view.asset, format: view.view.state.timeFormat, project: view.project },
          objects.ids,
        );
      }
      const scope = editScope(context, invocation, RANGE_ONLY);
      if (typeof scope === 'string') return scope;
      const split = partOfTheChannels(scope);
      if (split !== undefined) return split;
      const { owner } = scope.project;
      changeProject(context, scope.project.session, {
        description: 'Delete',
        invocations: [
          chainInvocation(context, scope.target, { kind: 'delete', range: scope.target.range }),
        ],
        said: onWholeAsset(owner, `Deleted ${what(scope)}.`),
      });
      return undefined;
    },
    ['delete', 'remove', 'erase', 'clear', 'cut out'],
  );
}

function trimCommand(): Command<ShellContext> {
  return editCommand(
    'edit.trim',
    'Trim to the selection',
    (context, invocation) => {
      const scope = editScope(context, invocation, RANGE_ONLY);
      if (typeof scope === 'string') return scope;
      const split = partOfTheChannels(scope);
      if (split !== undefined) return split;
      // A region is trimmed by its boundaries, which leaves its asset whole.
      if (scope.target.kind === 'region') return setRegionBounds(context, scope);
      changeProject(context, scope.project.session, {
        description: 'Trim',
        invocations: [
          chainInvocation(context, scope.target, { kind: 'trim', range: scope.target.range }),
        ],
        said: `Trimmed ${scope.view.asset.name} to ${lengthOf(scope)}.`,
      });
      return undefined;
    },
    ['trim', 'crop', 'keep', 'top and tail'],
  );
}

function reverseCommand(): Command<ShellContext> {
  return editCommand(
    'edit.reverse',
    'Reverse',
    (context, invocation) => {
      const scope = editScope(context, invocation, RANGE_OR_WHOLE);
      if (typeof scope === 'string') return scope;
      const split = partOfTheChannels(scope);
      if (split !== undefined) return split;
      const { owner } = scope.project;
      changeProject(context, scope.project.session, {
        description: 'Reverse',
        invocations: [
          chainInvocation(context, scope.target, { kind: 'reverse', range: scope.target.range }),
        ],
        said: onWholeAsset(owner, `Reversed ${what(scope)}.`),
      });
      return undefined;
    },
    ['reverse', 'backwards', 'flip'],
  );
}

/** A level edit over the scope, its words and its keywords. */
function levelCommand(
  id: string,
  label: string,
  edit: RangeEdit,
  done: string,
  keywords: readonly string[],
): Command<ShellContext> {
  return editCommand(
    id,
    label,
    (context, invocation) => {
      const scope = editScope(context, invocation, RANGE_OR_WHOLE);
      if (typeof scope === 'string') return scope;
      processed(context, scope, edit, `${done} ${what(scope)}`);
      return undefined;
    },
    keywords,
  );
}

/** The shape a fade command is given, linear where it names none, or `undefined` for no shape. */
function shapeArgument(invocation: CommandInvocation): FadeShape | undefined {
  const named = textArgument(invocation, 'shape');
  if (named === undefined) return FadeShape.Linear;
  return Object.values(FadeShape).find((shape) => shape === named);
}

function fadeCommand(direction: FadeDirection): Command<ShellContext> {
  const rising = direction === FadeDirection.In;
  return editCommand(
    rising ? 'edit.fade-in' : 'edit.fade-out',
    rising ? 'Fade in' : 'Fade out',
    (context, invocation) => {
      const scope = editScope(context, invocation, RANGE_OR_WHOLE);
      if (typeof scope === 'string') return scope;
      const shape = shapeArgument(invocation);
      if (shape === undefined) return `A fade is ${Object.values(FadeShape).join(', ')}.`;
      processed(
        context,
        scope,
        { kind: 'fade', direction, shape },
        `Faded ${rising ? 'in' : 'out'} ${what(scope)}`,
      );
      return undefined;
    },
    ['fade', rising ? 'in' : 'out', 'ramp', 'envelope'],
  );
}

/** The quietest gain a person can type, in decibels: below it the edit is silence. */
const QUIETEST_DECIBELS = -96;

/** The gain of `decibels`, as the linear factor kept (ADR-0032), or why it cannot be. */
function gainOf(decibels: number): number | string {
  if (decibels < QUIETEST_DECIBELS) {
    return `A gain is no quieter than ${String(QUIETEST_DECIBELS)} dB. Silence the range instead.`;
  }
  // Converted once, where the decibels are typed, by the engine's canonical
  // conversion: the factor is what is kept, so the edit gives the same bits on
  // every machine.
  const factor = decibelsToGain(decibels);
  return factor > MAXIMUM_EDIT_GAIN
    ? `A gain is no louder than ${String(gainToDecibels(MAXIMUM_EDIT_GAIN))} dB.`
    : factor;
}

/** Applies a gain of `decibels` to the scope. */
function gained(context: ShellContext, scope: EditScope, decibels: number): BodyAnswer {
  const gain = gainOf(decibels);
  if (typeof gain === 'string') return gain;
  const sign = decibels > 0 ? '+' : '';
  processed(
    context,
    scope,
    { kind: 'gain', gain },
    `Gain of ${sign}${String(decibels)} dB on ${what(scope)}`,
  );
  return undefined;
}

function gainCommand(): Command<ShellContext> {
  return editCommand(
    'edit.gain',
    'Change the gain',
    (context, invocation) => {
      const decibels = numberArgument(invocation, 'decibels');
      if (decibels === undefined) return 'Say how many decibels to change the gain by.';
      const scope = editScope(context, invocation, RANGE_OR_WHOLE);
      return typeof scope === 'string' ? scope : gained(context, scope, decibels);
    },
    ['gain', 'volume', 'level', 'amplify', 'decibels'],
    false,
  );
}

/** A step of gain the palette and the menus offer. */
function gainStep(id: string, label: string, decibels: number): Command<ShellContext> {
  return editCommand(
    id,
    label,
    (context, invocation) => {
      const scope = editScope(context, invocation, RANGE_OR_WHOLE);
      return typeof scope === 'string' ? scope : gained(context, scope, decibels);
    },
    ['gain', 'volume', 'level', decibels > 0 ? 'louder' : 'quieter'],
  );
}

/** The edit commands over a range. */
export function editCommands(): readonly Command<ShellContext>[] {
  return [
    deleteCommand(),
    trimCommand(),
    reverseCommand(),
    levelCommand('edit.silence', 'Silence', { kind: 'silence' }, 'Silenced', [
      'silence',
      'mute',
      'zero',
    ]),
    levelCommand('edit.invert', 'Invert the polarity', { kind: 'invert' }, 'Inverted', [
      'invert',
      'polarity',
      'phase',
    ]),
    fadeCommand(FadeDirection.In),
    fadeCommand(FadeDirection.Out),
    gainCommand(),
    gainStep('edit.louder', 'Make louder by 3 dB', 3),
    gainStep('edit.quieter', 'Make quieter by 3 dB', -3),
    ...spectralEditCommands(),
  ];
}
