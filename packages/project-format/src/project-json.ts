/**
 * The project document: the versioned, documented JSON form of a project state
 * (REQ-STOR-026), read back only through full runtime validation
 * (REQ-EXEC-136.12) and only at this build's schema version (REQ-STOR-052).
 *
 * The document is an object of four members:
 *
 * - `format`: always `audiogubbins.project`.
 * - `schemaVersion`: the `projectDocument` schema version that wrote it.
 * - `project`: every field of the domain project, each entity list sorted by
 *   identifier.
 * - `sources`: one entry per asset, sorted by asset: its media and, where
 *   kept, its provenance.
 *
 * Reading refuses a document whose version this build does not write before
 * reading anything else, then reads every member with the domain's own
 * constructors and checks every reference, reporting all it finds.
 */

import { flatMapResult, type DomainResult } from '@audiogubbins/domain';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import type { Digest } from './byte-ports.js';
import {
  canonicalJson,
  prettyCanonicalJson,
  type JsonObject,
  type JsonValue,
} from './canonical-json.js';
import { readCompatibleHeader } from './compatibility.js';
import { fingerprintOf } from './content-hashing.js';
import type { StateFingerprint } from './content-identity.js';
import { objectOf, required, startReading } from './document-reading.js';
import { parseJson, type JsonLimits } from './json-parsing.js';
import { asProject } from './project-reading.js';
import type { ProjectState } from './project-state.js';
import { writeProject, writeSources } from './project-writing.js';
import { sourcesConverter } from './source-reading.js';

/** The format name a project document carries. */
export const PROJECT_DOCUMENT_FORMAT = 'audiogubbins.project';

/**
 * The bounds a project document's text is read within.
 *
 * 2^28 code units, a quarter of a gibibyte and below the longest string every
 * engine builds, holds a project of hundreds of thousands of entities; the
 * document nests nine levels deep, and 32 leaves room without letting a hostile
 * file recurse.
 */
const PROJECT_DOCUMENT_LIMITS: JsonLimits = { maximumLength: 2 ** 28, maximumDepth: 32 };

const DOCUMENT_MEMBERS: ReadonlySet<string> = new Set([
  'format',
  'schemaVersion',
  'project',
  'sources',
]);

/** The document of a state, as a JSON value. */
export function writeProjectDocument(state: ProjectState): JsonObject {
  return {
    format: PROJECT_DOCUMENT_FORMAT,
    schemaVersion: SCHEMA_VERSIONS.projectDocument,
    project: writeProject(state.project),
    sources: writeSources(state.sources),
  };
}

/**
 * The state a document holds, or every problem with it.
 *
 * A document of another schema version is refused with
 * `format.schema-incompatible` and read no further.
 */
export function readProjectDocument(value: JsonValue): DomainResult<ProjectState> {
  const header = readCompatibleHeader(value, PROJECT_DOCUMENT_FORMAT, 'projectDocument');
  if (!header.ok) return header;

  const reading = startReading();
  const object = objectOf(reading, value, '', '', DOCUMENT_MEMBERS);
  if (object === undefined) return reading.outcome<ProjectState>(undefined);

  const project = required(reading, object, '', 'project', asProject);
  const sources = required(reading, object, '', 'sources', sourcesConverter(project?.assets));
  return reading.outcome(
    project === undefined || sources === undefined ? undefined : { project, sources },
  );
}

/** The document of a state as the text written to a file: pretty canonical JSON. */
export function serialiseProjectDocument(state: ProjectState): string {
  return prettyCanonicalJson(writeProjectDocument(state));
}

/** The state a document's text holds, or why it cannot be read. */
export function parseProjectDocument(text: string): DomainResult<ProjectState> {
  return flatMapResult(parseJson(text, PROJECT_DOCUMENT_LIMITS), readProjectDocument);
}

/**
 * The fingerprint of a state: the digest of its document's compact canonical
 * text, so two equal states share one and any difference changes it.
 */
export async function stateFingerprintOf(
  state: ProjectState,
  digest: Digest,
): Promise<StateFingerprint> {
  return await fingerprintOf(canonicalJson(writeProjectDocument(state)), digest);
}
