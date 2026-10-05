/**
 * The processor types (ADR-0061): each one object that states its descriptor
 * and makes its kernel on the audio engine. Anything not listed here is
 * internal to the package.
 */

export { PROCESSOR_CATALOGUE, PROCESSOR_TYPES, PROCESSOR_TYPES_BY_KEY } from './catalogue.js';
export {
  type ParameterReader,
  type ProcessorDefinition,
  type ProcessorRun,
  type ProcessorType,
  ProcessorPort,
  processorNodeType,
} from './framework/processor-type.js';
export { processorNodeSettings } from './framework/processor-node.js';
