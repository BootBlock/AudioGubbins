/**
 * The chains of a game preview's plan (ADR-0104): an emitter's spatial panner,
 * set from its rules and the scenario and moved along its path, and a bus's
 * gain, set to its level.
 *
 * The processors are the catalogue's own `spatial-panner` and `gain`, each
 * value set by its parameter's key and checked against its descriptor, so a
 * rule the panner cannot take is refused here, naming the parameter, rather
 * than heard otherwise. The rules map onto the panner one to one: an
 * attenuation of `none` is the panner's, with no maximum distance and a
 * ceiling of 0 dB; a maximum distance of 0 is Godot's "no limit", as the
 * panner reads it; a distance filter of 0 dB, or none, is flat.
 */

import {
  FailureKind,
  fail,
  failure,
  instantiateProcessor,
  succeed,
  validateParameterValue,
  type DomainResult,
  type EffectChain,
  type IdGenerator,
  type ParameterAutomation,
  type ParameterValue,
  type ProcessorCatalogue,
  type ProcessorDescriptor,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import { quoted } from '@audiogubbins/text';

import type { EmitterRules } from '../policy/playback-rules.js';
import { inListenerFrame, type MotionLanes } from './motion.js';
import type { GamePreviewScenario, Motion } from './preview-scenario.js';

const PANNER_TYPE = 'spatial-panner';
const GAIN_TYPE = 'gain';

function descriptorOf(
  catalogue: ProcessorCatalogue,
  typeKey: string,
): DomainResult<ProcessorDescriptor> {
  const descriptor = catalogue.get(typeKey);
  return descriptor === undefined
    ? fail(
        failure(
          'preview.processor-missing',
          FailureKind.Rejected,
          `The preview needs the ${quoted(typeKey)} processor, which this catalogue lacks.`,
          { details: { typeKey } },
        ),
      )
    : succeed(descriptor);
}

/** A processor of `descriptor` with `values` set by key, each checked, under a new identifier. */
function processorWith(
  descriptor: ProcessorDescriptor,
  values: Readonly<Record<string, ParameterValue>>,
  ids: IdGenerator,
): DomainResult<ProcessorInstance> {
  const instance = instantiateProcessor(ids.next<'ProcessorId'>(), descriptor);
  const set = new Map(instance.values);
  for (const [key, value] of Object.entries(values)) {
    const parameter = descriptor.parameters.find((one) => one.key === key);
    if (parameter === undefined) {
      return fail(
        failure(
          'preview.parameter-missing',
          FailureKind.Rejected,
          `The ${quoted(descriptor.typeKey)} processor has no ${quoted(key)} parameter.`,
          { details: { typeKey: descriptor.typeKey, key } },
        ),
      );
    }
    const checked = validateParameterValue(parameter, value);
    if (!checked.ok) return checked;
    set.set(parameter.id, checked.value);
  }
  return succeed({ ...instance, values: set });
}

function chainOf(processor: ProcessorInstance, ids: IdGenerator): EffectChain {
  return { id: ids.next<'EffectChainId'>(), slots: [processor] };
}

/** The panner's values for `rules` in `scenario`, the emitter at `at` in the listener's frame. */
function pannerValues(
  scenario: GamePreviewScenario,
  rules: EmitterRules,
  at: { readonly x: number; readonly y: number; readonly z: number },
): Readonly<Record<string, ParameterValue>> {
  const { attenuation, filter } = rules;
  const distance =
    attenuation.kind === 'none'
      ? { 'max-distance': 0, ceiling: 0 }
      : attenuation.kind === 'exponent'
        ? { 'max-distance': attenuation.maxDistance, exponent: attenuation.exponent }
        : {
            'unit-size': attenuation.unitSize,
            'max-distance': attenuation.maxDistance,
            ceiling: attenuation.ceilingDecibels,
          };
  return {
    space: scenario.space,
    attenuation: attenuation.kind,
    ...distance,
    'pan-width': scenario.panWidth,
    'panning-strength': scenario.panningStrength,
    'filter-decibels': filter?.decibels ?? 0,
    ...(filter === undefined ? {} : { 'filter-cutoff': filter.cutoffHertz }),
    x: at.x,
    y: at.y,
    z: at.z,
  };
}

/** A chain of one processor, and the processor, whose values a running change moves. */
export interface OneProcessorChain {
  readonly chain: EffectChain;
  readonly processor: ProcessorInstance;
}

/**
 * The panner chain of an emitter playing by `rules` along `motion` in
 * `scenario`: placed where a still emitter is, or where a moving one starts.
 */
export function pannerChain(
  scenario: GamePreviewScenario,
  rules: EmitterRules,
  motion: Motion,
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
): DomainResult<OneProcessorChain> {
  const descriptor = descriptorOf(catalogue, PANNER_TYPE);
  if (!descriptor.ok) return descriptor;
  // A validated motion has at least two waypoints.
  const start = motion.kind === 'still' ? motion.at : motion.points[0]?.at;
  const at =
    start === undefined
      ? { x: 0, y: 0, z: 0 }
      : inListenerFrame(start, scenario.listener, scenario.space);
  const panner = processorWith(descriptor.value, pannerValues(scenario, rules, at), ids);
  if (!panner.ok) return panner;
  return succeed({ chain: chainOf(panner.value, ids), processor: panner.value });
}

/** The automation moving `panner` along `lanes`. */
export function pannerAutomation(
  panner: ProcessorInstance,
  descriptor: ProcessorDescriptor,
  lanes: MotionLanes,
): readonly ParameterAutomation[] {
  const idOf = (key: string) => descriptor.parameters.find((one) => one.key === key)?.id;
  const automation: ParameterAutomation[] = [];
  for (const [key, points] of [
    ['x', lanes.x],
    ['y', lanes.y],
    ['z', lanes.z],
  ] as const) {
    const parameter = idOf(key);
    if (parameter !== undefined) automation.push({ processor: panner.id, parameter, points });
  }
  return automation;
}

/** The panner's descriptor in `catalogue`. */
export function pannerDescriptor(catalogue: ProcessorCatalogue): DomainResult<ProcessorDescriptor> {
  return descriptorOf(catalogue, PANNER_TYPE);
}

/** A bus's gain chain at `decibels`, and the processor in it. */
export function busChain(
  decibels: number,
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
): DomainResult<OneProcessorChain> {
  const descriptor = descriptorOf(catalogue, GAIN_TYPE);
  if (!descriptor.ok) return descriptor;
  const gain = processorWith(descriptor.value, { gain: decibels }, ids);
  if (!gain.ok) return gain;
  return succeed({ chain: chainOf(gain.value, ids), processor: gain.value });
}
