/**
 * Every processor type this build has (ADR-0061): the node implementations
 * the engine runs a rack with, and their descriptors, which the domain checks
 * every chain against. A type is listed here once, and nothing else lists
 * processors, so the catalogue the project is checked by and the node types a
 * render runs cannot differ.
 */

import type { ProcessorDescriptor } from '@audiogubbins/domain';

import { catalogueOf, type ProcessorType } from './framework/processor-type.js';
import { COMPRESSOR } from './dynamics/compressor.js';
import { EXPANDER } from './dynamics/expander.js';
import { GATE } from './dynamics/gate.js';
import { LIMITER } from './dynamics/limiter.js';
import { DC_OFFSET_REMOVAL } from './filters/dc-offset-removal.js';
import { DE_ESSER } from './filters/de-esser.js';
import { DE_HUM } from './filters/de-hum.js';
import { FILTER } from './filters/filter.js';
import { PARAMETRIC_EQUALISER } from './filters/parametric-equaliser.js';
import { DEREVERBERATION } from './spectral/dereverb.js';
import { NOISE_REDUCTION } from './spectral/noise-reduction.js';
import { DE_CLICK } from './repair/de-click.js';
import { DE_POP } from './repair/de-pop.js';
import { GAIN_PROCESSOR } from './level/gain-processor.js';
import { LOUDNESS_NORMALISATION } from './level/loudness-normalisation.js';
import { PEAK_NORMALISATION } from './level/peak-normalisation.js';
import { PITCH_SHIFT } from './pitch/pitch-shift.js';
import { AMBISONIC_DECODER } from './space/ambisonic-decode.js';
import { AMBISONIC_ENCODER } from './space/ambisonic-encode.js';
import { AMBISONIC_ROTATION } from './space/ambisonic-rotate.js';
import { DELAY } from './space/delay.js';
import { REVERB } from './space/reverb.js';

/**
 * Every processor type, by category in the order the domain lists categories,
 * and in the order a menu lists them within a category.
 */
export const PROCESSOR_TYPES: readonly ProcessorType[] = [
  GAIN_PROCESSOR,
  PEAK_NORMALISATION,
  LOUDNESS_NORMALISATION,
  PARAMETRIC_EQUALISER,
  FILTER,
  COMPRESSOR,
  LIMITER,
  GATE,
  EXPANDER,
  DE_ESSER,
  DELAY,
  PITCH_SHIFT,
  REVERB,
  AMBISONIC_ENCODER,
  AMBISONIC_ROTATION,
  AMBISONIC_DECODER,
  DC_OFFSET_REMOVAL,
  DE_HUM,
  DE_CLICK,
  DE_POP,
  NOISE_REDUCTION,
  DEREVERBERATION,
];

/** Every processor type by type key, as the effect rack finds a slot's type. */
export const PROCESSOR_TYPES_BY_KEY: ReadonlyMap<string, ProcessorType> = new Map(
  PROCESSOR_TYPES.map((type) => [type.descriptor.typeKey, type]),
);

/** The descriptors of every processor type, by type key. */
export const PROCESSOR_CATALOGUE: ReadonlyMap<string, ProcessorDescriptor> =
  catalogueOf(PROCESSOR_TYPES);
