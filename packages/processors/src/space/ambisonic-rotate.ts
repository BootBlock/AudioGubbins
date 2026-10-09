/**
 * Ambisonic rotation: a sound field of order 1 to 3 turned by a yaw, a
 * pitch and a roll, keeping its layout.
 *
 * The field is moved into ACN with SN3D by the engine's own conversion
 * (`ambisonic-sets.ts`) where it is of another convention, turned there by the
 * Ivanic–Ruedenberg matrices (`sphere-rotation.ts`), whose convention of angles
 * that file states, and moved back. The angles ramp a frame at a time as they
 * move, and the matrices are designed again from the ramped angles every 32
 * frames (`DESIGN_INTERVAL`) counted from the kernel's first frame, so the
 * output is the same however the stream is cut.
 *
 * Where the field is moved, it is held in f32 between the moves, as every
 * engine node's output is: the conversion is the engine's matrix node, so
 * the field is rounded once more there than a set already in ACN with SN3D.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  succeed,
  unsafeBrandId,
  type ChannelLayout,
  type DomainResult,
  type NumericParameterDescriptor,
} from '@audiogubbins/domain';
import {
  allocateBlock,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { DesignClock } from '../filters/cascade-kernel.js';
import { RampedParameter } from '../filters/ramped-parameter.js';
import { ambisonicSetOf, copyFinite, inSn3d, sn3dLayout } from './ambisonic-sets.js';
import { SphereRotation } from './sphere-rotation.js';

const TYPE = 'ambisonic rotation';

/** An angle of the turn, in degrees either way. */
function angle(id: string, key: string, label: string): NumericParameterDescriptor {
  return {
    kind: 'numeric',
    id: unsafeBrandId<'ParameterId'>(id),
    key,
    label,
    minimum: -180,
    maximum: 180,
    defaultValue: 0,
    taper: ParameterTaper.Linear,
    unit: '°',
    step: 0.1,
  };
}

const yaw = angle('c1000000-0041', 'yaw', 'Yaw');
const pitch = angle('c1000000-0042', 'pitch', 'Pitch');
const roll = angle('c1000000-0043', 'roll', 'Roll');

function outputLayout(input: ChannelLayout): DomainResult<ChannelLayout> {
  const set = ambisonicSetOf(input, 'An ambisonic rotation');
  return set.ok ? succeed(input) : set;
}

/** What the kernel is made of. */
interface RotationParts {
  readonly rotation: SphereRotation;
  readonly yaw: RampedParameter;
  readonly pitch: RampedParameter;
  readonly roll: RampedParameter;
  /** The field in ACN with SN3D read through `finiteSample`, which it is turned from. */
  readonly sn3d: AudioFrameBlock;
}

class RotationKernel implements NodeKernel {
  readonly #parts: RotationParts;
  readonly #ramps: readonly RampedParameter[];
  readonly #byKey: ReadonlyMap<string, RampedParameter>;
  readonly #clock = new DesignClock();

  constructor(parts: RotationParts) {
    this.#parts = parts;
    this.#ramps = [parts.yaw, parts.pitch, parts.roll];
    this.#byKey = new Map(this.#ramps.map((ramp) => [ramp.descriptor.key, ramp]));
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const { sn3d, rotation } = this.#parts;
    const turned = portAt(outputs, 0).channels;
    copyFinite(portAt(inputs, 0), sn3d, frames);
    for (const ramp of this.#ramps) ramp.fill(frames);
    for (let frame = 0; frame < frames;) {
      if (this.#clock.due) this.#design(frame);
      const count = this.#clock.span(frames - frame);
      for (let at = frame; at < frame + count; at += 1) rotation.apply(sn3d.channels, turned, at);
      this.#clock.advance(count);
      frame += count;
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    const ramp = this.#byKey.get(name);
    return ramp === undefined ? unknownParameter(TYPE, name) : ramp.set(TYPE, value);
  }

  release(): void {
    // Holds only its own matrices and block, which are collected with it.
  }

  /** The matrices of the angles the ramps reach at `frame`, where any moved. */
  #design(frame: number): void {
    const { yaw: turn, pitch: tilt, roll: lean, rotation } = this.#parts;
    // Each is asked, so each takes the value it is designed at.
    const yawMoved = turn.moved(frame);
    const pitchMoved = tilt.moved(frame);
    if (!lean.moved(frame) && !yawMoved && !pitchMoved) return;
    const angles = rotation.angles;
    angles[0] = turn.values[frame] ?? 0;
    angles[1] = tilt.values[frame] ?? 0;
    angles[2] = lean.values[frame] ?? 0;
    rotation.redesign();
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const set = ambisonicSetOf(run.input, 'An ambisonic rotation');
  if (!set.ok) return set;
  const sn3d = sn3dLayout(set.value.order);
  if (!sn3d.ok) return sn3d;
  const ramp = (parameter: NumericParameterDescriptor) =>
    new RampedParameter(
      parameter,
      run.parameters.number(parameter.key),
      run.sampleRate,
      run.blockFrames,
    );
  return inSn3d(
    run,
    set.value.order,
    new RotationKernel({
      rotation: new SphereRotation(set.value.order),
      yaw: ramp(yaw),
      pitch: ramp(pitch),
      roll: ramp(roll),
      sn3d: allocateBlock(sn3d.value, run.sampleRate, run.blockFrames),
    }),
  );
}

/** Ambisonic rotation, as a processor of the rack. */
export const AMBISONIC_ROTATION = processorType({
  descriptor: {
    typeKey: 'ambisonic-rotate',
    label: 'Ambisonic rotation',
    category: ProcessorCategory.Space,
    version: { implementation: 1, parameters: 1 },
    parameters: [yaw, pitch, roll],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout,
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    // Each frame is turned on its own, with no memory of earlier frames.
    leadIn: () => 0,
    frameGrid: () => 1,
  },
  kernel,
});
