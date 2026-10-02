/**
 * A command bus over project states for this package's tests: naming the
 * project, and adding and removing an asset whose bytes are managed media, each
 * undoable through an inverse invocation and deterministic over its arguments,
 * as the project commands are.
 *
 * The project commands are not a dependency of this package, which takes the
 * bus from its caller; these stand in for them with the same contract, so a
 * session is driven through a real bus without the storage knowing any command.
 */

import {
  CommandCategory,
  commandId,
  createCommandBus,
  createCommandRegistry,
  refusal,
  unchanged,
  type Command,
  type CommandBus,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  AssetOrigin,
  StandardLayouts,
  isWellFormedId,
  sampleCount,
  sampleRate,
  unsafeBrandId,
  type Asset,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  ProvenanceArgument,
  NESTED_ARGUMENT_LIMITS,
  canonicalJson,
  contentIdFrom,
  invocationProvenance,
  parseJson,
  readAssetRecord,
  readMediaSource,
  startReading,
  storageKeyOf,
  writeAssetRecord,
  writeMediaSource,
  type ContentId,
  type InvocationProvenance,
  type AssetSource,
  type MediaSource,
  type ProjectState,
} from '@audiogubbins/project-format';

import { silentLogger } from './silent-logger.js';

const SET_NAME = commandId('test.set-name');
const ADD_ASSET = commandId('test.add-asset');
const REMOVE_ASSET = commandId('test.remove-asset');
const SET_MEDIA = commandId('test.set-media');
const ADD_RECORD = commandId('test.add-record');
const REMOVE_RECORD = commandId('test.remove-record');

const RATE = expectSuccess(sampleRate(48_000));
const LENGTH = expectSuccess(sampleCount(4_800));

/** An invocation naming the project. */
export function setName(name: string): CommandInvocation {
  return { commandId: SET_NAME, arguments: { name } };
}

/** An invocation adding an asset of managed media. */
export function addAsset(asset: string, content: ContentId): CommandInvocation {
  return { commandId: ADD_ASSET, arguments: { asset, content } };
}

/** An invocation keeping an asset's bytes where `media` says, adding the asset if it is new. */
export function setMedia(asset: string, media: MediaSource): CommandInvocation {
  return {
    commandId: SET_MEDIA,
    arguments: { asset, media: canonicalJson(writeMediaSource(media)) },
  };
}

/** A content identifier made of a number. */
export function contentOf(value: number): ContentId {
  return expectSuccess(contentIdFrom(`c1-${value.toString(16).padStart(64, '0')}`));
}

function command(
  id: CommandInvocation['commandId'],
  run: Command<ProjectState>['run'],
): Command<ProjectState> {
  return {
    id,
    label: id,
    category: CommandCategory.Edit,
    undoable: true,
    availability: () => ({ available: true }),
    run,
  };
}

function setNameCommand(): Command<ProjectState> {
  return command(SET_NAME, (state, invocation) => {
    const name = invocation.arguments?.['name'];
    if (typeof name !== 'string' || name.trim() === '') {
      return refusal('test.name', 'A name is text.');
    }
    const before = state.project.displayName;
    if (name === before) return unchanged('test.same-name', 'The project has that name.');
    return {
      kind: 'applied',
      next: { ...state, project: { ...state.project, displayName: name } },
      inverse: setName(before),
      description: `Name the project ${name}`,
    };
  });
}

function assetArguments(
  invocation: CommandInvocation,
): { readonly asset: string; readonly content: ContentId } | undefined {
  const asset = invocation.arguments?.['asset'];
  const content = invocation.arguments?.['content'];
  if (typeof asset !== 'string' || !isWellFormedId(asset) || typeof content !== 'string') {
    return undefined;
  }
  const contentId = contentIdFrom(content);
  return contentId.ok ? { asset, content: contentId.value } : undefined;
}

function addAssetCommand(): Command<ProjectState> {
  return command(ADD_ASSET, (state, invocation): CommandOutcome<ProjectState> => {
    const read = assetArguments(invocation);
    if (read === undefined) return refusal('test.asset', 'An asset and its content are needed.');
    const id = unsafeBrandId<'AssetId'>(read.asset);
    if (state.project.assets.has(id)) return refusal('test.asset-taken', 'The asset exists.');
    const media = {
      kind: 'managed',
      contentId: read.content,
      byteLength: 9_600,
      mediaType: 'audio/wav',
    } as const;
    const asset: Asset = {
      id,
      displayName: `Asset ${read.asset.slice(0, 8)}`,
      origin: AssetOrigin.Imported,
      sampleRate: RATE,
      channelLayout: StandardLayouts.mono,
      length: LENGTH,
      storageKey: storageKeyOf(id, media),
      edits: [],
    };
    return {
      kind: 'applied',
      next: {
        project: { ...state.project, assets: new Map(state.project.assets).set(id, asset) },
        sources: new Map(state.sources).set(id, { media }),
      },
      inverse: { commandId: REMOVE_ASSET, arguments: { asset: read.asset, content: read.content } },
      description: 'Add an asset',
    };
  });
}

