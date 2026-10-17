/**
 * A level meter (design language, section 10): LED segments coloured by the
 * meter gradient, a peak hold and a clip lamp for each channel, in a row for
 * the transport and the recorder or in columns for a rack's input and output.
 *
 * It takes each channel's peak as the engine reports it, a linear amplitude
 * where 1 is full scale, and its scale as plain values from its caller, and
 * applies its own ballistics (`meter-ballistics.ts`) from the theme's typed
 * motion scale, which are the same at every motion level. Only the clip
 * lamp's fade follows the level, in its stylesheet.
 *
 * Drawn by the stylesheet from tokens: each frame writes where the level and
 * the peak stand as custom properties, so there is no canvas and no colour
 * outside the theme. A screen reader is told the reading the engine
 * reported, as it arrives, rather than one value a frame.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { useTheme } from '../../theme/theme-provider.js';
import { BROWSER_FRAME_CLOCK, type FrameClock } from './frame-clock.js';
import { PeakBallistics, decibelsOf } from './meter-ballistics.js';
import { useFrames } from './use-frames.js';

/** Which way a meter's level runs. */
export const MeterOrientation = {
  /** A row per channel, rising to the trailing end: the transport's and the recorder's. */
  Horizontal: 'horizontal',

  /** A column per channel, rising upward: a rack's input and output. */
  Vertical: 'vertical',
} as const;

/** Which way a meter's level runs. */
export type MeterOrientation = (typeof MeterOrientation)[keyof typeof MeterOrientation];

/** A level printed along a meter. */
export interface MeterMark {
  /** The level, in decibels of full scale. */
  readonly decibels: number;

  /** How it is printed, for example `−12`. */
  readonly label: string;
}

/** Where levels sit along a meter, given by the panel that owns it. */
export interface MeterScale {
  /** The lowest level shown, in decibels of full scale: below it the meter is dark. */
  readonly floor: number;

  /** Where a level in decibels sits, from 0 at the floor to 1 at the meter's end. */
  readonly positionOf: (decibels: number) => number;

  /** The levels printed along the meter, in order. A vertical meter prints none. */
  readonly marks: readonly MeterMark[];
}

/** One channel of a meter. */
export interface MeterChannel {
  /** Its accessible name, for example `Left peak`. */
  readonly name: string;

  /** The letter printed beside a row, for example `L`. */
  readonly letter: string;

  /** Its peak as the engine reports it: a linear amplitude, 1 at full scale. */
  readonly peak: number;
}

/** What a level meter takes. */
export interface LevelMeterProps {
  /** The meter's accessible name, for example `Levels at the output`. */
  readonly label: string;

  readonly channels: readonly MeterChannel[];

  readonly scale: MeterScale;

  /** Turns a channel's peak into the words a screen reader says, for example `−6.0 dB`. */
  readonly describePeak: (peak: number) => string;

  /** Rows, the default, or columns. */
  readonly orientation?: MeterOrientation;

  /** The main meter of a surface, drawn with taller rows: the recorder's. */
  readonly prominent?: boolean;

  /** The time the ballistics run in and the frames they draw on: the browser's by default. */
  readonly clock?: FrameClock;
}

/** Where a level sits along the meter, held to the meter's two ends. */
function positionOf(scale: MeterScale, decibels: number): number {
  if (decibels <= scale.floor) return 0;
  return Math.min(1, Math.max(0, scale.positionOf(decibels)));
}

/** What one channel's bar draws on. */
interface ChannelProps {
  readonly channel: MeterChannel;
  readonly scale: MeterScale;
  readonly describePeak: (peak: number) => string;
  readonly clock: FrameClock;
}

/** One channel: its letter, its bar of segments with the peak hold, and its clip lamp. */
function ChannelMeter({ channel, scale, describePeak, clock }: ChannelProps): ReactNode {
  const { ballistics } = useTheme().motion;
  const bar = useRef<HTMLDivElement>(null);
  const lamp = useRef<HTMLSpanElement>(null);
  const [meter] = useState(() => new PeakBallistics(ballistics, scale.floor, clock.now()));

  const wake = useFrames(clock, (now) => {
    const reading = meter.read(now);
    const drawn = bar.current;
    if (drawn !== null) {
      drawn.style.setProperty('--ag-meter-level', String(positionOf(scale, reading.level)));
      drawn.style.setProperty('--ag-meter-peak', String(positionOf(scale, reading.peak)));
      drawn.toggleAttribute('data-ag-silent', reading.peak <= scale.floor);
    }
    lamp.current?.toggleAttribute('data-ag-lit', reading.clipping);
    return meter.settledAt(now);
  });

  // Before the paint, so a rise is seen in the frame its reading arrives.
  useLayoutEffect(() => {
    meter.report(decibelsOf(channel.peak), clock.now());
    wake();
  }, [channel.peak, clock, meter, wake]);

  return (
    <div className="ag-level-meter-channel">
      <span className="ag-level-meter-letter" aria-hidden="true">
        {channel.letter}
      </span>
      <div
        ref={bar}
        className="ag-level-meter-bar"
        role="meter"
        aria-label={channel.name}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.min(1, Math.max(0, channel.peak))}
        aria-valuetext={describePeak(channel.peak)}
      >
        <span className="ag-level-meter-segments ag-level-meter-unlit" />
        <span className="ag-level-meter-glow">
          <span className="ag-level-meter-segments ag-level-meter-lit" />
        </span>
        <span className="ag-level-meter-hold" />
      </div>
      <span ref={lamp} className="ag-level-meter-clip" aria-hidden="true">
        <span className="ag-level-meter-clip-light" />
      </span>
    </div>
  );
}

/** A level meter. */
export function LevelMeter({
  label,
  channels,
  scale,
  describePeak,
  orientation = MeterOrientation.Horizontal,
  prominent = false,
  clock = BROWSER_FRAME_CLOCK,
}: LevelMeterProps): ReactNode {
  const printed = orientation === MeterOrientation.Horizontal && scale.marks.length > 0;
  return (
    <div
      className="ag-level-meter"
      role="group"
      aria-label={label}
      data-ag-orientation={orientation}
      data-ag-prominent={prominent ? '' : undefined}
    >
      {channels.map((channel) => (
        <ChannelMeter
          key={channel.name}
          channel={channel}
          scale={scale}
          describePeak={describePeak}
          clock={clock}
        />
      ))}
      {printed && (
        <div className="ag-level-meter-scale" aria-hidden="true">
          <span className="ag-level-meter-scale-track">
            {scale.marks.map((mark) => (
              <span
                key={mark.label}
                className="ag-level-meter-mark"
                style={{ insetInlineStart: `${String(positionOf(scale, mark.decibels) * 100)}%` }}
              >
                {mark.label}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
