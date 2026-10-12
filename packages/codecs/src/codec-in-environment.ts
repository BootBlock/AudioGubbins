/**
 * A codec's descriptor as one runtime serves it (ADR-0090, ADR-0092): the
 * registry's, with what the runtime's probes found in place of what the
 * registry cannot know.
 *
 * The registry states the bit rates of the encoders AudioGubbins builds, from
 * their sources (`encoder-bit-rates.ts`). A browser's encoder is each
 * browser's own, and takes what its platform's encoder takes, as Chromium's
 * AAC encoder on Windows takes 96, 128, 160 or 192 kbit/s and nothing else;
 * so a direction the browser serves states the bit rates its encoder was
 * probed to take here. Validation and the
 * defaults read the direction's `bitRates` alike whoever serves it, so an
 * export is refused before it renders, never by the encoder after.
 */

import { CODEC_REGISTRY, codecDescriptor } from './codec-registry.js';
import type { CodecEnvironment } from './codec-capability.js';
import type { CodecDescriptor, CodecDirection, CodecId } from './codec-descriptor.js';

/** What of an environment a descriptor depends on: the bit rates its browser's encoder takes. */
type ProbedBitRates = CodecEnvironment['browserBitRates'];

/**
 * The descriptors already made for each probe's bit rates, a value replaced
 * whole with the environment, so a lookup asked on every change of the
 * Export dialog makes them once.
 */
const MADE = new WeakMap<ProbedBitRates, ReadonlyMap<CodecId, CodecDescriptor>>();

/**
 * `write` as served where the browser's encoder takes `bitRates`. A browser's
 * direction that found none states none: the browser does not encode the
 * codec, which its capability says, with the codecs that serve instead.
 */
function writeIn(
  bitRates: ProbedBitRates,
  codec: CodecId,
  write: CodecDirection | undefined,
): CodecDirection | undefined {
  const found = write?.implementation === 'browser' ? bitRates.get(codec) : undefined;
  return write === undefined || found === undefined ? write : { ...write, bitRates: found };
}

function descriptorsIn(bitRates: ProbedBitRates): ReadonlyMap<CodecId, CodecDescriptor> {
  const made = MADE.get(bitRates);
  if (made !== undefined) return made;
  const descriptors = new Map(
    [...CODEC_REGISTRY.values()].map((descriptor): [CodecId, CodecDescriptor] => [
      descriptor.id,
      { ...descriptor, write: writeIn(bitRates, descriptor.id, descriptor.write) },
    ]),
  );
  MADE.set(bitRates, descriptors);
  return descriptors;
}

/**
 * `codec`'s descriptor as a runtime serves it whose browser's encoder was
 * probed to take `environment.browserBitRates` (see the module comment).
 */
export function codecDescriptorIn(
  environment: Pick<CodecEnvironment, 'browserBitRates'>,
  codec: CodecId,
): CodecDescriptor {
  return descriptorsIn(environment.browserBitRates).get(codec) ?? codecDescriptor(codec);
}
