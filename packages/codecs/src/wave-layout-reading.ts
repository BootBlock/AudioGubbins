/**
 * The layout a WAV file's header states: its speaker mask, and the `iXML`
 * statement AudioGubbins writes for a layout a mask cannot hold (ADR-0093).
 *
 * The statement is honoured where it lies before the samples, where AudioGubbins
 * writes it, so a reader never walks past the data to find it; and only where it
 * agrees with the mask, speaker for speaker, or the mask places none. A mask and
 * a statement that disagree mean another tool changed the channels and left the
 * statement behind, and the mask, which every tool keeps, is believed.
 */

import {
  succeed,
  type CancellationSignal,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';

import type { HeaderSource } from './byte-reading.js';
import { speakerMaskLayout } from './channel-layouts.js';
import { readHeaderChunk, type ChunkSpan } from './chunk-walk.js';
import { IXML_LAYOUT_BYTES, ixmlLayout } from './ixml-layout.js';

/** The layout a header states for a count of channels, once that count is known to be one. */
export type StatedLayout = (channelCount: number) => ChannelLayout | undefined;

/** Whether a statement's roles are the speakers a mask places, or the mask places none. */
function agrees(
  stated: ChannelLayout,
  masked: ChannelLayout | undefined,
  mask: number | undefined,
): boolean {
  if (mask === undefined || mask === 0) return true;
  return masked?.roles.every((role, index) => stated.roles[index] === role) ?? false;
}

/**
 * The layout a WAV header states, from its extensible form's speaker mask, if
 * any, and the `iXML` chunk before its data, if any and if no larger than any
 * statement AudioGubbins writes.
 */
export async function waveStatedLayout(
  source: HeaderSource,
  mask: number | undefined,
  ixml: ChunkSpan | undefined,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<StatedLayout>> {
  let body: Uint8Array | undefined;
  if (ixml !== undefined && ixml.size <= IXML_LAYOUT_BYTES) {
    const read = await readHeaderChunk(source, ixml, IXML_LAYOUT_BYTES, signal);
    if (!read.ok) return read;
    body = read.value;
  }
  return succeed((channelCount) => {
    const masked = mask === undefined ? undefined : speakerMaskLayout(mask, channelCount);
    const stated = body === undefined ? undefined : ixmlLayout(body, channelCount);
    return stated !== undefined && agrees(stated, masked, mask) ? stated : masked;
  });
}
