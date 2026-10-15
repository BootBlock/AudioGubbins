/**
 * Spatial panner: one emitter heard by one listener, as Godot 4 hears it
 * (ADR-0104), so a game's sound is previewed here as the game will play it.
 *
 * The emitter's position is given in the listener's frame, in Godot's axes:
 * in 3D +x to the listener's right, +y up and the listener facing −z; in 2D
 * +x right and +y down the screen. Distance attenuates it by the model chosen,
 * its angle pans it, and, where a distance filter is set, a high shelf cuts
 * its top as it is attenuated (`emitter-laws.ts`, each law Godot's own). A
 * mono emitter is heard on both outputs, each by its own gain; a stereo one
 * has each channel scaled by its own side's gain, as Godot's mixer scales a
 * stereo stream, with no cross-feed. Any other layout is refused: a caller
 * that places one converts it first, and says it is not panned.
 *
 * The law is worked out again every 32 frames (`DESIGN_INTERVAL`) from the
 * parameters' ramped values, counted from the kernel's first frame, and each
 * output's gain moves in a straight line from the last design's to the new
 * one's across the interval, so a moving emitter neither steps nor clicks and
 * the output is the same however the stream is cut into blocks. Each channel
 * is filtered before its gain is applied, where Godot filters after: the two
 * differ only while the gain moves, and filtering the input lets the shelf
 * read it as it arrives.
 */

import {
  DeterminismClass,
  FailureKind,
  ParameterTaper,
  ProcessorCategory,
  StandardLayouts,
  ZERO_SAMPLES,
  fail,
  failure,
  layoutsMatch,
  succeed,
  unsafeBrandId,
  type ChannelLayout,
  type ChoiceParameterDescriptor,
  type DomainResult,
  type NumericParameterDescriptor,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import {
  channelAt,
  decibelsToGain,
  ln,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { BiquadCascade, silenceFrames } from '../filters/biquad.js';
import { DESIGN_INTERVAL, DesignClock } from '../filters/cascade-kernel.js';
import { numberOf } from '../filters/parameter-values.js';
import { RampedParameter } from '../filters/ramped-parameter.js';
import {
  Attenuation,
  EMITTER_LAW_LENGTH,
  EmitterLaw,
  HIGHEST_CUTOFF_FRACTION,
  LEAST_SHELF_GAIN,
  Space,
  designDistanceShelf,
  emitterLaw,
} from './emitter-laws.js';

const TYPE = 'spatial panner';

/** The farthest an emitter may be placed along an axis, in metres (3D) or pixels (2D). */
const FARTHEST = 1_000_000;

function numeric(
  id: string,
  key: string,
  label: string,
  range: Pick<NumericParameterDescriptor, 'minimum' | 'maximum' | 'defaultValue' | 'taper'> &
    Partial<Pick<NumericParameterDescriptor, 'unit' | 'step'>>,
): NumericParameterDescriptor {
  return { kind: 'numeric', id: unsafeBrandId<'ParameterId'>(id), key, label, ...range };
}

const space: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('c1000000-0051'),
  key: 'space',
  label: 'Space',
  options: [
    { key: Space.ThreeD, label: '3D' },
    { key: Space.TwoD, label: '2D' },
  ],
  defaultKey: Space.ThreeD,
};

const position = (id: string, key: string, label: string) =>
  numeric(id, key, label, {
    minimum: -FARTHEST,
    maximum: FARTHEST,
    defaultValue: 0,
    taper: ParameterTaper.Linear,
    step: 0.01,
  });

const x = position('c1000000-0052', 'x', 'Position x (right)');
const y = position('c1000000-0053', 'y', 'Position y (up in 3D, down in 2D)');
const z = position('c1000000-0054', 'z', 'Position z (behind, in 3D)');

const attenuation: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('c1000000-0055'),
  key: 'attenuation',
  label: 'Attenuation',
  options: [
    { key: Attenuation.None, label: 'None' },
    { key: Attenuation.Inverse, label: 'Inverse distance' },
    { key: Attenuation.InverseSquare, label: 'Inverse square distance' },
    { key: Attenuation.Logarithmic, label: 'Logarithmic' },
    { key: Attenuation.Exponent, label: 'Exponent of distance' },
  ],
  // Godot's 3D player's default.
  defaultKey: Attenuation.Inverse,
};

