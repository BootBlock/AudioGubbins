/**
 * A correlation meter (design language, section 10): a bar from the clip
 * colour at -1 through the well at 0 to the meter's low colour at +1, a centre
 * line, and a pointer that glides to each reading with the ballistics' time
 * constant, with its caption leading and its value trailing.
 *
 * It takes the correlation as the engine reports it, from -1 to 1, and the
 * words for it from its caller. Each frame writes where the pointer stands as
 * a custom property, so the glide costs no React work, and a screen reader is
 * told the reading as it arrives.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { useTheme } from '../../theme/theme-provider.js';
import { BROWSER_FRAME_CLOCK, type FrameClock } from './frame-clock.js';
import { CorrelationGlide } from './meter-ballistics.js';
import { useFrames } from './use-frames.js';

/** What a correlation meter takes. */
export interface CorrelationMeterProps {
  /** Its accessible name, for example `Left and right correlation`. */
  readonly label: string;

  /** The word printed before the bar, for example `Corr`. */
  readonly caption: string;

  /** The phase correlation the engine reports, from -1, inverted, to 1, in phase. */
  readonly correlation: number;

  /** The reading as printed after the bar, for example `+0.72`. */
  readonly displayValue: string;

  /** Turns the reading into the words a screen reader says. */
  readonly describeCorrelation: (correlation: number) => string;

  /** The time the pointer glides in and the frames it draws on: the browser's by default. */
  readonly clock?: FrameClock;
}

/** Where a reading sits along the bar, from 0 at -1 to 1 at +1. */
function fractionOf(correlation: number): number {
  return Math.min(1, Math.max(0, (correlation + 1) / 2));
}

/** A correlation meter. */
export function CorrelationMeter({
  label,
  caption,
  correlation,
  displayValue,
  describeCorrelation,
  clock = BROWSER_FRAME_CLOCK,
}: CorrelationMeterProps): ReactNode {
  const { ballistics } = useTheme().motion;
  const bar = useRef<HTMLDivElement>(null);
  const [glide] = useState(() => new CorrelationGlide(ballistics, correlation, clock.now()));

  const wake = useFrames(clock, (now) => {
    bar.current?.style.setProperty('--ag-correlation-at', String(fractionOf(glide.read(now))));
    return glide.settledAt(now);
  });

  useLayoutEffect(() => {
    glide.report(correlation, clock.now());
    wake();
  }, [correlation, clock, glide, wake]);

  return (
    <div className="ag-correlation-meter">
      <span className="ag-correlation-meter-caption" aria-hidden="true">
        {caption}
      </span>
      <div
        ref={bar}
        className="ag-correlation-meter-bar"
        role="meter"
        aria-label={label}
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Math.min(1, Math.max(-1, correlation))}
        aria-valuetext={describeCorrelation(correlation)}
      >
        <span className="ag-correlation-meter-centre" />
        <span className="ag-correlation-meter-pointer" />
      </div>
      <span className="ag-correlation-meter-value" aria-hidden="true">
        {displayValue}
      </span>
    </div>
  );
}
