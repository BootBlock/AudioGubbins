/**
 * The metadata reader of each container (ADR-0093): one entry per container,
 * so a format's reader is added as a line here and nowhere else.
 */

import type { ContainerId } from './codec-descriptor.js';
import { readAiffMetadata } from './aiff-metadata.js';
import type { MetadataReader } from './metadata-reading.js';
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
]);