// Each default is the Godot 4 player's or project's own.
const unitSize = numeric('c1000000-0056', 'unit-size', 'Unit size', {
  minimum: 0.01,
  maximum: FARTHEST,
  defaultValue: 10,
  taper: ParameterTaper.Logarithmic,
});

const maxDistance = numeric('c1000000-0057', 'max-distance', 'Maximum distance (0 for none)', {
  minimum: 0,
  maximum: FARTHEST,
  defaultValue: 0,
  taper: ParameterTaper.Linear,
});

const ceiling = numeric('c1000000-0058', 'ceiling', 'Ceiling', {
  minimum: -80,
  maximum: 24,
  defaultValue: 3,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
});

const exponent = numeric('c1000000-0059', 'exponent', 'Exponent', {
  minimum: 0.01,
  maximum: 16,
  defaultValue: 1,
  taper: ParameterTaper.Logarithmic,
  step: 0.01,
});

/** Godot's default viewport width, the 2D pan's width where its project changes none. */
const panWidth = numeric('c1000000-005a', 'pan-width', 'Pan width (2D)', {
  minimum: 1,
  maximum: FARTHEST,
  defaultValue: 1_152,
  taper: ParameterTaper.Logarithmic,
});

/** The product of Godot's project panning strength, 0.5, and its player's, 1. */
const panningStrength = numeric('c1000000-005b', 'panning-strength', 'Panning strength', {
  minimum: 0,
  maximum: 1,
  defaultValue: 0.5,
  taper: ParameterTaper.Linear,
  step: 0.01,
});

const filterCutoff = numeric('c1000000-005c', 'filter-cutoff', 'Distance filter cutoff', {
  minimum: 20,
  maximum: 20_000,
  defaultValue: 5_000,
  taper: ParameterTaper.Logarithmic,
  unit: 'Hz',
});

const filterDecibels = numeric('c1000000-005d', 'filter-decibels', 'Distance filter (0 for none)', {
  minimum: -80,
  maximum: 0,
  defaultValue: -24,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
});

/** Each numeric parameter that feeds the law, and where the law holds it. */
const LAW_PARAMETERS: readonly (readonly [NumericParameterDescriptor, number])[] = [
  [x, EmitterLaw.X],
  [y, EmitterLaw.Y],
  [z, EmitterLaw.Z],
  [unitSize, EmitterLaw.UnitSize],
  [maxDistance, EmitterLaw.MaxDistance],
  [ceiling, EmitterLaw.Ceiling],
  [exponent, EmitterLaw.Exponent],
  [panWidth, EmitterLaw.PanWidth],
  [panningStrength, EmitterLaw.Strength],
  [filterDecibels, EmitterLaw.FilterDecibels],
];

/** The space and the model, by option key. */
const SPACES: Readonly<Record<string, Space>> = { '3d': Space.ThreeD, '2d': Space.TwoD };
const MODELS: Readonly<Record<string, Attenuation>> = {
  none: Attenuation.None,
  inverse: Attenuation.Inverse,
  'inverse-square': Attenuation.InverseSquare,
  logarithmic: Attenuation.Logarithmic,
  exponent: Attenuation.Exponent,
};

function outputLayout(input: ChannelLayout): DomainResult<ChannelLayout> {
  if (layoutsMatch(input, StandardLayouts.mono) || layoutsMatch(input, StandardLayouts.stereo)) {
    return succeed(StandardLayouts.stereo);
  }
  return fail(
    failure(
      'processor.layout-refused',
      FailureKind.Rejected,
      'A spatial panner places a mono or stereo source; convert this source to one of them first.',
    ),
  );
}

