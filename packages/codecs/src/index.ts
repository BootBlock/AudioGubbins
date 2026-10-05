/**
 * The public contract of the AudioGubbins codecs: the read contract for audio
 * files (ADR-0050, ADR-0052).
 *
 * A file is reached through {@link AudioBytes}, a size and a ranged,
 * cancellable read. {@link recogniseAudio} names its format from its contents
 * alone, and {@link openAudio} parses its header into an
 * {@link AudioFormatDescriptor} and reads its frames on demand at the rate it
 * was recorded at, never holding the file whole (REQ-AUDIO-220). Phase 09's
 * decoders and writers extend this contract rather than adding a second one.
 *
 * Portable: no browser or Node global, so the same readers serve the storage
 * worker, the feeder, render and peak workers, and a test. Depends on the
 * domain alone.
 */

export { type AudioBytes } from './audio-bytes.js';

export { type ReadableContainer } from './recognised-format.js';

export { type AudioFormatDescriptor, type SampleEncoding } from './format-descriptor.js';

export { type AudioReader, openAudio } from './audio-reader.js';
