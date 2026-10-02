/**
 * The header of a project's unpacked tree, `audiogubbins-project.json`: which
 * format and schema wrote the tree, which project it is, and what it includes
 * (REQ-STOR-052, REQ-STOR-103, REQ-STOR-166).
 *
 * The header is read before anything else, and a tree of another
 * `portableBundle` schema version, or whose project files were written with
 * another `projectDocument` version, is refused with the version it was found
 * to be, and read no further: before 1.0 nothing migrates. A tree keeps its
 * history at any provenance level: below full, the history's changes are
 * stripped with its states, each linked file's name, handle and path a
 * placeholder, so undo and redo restore nothing that was left out
 * (`history-stripping.ts`).
 */

import {
  FailureKind,
  fail,
  failure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import type { JsonObject, JsonValue } from './canonical-json.js';
import { compatibilityOf, readCompatibleHeader } from './compatibility.js';
import { objectOf, pathOf, required, startReading, type Converter } from './document-reading.js';
import { asProjectName } from './given-names.js';
import { ProvenanceLevel } from './provenance-stripping.js';
import { asBoolean, asId, integerConverter, oneOfConverter } from './scalar-reading.js';

/** The format name a tree's header carries. */
const PROJECT_TREE_FORMAT = 'audiogubbins.project-tree';

/** What a tree's header says. */
export interface TreeHeader {
  readonly project: ProjectId;
  readonly displayName: string;

  /** Whether the tree holds the project's history and the states it keeps. */
  readonly history: boolean;

  /** Whether the tree holds disposable caches. */
  readonly caches: boolean;

  /** How much provenance the state, the history and the export records keep. */
  readonly provenance: ProvenanceLevel;
}

const HEADER_MEMBERS: ReadonlySet<string> = new Set([
  'format',
  'schemaVersion',
  'projectDocumentSchemaVersion',
  'project',
  'displayName',
  'includes',
  'provenance',
]);
const INCLUDES_MEMBERS: ReadonlySet<string> = new Set(['history', 'caches']);

const asVersion = integerConverter(1, Number.MAX_SAFE_INTEGER);
const asProvenance = oneOfConverter([
  ProvenanceLevel.Full,
  ProvenanceLevel.Minimal,
  ProvenanceLevel.None,
]);

/** What a tree includes besides the project's state. */
const asIncludes: Converter<Pick<TreeHeader, 'history' | 'caches'>> = (
  reading,
  value,
  parent,
  key,
) => {
  const held = objectOf(reading, value, parent, key, INCLUDES_MEMBERS);
  if (held === undefined) return undefined;
  const at = pathOf(parent, key);
  const history = required(reading, held, at, 'history', asBoolean);
  const caches = required(reading, held, at, 'caches', asBoolean);
  return history === undefined || caches === undefined ? undefined : { history, caches };
};

/** Writes a tree's header. */
export function writeTreeHeader(header: TreeHeader): JsonObject {
  return {
    format: PROJECT_TREE_FORMAT,
    schemaVersion: SCHEMA_VERSIONS.portableBundle,
    projectDocumentSchemaVersion: SCHEMA_VERSIONS.projectDocument,
    project: header.project,
    displayName: header.displayName,
    includes: { history: header.history, caches: header.caches },
    provenance: header.provenance,
  };
}

/** Reads a tree's header, refusing a tree of another schema first. */
export function readTreeHeader(value: JsonValue): DomainResult<TreeHeader> {
  const format = readCompatibleHeader(value, PROJECT_TREE_FORMAT, 'portableBundle');
  if (!format.ok) return format;

  const reading = startReading();
  const object = objectOf(reading, value, '', '', HEADER_MEMBERS);
  if (object === undefined) return reading.outcome<TreeHeader>(undefined);
  const documentVersion = required(reading, object, '', 'projectDocumentSchemaVersion', asVersion);
  if (documentVersion !== undefined) {
    const verdict = compatibilityOf(documentVersion, 'projectDocument');
    if (verdict.kind === 'incompatible') {
      return fail(
        failure(
          'format.schema-incompatible',
          FailureKind.Unrecoverable,
          `The project was written with projectDocument schema ${String(verdict.found)}, and this version reads only ${String(verdict.current)}; before 1.0 no migration exists.`,
          {
            details: {
              schema: 'projectDocument',
              found: verdict.found,
              current: verdict.current,
              direction: verdict.direction,
            },
          },
        ),
      );
    }
  }
  const project = required(reading, object, '', 'project', asId<'ProjectId'>);
  const displayName = required(reading, object, '', 'displayName', asProjectName);
  const includes = required(reading, object, '', 'includes', asIncludes);
  const provenance = required(reading, object, '', 'provenance', asProvenance);
  return reading.outcome(
    project === undefined ||
      displayName === undefined ||
      includes === undefined ||
      provenance === undefined
      ? undefined
      : { project, displayName, ...includes, provenance },
  );
}
