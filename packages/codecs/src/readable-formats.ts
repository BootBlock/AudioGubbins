/**
 * The sentence a refusal ends with: what AudioGubbins can read, made from the
 * registry, so it names exactly what the descriptors serve and changes when
 * they do.
 */

import type { CodecDescriptor } from './codec-descriptor.js';
import { CODEC_REGISTRY } from './codec-registry.js';

/** Names joined as a sentence lists them: "a, b and c". */
function listed(names: readonly string[], conjunction: 'and' | 'or'): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${conjunction} ${names.at(-1) ?? ''}`;
}

const DESCRIPTORS: readonly CodecDescriptor[] = [...CODEC_REGISTRY.values()];

/** The compressed codes the application reads in place, by name. */
const IN_PLACE = DESCRIPTORS.filter(
  (descriptor) => descriptor.read?.implementation === 'application' && descriptor.id !== 'pcm',
).map((descriptor) => descriptor.name);

/** The codecs decoded on every runtime that can decode, and those only a browser's decoder serves. */
const DECODED = DESCRIPTORS.filter(
  (descriptor) =>
    descriptor.read !== undefined &&
    descriptor.read.implementation !== 'application' &&
    descriptor.read.implementation !== 'browser',
).map((descriptor) => descriptor.name);
const BROWSER_DECODED = DESCRIPTORS.filter(
  (descriptor) => descriptor.read?.implementation === 'browser',
).map((descriptor) => descriptor.name);

/** The formats a refusal tells the person can be read. */
export const READABLE_FORMATS_SENTENCE = `AudioGubbins reads WAV (including RF64 and BW64), AIFF and AIFF-C, uncompressed or compressed as ${listed(IN_PLACE, 'or')}, and decodes ${listed(DECODED, 'and')}${BROWSER_DECODED.length === 0 ? '' : `, and ${listed(BROWSER_DECODED, 'and')} where the browser decodes it`}.`;
