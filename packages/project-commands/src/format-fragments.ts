/**
 * The parts of a project state a command carries in its arguments, written and
 * read in the project document's own shapes: one asset with its source, one
 * media source, and a name.
 *
 * An invocation's arguments are primitives (REQ-EDIT-073), so a nested value
 * travels as one string of compact canonical JSON. It is the value the project
 * document writes, and it is read back by the project document's reader, never
 * by a second one here: the part is placed in a document that holds nothing
 * else and the whole is read by `readProjectDocument`, so a part a command
 * accepts is exactly a part the format accepts (REQ-EXEC-136.12, REQ-STOR-101).
 * A refusal names the place of the problem in the argument, not in the holder.
 */

import {
  FailureKind,
  createProject,
  fail,
  failure,
  flatMapResult,
  succeed,
  unsafeBrandId,
  type Asset,
  type AssetId,
  type DomainFailure,
  type DomainResult,
  type ProjectSettings,
} from '@audiogubbins/domain';
import {
  DEFAULT_SOURCE_CHANGE_POLICY,
  canonicalJson,
  isJsonArray,
  isJsonObject,
  memberOf,
  parseJson,
  readProjectDocument,
  writeProjectDocument,
  type AssetSource,
  type ExternalSourceIdentity,
  type JsonLimits,
  type JsonObject,
  type JsonValue,
  type MediaSource,
  type ProjectState,
} from '@audiogubbins/project-format';

/**
 * The bounds an argument's text is read within: far past the longest asset
 * record, whose names are bounded at a kibibyte and whose path at four, and as
 * deep as a record nests with room to spare.
 */
const ARGUMENT_LIMITS: JsonLimits = { maximumLength: 65_536, maximumDepth: 8 };

/**
 * The project a part is placed in to be read. Its identifier and name are never
 * seen: only the part is taken out of what is read.
 */
const HOLDER_ID = unsafeBrandId<'ProjectId'>('00000000');

/**
 * Where a problem the reader finds lies in the argument, by where it lies in
 * the holding document, longest first so the most exact place is named.
 */
const ARGUMENT_PLACES: readonly (readonly [string, string])[] = [
  ['sources[0].media.identity', 'identity'],
  ['sources[0].media', 'media'],
  ['sources[0]', 'source'],
  ['sources', 'source'],
  ['project.assets[0]', 'asset'],
  ['project.displayName', 'name'],
];

/** One asset and its source, as `project.add-asset` carries them. */
export interface AssetRecord {
  readonly asset: Asset;
  readonly source: AssetSource;
}

const RECORD_MEMBERS: ReadonlySet<string> = new Set(['asset', 'source']);

/** The text of an argument, as a JSON value, or why it is not JSON. */
export function parseArgument(text: string): DomainResult<JsonValue> {
  return parseJson(text, ARGUMENT_LIMITS);
}

/**
 * The argument `project.add-asset` carries for an asset and its source: an
 * object of the asset and its source entry, each as the document writes it.
 */
export function encodeAssetRecord(asset: Asset, source: AssetSource): string {
  const document = holdingDocument(settingsOf(asset), [asset], new Map([[asset.id, source]]));
  return canonicalJson({
    asset: onlyItem(objectMember(document, 'project'), 'assets'),
    source: onlyItem(document, 'sources'),
  });
}

/** The asset and source an argument of {@link encodeAssetRecord}'s shape holds. */
export function readAssetRecord(
  settings: ProjectSettings,
  value: JsonValue,
): DomainResult<AssetRecord> {
  if (!isJsonObject(value)) {
    return fail(
      failure('asset.record-malformed', FailureKind.Rejected, 'The asset record is not an object.'),
    );
  }
  const unknown = Object.keys(value).find((member) => !RECORD_MEMBERS.has(member));
  const asset = memberOf(value, 'asset');
  const source = memberOf(value, 'source');
  if (unknown !== undefined || asset === undefined || source === undefined) {
    return fail(
      failure(
        'asset.record-malformed',
        FailureKind.Rejected,
        'The asset record holds exactly an asset and its source.',
      ),
    );
  }
  return mapRead(readHolding(settings, undefined, [asset], [source]), (state) => {
    const [read] = state.project.assets.values();
    const readSource = read === undefined ? undefined : state.sources.get(read.id);
    return read === undefined || readSource === undefined
      ? undefined
      : { asset: read, source: readSource };
  });
}

/** The media source as the document writes it, for an argument. */
export function writtenMedia(asset: Asset, media: MediaSource): JsonObject {
  const document = holdingDocument(settingsOf(asset), [asset], new Map([[asset.id, { media }]]));
  const written = memberOf(onlyItem(document, 'sources'), 'media');
  if (written === undefined || !isJsonObject(written)) {
    throw new Error('The project document wrote a source without its media.');
  }
  return written;
}

/** The identity of an external file as the document writes it, for an argument. */
export function writtenIdentity(asset: Asset, identity: ExternalSourceIdentity): JsonObject {
  const media = writtenMedia(asset, {
    kind: 'external',
    identity,
    policy: DEFAULT_SOURCE_CHANGE_POLICY,
  });
  const written = memberOf(media, 'identity');
  if (written === undefined || !isJsonObject(written)) {
    throw new Error('The project document wrote external media without its identity.');
  }
  return written;
}

