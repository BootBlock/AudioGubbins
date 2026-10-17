/**
 * How a meter moves (REQ-UX-222, the design language's MotionSpec): its
 * measurement, not an animation, so the same at every motion level.
 *
 * A level meter rises at once to a new peak and falls back at the ballistics'
 * rate; its peak hold waits, then falls at its own, never below the level; its
 * clip lamp lights on an over and stays lit for the clip hold. A correlation
 * pointer glides towards each reading with the ballistics' time constant.
 *
 * Each reading the engine reports holds until the next: a steady tone reported
 * as the same peak again and again is a level standing still, not a level that
 * rose once and is falling back.
 */

import type { MeterBallistics } from '../../tokens/motion.js';

/** What a level meter shows at a moment, in decibels of full scale. */
export interface PeakReading {
  readonly level: number;

  /** The held peak, never below the level. */
  readonly peak: number;

  readonly clipping: boolean;
}

/** The milliseconds in a second, for rates given in decibels a second. */
const MILLISECONDS = 1000;

/** A linear peak in decibels of full scale: 1 is 0 dB, and silence is minus infinity. */
export function decibelsOf(peak: number): number {
  return peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
}

/** One channel's level, peak hold and clip lamp, moved by the ballistics. */
export class PeakBallistics {
  readonly #ballistics: MeterBallistics;

  /** The lowest level shown: every reading below it is shown at it. */
  readonly #floor: number;

  /** The reading the engine last reported, at the floor or above. */
  #input: number;

  /** Where the level stood when it last rose or a reading arrived, and when. */
  #anchor: number;
  #anchorTime: number;

  /** The peak held, and when it was caught. */
  #peak: number;
  #peakTime: number;

  /** Until when the clip lamp stays lit after the last over. */
  #clipUntil = Number.NEGATIVE_INFINITY;

  constructor(ballistics: MeterBallistics, floor: number, now: number) {
    this.#ballistics = ballistics;
    this.#floor = floor;
    this.#input = floor;
    this.#anchor = floor;
    this.#anchorTime = now;
    this.#peak = floor;
    this.#peakTime = now;
  }

  /** Takes a reading, in decibels of full scale, reported at `now`. */
  report(decibels: number, now: number): void {
    const input = Math.max(this.#floor, decibels);
    const level = this.#levelAt(now);
    const peak = this.#peakAt(now);
    // An over lights the lamp, and one that has just ended keeps it lit for
    // the hold from now, since the reading held until this moment.
    if (this.#input >= 0 || input >= 0) this.#clipUntil = now + this.#ballistics.clipHold;
    this.#anchor = Math.max(level, input);
    this.#anchorTime = now;
    if (input >= Math.max(peak, level)) {
      this.#peak = input;
      this.#peakTime = now;
    }
    this.#input = input;
  }

  /** What the meter shows at `now`. */
  read(now: number): PeakReading {
    const level = this.#levelAt(now);
    return {
      level,
      peak: Math.max(level, this.#peakAt(now)),
      clipping: this.#input >= 0 || now < this.#clipUntil,
    };
  }

  /** Whether nothing the meter shows changes after `now` until another reading arrives. */
  settledAt(now: number): boolean {
    const level = this.#levelAt(now);
    return (
      level <= this.#input &&
      this.#peakAt(now) <= level &&
      (this.#input >= 0 || now >= this.#clipUntil)
    );
  }

  /** The level at `now`: the reading, or the last level falling back towards it. */
  #levelAt(now: number): number {
    const fallen = (this.#ballistics.fallRate * (now - this.#anchorTime)) / MILLISECONDS;
    return Math.max(this.#input, this.#anchor - fallen);
  }

  /** The held peak at `now`, held for the hold and then falling, at the floor or above. */
  #peakAt(now: number): number {
    const falling = now - this.#peakTime - this.#ballistics.peakHold;
    if (falling <= 0) return this.#peak;
    const fallen = (this.#ballistics.peakFallRate * falling) / MILLISECONDS;
    return Math.max(this.#floor, this.#peak - fallen);
  }
}

/**
 * How near its reading a gliding pointer has to come to be still: a
 * thousandth of the correlation scale, far under a pixel of any meter.
 */
const AT_REST = 0.001;

/** A correlation pointer, gliding towards each reading. */
export class CorrelationGlide {
  readonly #timeConstant: number;

  /** Where the pointer was when the reading it glides towards arrived, and when. */
  #from: number;
  #fromTime: number;

  #target: number;

  /** Starts at `reading`: a meter that appears shows the reading it appears with. */
  constructor(ballistics: MeterBallistics, reading: number, now: number) {
    this.#timeConstant = ballistics.correlationTime;
    this.#from = reading;
    this.#fromTime = now;
    this.#target = reading;
  }

  /** Takes a reading, from −1 to 1, reported at `now`. */
  report(reading: number, now: number): void {
    this.#from = this.read(now);
    this.#fromTime = now;
    this.#target = reading;
  }

  /** Where the pointer is at `now`. */
  read(now: number): number {
    const left = Math.exp(-(now - this.#fromTime) / this.#timeConstant);
    return this.#target + (this.#from - this.#target) * left;
  }

  /** Whether the pointer has come to rest at its reading by `now`. */
  settledAt(now: number): boolean {
    return Math.abs(this.read(now) - this.#target) < AT_REST;
  }
}
