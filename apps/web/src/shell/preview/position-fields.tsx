/**
 * A position typed in, axis by axis, in the scenario's space: x, y and z in
 * 3D, x and y in 2D, where z is always 0.
 */

import type { ReactNode } from 'react';

import type { GamePreviewScenario, Position } from '@audiogubbins/game-audio';

import { NumberField } from '../export/setting-fields.js';

/** The fields of `at`, each axis named after `label`. */
export function PositionFields({
  label,
  at,
  space,
  onPosition,
}: {
  readonly label: string;
  readonly at: Position;
  readonly space: GamePreviewScenario['space'];
  readonly onPosition: (at: Position) => void;
}): ReactNode {
  const unit = space === '3d' ? 'metres' : 'pixels';
  const axes = space === '3d' ? (['x', 'y', 'z'] as const) : (['x', 'y'] as const);
  return (
    <div className="ag-preview-position" role="group" aria-label={label}>
      {axes.map((axis) => (
        <NumberField
          key={axis}
          label={`${label} ${axis}`}
          value={at[axis]}
          unit={unit}
          onNumber={(value) => {
            onPosition({ ...at, [axis]: value });
          }}
        />
      ))}
    </div>
  );
}