/** The cutoff a distance filter is realised at, as a fraction of `rate`. */
function cutoffTurns(cutoff: number, rate: number): number {
  return Math.min(cutoff, HIGHEST_CUTOFF_FRACTION * rate) / rate;
}

/** What the kernel is made of. */
interface PannerParts {
  readonly space: Space;
  readonly model: Attenuation;
  readonly rate: number;
  readonly channels: number;
  readonly ramps: readonly RampedParameter[];
  /** Where each ramp's value is held in the law, by the ramp's index. */
  readonly places: readonly number[];
  readonly cutoff: RampedParameter;
}

class PannerKernel implements NodeKernel {
  readonly #parts: PannerParts;
  readonly #byKey: ReadonlyMap<string, RampedParameter>;
  readonly #clock = new DesignClock();
  readonly #law = new Float64Array(EMITTER_LAW_LENGTH);
  readonly #shelf: BiquadCascade;
  /**
   * The interval of the input's left channel through the shelf, before it is
   * scaled, and of its right: a mono input's one channel is both.
   */
  readonly #heardLeft = new Float64Array(DESIGN_INTERVAL);
  readonly #heardRight: Float64Array;
  /** The left and right gains the interval moves from, and to. */
  readonly #from = new Float64Array(2);
  readonly #to = new Float64Array(2);
  /** Frames of the current interval already written. */
  #into = 0;
  #designed = false;

