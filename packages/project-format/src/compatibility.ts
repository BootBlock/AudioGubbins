/**
 * The one rule deciding whether a stored document of a schema version can be
 * read (REQ-STOR-052, REQ-EXEC-136.11).
 *
 * Before 1.0 the schemas may break, and REQ-STOR-052 forbids accumulating
 * migration code meanwhile: a document whose version is not this build's is
 * incompatible, whichever way the difference runs, and is refused whole so the
 * storage layer can show the blocking compatibility screen. Nothing here
 * migrates, and nothing is shaped for a migration step that does not exist.
 *
 * From 1.0, REQ-STOR-052 makes migration a product responsibility. This rule is
 * the pre-1.0 rule and nothing else, so the module refuses to load in a build
 * whose product version has reached 1.0: the release that crosses it must
 * replace this rule with explicit, tested migration steps on purpose, never
 * inherit a refusal to read its users' projects by accident.
 */

import { PRODUCT_VERSION, SCHEMA_VERSIONS, type SchemaName } from '@audiogubbins/version';
import {
  FailureKind,
  failure,
  fail,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import type { JsonValue } from './canonical-json.js';
import { anyObjectOf, required, startReading } from './document-reading.js';
import { integerConverter, textConverter } from './scalar-reading.js';

/** The major part of the product version. */
const PRODUCT_MAJOR = Number.parseInt(PRODUCT_VERSION, 10);

if (PRODUCT_MAJOR !== 0) {
  throw new Error(
    `The product version ${PRODUCT_VERSION} is 1.0 or later, where REQ-STOR-052 requires schema migration; the pre-1.0 compatibility rule cannot serve it.`,
  );
}

/** Whether a stored schema version can be read by this build. */
export type Compatibility =
  | { readonly kind: 'current' }
  | {
      readonly kind: 'incompatible';
      readonly found: number;
      readonly current: number;

      /** Whether the stored version is older or newer than this build's. */
      readonly direction: 'older' | 'newer';
    };

/** What every versioned document of the format opens with. */
export interface FormatHeader {
  readonly format: string;
  readonly schemaVersion: number;
}

const CURRENT: Compatibility = { kind: 'current' };

const asFormat = textConverter({ maximumLength: 64 });
const asSchemaVersion = integerConverter(1, Number.MAX_SAFE_INTEGER);

/**
 * Whether a document of schema version `found` of `schema` can be read. Before
 * 1.0, only the version this build writes can be.
 */
export function compatibilityOf(found: number, schema: SchemaName): Compatibility {
  const current = SCHEMA_VERSIONS[schema];
  if (found === current) return CURRENT;
  return { kind: 'incompatible', found, current, direction: found < current ? 'older' : 'newer' };
}

/**
 * Reads a document's format name and schema version, refusing a document of
 * another format. Members other than the two are left to the document's own
 * reader.
 */
function readFormatHeader(value: JsonValue, expectedFormat: string): DomainResult<FormatHeader> {
  const reading = startReading();
  const object = anyObjectOf(reading, value, '', '');
  if (object === undefined) return reading.outcome<FormatHeader>(undefined);

  const format = required(reading, object, '', 'format', asFormat);
  const schemaVersion = required(reading, object, '', 'schemaVersion', asSchemaVersion);
  if (format !== undefined && format !== expectedFormat) {
    reading.refuse(
      'format.unexpected-format',
      `The document is not of the format "${expectedFormat}".`,
      'format',
      {
        expected: expectedFormat,
      },
    );
  }
  return reading.outcome(
    format === undefined || schemaVersion === undefined ? undefined : { format, schemaVersion },
  );
}

/**
 * Reads a document's header and applies the rule to it: the header, or a
 * refusal. An incompatible version fails with `format.schema-incompatible`, of
 * kind `unrecoverable`, whose details carry the schema, both versions and the
 * direction; a caller that must say more reads the header and calls
 * {@link compatibilityOf} itself.
 */
export function readCompatibleHeader(
  value: JsonValue,
  expectedFormat: string,
  schema: SchemaName,
): DomainResult<FormatHeader> {
  const header = readFormatHeader(value, expectedFormat);
  if (!header.ok) return header;

  const verdict = compatibilityOf(header.value.schemaVersion, schema);
  return verdict.kind === 'current' ? header : fail(incompatibility(verdict, schema));
}

/** The failure an incompatible version is refused with. */
function incompatibility(
  verdict: Extract<Compatibility, { kind: 'incompatible' }>,
  schema: SchemaName,
): DomainFailure {
  return failure(
    'format.schema-incompatible',
    FailureKind.Unrecoverable,
    `The document was written with ${verdict.direction === 'older' ? 'an older' : 'a newer'} ${schema} schema than this version reads, and before 1.0 no migration exists.`,
    {
      details: {
        schema,
        found: verdict.found,
        current: verdict.current,
        direction: verdict.direction,
      },
    },
  );
}
