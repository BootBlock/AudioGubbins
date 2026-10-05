/**
 * The person's library of saved chains and presets as a document (ADR-0060).
 *
 * Every chain and preset in it is written and read by the project format's
 * own chain writer and reader (`chain-writing.ts`, `chain-reading.ts`), so a
 * chain has one persisted form wherever it is kept. The document is versioned
 * like every other the application writes, and before 1.0 a version this
 * build does not know is refused with the reason, with no migration
 * (REQ-STOR-052).
 */

import {
  flatMapResult,
  savedName,
  type DomainResult,
  type ProcessingLibrary,
  type SavedChain,
  type SavedPreset,
} from '@audiogubbins/domain';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import {
  canonicalJsonWithin,
  type CanonicalJson,
  type JsonLimits,
  type JsonObject,
  type JsonValue,
} from './canonical-json.js';
import { writeEffectChain, writeProcessor } from './chain-writing.js';
import { readEffectChain, readSlotAlone } from './chain-reading.js';
import { readCompatibleHeader } from './compatibility.js';
import {
  listConverter,
  objectOf,
  pathOf,
  required,
  startReading,
  type Converter,
} from './document-reading.js';
import { parseJson } from './json-parsing.js';
import { asName, LONGEST_PROJECT_DOCUMENT, MAXIMUM_NESTED_ITEMS } from './value-reading.js';

export const LIBRARY_DOCUMENT_FORMAT = 'audiogubbins.library';

const LIBRARY_LIMITS: JsonLimits = { maximumLength: LONGEST_PROJECT_DOCUMENT, maximumDepth: 48 };

const DOCUMENT_MEMBERS: ReadonlySet<string> = new Set([
  'format',
  'schemaVersion',
  'chains',
  'presets',
]);
const CHAIN_ENTRY_MEMBERS: ReadonlySet<string> = new Set(['name', 'chain']);
const PRESET_ENTRY_MEMBERS: ReadonlySet<string> = new Set(['name', 'processor']);

/** Writes the library, each list in its order. */
export function writeLibraryDocument(library: ProcessingLibrary): JsonObject {
  return {
    format: LIBRARY_DOCUMENT_FORMAT,
    schemaVersion: SCHEMA_VERSIONS.processingLibrary,
    chains: library.chains.map((entry) => ({
      name: entry.name,
      chain: writeEffectChain(entry.chain),
    })),
    presets: library.presets.map((entry) => ({
      name: entry.name,
      processor: writeProcessor(entry.processor),
    })),
  };
}

/** Reads a saved entry's name by the rule the library gives it. */
const asSavedName: Converter<string> = (reading, value, parent, key) => {
  const name = asName(reading, value, parent, key);
  if (name === undefined) return undefined;
  const checked = savedName(name);
  if (checked.ok && checked.value === name) return name;
  reading.refuse(
    'library.name-invalid',
    'A saved name is trimmed, not empty and of bounded length.',
    pathOf(parent, key),
  );
  return undefined;
};

const readSavedChain: Converter<SavedChain> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, CHAIN_ENTRY_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const name = required(reading, object, at, 'name', asSavedName);
  const chain = required(reading, object, at, 'chain', readEffectChain);
  return name === undefined || chain === undefined ? undefined : { name, chain };
};

const readSavedPreset: Converter<SavedPreset> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, PRESET_ENTRY_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const name = required(reading, object, at, 'name', asSavedName);
  const slot = required(reading, object, at, 'processor', readSlotAlone);
  if (slot !== undefined && slot.kind !== 'processor') {
    reading.refuse(
      'library.preset-not-processor',
      'A preset holds one processor.',
      pathOf(at, 'processor'),
    );
    return undefined;
  }
  return name === undefined || slot === undefined ? undefined : { name, processor: slot };
};

/** Reads a library document, refusing a schema version this build does not know. */
export function readLibraryDocument(value: JsonValue): DomainResult<ProcessingLibrary> {
  const header = readCompatibleHeader(value, LIBRARY_DOCUMENT_FORMAT, 'processingLibrary');
  if (!header.ok) return header;
  const reading = startReading();
  const object = objectOf(reading, value, '', '', DOCUMENT_MEMBERS);
  if (object === undefined) return reading.outcome<ProcessingLibrary>(undefined);
  const chains = required(
    reading,
    object,
    '',
    'chains',
    listConverter(MAXIMUM_NESTED_ITEMS, readSavedChain),
  );
  const presets = required(
    reading,
    object,
    '',
    'presets',
    listConverter(MAXIMUM_NESTED_ITEMS, readSavedPreset),
  );
  for (const [list, name] of [
    [chains, 'chains'],
    [presets, 'presets'],
  ] as const) {
    const names = new Set<string>();
    for (const [index, entry] of (list ?? []).entries()) {
      if (names.has(entry.name)) {
        reading.refuse(
          'library.name-repeated',
          'Two saved entries of one kind share a name.',
          pathOf(name, index),
        );
      }
      names.add(entry.name);
    }
  }
  return reading.outcome(
    chains === undefined || presets === undefined ? undefined : { chains, presets },
  );
}

/** The library as the text it is kept as. */
export function libraryDocumentText(library: ProcessingLibrary): DomainResult<CanonicalJson> {
  return canonicalJsonWithin(writeLibraryDocument(library), LIBRARY_LIMITS);
}

/** The library a kept text holds. */
export function parseLibraryDocument(text: string): DomainResult<ProcessingLibrary> {
  return flatMapResult(parseJson(text, LIBRARY_LIMITS), readLibraryDocument);
}
