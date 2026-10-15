/**
 * How Godot 4 hears one emitter from one listener, as the spatial panner
 * (`spatial-panner.ts`) designs it: the distance attenuation, the fade to the
 * maximum distance, the pan law of each space and the distance filter, each
 * written as Godot's source writes it (`scene/3d/audio_stream_player_3d.cpp`,
 * `scene/2d/audio_stream_player_2d.cpp`, `servers/audio/audio_filter_sw.cpp`),
 * so a scenario heard here is heard alike when the game plays it.
 *
 * Godot evaluates these in single precision with the platform's logarithm and
 * trigonometry; here each is the canonical primitive (ADR-0032), so the law
 * is Godot's and the bits are the same on every machine.
 *
 * What a law is worked out from and what it answers are handed through one
 * array, {@link EmitterLaw}, rather than as arguments and a returned number:
 * the panner designs on the audio thread, where V8 boxes a double passed to
 * or returned from a call it does not inline.
 */

import {
  cosineOfTurns,
  decibelsToGain,
  gainToDecibels,
  ln,
  pow,
  sineOfTurns,
} from '@audiogubbins/audio-engine';

/** Godot 4's `CMP_EPSILON` (`core/math/math_defs.h`), which keeps a distance of zero finite. */
export const CMP_EPSILON = 0.00001;

/**
 * The least linear gain Godot's filter designs a shelf with
 * (`AudioFilterSW::prepare_coefficients`): −60 dB.
 */
export const LEAST_SHELF_GAIN = 0.001;

/** The highest cutoff a distance filter is realised at, as a fraction of the rate. */
export const HIGHEST_CUTOFF_FRACTION = 0.45;

/** Where each value of an emitter's law is held in its array. */
export const EmitterLaw = {
  /** The emitter in the listener's frame: +x right, +y up (3D) or down (2D), the listener facing −z. */
  X: 0,
  Y: 1,
  Z: 2,
  /** The distance at which the inverse models are 0 dB. */
  UnitSize: 3,
  /** The distance from which the emitter is silent, 0 for none. */
  MaxDistance: 4,
  /** The loudest the inverse models and the unattenuated model reach, in dB. */
  Ceiling: 5,
  /** The power of the exponent model's fall to the maximum distance. */
  Exponent: 6,
  /** The 2D distance to the side at which a pan of full strength is full. */
  PanWidth: 7,
  /** How far the pan moves to the side, from 0 (centred) to 1 (full). */
  Strength: 8,
  /** The distance filter's decibels at full attenuation, 0 for none. */
  FilterDecibels: 9,
  /** The distance filter's cutoff over the rate. */
  CutoffTurns: 10,
  /** Answered: the linear gain distance gives the emitter. */
  Distance: 11,
  /** Answered: the left output's linear gain, distance and pan together. */
  Left: 12,
  /** Answered: the right output's linear gain, distance and pan together. */
  Right: 13,
  /** Answered: the distance filter's linear gain, 1 where it is flat. */
  ShelfGain: 14,
} as const;

/** How many values an emitter's law holds. */
export const EMITTER_LAW_LENGTH = 15;

/** The space an emitter is heard in. */
export const Space = {
  ThreeD: '3d',
  TwoD: '2d',
} as const;
export type Space = (typeof Space)[keyof typeof Space];

/** How loudness falls with distance: Godot 4's three 3D models, none, and its 2D exponent. */
export const Attenuation = {
  None: 'none',
  Inverse: 'inverse',
  InverseSquare: 'inverse-square',
  Logarithmic: 'logarithmic',
  Exponent: 'exponent',
} as const;
export type Attenuation = (typeof Attenuation)[keyof typeof Attenuation];

/**
 * Writes the linear gain distance gives the emitter, `d` from the listener
 * (in 2D, in the plane, z being no part of a 2D position): the
 * exponent model as Godot's 2D player has it, `(1 − d/max)^exponent`, silent
 * from the maximum and flat with none; any other as its 3D player has it
 * (`_get_attenuation_db`, `_update_panning`), the model's decibels capped at
 * the ceiling, then, where there is a maximum distance, faded by `1 − d/max`
 * to silence at it.
 */
function distanceGain(space: Space, model: Attenuation, law: Float64Array): void {
  const x = law[EmitterLaw.X] ?? 0;
  const y = law[EmitterLaw.Y] ?? 0;
  const z = space === Space.TwoD ? 0 : (law[EmitterLaw.Z] ?? 0);
  const distance = Math.sqrt(x * x + y * y + z * z);
  const maximum = law[EmitterLaw.MaxDistance] ?? 0;
  const beyond = maximum > 0 && distance >= maximum;
  if (model === Attenuation.Exponent) {
    law[EmitterLaw.Distance] =
      maximum === 0 ? 1 : beyond ? 0 : pow(1 - distance / maximum, law[EmitterLaw.Exponent] ?? 1);
    return;
  }
  if (beyond) {
    law[EmitterLaw.Distance] = 0;
    return;
  }
  const ratio = distance / (law[EmitterLaw.UnitSize] ?? 1);
  let decibels = 0;
  if (model === Attenuation.Inverse) decibels = gainToDecibels(1 / (ratio + CMP_EPSILON));
  else if (model === Attenuation.InverseSquare) {
    decibels = gainToDecibels(1 / (ratio * ratio + CMP_EPSILON));
  } else if (model === Attenuation.Logarithmic) decibels = -20 * ln(ratio + CMP_EPSILON);
  const gain = decibelsToGain(Math.min(law[EmitterLaw.Ceiling] ?? 0, decibels));
  law[EmitterLaw.Distance] = maximum > 0 ? gain * (1 - distance / maximum) : gain;
}

