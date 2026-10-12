/**
 * Whether the sound of a reference picture may be extracted in the memory the
 * page has (REQ-EXEC-216, REQ-AUDIO-156).
 *
 * The codec worker reads the file where it lies and sends its sound a block at
 * a time, so the file itself is never held. The sound is: decoded as 32-bit
 * samples at its own rate, it is held whole by the session as an asset and
 * copied for each thread that reads it. So it is weighed before a block of it
 * is decoded, at the rate and channels the codec worker's analysis read from
 * the file's headers, and the length its stream states, or where it states
 * none, the length the picture plays for; past the bound it is refused with
 * the reason, since an hour-long reel would otherwise take the tab, and the
 * editor with it, down. A stream that runs past what was weighed is stopped
 * at the bound ({@link soundFrameLimit}), so no stream holds more than it.
 */

import type { ResourceFigures } from '@audiogubbins/capabilities';
import type { AnalysedStream } from '@audiogubbins/codec-runtime';

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
const KILOHERTZ = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 });

/** A size in bytes, in the unit a reader thinks of it in. */
function sizeText(bytes: number): string {
  return bytes >= 1e9
    ? `${GIGABYTES.format(bytes / 1e9)} GB`
    : `${MEGABYTES.format(bytes / 1e6)} MB`;
}

function minutesText(minutes: number): string {
  const text = MINUTES.format(minutes);
  return text === '1' ? '1 minute' : `${text} minutes`;
}

function channelsText(count: number): string {
  return count === 1 ? '1 channel' : `${String(count)} channels`;
}

/** The most memory extracting a picture's sound may take, given what the page says it has. */
export function soundBound(resources: ResourceFigures): number {
  const { availableMemoryBytes } = resources;
  return availableMemoryBytes === undefined
    ? FIXED_SOUND_BOUND_BYTES
    : Math.floor(availableMemoryBytes * SHARE_OF_AVAILABLE);
}

/** The most frames of `channels` channels that `bound` bytes hold. */
export function soundFrameLimit(channels: number, bound: number): number {
  return Math.floor(bound / (channels * BYTES_PER_SAMPLE));
}

/**
 * Why the sound `stream` describes, of a picture lasting `duration` seconds,
 * cannot be extracted within `bound` bytes, or `undefined` when it can.
 */
export function soundRefusal(
  stream: AnalysedStream,
  duration: number,
  bound: number,
): string | undefined {
  let frames: number;
  if (stream.statedFrames !== undefined) frames = stream.statedFrames;
  else if (Number.isFinite(duration)) frames = Math.ceil(duration * stream.sampleRate);
  else {
    return 'Neither the picture nor its sound says how long it is, so the memory its sound needs cannot be told.';
  }
  const channels = stream.layout.roles.length;
  if (frames <= soundFrameLimit(channels, bound)) return undefined;
  const needed = frames * channels * BYTES_PER_SAMPLE;
  return (
    `Extracting the picture’s sound needs ${sizeText(needed)}: ` +
    `${minutesText(frames / stream.sampleRate / 60)} of sound in ` +
    `${channelsText(channels)} at ${KILOHERTZ.format(stream.sampleRate / 1000)} kHz. ` +
    `This page can spare ${sizeText(bound)} for it.`
  );
}
