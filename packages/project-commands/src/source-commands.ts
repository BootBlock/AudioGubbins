/**
 * Where an asset's bytes come from, and what happens when an external file
 * changes (REQ-STOR-053, REQ-STOR-099, REQ-STOR-104).
 *
 * `project.set-asset-media` replaces an asset's media outright, keeping its
 * storage key derived from the media; it is the inverse of every command here
 * but the policy's, and what the storage layer runs where no intention names
 * the change. The others are the intentions the source change prompt offers,
 * each refusing what does not apply:
 *
 * - relinking points an external asset at another file;
 * - adopting takes a new version of the same file, told apart from another
 *   file by the kept handle and relative path (REQ-STOR-104);
 * - freezing switches the asset to the retained managed copy of the version
 *   its link last saw. Nothing of the link is kept in the state afterwards; it
 *   survives only in the history, whose inverse carries the whole prior media.
 *
 * A relink or an adoption says which managed copy, if any, the new version is
 * retained as. With none given the asset keeps none, because the old copy is
 * of content the new identity no longer describes.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type Command,
  type CommandInvocation,
  type CommandOutcome,
  type RefusedOutcome,
} from '@audiogubbins/commands';
import {
  SourceChangePolicy,
  canonicalJson,
  readMediaSource,
  writeMediaSource,
  type ExternalSourceIdentity,
  type JsonObject,
  type ManagedMedia,
  type MediaSource,
  type ProjectState,
} from '@audiogubbins/project-format';

import {
  jsonArgument,
  optionalTextArgument,
  readNested,
  refusedBy,
  targetAsset,
  textArgument,
  type TargetAsset,
} from './invocation-arguments.js';
import {
  ProjectCommandId,
  applied,
  assetAvailability,
  projectCommand,
  quoted,
} from './project-command.js';
import { setAssetMediaInvocation } from './project-invocations.js';
import { withMedia } from './state-edits.js';

/** What the undo menu calls choosing each policy, for an asset's quoted name. */
const POLICY_DESCRIPTIONS: Readonly<Record<SourceChangePolicy, (name: string) => string>> = {
  [SourceChangePolicy.Prompt]: (name) => `Ask before using a changed file for ${name}`,
  [SourceChangePolicy.Adopt]: (name) => `Use a changed file for ${name} without asking`,
  [SourceChangePolicy.Freeze]: (name) => `Keep ${name} on its retained copy when its file changes`,
};

/** Which way a new identity is taken: as another file, or as the same one. */
type IdentityChange = 'relink' | 'adopt';

/** The commands that change an asset's source. */
export function sourceCommands(): readonly Command<ProjectState>[] {
  return [
    projectCommand({
      id: ProjectCommandId.SetSourcePolicy,
      label: 'Set what happens when a linked file changes',
      category: CommandCategory.Edit,
      description:
        'Chooses whether a change to a linked file is asked about, used, or set aside for the retained copy.',
      availability: assetAvailability,
      run: setPolicy,
    }),
    projectCommand({
      id: ProjectCommandId.SetAssetMedia,
      label: 'Set where an asset is kept',
      category: CommandCategory.Edit,
      description: 'Replaces where an asset’s audio is found, which is how undo restores it.',
      availability: assetAvailability,
      run: setMedia,
    }),
    projectCommand({
      id: ProjectCommandId.RelinkSource,
      label: 'Relink an asset to another file',
      category: CommandCategory.Edit,
      description: 'Points a linked asset at another file, such as one that was moved.',
      availability: assetAvailability,
      run: (state, invocation) => changeIdentity(state, invocation, 'relink'),
    }),
    projectCommand({
      id: ProjectCommandId.AdoptSourceVersion,
      label: 'Use the new version of a linked file',
      category: CommandCategory.Edit,
      description: 'Takes the changed version of the file an asset is linked to.',
      availability: assetAvailability,
      run: (state, invocation) => changeIdentity(state, invocation, 'adopt'),
    }),
    projectCommand({
      id: ProjectCommandId.FreezeSource,
      label: 'Keep a linked asset as a copy in the project',
      category: CommandCategory.Edit,
      description:
        'Stops following a linked file and keeps the retained copy of the version the project last saw.',
      availability: assetAvailability,
      run: freeze,
    }),
  ];
}

function setPolicy(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const target = targetAsset(state, invocation);
  if (!target.ok) return refusedBy(target);
  const text = textArgument(invocation, 'policy');
  if (!text.ok) return refusedBy(text);
  const { asset, source } = target.value;
  const name = quoted(asset.displayName);

  const policy = Object.values(SourceChangePolicy).find((known) => known === text.value);
  if (policy === undefined) {
    return refusal(
      'source.policy-unknown',
      `There is no policy “${text.value}”. Choose one of ${Object.values(SourceChangePolicy).join(', ')}.`,
    );
  }
  const media = source.media;
  if (media.kind !== 'external') {
    return refusal('source.not-external', `${name} is kept in the project, not linked to a file.`);
  }
  if (policy === media.policy) {
    return unchanged('source.policy-unchanged', `${name} already has that policy.`);
  }
  if (policy === SourceChangePolicy.Freeze && media.retainedCopy === undefined) {
    return refusal(
      'source.freeze-without-retained-copy',
      `${name} has no retained copy of its file, so there is no version to keep playing.`,
    );
  }
  return applied(
    withMedia(state, asset, source, { ...media, policy }),
    {
      commandId: ProjectCommandId.SetSourcePolicy,
      arguments: { assetId: asset.id, policy: media.policy },
    },
    POLICY_DESCRIPTIONS[policy](name),
  );
}