  constructor(parts: PannerParts) {
    this.#parts = parts;
    this.#byKey = new Map(
      [...parts.ramps, parts.cutoff].map((ramp) => [ramp.descriptor.key, ramp] as const),
    );
    this.#shelf = new BiquadCascade(parts.channels, 1);
    this.#heardRight = parts.channels === 1 ? this.#heardLeft : new Float64Array(DESIGN_INTERVAL);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const { ramps, cutoff, channels } = this.#parts;
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    const left = channelAt(output, 0);
    const right = channelAt(output, 1);
    for (const ramp of ramps) ramp.fill(frames);
    cutoff.fill(frames);
    const from = this.#from;
    const to = this.#to;
    for (let frame = 0; frame < frames;) {
      if (this.#clock.due) this.#design(frame);
      const count = this.#clock.span(frames - frame);
      const heardLeft = this.#heardLeft;
      const heardRight = this.#heardRight;
      this.#shelf.run(0, channelAt(input, 0), frame, count, heardLeft, 0);
      if (channels === 2) this.#shelf.run(1, channelAt(input, 1), frame, count, heardRight, 0);
      const fromLeft = from[0] ?? 0;
      const fromRight = from[1] ?? 0;
      const stepLeft = (to[0] ?? 0) - fromLeft;
      const stepRight = (to[1] ?? 0) - fromRight;
      for (let at = 0; at < count; at += 1) {
        const along = this.#into + at + 1;
        left[frame + at] = (fromLeft + (stepLeft * along) / DESIGN_INTERVAL) * (heardLeft[at] ?? 0);
        right[frame + at] =
          (fromRight + (stepRight * along) / DESIGN_INTERVAL) * (heardRight[at] ?? 0);
      }
      this.#into += count;
      this.#clock.advance(count);
      frame += count;
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    const ramp = this.#byKey.get(name);
    return ramp === undefined ? unknownParameter(TYPE, name) : ramp.set(TYPE, value);
  }

  release(): void {
    // A panner holds nothing outside the JavaScript heap.
  }

  /**
   * Starts an interval at `frame`: its gains move from where the last one
   * ended, to the law at the parameters' values at `frame` where any moved;
   * the first starts at its own law, so the output does not rise from silence.
   */
  #design(frame: number): void {
    const { ramps, places, cutoff, space: heardIn, model, rate } = this.#parts;
    const from = this.#from;
    const to = this.#to;
    from[0] = to[0] ?? 0;
    from[1] = to[1] ?? 0;
    this.#into = 0;
    const law = this.#law;
    let moved = cutoff.moved(frame);
    for (let index = 0; index < ramps.length; index += 1) {
      // Not `ramp?.`: the undefined it might give boxes the value read here.
      const ramp = ramps[index];
      if (ramp === undefined) continue;
      if (ramp.moved(frame)) moved = true;
      law[places[index] ?? 0] = ramp.values[frame] ?? 0;
    }
    if (!moved) return;
    emitterLaw(heardIn, model, law);
    to[0] = law[EmitterLaw.Left] ?? 0;
    to[1] = law[EmitterLaw.Right] ?? 0;
    // `cutoffTurns` written out: a double it returned would be boxed here.
    law[EmitterLaw.CutoffTurns] =
      Math.min(cutoff.values[frame] ?? 0, HIGHEST_CUTOFF_FRACTION * rate) / rate;
    designDistanceShelf(law, this.#shelf.coefficients, 0);
    if (this.#designed) return;
    this.#designed = true;
    from[0] = to[0];
    from[1] = to[1];
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const ramp = (parameter: NumericParameterDescriptor) =>
    new RampedParameter(
      parameter,
      run.parameters.number(parameter.key),
      run.sampleRate,
      run.blockFrames,
    );
  return succeed(
    new PannerKernel({
      space: SPACES[run.parameters.choice(space.key)] ?? Space.ThreeD,
      model: MODELS[run.parameters.choice(attenuation.key)] ?? Attenuation.Inverse,
      rate: run.sampleRate,
      channels: run.input.roles.length,
      ramps: LAW_PARAMETERS.map(([parameter]) => ramp(parameter)),
      places: LAW_PARAMETERS.map(([, place]) => place),
      cutoff: ramp(filterCutoff),
    }),
  );
}

/** Where {@link shelfDecayFrames} designs the shelf it measures, and from what. */
const MEASURED = new Float64Array(5);
const MEASURED_LAW = new Float64Array(EMITTER_LAW_LENGTH);

/** Frames the distance filter's shelf at `gain` and `turns` takes to decay by 120 dB, from its poles. */
function shelfDecayFrames(gain: number, turns: number): number {
  MEASURED_LAW[EmitterLaw.ShelfGain] = gain;
  MEASURED_LAW[EmitterLaw.CutoffTurns] = turns;
  designDistanceShelf(MEASURED_LAW, MEASURED, 0);
  const a1 = MEASURED[3] ?? 0;
  const a2 = MEASURED[4] ?? 0;
  const discriminant = a1 * a1 - 4 * a2;
  const radius = discriminant < 0 ? Math.sqrt(a2) : (Math.abs(a1) + Math.sqrt(discriminant)) / 2;
  // `silenceFrames` takes a time constant: a pole of radius r decays by e in −1/ln r frames.
  return radius === 0 ? 0 : silenceFrames(-1 / ln(radius), 1);
}

/**
 * Frames the distance filter takes to settle: its shelf's decay at the
 * slowest it can be designed, flat or at the filter's full cut, since the
 * emitter may be anywhere when a run starts. None without a filter.
 */
function leadIn({ values, sampleRate }: ProcessorSettings): number {
  const decibels = numberOf(values, filterDecibels);
  if (decibels === 0) return 0;
  const turns = cutoffTurns(numberOf(values, filterCutoff), sampleRate);
  const cut = Math.max(LEAST_SHELF_GAIN, decibelsToGain(decibels));
  return Math.max(shelfDecayFrames(cut, turns), shelfDecayFrames(1, turns));
}

/** Spatial panner, as a processor of the rack. */
export const SPATIAL_PANNER = processorType({
  descriptor: {
    typeKey: 'spatial-panner',
    label: 'Spatial panner',
    category: ProcessorCategory.Space,
    version: { implementation: 1, parameters: 1 },
    parameters: [
      space,
      x,
      y,
      z,
      attenuation,
      unitSize,
      maxDistance,
      ceiling,
      exponent,
      panWidth,
      panningStrength,
      filterCutoff,
      filterDecibels,
    ],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout,
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn,
    frameGrid: () => 1,
  },
  kernel,
});
