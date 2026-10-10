/**
 * The pressure choice (REQ-UX-068, ADR-0082): whether a pen's pressure sets
 * how hard a tool acts, and the fixed strength used when it does not.
 *
 * Each is a preference change, so none is undoable, and each runs from the
 * palette, a shortcut or a control alike (REQ-EDIT-073). The fixed strength
 * moves through the steps of its control's model, so a strength set from the
 * keyboard and one set with a slider are the same number.
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import {
  FIXED_STRENGTH_RANGE,
  fixedStrengthOf,
  type PressurePreference,
} from '@audiogubbins/input';

import { availableUnless, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The strength as a reader is told it: a percentage, which is what the control shows. */
function percent(strength: number): string {
  return `${String(Math.round(strength * 100))}%`;
}

function pressureOf(context: ShellContext): PressurePreference {
  return context.preferences.get().pressure;
}

function changed(context: ShellContext, change: Partial<PressurePreference>): void {
  context.preferences.change({ pressure: { ...pressureOf(context), ...change } });
}

/** A command that moves the fixed strength one step of its control. */
function stepCommand(direction: 1 | -1): Command<ShellContext> {
  const raising = direction === 1;
  return shellCommand(
    raising ? 'tools.raise-fixed-strength' : 'tools.lower-fixed-strength',
    raising ? 'Raise the fixed strength' : 'Lower the fixed strength',
    CommandCategory.Tools,
    (context) => {
      const { fixedStrength } = pressureOf(context);
      changed(context, {
        fixedStrength: fixedStrengthOf(fixedStrength + direction * FIXED_STRENGTH_RANGE.step),
      });
    },
    {
      keywords: ['strength', 'brush', 'pressure', raising ? 'stronger' : 'weaker'],
      availability: (context) => {
        const { fixedStrength } = pressureOf(context);
        const atEnd = raising
          ? fixedStrength >= FIXED_STRENGTH_RANGE.maximum
          : fixedStrength <= FIXED_STRENGTH_RANGE.minimum;
        return availableUnless(
          atEnd
            ? `The fixed strength is already at its ${raising ? 'strongest' : 'weakest'}.`
            : undefined,
        );
      },
    },
  );
}

/** The commands that set the pressure choice. */
export function pressureCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      'tools.use-pen-pressure',
      'Let pen pressure set the strength',
      CommandCategory.Tools,
      (context) => {
        changed(context, { usePenPressure: true });
      },
      {
        keywords: ['pen', 'pressure', 'stylus', 'brush', 'strength'],
        availability: (context) =>
          availableUnless(
            pressureOf(context).usePenPressure
              ? 'Pen pressure already sets the strength.'
              : undefined,
          ),
      },
    ),
    shellCommand(
      'tools.use-fixed-strength',
      'Use the fixed strength, whatever the pen',
      CommandCategory.Tools,
      (context) => {
        changed(context, { usePenPressure: false });
      },
      {
        keywords: ['pen', 'pressure', 'fixed', 'strength', 'brush', 'deterministic'],
        availability: (context) =>
          availableUnless(
            pressureOf(context).usePenPressure ? undefined : 'The fixed strength is already used.',
          ),
      },
    ),
    shellCommand(
      'tools.set-fixed-strength',
      'Set the fixed strength',
      CommandCategory.Tools,
      (context, invocation) => {
        const asked = invocation.arguments?.['strength'];
        if (typeof asked !== 'number' || !Number.isFinite(asked)) {
          return `Choose a strength from ${percent(FIXED_STRENGTH_RANGE.minimum)} to ${percent(FIXED_STRENGTH_RANGE.maximum)}.`;
        }
        const fixedStrength = fixedStrengthOf(asked);
        if (fixedStrength === pressureOf(context).fixedStrength) {
          return unchanged(
            'tools.fixed-strength-already-set',
            `The fixed strength is already ${percent(fixedStrength)}.`,
          );
        }
        changed(context, { fixedStrength });
        return undefined;
      },
      {
        keywords: ['strength', 'brush', 'pressure', 'fixed'],
        description:
          'Sets the strength a tool acts with when pen pressure does not set it. Raise and Lower move it a step at a time.',
      },
    ),
    stepCommand(1),
    stepCommand(-1),
  ];
}
