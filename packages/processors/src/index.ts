/**
 * The processor types (ADR-0061): each one object that states its descriptor
 * and makes its kernel on the audio engine. Anything not listed here is
 * internal to the package.
 */

export { PROCESSOR_CATALOGUE, PROCESSOR_TYPES, PROCESSOR_TYPES_BY_KEY } from './catalogue.js';
export { deepFilterNet3 } from './ml/deepfilternet/deepfilternet.js';
export { mossFormer2Se48k } from './ml/mossformer2/mossformer2.js';
export { spleeter2Stems, spleeter4Stems } from './ml/spleeter/spleeter.js';
export {
  type ModelFile,
  type ModelLibrary,
  ModelUnavailability,
  modelUnavailable,
} from './ml/model-library.js';
export { type ModelServices } from './ml/model-sessions.js';
export {
  type ParameterReader,
  type ProcessorDefinition,
  type ProcessorRun,
  type ProcessorType,
  ProcessorPort,
  processorNodeType,
} from './framework/processor-type.js';
export { processorNodeSettings } from './framework/processor-node.js';
export { type Measurement, type Measurer, type WholePass } from './framework/whole-pass.js';
export { type NoiseProfileSettings, noiseProfileLearner } from './spectral/noise-reduction.js';
export {
  type Assistant,
  type AudioDetector,
  type Detection,
  type DetectionSettings,
} from './detection/audio-detector.js';
export {
  CLASSIFICATION_ASSISTANT,
  REPAIR_ASSISTANT,
  RESTORATION_ASSISTANT,
  recommendation,
} from './detection/assistants.js';
export { CLICK_DETECTOR } from './detection/click-detector.js';
export { CLIPPING_DETECTOR } from './detection/clipping-detector.js';
export { DC_OFFSET_DETECTOR } from './detection/dc-offset-detector.js';
export { HUM_DETECTOR } from './detection/hum-detector.js';
export { NOISE_FLOOR_DETECTOR } from './detection/noise-floor-detector.js';
export { TRANSIENT_DETECTOR } from './detection/transient-detector.js';
