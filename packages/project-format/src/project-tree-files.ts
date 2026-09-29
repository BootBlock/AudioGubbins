/**
 * The files of a project's unpacked tree as they are read: placing each by its
 * path, reading one as JSON, and recording each problem at the file it is in
 * (REQ-STOR-103, REQ-EXEC-136.12).
 *
 * A problem found in a value put back together from several files is placed at
 * the file its part of the value came from, so a person fixing a tree by hand
 * is sent to the file to fix.
 */

import {
  FailureKind,
  fail,
  failure,
  flatMapResult,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import { compareCodeUnits, isJsonObject, memberOf, type JsonValue } from './canonical-json.js';
import { startReading, type Converter } from './document-reading.js';
import { parseJson, type JsonLimits } from './json-parsing.js';
import { readTreeHeader, type TreeHeader } from './project-tree-header.js';
import { TREE_HEADER_PATH, placeOf, type TreePlace } from './project-tree-layout.js';
import { decodeUtf8 } from './utf8.js';

/** A file of a tree, by its path and length. */
export interface TreeListedFile {
  readonly path: string;
  readonly size: number;
}

/** The files of a tree, and a way to read one of its metadata files whole. */
export interface ProjectTreeListing {
  readonly files: readonly TreeListedFile[];

  /** The bytes of a file, or why they cannot be had or trusted. */
  read(path: string, signal?: AbortSignal): Promise<DomainResult<Uint8Array<ArrayBuffer>>>;
}

/** The longest metadata file read, in bytes: the longest a project's text may be. */
const LONGEST_METADATA = 2 ** 28;

const TREE_JSON_LIMITS: JsonLimits = { maximumLength: LONGEST_METADATA, maximumDepth: 32 };

/** An item of a list within a value: the list's path and the item's index. */
const LIST_ITEM = /^([A-Za-z.]*)\[([0-9]+)\]/u;

const HISTORY_PLACES: ReadonlySet<TreePlace['kind']> = new Set([
  'cursor',
  'branch-names',
  'retention',
  'comparison',
  'node',
  'snapshot',
  'state',
]);

/** A file of the tree and what its path says it holds. */
interface Placed<TPlace extends TreePlace = TreePlace> {
  readonly path: string;
  readonly size: number;
  readonly place: TPlace;
}

/** A tree being read: its files by place, and every problem found so far. */
export class TreeReading {
  readonly problems: DomainFailure[] = [];
  private readonly placed: Placed[] = [];
  private readonly listing: ProjectTreeListing;
  private readonly signal: AbortSignal | undefined;

  constructor(listing: ProjectTreeListing, signal: AbortSignal | undefined) {
    this.listing = listing;
    this.signal = signal;
  }

  /** The header, or why the tree is not read further. */
  async header(): Promise<DomainResult<TreeHeader>> {
    const size = this.listing.files.find(({ path }) => path === TREE_HEADER_PATH)?.size;
    if (size === undefined) return fail(treeProblem('tree.missing-file', TREE_HEADER_PATH));
    return flatMapResult(await this.json(TREE_HEADER_PATH, size), readTreeHeader);
  }

  /** Places every file, refusing those no tree of this header holds. */
  placeEvery(header: TreeHeader): void {
    const seen = new Set<string>();
    for (const { path, size } of this.listing.files) {
      const place = placeOf(path);
      if (seen.has(path)) this.refuse('tree.duplicate-file', path);
      else if (place === undefined) this.refuse('tree.unknown-file', path);
      else if (
        (HISTORY_PLACES.has(place.kind) && !header.history) ||
        (place.kind === 'cache' && !header.caches)
      ) {
        this.refuse('tree.unexpected-file', path);
      } else this.placed.push({ path, size, place });
      seen.add(path);
    }
  }

  /** The files of one kind, in path order. */
  ofKind<TKind extends TreePlace['kind']>(
    kind: TKind,
  ): readonly Placed<Extract<TreePlace, { kind: TKind }>>[] {
    return this.placed
      .filter(
        (file): file is Placed<Extract<TreePlace, { kind: TKind }>> => file.place.kind === kind,
      )
      .sort((one, other) => compareCodeUnits(one.path, other.path));
  }

  /** The value of the one file of a kind, refused where the tree lacks it. */
  async single(kind: TreePlace['kind'], path: string): Promise<JsonValue | undefined> {
    const [file] = this.ofKind(kind);
    if (file === undefined) {
      this.refuse('tree.missing-file', path);
      return undefined;
    }
    return await this.valueOf(file);
  }

  /** The JSON a file holds, its problems recorded where it holds none. */
  async valueOf(file: Placed): Promise<JsonValue | undefined> {
    const value = await this.json(file.path, file.size);
    if (value.ok) return value.value;
    this.problems.push(...value.failures.map((cause) => atFile(cause, file.path)));
    return undefined;
  }

  /** The value a converter reads from a file, its problems recorded. */
  async converted<TValue>(file: Placed, convert: Converter<TValue>): Promise<TValue | undefined> {
    const value = await this.valueOf(file);
    return value === undefined ? undefined : this.convertedValue(value, file.path, convert);
  }

  /** The value a converter reads from JSON of a file, its problems recorded. */
  convertedValue<TValue>(
    value: JsonValue,
    path: string,
    convert: Converter<TValue>,
  ): TValue | undefined {
    const reading = startReading();
    const outcome = reading.outcome(convert(reading, value, '', ''));
    if (outcome.ok) return outcome.value;
    this.problems.push(...outcome.failures.map((cause) => atFile(cause, path)));
    return undefined;
  }

  /**
   * Records problems found in a value put back together from files, each at the
   * file its place in the value came from: an item of one of `lists`, or one of
   * `members`, and otherwise the header, which holds the rest.
   */
  locate(
    failures: readonly DomainFailure[],
    places: {
      readonly lists: ReadonlyMap<string, readonly string[]>;
      readonly members: ReadonlyMap<string, string>;
    },
  ): void {
    for (const cause of failures) {
      const at = cause.details?.['at'];
      const item = typeof at === 'string' ? LIST_ITEM.exec(at) : null;
      const listed = places.lists.get(item?.[1] ?? '')?.[Number(item?.[2])];
      const member = [...places.members].find(
        ([key]) =>
          typeof at === 'string' &&
          (at === key || at.startsWith(`${key}.`) || at.startsWith(`${key}[`)),
      )?.[1];
      this.problems.push(atFile(cause, listed ?? member ?? TREE_HEADER_PATH));
    }
  }

  refuse(code: string, path: string): void {
    this.problems.push(treeProblem(code, path));
  }

  private async json(path: string, size: number): Promise<DomainResult<JsonValue>> {
    this.signal?.throwIfAborted();
    if (size > LONGEST_METADATA) return fail(treeProblem('tree.file-too-large', path));
    const bytes = await this.listing.read(path, this.signal);
    if (!bytes.ok) return bytes;
    return flatMapResult(decodeUtf8(bytes.value), (text) => parseJson(text, TREE_JSON_LIMITS));
  }
}

/**
 * The values of files that each name what they hold, each checked to hold what
 * its name says: `member` of each must be the identifier `nameOf` its file.
 */
export async function namedValues<TPlace extends TreePlace>(
  tree: TreeReading,
  files: readonly Placed<TPlace>[],
  member: string,
  nameOf: (file: Placed<TPlace>) => string,
): Promise<{ readonly values: readonly JsonValue[]; readonly paths: readonly string[] }> {
  const values: JsonValue[] = [];
  const paths: string[] = [];
  for (const file of files) {
    const value = await tree.valueOf(file);
    if (value === undefined) continue;
    if (isJsonObject(value) && memberOf(value, member) === nameOf(file)) {
      values.push(value);
      paths.push(file.path);
    } else tree.refuse('tree.misnamed-file', file.path);
  }
  return { values, paths };
}

/** The summaries of the tree's own refusals, by code. */
const SUMMARIES: ReadonlyMap<string, string> = new Map([
  ['tree.missing-file', 'The tree lacks a file every project tree has.'],
  ['tree.duplicate-file', 'The tree lists a file twice.'],
  ['tree.unknown-file', 'The tree holds a file no project tree has.'],
  ['tree.unexpected-file', 'The tree holds a file its header says it does not.'],
  ['tree.file-too-large', 'A metadata file is longer than any project’s text may be.'],
  ['tree.misnamed-file', 'A file holds something other than what its name says.'],
  ['tree.foreign-state', 'A kept state is of another project than the tree’s.'],
  ['tree.state-mismatch', 'A kept state is not the state its name promises.'],
  ['tree.snapshot-state-missing', 'A snapshot’s state is not in the tree.'],
  ['tree.cursor-state-mismatch', 'The project’s state is not the one its history is at.'],
]);

function treeProblem(code: string, path: string): DomainFailure {
  return failure(code, FailureKind.IntegrityViolation, SUMMARIES.get(code) ?? code, {
    details: { file: path },
  });
}

/** A problem found inside a file, placed at the file. */
export function atFile(cause: DomainFailure, path: string): DomainFailure {
  return failure(cause.code, cause.kind, cause.summary, {
    details: { ...cause.details, file: path },
    ...(cause.cause === undefined ? {} : { cause: cause.cause }),
  });
}
