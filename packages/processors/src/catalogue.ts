/**
 * Every processor type this build has (ADR-0061): the node implementations
 * the engine runs a rack with, and their descriptors, which the domain checks
 * every chain against. A type is listed here once, and nothing else lists
 * processors, so the catalogue the project is checked by and the node types a
 * render runs cannot differ.
 */

import type { ProcessorDescriptor } from '@audiogubbins/domain';

import { catalogueOf, type ProcessorType } from './framework/processor-type.js';
import { GAIN_PROCESSOR } from './level/gain-processor.js';

/** Every processor type, in the order a menu lists them within a category. */
export const PROCESSOR_TYPES: readonly ProcessorType[] = [GAIN_PROCESSOR];

/** Every processor type by type key, as the effect rack finds a slot's type. */
export const PROCESSOR_TYPES_BY_KEY: ReadonlyMap<string, ProcessorType> = new Map(
  PROCESSOR_TYPES.map((type) => [type.descriptor.typeKey, type]),
);

/** The descriptors of every processor type, by type key. */
export const PROCESSOR_CATALOGUE: ReadonlyMap<string, ProcessorDescriptor> =
  catalogueOf(PROCESSOR_TYPES);
