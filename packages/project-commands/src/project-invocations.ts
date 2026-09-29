/**
 * The invocations of the project commands that carry a nested value, built
 * with the value written as the command reads it (REQ-EDIT-073, REQ-STOR-101).
 *
 * A caller outside this package cannot write an asset record or an external
 * identity in the project document's shape, and should not learn to: the
 * import pipeline and the source change prompt build their invocations here,
 * so the text a journal keeps is always the text the command reads.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { Asset } from '@audiogubbins/domain';
import {
  canonicalJson,
  type AssetSource,
  type ContentId,
  type ExternalSourceIdentity,
} from '@audiogubbins/project-format';

import { encodeAssetRecord, writtenIdentity } from './format-fragments.js';
import { ProjectCommandId } from './project-command.js';

/** Adds an asset with its source. */
export function addAssetInvocation(asset: Asset, source: AssetSource): CommandInvocation {
  return {
    commandId: ProjectCommandId.AddAsset,
    arguments: { asset: encodeAssetRecord(asset, source) },
  };
}

/**
 * Relinks an external asset to another file, retained as `retainedCopy` where
 * the media store kept a copy of it.
 */
export function relinkSourceInvocation(
  asset: Asset,
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
  asset: Asset,
  identity: ExternalSourceIdentity,
  retainedCopy?: ContentId,
): CommandInvocation {
  return identityInvocation(ProjectCommandId.AdoptSourceVersion, asset, identity, retainedCopy);
}

function identityInvocation(
  commandId: CommandInvocation['commandId'],
  asset: Asset,
  identity: ExternalSourceIdentity,
  retainedCopy: ContentId | undefined,
): CommandInvocation {
  return {
    commandId,
    arguments: {
      assetId: asset.id,
      identity: canonicalJson(writtenIdentity(asset, identity)),
      ...(retainedCopy === undefined ? {} : { retainedCopy }),
    },
  };
}
