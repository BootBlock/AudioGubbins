/**
 * Settings held to the codec's descriptor (ADR-0090): that the registry knows
 * the codec, writes it, writes it in the format's container, at the rate
 * asked for and with the channels the file will have.
 */

import {
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import type { CodecDescriptor, CodecDirection, SampleRateSupport } from '@audiogubbins/codecs';

import type { CodecLookup } from './export-context.js';
import type { ExportTarget } from './export-formats.js';
import { refusal } from './refusal.js';

/** Whether a direction takes a rate. */
export function acceptsRate(support: SampleRateSupport, rate: number): boolean {
  return support.kind === 'any'
    ? rate >= support.minimum && rate <= support.maximum
    : support.rates.includes(rate);
}

function rateSentence(support: SampleRateSupport): string {
  return support.kind === 'any'
    ? `from ${String(support.minimum)} to ${String(support.maximum)} Hz`
    : `at ${support.rates.map(String).join(', ')} Hz`;
}

/** A codec's descriptor and the direction that writes it. */
export interface Writing {
  readonly descriptor: CodecDescriptor;
  readonly write: CodecDirection;
}

/**
 * The direction that writes the target's codec in its container, or the
 * refusal that says why there is none.
 */
export function writingDirection(target: ExportTarget, codecs: CodecLookup): DomainResult<Writing> {
  const descriptor = codecs(target.codec);
  if (descriptor === undefined) {
    return fail(
      refusal(
        'codec-unknown',
        `AudioGubbins has no codec for ${target.formatName} files of this encoding.`,
        { codec: target.codec },
      ),
    );
  }
  const { write } = descriptor;
  if (write === undefined) {
    return fail(
      refusal('codec-not-written', `AudioGubbins reads ${descriptor.name} but cannot write it.`, {
        codec: target.codec,
      }),
    );
  }
  if (!write.containers.includes(target.container)) {
    return fail(
      refusal(
        'container-not-written',
        `AudioGubbins cannot write ${descriptor.name} in a ${target.formatName} file.`,
        { codec: target.codec, container: target.container },
      ),
    );
  }
  return succeed({ descriptor, write });
}

/** Why a direction cannot write at `rate`, or nothing. */
export function rateProblems(
  { descriptor, write }: Writing,
  rate: SampleRate,
): readonly DomainFailure[] {
  return acceptsRate(write.sampleRates, rate)
    ? []
    : [
        refusal(
          'sample-rate-unsupported',
          `${descriptor.name} is written ${rateSentence(write.sampleRates)}, not at ${String(rate)} Hz.`,
          { rate },
        ),
      ];
}

/** Why a direction cannot write `channels` channels, or nothing. */
export function channelProblems(
  { descriptor, write }: Writing,
  channels: number,
): readonly DomainFailure[] {
  return channels <= write.maximumChannels
    ? []
    : [
        refusal(
          'too-many-channels',
          `${descriptor.name} holds at most ${String(write.maximumChannels)} channels, and this export has ${String(channels)}; convert its layout to fewer.`,
          { channels, maximum: write.maximumChannels },
        ),
      ];
}
