/**
 * The reader of a catalogue, `{ "format": 1, "packs": [manifest, ...] }`, the
 * list of packs the build's catalogue offers (ADR-0062), from text nobody here
 * wrote, each manifest in it read by the manifest reader.
 */

import type { DomainResult } from '@audiogubbins/domain';
import {
  objectOf,
  parseJson,
  required,
  startReading,
  type JsonLimits,
} from '@audiogubbins/project-format';

import { distinctList } from './distinct-list.js';
import { packKey, refOf, type ModelPackManifest } from './manifest.js';
import { manifestConverter, readFormat } from './manifest-reading.js';

/** The most packs one catalogue may list. */
const MOST_CATALOGUE_PACKS = 256;

/** A catalogue's text: its bound of manifests at their bound. */
const CATALOGUE_LIMITS: JsonLimits = {
  maximumLength: 4 * 1024 * 1024,
  maximumDepth: 8,
};

const CATALOGUE_MEMBERS: ReadonlySet<string> = new Set(['format', 'packs']);

const readPacks = distinctList(
  MOST_CATALOGUE_PACKS,
  manifestConverter,
  (manifest) => packKey(refOf(manifest)),
  'The catalogue lists each version of a pack once.',
  0,
);

/**
 * Reads a catalogue, `{ "format": 1, "packs": [manifest, ...] }`, refusing it
 * whole with every reason where any manifest in it is not one: a catalogue that
 * lies about one pack is not trusted about the others.
 */
export function readPackCatalogue(text: string): DomainResult<readonly ModelPackManifest[]> {
  const parsed = parseJson(text, CATALOGUE_LIMITS);
  if (!parsed.ok) return parsed;
  const reading = startReading();
  const object = objectOf(reading, parsed.value, '', 'catalogue', CATALOGUE_MEMBERS);
  if (object === undefined) return reading.outcome<readonly ModelPackManifest[]>(undefined);
  const format = required(reading, object, 'catalogue', 'format', readFormat);
  const packs = required(reading, object, 'catalogue', 'packs', readPacks);
  return reading.outcome(format === undefined ? undefined : packs);
}
