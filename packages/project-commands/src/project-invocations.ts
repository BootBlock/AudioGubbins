/**
 * The invocations of the project commands that carry a nested value, built with
 * the value written as the command reads it (REQ-EDIT-073, REQ-STOR-101).
 *
 * A caller outside this package cannot write an asset record, an external
 * identity or a media source in the project document's shape, and should not
 * learn to: the import pipeline, the source change prompt and consolidation
 * build their invocations here, and so does every command whose inverse sets
 * media back, so the text a journal keeps is always the text the command reads.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { Asset, AssetId } from '@audiogubbins/domain';
import {
  canonicalJson,
  writeAssetRecord,
  writeExternalIdentity,
  writeMediaSource,
  type AssetSource,
  type ContentId,
  type ExternalSourceIdentity,
  type MediaSource,
} from '@audiogubbins/project-format';

import { ProjectCommandId } from './project-command.js';

/** Adds an asset with its source. */
export function addAssetInvocation(asset: Asset, source: AssetSource): CommandInvocation {
  return {
    commandId: ProjectCommandId.AddAsset,
    arguments: { asset: canonicalJson(writeAssetRecord({ asset, source })) },
  };
}

/** Sets where an asset's bytes are kept, whatever kept them before. */
export function setAssetMediaInvocation(asset: AssetId, media: MediaSource): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetAssetMedia,
    arguments: { assetId: asset, media: canonicalJson(writeMediaSource(media)) },
  };
}

/**
 * Relinks an external asset to another file, retained as `retainedCopy` where
 * the media store kept a copy of it.
 */
export function relinkSourceInvocation(
  asset: AssetId,
  identity: ExternalSourceIdentity,
  retainedCopy?: ContentId,
): CommandInvocation {
  return identityInvocation(ProjectCommandId.RelinkSource, asset, identity, retainedCopy);
}

/**
 * Takes the new version of the file an external asset is linked to, retained
 * as `retainedCopy` where the media store kept a copy of it.
 */
export function adoptSourceVersionInvocation(
  asset: AssetId,
  identity: ExternalSourceIdentity,
  retainedCopy?: ContentId,
): CommandInvocation {
  return identityInvocation(ProjectCommandId.AdoptSourceVersion, asset, identity, retainedCopy);
}

function identityInvocation(
  commandId: CommandInvocation['commandId'],
  asset: AssetId,
  identity: ExternalSourceIdentity,
  retainedCopy: ContentId | undefined,
): CommandInvocation {
  return {
    commandId,
    arguments: {
      assetId: asset,
      identity: canonicalJson(writeExternalIdentity(identity)),
      ...(retainedCopy === undefined ? {} : { retainedCopy }),
    },
  };
}
