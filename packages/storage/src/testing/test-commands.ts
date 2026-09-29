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
  contentIdFrom,
  storageKeyOf,
  type ContentId,
  type ProjectState,
} from '@audiogubbins/project-format';

import { silentLogger } from './silent-logger.js';

const SET_NAME = commandId('test.set-name');
const ADD_ASSET = commandId('test.add-asset');
const REMOVE_ASSET = commandId('test.remove-asset');

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

/** A bus running the test commands. */
export function testBus(): CommandBus<ProjectState> {
  const registry = createCommandRegistry<ProjectState>();
  for (const each of [setNameCommand(), addAssetCommand(), removeAssetCommand()]) {
    registry.register(each);
  }
  return createCommandBus(registry, silentLogger());
}
