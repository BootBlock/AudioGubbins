/**
 * An entry of the person's library of saved chains and presets as a document
 * (ADR-0060), and the rule for the name it is saved under.
 *
 * A saved chain and a preset are written and read by the project format's own
 * chain writer and reader (`chain-writing.ts`, `chain-reading.ts`), so a chain
 * has one persisted form wherever it is kept. Each entry is a document of its
 * own, versioned like every other the application writes, so an entry another
 * build wrote is refused alone, with the reason, and the rest of the library
 * still reads; before 1.0 a version this build does not know is refused with
 * no migration (REQ-STOR-052). The entry's identifier is where it is kept, not
 * a member of the document.
 */

import {
  FailureKind,
  LONGEST_SAVED_NAME,
  fail,
  failure,
  succeed,
  type DomainResult,
  type LibraryContent,
  type LibraryEntry,
  type LibraryEntryId,
} from '@audiogubbins/domain';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';
import { asName as asGivenName } from '@audiogubbins/text';

import type { JsonObject, JsonValue } from './canonical-json.js';
import { writeEffectChain, writeProcessor } from './chain-writing.js';
import { WRITTEN_CHAIN_DEPTH, readEffectChain, readSlotAlone } from './chain-reading.js';
import { readCompatibleHeader } from './compatibility.js';
import {
  anyObjectOf,
  checkMembers,
  pathOf,
  required,
  startReading,
  type Converter,
} from './document-reading.js';
import { integerConverter, oneOfConverter } from './scalar-reading.js';
import { LONGEST_NAME, asName } from './value-reading.js';

/** The format name an entry of the library carries. */
const LIBRARY_ENTRY_FORMAT = 'audiogubbins.library-entry';

/** How many levels of arrays and objects an entry takes: its own, and its chain's. */
export const LIBRARY_ENTRY_DEPTH = 1 + WRITTEN_CHAIN_DEPTH;

const HEADER_MEMBERS = ['format', 'schemaVersion', 'kind', 'name', 'savedAt'] as const;
const CHAIN_MEMBERS: ReadonlySet<string> = new Set([...HEADER_MEMBERS, 'chain']);
const PRESET_MEMBERS: ReadonlySet<string> = new Set([...HEADER_MEMBERS, 'processor']);

const asKind = oneOfConverter(['chain', 'preset'] as const);
const asSavedAt = integerConverter(0, Number.MAX_SAFE_INTEGER);

function nameRefused(code: 'blank' | 'too-long'): DomainResult<never> {
  return fail(
    code === 'blank'
      ? failure('library.name-blank', FailureKind.Rejected, 'A saved chain or preset needs a name.')
      : failure(
          'library.name-too-long',
          FailureKind.Rejected,
          `A saved chain or preset's name is at most ${String(LONGEST_SAVED_NAME)} characters.`,
        ),
  );
}

/**
 * `value` as the name of a saved chain or preset, without the space around
 * it, or why it cannot be one: something a reader sees, by the rule every
 * name a reader is shown is held to, within {@link LONGEST_SAVED_NAME}
 * characters and the document's bound in code units.
 */
export function savedEntryName(value: unknown): DomainResult<string> {
  const name = asGivenName(value, LONGEST_SAVED_NAME);
  if (typeof name !== 'string') return nameRefused(name.kind);
  return name.length > LONGEST_NAME ? nameRefused('too-long') : succeed(name);
}

/** Reads an entry's name, kept as {@link savedEntryName} gives it. */
const asSavedName: Converter<string> = (reading, value, parent, key) => {
  const text = asName(reading, value, parent, key);
  if (text === undefined) return undefined;
  const checked = savedEntryName(text);
  if (checked.ok && checked.value === text) return text;
  reading.refuseAll(
    checked.ok
      ? [
          failure(
            'library.name-untrimmed',
            FailureKind.Rejected,
            'A saved name is kept without the space around it.',
          ),
        ]
      : checked.failures,
    pathOf(parent, key),
  );
  return undefined;
};

/** Writes an entry as {@link readLibraryEntry} reads it, its content in the chain's one form. */
export function writeLibraryEntry(entry: LibraryEntry): JsonObject {
  const header = {
    format: LIBRARY_ENTRY_FORMAT,
    schemaVersion: SCHEMA_VERSIONS.processingLibrary,
    kind: entry.content.kind,
    name: entry.name,
    savedAt: entry.savedAt,
  };
  return entry.content.kind === 'chain'
    ? { ...header, chain: writeEffectChain(entry.content.chain) }
    : { ...header, processor: writeProcessor(entry.content.processor) };
}

/**
 * Reads the entry kept as `id`, refusing a schema version this build does
 * not know, and anything else that is not an entry, with the reason. Whether
 * this build has the processor types and versions it names is the
 * catalogue's question (`checkProcessors`), asked by whatever lists it.
 */
export function readLibraryEntry(id: LibraryEntryId, value: JsonValue): DomainResult<LibraryEntry> {
  const header = readCompatibleHeader(value, LIBRARY_ENTRY_FORMAT, 'processingLibrary');
  if (!header.ok) return header;
  const reading = startReading();
  const object = anyObjectOf(reading, value, '', '');
  if (object === undefined) return reading.outcome<LibraryEntry>(undefined);
  const kind = required(reading, object, '', 'kind', asKind);
  if (kind === undefined) return reading.outcome<LibraryEntry>(undefined);
  checkMembers(reading, object, '', kind === 'chain' ? CHAIN_MEMBERS : PRESET_MEMBERS);
  const name = required(reading, object, '', 'name', asSavedName);
  const savedAt = required(reading, object, '', 'savedAt', asSavedAt);
  let content: LibraryContent | undefined;
  if (kind === 'chain') {
    const chain = required(reading, object, '', 'chain', readEffectChain);
    content = chain === undefined ? undefined : { kind, chain };
  } else {
    const slot = required(reading, object, '', 'processor', readSlotAlone);
    if (slot?.kind === 'group') {
      reading.refuse('library.preset-not-processor', 'A preset holds one processor.', 'processor');
    } else if (slot !== undefined) {
      content = { kind, processor: slot };
    }
  }
  return reading.outcome(
    name === undefined || savedAt === undefined || content === undefined
      ? undefined
      : { id, name, savedAt, content },
  );
}
