/**
 * Reading the names the codec registry gives containers, codecs and their
 * implementations (ADR-0090), wherever the project keeps one: a rendition's
 * provenance and an export record. Each list is a record over the registry's
 * own union, so a name the registry gains and this leaves out fails to
 * compile.
 */

import type { CodecId, CodecImplementation, ContainerId } from '@audiogubbins/codecs';

import { namedValueConverter } from './scalar-reading.js';

/** A container, as the codec registry names it. */
export const asContainer = namedValueConverter<ContainerId>({
  wav: true,
  rf64: true,
  bw64: true,
  aiff: true,
  aifc: true,
  flac: true,
  mp3: true,
  ogg: true,
  mp4: true,
  adts: true,
  webm: true,
  matroska: true,
});

/** A codec, as the codec registry names it. */
export const asCodec = namedValueConverter<CodecId>({
  pcm: true,
  'g711-alaw': true,
  'g711-ulaw': true,
  'ima-adpcm': true,
  'ms-adpcm': true,
  flac: true,
  alac: true,
  mp3: true,
  vorbis: true,
  opus: true,
  'aac-lc': true,
  'he-aac': true,
});

/** What serves a codec, as the codec registry names it. */
export const asImplementation = namedValueConverter<CodecImplementation>({
  application: true,
  'codec-module': true,
  'encoder-module': true,
  browser: true,
});