function setMedia(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const target = targetAsset(state, invocation);
  if (!target.ok) return refusedBy(target);
  const value = jsonArgument(invocation, 'media');
  if (!value.ok) return refusedBy(value);
  const { asset, source } = target.value;
  const media = readNested(readMediaSource, value.value, 'media');
  if (!media.ok) return refusedBy(media);
  if (sameMedia(source.media, media.value)) {
    return unchanged(
      'source.media-unchanged',
      `${quoted(asset.displayName)} is already kept that way.`,
    );
  }
  return changedMedia(
    state,
    target.value,
    media.value,
    `Change where ${quoted(asset.displayName)} is kept`,
  );
}

function changeIdentity(
  state: ProjectState,
  invocation: CommandInvocation,
  change: IdentityChange,
): CommandOutcome<ProjectState> {
  const target = targetAsset(state, invocation);
  if (!target.ok) return refusedBy(target);
  const identity = jsonArgument(invocation, 'identity');
  if (!identity.ok) return refusedBy(identity);
  const retainedCopy = optionalTextArgument(invocation, 'retainedCopy');
  if (!retainedCopy.ok) return refusedBy(retainedCopy);
  const { asset, source } = target.value;
  const name = quoted(asset.displayName);

  const current = source.media;
  if (current.kind !== 'external') {
    return refusal('source.not-external', `${name} is kept in the project, not linked to a file.`);
  }

  // The new identity is read as the media it makes, so the format's reader
  // checks it and the retained copy together with the policy they must meet.
  // The media is read as a whole, so a problem is placed at the argument's
  // own name: `identity` and within it, or `retainedCopy`.
  const { retainedCopy: _replaced, ...kept } = writeMediaSource(current);
  const candidate: JsonObject = {
    ...kept,
    identity: identity.value,
    ...(retainedCopy.value === undefined ? {} : { retainedCopy: retainedCopy.value }),
  };
  const media = readNested(readMediaSource, candidate, '');
  if (!media.ok) return refusedBy(media);
  if (media.value.kind !== 'external') {
    throw new Error('A linked source was read back as one kept in the project.');
  }
  if (sameMedia(current, media.value)) {
    return unchanged('source.identity-unchanged', `${name} is already linked that way.`);
  }

  const problem = locationProblem(change, current.identity, media.value.identity, name);
  if (problem !== undefined) return problem;
  return changedMedia(
    state,
    target.value,
    media.value,
    change === 'relink' ? `Relink ${name} to another file` : `Use the new version of ${name}`,
  );
}

/**
 * Why a new identity cannot be taken the way asked: a relink must name another
 * file, and an adoption the same one, known by its kept handle and relative
 * path. A file known by neither cannot be told from another file in its place
 * (REQ-STOR-104), so it can be relinked but never adopted.
 */
function locationProblem(
  change: IdentityChange,
  before: ExternalSourceIdentity,
  after: ExternalSourceIdentity,
  name: string,
): RefusedOutcome | undefined {
  const known = before.handleKey !== undefined || before.relativePath !== undefined;
  const same = before.handleKey === after.handleKey && before.relativePath === after.relativePath;
  if (change === 'relink') {
    return known && same
      ? refusal(
          'source.relink-same-file',
          `${name} is already linked to that file. Use its new version instead.`,
        )
      : undefined;
  }
  if (!known) {
    return refusal(
      'source.location-unknown',
      `${name} is linked to a file known by no kept handle or path, so a new version cannot be told from another file. Relink it instead.`,
    );
  }
  return same
    ? undefined
    : refusal(
        'source.adopt-other-file',
        `That is another file, not a new version of the one ${name} is linked to. Relink it instead.`,
      );
}

function freeze(state: ProjectState, invocation: CommandInvocation): CommandOutcome<ProjectState> {
  const target = targetAsset(state, invocation);
  if (!target.ok) return refusedBy(target);
  const { asset, source } = target.value;
  const name = quoted(asset.displayName);

  const current = source.media;
  if (current.kind !== 'external') {
    return refusal('source.not-external', `${name} is kept in the project, not linked to a file.`);
  }
  const { identity, retainedCopy } = current;
  if (retainedCopy === undefined) {
    return refusal(
      'source.no-retained-copy',
      `${name} has no retained copy of its file to keep in the project.`,
    );
  }
  // The retained copy is of the content the identity describes, which is what
  // gives its length and type. Where the identity names other content, that
  // description is of something else.
  if (identity.contentId !== undefined && identity.contentId !== retainedCopy) {
    return refusal(
      'source.retained-copy-stale',
      `The retained copy of ${name} is not the version its link last saw. Relink the asset or use its new version first.`,
    );
  }
  const managed: ManagedMedia = {
    kind: 'managed',
    contentId: retainedCopy,
    byteLength: identity.byteLength,
    mediaType: identity.mediaType,
  };
  return changedMedia(state, target.value, managed, `Keep ${name} as a copy in the project`);
}

/** The state with the asset's media replaced, undone by setting the old media back. */
function changedMedia(
  state: ProjectState,
  target: TargetAsset,
  media: MediaSource,
  description: string,
): CommandOutcome<ProjectState> {
  const { asset, source } = target;
  return applied(
    withMedia(state, asset, source, media),
    setAssetMediaInvocation(asset.id, source.media),
    description,
  );
}

/** Whether two media are the same value, by the one text each is written as. */
function sameMedia(left: MediaSource, right: MediaSource): boolean {
  return canonicalJson(writeMediaSource(left)) === canonicalJson(writeMediaSource(right));
}