/** The media an argument written by {@link writtenMedia} holds, for `asset`. */
export function readMedia(
  settings: ProjectSettings,
  asset: Asset,
  value: JsonValue,
): DomainResult<MediaSource> {
  // The reader checks the asset's storage key against the key the media gives,
  // so the asset is offered with the key sound media of this kind would give.
  // A wrong guess is only ever made for media the reader refuses anyway.
  const written = writtenAsset(asset);
  const holder = { ...written, storageKey: expectedStorageKey(asset.id, value) };
  return mapRead(
    readHolding(settings, undefined, [holder], [{ assetId: asset.id, media: value }]),
    (state) => state.sources.get(asset.id)?.media,
  );
}

/**
 * The name, if the document holds it as a project's name. Asked of the
 * project's slot, whose rule an asset's name shares, so one bound applies.
 */
export function readName(settings: ProjectSettings, name: string): DomainResult<string> {
  return mapRead(readHolding(settings, name, [], []), (state) => state.project.displayName);
}

/** The settings a holding project takes from the asset it holds. */
function settingsOf(asset: Asset): ProjectSettings {
  return { sampleRate: asset.sampleRate, channelLayout: asset.channelLayout };
}

/** The asset as the document writes it. */
function writtenAsset(asset: Asset): JsonObject {
  const document = holdingDocument(settingsOf(asset), [asset], new Map());
  return onlyItem(objectMember(document, 'project'), 'assets');
}

/**
 * The key the reader will expect of an asset holding `media`, were it sound:
 * the one `storageKeyOf` gives for managed media of that content, or for
 * external media.
 */
function expectedStorageKey(assetId: AssetId, media: JsonValue): string {
  const contentId =
    isJsonObject(media) && memberOf(media, 'kind') === 'managed'
      ? memberOf(media, 'contentId')
      : undefined;
  return typeof contentId === 'string' ? `content:${contentId}` : `external:${assetId}`;
}

/** The document of a project holding only `assets` and their `sources`. */
function holdingDocument(
  settings: ProjectSettings,
  assets: readonly Asset[],
  sources: ReadonlyMap<AssetId, AssetSource>,
): JsonObject {
  const project = createProject(HOLDER_ID, '', settings);
  return writeProjectDocument({
    project: { ...project, assets: new Map(assets.map((asset) => [asset.id, asset])) },
    sources,
  });
}

/** Reads the parts placed in a holding document, through the format's reader. */
function readHolding(
  settings: ProjectSettings,
  name: string | undefined,
  assets: readonly JsonValue[],
  sources: readonly JsonValue[],
): DomainResult<ProjectState> {
  const document = holdingDocument(settings, [], new Map());
  const project = objectMember(document, 'project');
  const holding: JsonObject = {
    ...document,
    project: { ...project, ...(name === undefined ? {} : { displayName: name }), assets },
    sources,
  };
  const read = readProjectDocument(holding);
  return read.ok ? read : fail(...placed(read.failures));
}

/**
 * The part taken out of a state read from a holding document, or the reading's
 * refusal. A state read without its part is the reader's fault, and throws.
 */
function mapRead<TValue>(
  read: DomainResult<ProjectState>,
  take: (state: ProjectState) => TValue | undefined,
): DomainResult<TValue> {
  return flatMapResult(read, (state) => {
    const value = take(state);
    if (value === undefined) {
      throw new Error('The project document read a holding document without its part.');
    }
    return succeed(value);
  });
}

/** Each failure, with its place said as a place in the argument. */
function placed(
  failures: readonly [DomainFailure, ...DomainFailure[]],
): [DomainFailure, ...DomainFailure[]] {
  const [first, ...rest] = failures.map((problem) => {
    const at = problem.details?.['at'];
    if (typeof at !== 'string') return problem;
    return { ...problem, details: { ...problem.details, at: argumentPlace(at) } };
  });
  if (first === undefined) throw new Error('A failed reading had no failure.');
  return [first, ...rest];
}

/** A place in the holding document, as a place in the argument. */
function argumentPlace(at: string): string {
  for (const [held, argument] of ARGUMENT_PLACES) {
    if (at === held || at.startsWith(`${held}.`) || at.startsWith(`${held}[`)) {
      return `${argument}${at.slice(held.length)}`;
    }
  }
  return at;
}

function objectMember(object: JsonObject, key: string): JsonObject {
  const member = memberOf(object, key);
  if (member === undefined || !isJsonObject(member)) {
    throw new Error(`The project document wrote no object "${key}".`);
  }
  return member;
}

/** The one item of the list `key` a holding document wrote. */
function onlyItem(object: JsonObject, key: string): JsonObject {
  const list = memberOf(object, key);
  const [item] = list !== undefined && isJsonArray(list) ? list : [];
  if (item === undefined || !isJsonObject(item)) {
    throw new Error(`The project document wrote no item in "${key}".`);
  }
  return item;
}
