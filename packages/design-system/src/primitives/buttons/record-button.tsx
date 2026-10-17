/**
 * The record button: a backlit red lamp that starts and stops a recording.
 *
 * A button to a screen reader and the keyboard, pressed (`aria-pressed`) while
 * it is recording, so a reader hears both what it does and whether it is doing
 * it. The lamp is lit while recording, and at the full motion level its rim
 * glow breathes; the lens stays fully lit, so a recording never looks off
 * (MotionSpec, recording indicator).
 */

import type { ReactNode } from 'react';

import { ControlHint, describedBy } from './control-hint.js';
import { RecordLampDrawing } from './record-lamp-drawing.js';

/** What a record button takes. */
export interface RecordButtonProps {
  /** The accessible name, for example "Record". */
  readonly label: string;

  /** Whether a recording is under way, which lights the lamp. */
  readonly recording: boolean;

  readonly onPress: () => void;

  /** The hint shown on hover or focus. */
  readonly hint?: string;

  /** The shortcut, shown after the hint (REQ-UX-066). */
  readonly shortcut?: string;

  /**
   * Why it cannot be pressed now, or `undefined` while it can. It keeps its
   * focus and opens the reason on hover or focus (ADR-0013).
   */
  readonly unavailableReason?: string;
}

/** A backlit red lamp that starts and stops a recording. */
export function RecordButton({
  label,
  recording,
  onPress,
  hint,
  shortcut,
  unavailableReason,
}: RecordButtonProps): ReactNode {
  const unavailable = unavailableReason !== undefined;
  return (
    <ControlHint hint={hint} shortcut={shortcut} unavailableReason={unavailableReason}>
      {({ reasonId }) => (
        <button
          type="button"
          className="ag-record-button ag-touch-target"
          aria-label={label}
          aria-pressed={recording}
          {...(unavailable ? { 'aria-disabled': true, 'data-ag-unavailable': '' } : {})}
          {...describedBy(reasonId)}
          onClick={() => {
            if (!unavailable) onPress();
          }}
        >
          <RecordLampDrawing lit={recording} />
        </button>
      )}
    </ControlHint>
  );
}
