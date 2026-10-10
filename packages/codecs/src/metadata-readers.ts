/**
 * The metadata reader of each container (ADR-0093): one entry per container, so
 * a format's reader is added as a line here and nowhere else. The keys are the
 * containers recognition names, so a recognised file's reader is found by its
 * container. WebM and Matroska have no mapping in ADR-0093, so no reader.
 */

import type { ContainerId } from './codec-descriptor.js';
import { readAiffMetadata } from './aiff-metadata.js';
import { readFlacMetadata } from './flac-metadata-reader.js';
import { readId3Metadata } from './id3-metadata-reader.js';
import type { MetadataReader } from './metadata-reading.js';
import { readMp4Metadata } from './mp4-metadata-reader.js';
import { readOggMetadata } from './ogg-metadata-reader.js';
import { readRiffMetadata } from './riff-metadata.js';

export const METADATA_READERS: ReadonlyMap<ContainerId, MetadataReader> = new Map<
  ContainerId,
  MetadataReader
>([
  ['wav', readRiffMetadata],
  ['rf64', readRiffMetadata],
  ['bw64', readRiffMetadata],
  ['aiff', readAiffMetadata],
  ['aifc', readAiffMetadata],
  ['flac', readFlacMetadata],
  ['ogg', readOggMetadata],
  ['mp4', readMp4Metadata],
  ['mp3', readId3Metadata],
  ['adts', readId3Metadata],
]);
