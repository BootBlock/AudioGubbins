/**
 * An asset's source as the Inspector states it: how the file it came from was
 * kept, and the audio shape its reader found in it (REQ-STOR-166,
 * REQ-AUDIO-220), each a term and its detail.
 *
 * The shape is what the file stated, which the asset plays at unchanged: no
 * file is resampled on import, so the rate here is the rate heard.
 */

import { channelCount, type Asset } from '@audiogubbins/domain';
import type { AssetSource, SourceAudioShape, SourceContainer } from '@audiogubbins/project-format';

import { channelNames } from '../../assets/channel-names.js';
import { counted, quoted } from '../../wording.js';

/** One fact of the source: what it is about, and what it is. */
export interface SourceFact {
  readonly term: string;
  readonly detail: string;
}

/** What each container is called. */
const CONTAINER_NAMES: Readonly<Record<SourceContainer, string>> = {
  wav: 'WAV',
  rf64: 'RF64',
  bw64: 'BW64',
  aiff: 'AIFF',
  aifc: 'AIFF-C',
};

const KILOHERTZ = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 });
const SECONDS = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** How the asset's bytes are kept. */
function keptWords(source: AssetSource): string {
  if (source.media.kind === 'managed') return 'Copied into the project';
  const name = source.media.identity.fileName;
  return name === undefined ? 'Linked to a file' : `Linked to ${quoted(name)}`;
}

/** The facts of the audio shape a file's reader found. */
function shapeFacts(shape: SourceAudioShape, asset: Asset): readonly SourceFact[] {
  const layout = shape.statedLayout ?? asset.channelLayout;
  const facts: SourceFact[] = [
    { term: 'Format', detail: CONTAINER_NAMES[shape.container] },
    { term: 'Sample rate', detail: `${KILOHERTZ.format(shape.sampleRate / 1000)} kHz` },
    {
      term: 'Samples',
      detail: `${String(shape.bitDepth)}-bit ${shape.encoding === 'float' ? 'floating point' : 'integer'}, ${shape.byteOrder === 'little' ? 'little-endian' : 'big-endian'}`,
    },
    {
      term: 'Channels',
      detail: `${counted(channelCount(layout), 'channel', 'channels')}: ${channelNames(layout).join(', ')}`,
    },
    {
      term: 'Duration',
      detail: `${SECONDS.format(shape.frames / shape.sampleRate)} s, ${counted(shape.frames, 'frame', 'frames')}`,
    },
  ];
  const shortfall = shape.declaredFrames - shape.frames;
  if (shortfall > 0) {
    facts.push({
      term: 'Read short',
      detail: `Its audio ends ${counted(shortfall, 'frame', 'frames')} before its header says it does.`,
    });
  }
  return facts;
}

/** The facts of `asset`'s source, or what is known where it kept no provenance. */
export function sourceFacts(source: AssetSource | undefined, asset: Asset): readonly SourceFact[] {
  if (source === undefined) return [];
  const provenance = source.provenance;
  const facts: SourceFact[] = [{ term: 'Kept', detail: keptWords(source) }];
  if (provenance?.originalFileName !== undefined) {
    facts.push({ term: 'File', detail: provenance.originalFileName });
  }
  if (provenance?.audio === undefined) {
    facts.push({ term: 'Audio shape', detail: 'Not recorded for this asset.' });
    return facts;
  }
  return [...facts, ...shapeFacts(provenance.audio, asset)];
}