/**
 * Writes the left and right gains of the emitter at the pan Godot gives it.
 *
 * 3D (`_calc_output_vol_stereo`): the cosine of the emitter's angle from the
 * listener's right in the horizontal plane, `x / √(x² + z²)` and 0 where the
 * emitter is straight above, below or at the listener, scaled by
 * `(1 − g) / (1 + g)` with `g = (1 − strength)²`, and spread by the
 * equal-power law `√((1 ∓ p) / 2)`.
 *
 * 2D: `x` over the pan width, clamped to ±1, scaled by half the strength and
 * moved to 0 to 1, spread by the linear law `1 − p`, `p`.
 */
function pan(space: Space, law: Float64Array): void {
  const x = law[EmitterLaw.X] ?? 0;
  const strength = law[EmitterLaw.Strength] ?? 0;
  if (space === Space.TwoD) {
    const across = Math.max(-1, Math.min(1, x / (law[EmitterLaw.PanWidth] ?? 1)));
    const right = across * strength * 0.5 + 0.5;
    law[EmitterLaw.Left] = 1 - right;
    law[EmitterLaw.Right] = right;
    return;
  }
  const z = law[EmitterLaw.Z] ?? 0;
  const flat = Math.sqrt(x * x + z * z);
  const cosine = flat === 0 ? 0 : Math.max(-1, Math.min(1, x / flat));
  const narrowing = (1 - strength) * (1 - strength);
  const spread = (cosine * (1 - narrowing)) / (1 + narrowing);
  law[EmitterLaw.Left] = Math.sqrt((1 - spread) / 2);
  law[EmitterLaw.Right] = Math.sqrt((1 + spread) / 2);
}

/**
 * Works out the emitter's law from its position and settings in `law`: the
 * gain distance gives it, its left and right gains, distance and pan
 * together, and its distance filter's gain, `(1 − min(1, m))` of the filter's decibels, where `m` is the linear
 * gain distance gave it (`AudioStreamPlayer3D::_update_panning`), floored as
 * Godot's filter floors it.
 */
export function emitterLaw(space: Space, model: Attenuation, law: Float64Array): void {
  distanceGain(space, model, law);
  pan(space, law);
  const gain = law[EmitterLaw.Distance] ?? 0;
  law[EmitterLaw.Left] = gain * (law[EmitterLaw.Left] ?? 0);
  law[EmitterLaw.Right] = gain * (law[EmitterLaw.Right] ?? 0);
  const filterDecibels = law[EmitterLaw.FilterDecibels] ?? 0;
  law[EmitterLaw.ShelfGain] =
    filterDecibels === 0
      ? 1
      : Math.max(LEAST_SHELF_GAIN, decibelsToGain((1 - Math.min(1, gain)) * filterDecibels));
}

/**
 * Writes the coefficients of Godot's distance filter at the shelf gain and
 * the cutoff `law` holds into `into` from `at`: b0, b1, b2, a1 and a2, each
 * divided by a0, as `BiquadCascade` runs them.
 *
 * It is the cookbook's high shelf with the resonance Godot sets, Q = 1, but
 * with the cookbook's `A` taken as the linear `gain` itself rather than its
 * square root (`AudioFilterSW::prepare_coefficients`, `HIGHSHELF`): so the
 * response is `gain` at the cutoff and `gain²` above it, the filter's
 * decibels at the cutoff and twice them on the shelf.
 */
export function designDistanceShelf(law: Float64Array, into: Float64Array, at: number): void {
  const gain = law[EmitterLaw.ShelfGain] ?? 1;
  const turns = law[EmitterLaw.CutoffTurns] ?? 0;
  const cosine = cosineOfTurns(turns);
  const slope = Math.sqrt(gain) * sineOfTurns(turns);
  const a0 = gain + 1 - (gain - 1) * cosine + slope;
  into[at] = (gain * (gain + 1 + (gain - 1) * cosine + slope)) / a0;
  into[at + 1] = (-2 * gain * (gain - 1 + (gain + 1) * cosine)) / a0;
  into[at + 2] = (gain * (gain + 1 + (gain - 1) * cosine - slope)) / a0;
  into[at + 3] = (2 * (gain - 1 - (gain + 1) * cosine)) / a0;
  into[at + 4] = (gain + 1 - (gain - 1) * cosine - slope) / a0;
}
