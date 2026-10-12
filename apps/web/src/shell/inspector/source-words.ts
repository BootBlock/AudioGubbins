/**
 * An asset's source as the Inspector states it (REQ-EDIT-072, REQ-STOR-166,
 * REQ-AUDIO-220): how the file it came from was kept, and either the audio
 * shape its reader found in it, where it is read where it lies, or what the
 * compressed file was and what decoded it, where the asset plays a rendition
 * decoded from it (ADR-0090); each a term and its detail.
 *
 * The shape is what the file stated, which the asset plays at unchanged: no
 * file is resampled on import, so the rate here is the rate heard. A
 * rendition's sound is fixed when it is decoded, so the decoder and its
 * version named here are what made what the person hears, whatever decoder a
 * later build carries.
 */

import { codecDescriptor, containerName, type CodecImplementation } from '@audiogubbins/codecs';
import { channelCount, type Asset, type ChannelLayout } from '@audiogubbins/domain';
import type {
  AssetSource,
  DecodedRendition,
  KeptCompressedSource,
  SourceAudioShape,
  SourceEncoding,
} from '@audiogubbins/project-format';
import { counted, quoted } from '@audiogubbins/text';

import { channelNames } from '../../assets/channel-names.js';
import { sampleRateWords } from '../../wording.js';
import type { Fact } from './facts.js';

/** Where each kind of decoder runs, as the person is told it. */
const IMPLEMENTATION_WORDS: Readonly<Record<CodecImplementation, string>> = {
  application: 'AudioGubbins itself',
  'codec-module': 'AudioGubbins’s codec module',
  'encoder-module': 'an encoder module AudioGubbins carries',
  browser: 'this browser',
};

const KILOBITS = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

const SECONDS = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** A file linked where it lies, by the name it was linked under where it has one. */
function linkedWords(fileName: string | undefined): string {
  return fileName === undefined ? 'Linked to a file' : `Linked to ${quoted(fileName)}`;
}

/** How the asset's bytes are kept. */
function keptWords(source: AssetSource): string {
  if (source.media.kind === 'managed') {
    return source.provenance?.rendition === undefined
      ? 'Copied into the project'
      : 'Decoded once into the project';
  }
  return linkedWords(source.media.identity.fileName);
}

/** How the compressed file a rendition was decoded from is kept. */
function compressedKeptWords(kept: KeptCompressedSource): string {
  if (kept.kind === 'copied') return 'Copied into the project';
  const linked = linkedWords(kept.identity.fileName);
  return kept.retainedCopy === undefined ? linked : `${linked}, with a copy kept in the project`;
}

/** The channels of `layout`, counted and named. */
function channelsWords(layout: ChannelLayout): string {
  return `${counted(channelCount(layout), 'channel', 'channels')}: ${channelNames(layout).join(', ')}`;
}

/** How long `frames` at `rate` last, in seconds and in frames. */
function durationWords(frames: number, rate: number): string {
  return `${SECONDS.format(frames / rate)} s, ${counted(frames, 'frame', 'frames')}`;
}

/** How a file stores its samples, as a sentence names it. */
function encodingWords(encoding: SourceEncoding): string {
  switch (encoding.kind) {
    case 'integer':
    case 'float':
      return `${String(encoding.bits)}-bit ${encoding.kind === 'float' ? 'floating point' : 'integer'}, ${encoding.byteOrder === 'little' ? 'little-endian' : 'big-endian'}`;
    case 'g711-alaw':
      return 'G.711 A-law';
    case 'g711-ulaw':
      return 'G.711 µ-law';
    case 'ima-adpcm':
      return `IMA ADPCM, ${counted(encoding.framesPerBlock, 'frame', 'frames')} a block`;
    case 'ms-adpcm':
      return `Microsoft ADPCM, ${counted(encoding.framesPerBlock, 'frame', 'frames')} a block`;
  }
}

/** The facts of the audio shape a file's reader found. */
function shapeFacts(shape: SourceAudioShape, asset: Asset): readonly Fact[] {
  const layout = shape.statedLayout ?? asset.channelLayout;
  const facts: Fact[] = [
    { term: 'Format', detail: containerName(shape.container) },
    { term: 'Sample rate', detail: sampleRateWords(shape.sampleRate) },
    {
      term: 'Samples',
      detail: encodingWords(shape.encoding),
    },
    { term: 'Channels', detail: channelsWords(layout) },
    { term: 'Duration', detail: durationWords(shape.frames, shape.sampleRate) },
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

/** The facts of the compressed file a rendition was decoded from, and of what decoded it. */
function renditionFacts(rendition: DecodedRendition): readonly Fact[] {
  const { decoder } = rendition;
  const facts: Fact[] = [
    {
      term: 'Format',
      detail: `${containerName(rendition.container)}, ${codecDescriptor(rendition.codec).name}`,
    },
    { term: 'Sample rate', detail: sampleRateWords(rendition.sampleRate) },
    { term: 'Channels', detail: channelsWords(rendition.layout) },
    { term: 'Duration', detail: durationWords(rendition.frames, rendition.sampleRate) },
  ];
  if (rendition.bitRate !== undefined) {
    facts.push({
      term: 'Bit rate',
      detail: `${KILOBITS.format(rendition.bitRate / 1_000)} kbit/s on average`,
    });
  }
  if (rendition.statedFrames !== undefined && rendition.statedFrames !== rendition.frames) {
    facts.push({
      term: 'Stated length',
      detail: `The file says it holds ${counted(rendition.statedFrames, 'frame', 'frames')}, and ${counted(rendition.frames, 'frame', 'frames')} were decoded.`,
    });
  }
  if (rendition.leadingFrames > 0) {
    facts.push({
      term: 'Priming',
      detail: `${counted(rendition.leadingFrames, 'frame', 'frames')} the encoder put before the sound were left out.`,
    });
  }
  facts.push(
    {
      term: 'Decoded by',
      detail: `${decoder.name} ${decoder.version}, in ${IMPLEMENTATION_WORDS[decoder.implementation]}`,
    },
    { term: 'Compressed file', detail: compressedKeptWords(rendition.kept) },
  );
  return facts;
}

/** The facts of `asset`'s source, or what is known where it kept no provenance. */
export function sourceFacts(source: AssetSource | undefined, asset: Asset): readonly Fact[] {
  if (source === undefined) return [];
  const provenance = source.provenance;
  const facts: Fact[] = [{ term: 'Kept', detail: keptWords(source) }];
  if (provenance?.originalFileName !== undefined) {
    facts.push({ term: 'File', detail: provenance.originalFileName });
  }
  if (provenance?.rendition !== undefined) {
    return [...facts, ...renditionFacts(provenance.rendition)];
  }
  if (provenance?.audio === undefined) {
    facts.push({ term: 'Audio shape', detail: 'Not recorded for this asset.' });
    return facts;
  }
  return [...facts, ...shapeFacts(provenance.audio, asset)];
}
