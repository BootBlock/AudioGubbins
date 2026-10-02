/**
 * A project's header: what the list of projects shows without opening one, its
 * name, when it was made, and whether it has been deleted (REQ-STOR-102).
 *
 * The name is the catalogue's copy of the name the project's state holds, which
 * is authoritative: the session writes the header again whenever the state's
 * name changes, so the list agrees with the project. Deleting is soft: the flag
 * hides the project, and everything it holds stays until an explicit purge. A
 * purge marks the header before it removes anything, and removes the header
 * last, so a project whose purge a crash cut short says so: its files may be
 * part gone, so it can no longer be restored, only purged again. The header
 * changes in place, so it is a pair (`generational-pair.ts`). A project brought
 * in from a bundle or an unpacked tree says so, and which project it was
 * brought from (REQ-STOR-103).
 */

import type { ProjectId } from '@audiogubbins/domain';
import {
  asId,
  objectOf,
  optional,
  pathOf,
  presentMembers,
  required,
  textConverter,
  type Converter,
  type JsonObject,
} from '@audiogubbins/project-format';

import { RecordKind } from './checked-records.js';
import type { Generational, PairFiles } from './generational-pair.js';
import { asCountingNumber, asWholeNumber } from './record-values.js';
import type { ProjectPaths } from './storage-layout.js';

/** A project's header. */
export interface ProjectHeader extends Generational {
  readonly id: ProjectId;
  readonly name: string;

  /** When the project was made, in milliseconds since the epoch. */
  readonly created: number;

  /** When the project was deleted, where it has been and not restored. */
  readonly deleted?: number;

  /** When a purge of the deleted project began, where one has and was cut short. */
  readonly purging?: number;

  /** Where the project was brought in from a bundle or a tree: the project it was, and when. */
  readonly imported?: ImportOrigin;
}

/** The project a project was imported as a copy or a continuation of, and when. */
export interface ImportOrigin {
  readonly from: ProjectId;
  readonly at: number;
}

const HEADER_MEMBERS: ReadonlySet<string> = new Set([
  'generation',
  'id',
  'name',
  'created',
  'deleted',
  'purging',
  'imported',
]);
const IMPORTED_MEMBERS: ReadonlySet<string> = new Set(['from', 'at']);

/** The longest name, as the project document holds one. */
const asName = textConverter({ maximumLength: 1_024 });

/** Writes a header. */
export function writeHeader(header: ProjectHeader): JsonObject {
  return presentMembers({
    generation: header.generation,
    id: header.id,
    name: header.name,
    created: header.created,
    deleted: header.deleted,
    purging: header.purging,
    imported:
      header.imported === undefined
        ? undefined
        : { from: header.imported.from, at: header.imported.at },
  });
}

/** Reads a header. */
const readHeader: Converter<ProjectHeader> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, HEADER_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const generation = required(reading, object, at, 'generation', asCountingNumber);
  const id = required(reading, object, at, 'id', asId<'ProjectId'>);
  const name = required(reading, object, at, 'name', asName);
  const created = required(reading, object, at, 'created', asWholeNumber);
  const deleted = optional(reading, object, at, 'deleted', asWholeNumber);
  const purging = optional(reading, object, at, 'purging', asWholeNumber);
  const imported = optional(reading, object, at, 'imported', asImportOrigin);
  if (generation === undefined || id === undefined || name === undefined || created === undefined) {
    return undefined;
  }
  return {
    generation,
    id,
    name,
    created,
    ...(deleted === undefined ? {} : { deleted }),
    ...(purging === undefined ? {} : { purging }),
    ...(imported === undefined ? {} : { imported }),
  };
};

const asImportOrigin: Converter<ImportOrigin> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, IMPORTED_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const from = required(reading, object, at, 'from', asId<'ProjectId'>);
  const time = required(reading, object, at, 'at', asWholeNumber);
  return from === undefined || time === undefined ? undefined : { from, at: time };
};

/** The two files a project's header is kept in. */
export function headerFiles(paths: ProjectPaths): PairFiles<ProjectHeader> {
  return {
    path: (slot) => paths.header(slot),
    kind: RecordKind.ProjectHeader,
    convert: readHeader,
  };
}
