/**
 * Whether the sound of a reference picture may be extracted in the memory the
 * page has (REQ-EXEC-216, REQ-AUDIO-156).
 *
 * Extracting reads the whole file into one buffer, since the browser's decoder
 * takes nothing smaller, and decodes all of its sound as 32-bit samples at the
 * rate it is asked for, which the session then holds and copies for each thread
 * that reads it. Neither part can be streamed, so a file past the bound is
 * refused with the reason before a byte of it is read: an hour-long reel would
 * otherwise take the tab, and the editor with it, down.
 *
 * Both parts are counted together, because both are held while the sound is
 * decoded. The browser says nothing of a file's channels until it has decoded
 * them, so they are read first by the codec worker's analysis of the file,
 * which reads its headers alone. Where the analysis cannot say, the sound is
 * counted at eight channels, 7.1, the widest a picture's sound is commonly
 * delivered in, and a refusal says why it was.
 */

import type { ResourceFigures } from '@audiogubbins/capabilities';
import type { ImportAnalysis } from '@audiogubbins/codec-runtime';
import type { DomainResult } from '@audiogubbins/domain';

/** The channels a picture's sound is counted at where its analysis does not say. */
const ASSUMED_CHANNELS = 8;

/** The channels a picture's sound is counted at: those its analysis read, or eight, and why. */
export type SoundChannels =
  | { readonly kind: 'read'; readonly count: number }
  | { readonly kind: 'assumed'; readonly reason: string };

/** Why the analysis of a file read in place says nothing of its channels. */
const READ_IN_PLACE =
  'the file is read where it lies, and its analysis does not open its audio to count them.';

/** The channels the analysis of a picture's file read, or why it read none. */
export function soundChannelsOf(analysis: DomainResult<ImportAnalysis>): SoundChannels {
  if (!analysis.ok) return { kind: 'assumed', reason: analysis.failures[0].summary };
  const analysed = analysis.value;
  switch (analysed.kind) {
    case 'decode':
      return { kind: 'read', count: analysed.stream.layout.roles.length };
    case 'read-in-place':
      return { kind: 'assumed', reason: READ_IN_PLACE };
    case 'refused':
      return { kind: 'assumed', reason: analysed.failure.summary };
  }
}

function channelsText(count: number): string {
  return count === 1 ? '1 channel' : `${String(count)} channels`;
}

const BYTES_PER_SAMPLE = 4;

/**
 * The bound where the page does not say what memory it has: a conservative
 * fraction of what a modest machine gives a tab.
 */
const FIXED_SOUND_BOUND_BYTES = 1024 ** 3;

/**
 * The share of the memory the page says it has that extracting may take: a
 * quarter, leaving room for the copy a thread is handed and for the editor.
 */
const SHARE_OF_AVAILABLE = 1 / 4;

const MEGABYTES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const GIGABYTES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const MINUTES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/** A size in bytes, in the unit a reader thinks of it in. */
function sizeText(bytes: number): string {
  return bytes >= 1e9
    ? `${GIGABYTES.format(bytes / 1e9)} GB`
    : `${MEGABYTES.format(bytes / 1e6)} MB`;
}

/** The most memory extracting a picture's sound may take, given what the page says it has. */
export function soundBound(resources: ResourceFigures): number {
  const { availableMemoryBytes } = resources;
  return availableMemoryBytes === undefined
    ? FIXED_SOUND_BOUND_BYTES
    : Math.floor(availableMemoryBytes * SHARE_OF_AVAILABLE);
}

/**
 * Why the sound of a file of `bytes` lasting `duration` seconds, decoded at
 * `rate` in `channels`, cannot be extracted within `bound` bytes, or
 * `undefined` when it can.
 */
export function soundRefusal(
  bytes: number,
  duration: number,
  rate: number,
  channels: SoundChannels,
  bound: number,
): string | undefined {
  if (!Number.isFinite(duration)) {
    return 'The picture does not say how long it is, so the memory its sound needs cannot be told.';
  }
  const count = channels.kind === 'read' ? channels.count : ASSUMED_CHANNELS;
  const decoded = Math.ceil(duration * rate) * count * BYTES_PER_SAMPLE;
  if (bytes + decoded <= bound) return undefined;
  const needed =
    `Extracting the picture’s sound needs up to ${sizeText(bytes + decoded)}: the ` +
    `${sizeText(bytes)} file, read whole, and ${MINUTES.format(duration / 60)} minutes ` +
    `of sound in ${channels.kind === 'read' ? '' : 'up to '}${channelsText(count)}. This ` +
    `page can spare ${sizeText(bound)} for it.`;
  return channels.kind === 'read'
    ? needed
    : `${needed} Its channels are counted at ${String(ASSUMED_CHANNELS)}, the most a ` +
        `picture’s sound is commonly delivered in, because they could not be read: ` +
        channels.reason;
}