function removeAssetCommand(): Command<ProjectState> {
  return command(REMOVE_ASSET, (state, invocation): CommandOutcome<ProjectState> => {
    const read = assetArguments(invocation);
    if (read === undefined) return refusal('test.asset', 'An asset and its content are needed.');
    const id = unsafeBrandId<'AssetId'>(read.asset);
    if (!state.project.assets.has(id)) return refusal('test.asset-missing', 'No such asset.');
    const assets = new Map(state.project.assets);
    assets.delete(id);
    const sources = new Map(state.sources);
    sources.delete(id);
    return {
      kind: 'applied',
      next: { project: { ...state.project, assets }, sources },
      inverse: addAsset(read.asset, read.content),
      description: 'Remove an asset',
    };
  });
}

function mediaIn(invocation: CommandInvocation): MediaSource | undefined {
  const text = invocation.arguments?.['media'];
  if (typeof text !== 'string') return undefined;
  const parsed = parseJson(text, NESTED_ARGUMENT_LIMITS);
  if (!parsed.ok) return undefined;
  const reading = startReading();
  const media = reading.outcome(readMediaSource(reading, parsed.value, '', 'media'));
  return media.ok ? media.value : undefined;
}

function setMediaCommand(): Command<ProjectState> {
  return command(SET_MEDIA, (state, invocation): CommandOutcome<ProjectState> => {
    const asset = invocation.arguments?.['asset'];
    const media = mediaIn(invocation);
    if (typeof asset !== 'string' || !isWellFormedId(asset) || media === undefined) {
      return refusal('test.media', 'An asset and its media are needed.');
    }
    const id = unsafeBrandId<'AssetId'>(asset);
    const held = state.project.assets.get(id);
    const before = state.sources.get(id);
    const next: Asset = held ?? {
      id,
      displayName: `Asset ${asset.slice(0, 8)}`,
      origin: AssetOrigin.Imported,
      sampleRate: RATE,
      channelLayout: StandardLayouts.mono,
      length: LENGTH,
      storageKey: '',
      edits: [],
    };
    return {
      kind: 'applied',
      next: {
        project: {
          ...state.project,
          assets: new Map(state.project.assets).set(id, {
            ...next,
            storageKey: storageKeyOf(id, media),
          }),
        },
        sources: new Map(state.sources).set(id, { ...before, media }),
      },
      inverse:
        before === undefined
          ? { commandId: REMOVE_ASSET, arguments: { asset, content: contentOf(0) } }
          : setMedia(asset, before.media),
      description: 'Keep an asset elsewhere',
    };
  });
}

/** Adds a whole asset record, as the project commands' `addAssetInvocation` does. */
export function addRecord(asset: Asset, source: AssetSource): CommandInvocation {
  return {
    commandId: ADD_RECORD,
    arguments: { record: canonicalJson(writeAssetRecord({ asset, source })) },
  };
}

function addRecordCommand(): Command<ProjectState> {
  return command(ADD_RECORD, (state, invocation): CommandOutcome<ProjectState> => {
    const text = invocation.arguments?.['record'];
    const parsed = typeof text === 'string' ? parseJson(text, NESTED_ARGUMENT_LIMITS) : undefined;
    const reading = startReading();
    const record =
      parsed?.ok === true
        ? reading.outcome(readAssetRecord(reading, parsed.value, '', ''))
        : undefined;
    if (record?.ok !== true) return refusal('test.record', 'An asset record is needed.');
    const { asset, source } = record.value;
    if (state.project.assets.has(asset.id)) return refusal('test.asset-taken', 'The asset exists.');
    return {
      kind: 'applied',
      next: {
        project: { ...state.project, assets: new Map(state.project.assets).set(asset.id, asset) },
        sources: new Map(state.sources).set(asset.id, source),
      },
      inverse: { commandId: REMOVE_RECORD, arguments: { asset: asset.id } },
      description: 'Add an asset record',
    };
  });
}

function removeRecordCommand(): Command<ProjectState> {
  return command(REMOVE_RECORD, (state, invocation): CommandOutcome<ProjectState> => {
    const id = invocation.arguments?.['asset'];
    if (typeof id !== 'string' || !isWellFormedId(id)) return refusal('test.asset', 'No asset.');
    const asset = state.project.assets.get(unsafeBrandId<'AssetId'>(id));
    const source = state.sources.get(unsafeBrandId<'AssetId'>(id));
    if (asset === undefined || source === undefined) {
      return refusal('test.asset-missing', 'No such asset.');
    }
    const assets = new Map(state.project.assets);
    assets.delete(asset.id);
    const sources = new Map(state.sources);
    sources.delete(asset.id);
    return {
      kind: 'applied',
      next: { project: { ...state.project, assets }, sources },
      inverse: addRecord(asset, source),
      description: 'Remove an asset record',
    };
  });
}

/**
 * What the test commands declare of the provenance their arguments hold, as
 * the project commands declare theirs: only setting media carries any.
 */
export const TEST_INVOCATION_PROVENANCE: InvocationProvenance = invocationProvenance(
  new Map([
    [SET_NAME, {}],
    [ADD_ASSET, {}],
    [REMOVE_ASSET, {}],
    [SET_MEDIA, { media: ProvenanceArgument.MediaSource }],
    [ADD_RECORD, { record: ProvenanceArgument.AssetRecord }],
    [REMOVE_RECORD, {}],
  ]),
);

/** A bus running the test commands. */
export function testBus(): CommandBus<ProjectState> {
  const registry = createCommandRegistry<ProjectState>();
  for (const each of [
    setNameCommand(),
    addAssetCommand(),
    removeAssetCommand(),
    setMediaCommand(),
    addRecordCommand(),
    removeRecordCommand(),
  ]) {
    registry.register(each);
  }
  return createCommandBus(registry, silentLogger());
}
