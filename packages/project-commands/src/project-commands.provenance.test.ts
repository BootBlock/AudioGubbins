import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  storageKeyOf,
  type ExternalSourceIdentity,
  type MediaSource,
  type SourceRewrite,
} from '@audiogubbins/project-format';
import { contentIdOfDigit } from '@audiogubbins/project-format/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { ProjectCommandId } from './project-command.js';
import { commandProvenance, projectCommands } from './project-commands.js';
import {
  addAssetInvocation,
  adoptSourceVersionInvocation,
  relinkSourceInvocation,
  setAssetMediaInvocation,
} from './project-invocations.js';
import { entryOf, projectBus } from './testing/bus-runs.js';
import { referenceState } from './testing/reference-state.js';

/**
 * What each project command declares of the provenance its arguments hold is
 * all they hold (REQ-STOR-166): every change made over a state whose files
 * have names, kept handles and paths, with its inverse, passed through the
 * port built from the commands, keeps none of them once the rewrite takes them
 * out. A command carrying provenance in an argument it did not declare would
 * leave it in a whole history exported without it.
 */

const bus = projectBus();
const port = commandProvenance(projectCommands());
const fixture = sampleProject();
const { state, assets } = referenceState(fixture);

/** Every name, handle and path of a file the changes below carry. */
const PRIVATE = [
  'Gravel footstep.wav',
  'Forest ambience.flac',
  'Rain.wav',
  'handle-0001',
  'handle-0002',
  'Ambience/',
  'Moved/',
];

/** A rewrite that puts one word in place of every name, handle and path. */
const REDACTING: SourceRewrite = {
  identity: redacted,
  media: redactedMedia,
  source: (source) => {
    const media = redactedMedia(source.media);
    if (source.provenance === undefined) return { media };
    const { originalFileName: _name, ...kept } = source.provenance;
    return { media, provenance: kept };
  },
};

function redacted(identity: ExternalSourceIdentity): ExternalSourceIdentity {
  return {
    ...identity,
    ...(identity.handleKey === undefined ? {} : { handleKey: 'redacted' }),
    ...(identity.fileName === undefined ? {} : { fileName: 'redacted' }),
    ...(identity.relativePath === undefined ? {} : { relativePath: 'redacted' }),
  };
}

function redactedMedia(media: MediaSource): MediaSource {
  return media.kind === 'managed' ? media : { ...media, identity: redacted(media.identity) };
}

function forestIdentity(): ExternalSourceIdentity {
  const media = state.sources.get(assets.forest.id)?.media;
  if (media?.kind !== 'external') throw new Error('The forest asset is not linked.');
  return media.identity;
}

/** The forward and inverse invocations of a change made from the reference state. */
function changeOf(invocation: CommandInvocation): readonly CommandInvocation[] {
  const entry = entryOf(bus.execute(state, invocation));
  return [...entry.forward, ...entry.inverse];
}

/** Every change below, each with its inverse: one of every command that touches a file. */
function everyChange(): readonly CommandInvocation[] {
  const managed: MediaSource = {
    kind: 'managed',
    contentId: contentIdOfDigit('c'),
    byteLength: 1_234_567,
    mediaType: 'audio/flac',
  };
  const moved = { ...forestIdentity(), handleKey: 'handle-0002', relativePath: 'Moved/x.flac' };
  const edited = { ...forestIdentity(), fastFingerprint: 'e'.repeat(64) };
  const footstep = state.sources.get(assets.footstep.id);
  if (footstep === undefined) throw new Error('The footstep asset has no source.');
  const copy = fixture.ids.next<'AssetId'>();
  const added = { ...assets.footstep, id: copy, storageKey: storageKeyOf(copy, footstep.media) };
  // Removing an asset is undone by adding it again with its whole record.
  return [
    ...changeOf(addAssetInvocation(added, footstep)),
    ...changeOf({
      commandId: ProjectCommandId.RemoveAsset,
      arguments: { assetId: assets.rain.id },
    }),
    ...changeOf(relinkSourceInvocation(assets.forest.id, moved, contentIdOfDigit('c'))),
    ...changeOf(adoptSourceVersionInvocation(assets.forest.id, edited, contentIdOfDigit('e'))),
    ...changeOf(setAssetMediaInvocation(assets.forest.id, managed)),
    ...changeOf({
      commandId: ProjectCommandId.FreezeSource,
      arguments: { assetId: assets.forest.id },
    }),
  ];
}

describe('what the project commands declare of their arguments’ provenance', () => {
  it('names every argument that holds a file’s name, handle or path', () => {
    const changes = everyChange();
    const before = JSON.stringify(changes);
    for (const text of PRIVATE) expect(before).toContain(text);

    const after = JSON.stringify(changes.map((each) => expectSuccess(port(each, REDACTING))));

    for (const text of PRIVATE) expect(after).not.toContain(text);
  });

  it('gives back a change whose arguments the rewrite leaves alone, as it was', () => {
    const keeping: SourceRewrite = {
      identity: (identity) => identity,
      media: (media) => media,
      source: (source) => source,
    };
    for (const change of everyChange()) expect(expectSuccess(port(change, keeping))).toBe(change);
  });

  it('refuses a change of a command none declares, whose arguments cannot be known', () => {
    const unknown = port({ commandId: 'project.unknown-thing', arguments: {} }, REDACTING);
    expect(unknown.ok ? undefined : unknown.failures[0].code).toBe('provenance.command-unknown');
  });
});
