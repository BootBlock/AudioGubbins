/**
 * The pressure choice's controls (REQ-UX-068, ADR-0082): whether a pen's
 * pressure sets how hard a tool acts, and the fixed strength used when it
 * does not, each run as the `tools.*` command of the same name. Shown in
 * Settings, where the person's input choices live, and in the Spectral panel
 * beside the brush they change, so the two never disagree.
 */

import type { ReactNode } from 'react';

import { ToggleSwitch, ValueSlider } from '@audiogubbins/design-system';
import { FIXED_STRENGTH_RANGE, type PressurePreference } from '@audiogubbins/input';

/** The strength as its control writes it: a percentage. */
function percent(strength: number): string {
  return `${String(Math.round(strength * 100))}%`;
}

/** The pressure choice, and the controls that change it through its commands. */
export function PressureControls({
  pressure,
  run,
}: {
  readonly pressure: PressurePreference;
  readonly run: (id: string, args?: Readonly<Record<string, number>>) => void;
}): ReactNode {
  return (
    <>
      <ToggleSwitch
        label="Let pen pressure set the strength"
        description="Off, every tool acts at the fixed strength, so a stroke is the same on any hardware."
        checked={pressure.usePenPressure}
        onCheckedChange={(checked) => {
          run(checked ? 'tools.use-pen-pressure' : 'tools.use-fixed-strength');
        }}
      />
      <ValueSlider
        label="Fixed strength"
        value={pressure.fixedStrength}
        minimum={FIXED_STRENGTH_RANGE.minimum}
        maximum={FIXED_STRENGTH_RANGE.maximum}
        step={FIXED_STRENGTH_RANGE.step}
        displayValue={percent(pressure.fixedStrength)}
        describeValue={percent}
        onValueChange={(strength) => {
          // The value the slider was moved to, rather than a step: a step
          // command would move one step over a whole drag.
          run('tools.set-fixed-strength', { strength });
        }}
      />
    </>
  );
}
