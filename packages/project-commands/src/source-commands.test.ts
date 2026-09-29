import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import type { Asset } from '@audiogubbins/domain';
import {
  SourceChangePolicy,
  storageKeyOf,
  type ExternalMedia,
  type ExternalSourceIdentity,
  type MediaSource,
  type ProjectState,
} from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { ProjectCommandId } from './project-command.js';
import { adoptSourceVersionInvocation, relinkSourceInvocation } from './project-invocations.js';
import {
  appliedOf,
  assertReadsBack,
  entryOf,
  projectBus,
  refusalCodeOf,
  unchangedCodeOf,
} from './testing/bus-runs.js';
import { contentIdOfDigit, referenceState } from './testing/reference-state.js';

const bus = projectBus();
const { state, assets } = referenceState(sampleProject());

function mediaOf(of: ProjectState, asset: Asset): MediaSource {
  const media = of.sources.get(asset.id)?.media;
  if (media === undefined) throw new Error('The asset has no source.');
  return media;
}

function externalOf(of: ProjectState, asset: Asset): ExternalMedia {
  const media = mediaOf(of, asset);
  if (media.kind !== 'external') throw new Error('The asset is not linked.');
  return media;
}

/** Applies the invocation, checks the state it gives, and checks its inverse restores the start. */
function appliedAndUndone(start: ProjectState, invocation: CommandInvocation) {
  const result = bus.execute(start, invocation);
  const { next } = appliedOf(result);
  assertReadsBack(next);
  const entry = entryOf(result);
  expect(appliedOf(bus.execute(next, entry.inverse[0])).next).toEqual(start);
  return { next, entry };
}

function setPolicy(asset: Asset, policy: string): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetSourcePolicy,
    arguments: { assetId: asset.id, policy },
  };
}

function setMedia(asset: Asset, media: string): CommandInvocation {
  return { commandId: ProjectCommandId.SetAssetMedia, arguments: { assetId: asset.id, media } };
}

function freeze(asset: Asset): CommandInvocation {
  return { commandId: ProjectCommandId.FreezeSource, arguments: { assetId: asset.id } };
}

const forestIdentity = externalOf(state, assets.forest).identity;

/** The forest file as it is after being edited in place: same handle and path. */
const editedForest: ExternalSourceIdentity = {
  ...forestIdentity,
  byteLength: 1_300_000,
  lastModified: 1_790_000_000_000,
  fastFingerprint: 'e'.repeat(64),
  contentId: contentIdOfDigit('e'),
};

/** A copy of the forest file somewhere else. */
const movedForest: ExternalSourceIdentity = {
  ...forestIdentity,
  handleKey: 'handle-0002',
  relativePath: 'Moved/Forest ambience.flac',
};

describe('project.set-source-policy', () => {
  it('sets the policy of a linked file, undone by setting the old one', () => {
    const { next, entry } = appliedAndUndone(state, setPolicy(assets.forest, 'freeze'));

    expect(externalOf(next, assets.forest).policy).toBe(SourceChangePolicy.Freeze);
    expect(entry.description).toBe(
      'Keep “Forest ambience” on its retained copy when its file changes',
    );
    expect(entry.inverse[0]).toEqual(setPolicy(assets.forest, 'prompt'));
  });

  it('refuses freezing a file with no retained copy', () => {
    expect(refusalCodeOf(bus.execute(state, setPolicy(assets.rain, 'freeze')))).toBe(
      'source.freeze-without-retained-copy',
    );
    expect(bus.execute(state, setPolicy(assets.rain, 'adopt')).kind).toBe('applied');
  });

  it('refuses an asset kept in the project, and a policy there is not', () => {
    expect(refusalCodeOf(bus.execute(state, setPolicy(assets.footstep, 'adopt')))).toBe(
      'source.not-external',
    );
    expect(refusalCodeOf(bus.execute(state, setPolicy(assets.forest, 'ignore')))).toBe(
      'source.policy-unknown',
    );
  });

  it('changes nothing for the policy already set', () => {
    expect(unchangedCodeOf(bus.execute(state, setPolicy(assets.forest, 'prompt')))).toBe(
      'source.policy-unchanged',
    );
  });
});

describe('project.relink-source', () => {
  it('points a linked asset at another file, keeping the policy', () => {
    const invocation = relinkSourceInvocation(assets.forest, movedForest, contentIdOfDigit('c'));
    const { next, entry } = appliedAndUndone(state, invocation);

    expect(externalOf(next, assets.forest)).toEqual({
      kind: 'external',
      identity: movedForest,
      policy: SourceChangePolicy.Prompt,
      retainedCopy: contentIdOfDigit('c'),
    });
    expect(entry.description).toBe('Relink “Forest ambience” to another file');
    expect(entry.inverse[0].commandId).toBe(ProjectCommandId.SetAssetMedia);
  });

  it('keeps no retained copy unless told which copy is of the new file', () => {
    const { next } = appliedAndUndone(state, relinkSourceInvocation(assets.forest, movedForest));

    expect(externalOf(next, assets.forest).retainedCopy).toBeUndefined();
  });

  it('refuses a frozen source without a retained copy of the new file', () => {
    const frozen = appliedOf(bus.execute(state, setPolicy(assets.forest, 'freeze'))).next;

    expect(
      refusalCodeOf(bus.execute(frozen, relinkSourceInvocation(assets.forest, movedForest))),
    ).toBe('source.freeze-without-retained-copy');
  });

  it('refuses the same file, which is adopted rather than relinked', () => {
    expect(
      refusalCodeOf(bus.execute(state, relinkSourceInvocation(assets.forest, editedForest))),
    ).toBe('source.relink-same-file');
  });

  it('relinks a file known by nothing but its name', () => {
    const rainIdentity = externalOf(state, assets.rain).identity;
    const found = { ...rainIdentity, handleKey: 'handle-0009' };

    appliedAndUndone(state, relinkSourceInvocation(assets.rain, found));
  });

  it('refuses an identity the format refuses, naming where in it', () => {
    const invocation = {
      commandId: ProjectCommandId.RelinkSource,
      arguments: { assetId: assets.forest.id, identity: '{"byteLength":1}' },
    };
    const result = bus.execute(state, invocation);

    expect(refusalCodeOf(result)).toBe('schema.missing-member');
    expect(result.kind === 'refused' ? result.failures[0].summary : '').toContain('“identity.');
  });

  it('refuses a retained copy that is not a content identifier', () => {
    const invocation = relinkSourceInvocation(assets.forest, movedForest);
    const malformed = {
      ...invocation,
      arguments: { ...invocation.arguments, retainedCopy: 'c1-zz' },
    };

    expect(refusalCodeOf(bus.execute(state, malformed))).toBe('schema.malformed-content-id');
  });

  it('refuses an asset kept in the project, and changes nothing for the same identity', () => {
    expect(
      refusalCodeOf(bus.execute(state, relinkSourceInvocation(assets.footstep, movedForest))),
    ).toBe('source.not-external');
    expect(
      unchangedCodeOf(
        bus.execute(
          state,
          relinkSourceInvocation(assets.forest, forestIdentity, contentIdOfDigit('c')),
        ),
      ),
    ).toBe('source.identity-unchanged');
  });
});

describe('project.adopt-source-version', () => {
  it('takes the new version of the same file, with the copy retained of it', () => {
    const invocation = adoptSourceVersionInvocation(
      assets.forest,
      editedForest,
      contentIdOfDigit('e'),
    );
    const { next, entry } = appliedAndUndone(state, invocation);

    expect(externalOf(next, assets.forest).identity).toEqual(editedForest);
    expect(externalOf(next, assets.forest).retainedCopy).toBe(contentIdOfDigit('e'));
    expect(entry.description).toBe('Use the new version of “Forest ambience”');
  });

  it('refuses another file, which is relinked rather than adopted', () => {
    expect(
      refusalCodeOf(bus.execute(state, adoptSourceVersionInvocation(assets.forest, movedForest))),
    ).toBe('source.adopt-other-file');
  });

  it('refuses a file known by no handle or path, which cannot be told from another', () => {
    const rainIdentity = externalOf(state, assets.rain).identity;
    const changed = { ...rainIdentity, byteLength: 1 };

    expect(
      refusalCodeOf(bus.execute(state, adoptSourceVersionInvocation(assets.rain, changed))),
    ).toBe('source.location-unknown');
  });
});

describe('project.freeze-source', () => {
  it('switches a linked asset to the retained copy, its key following', () => {
    const { next, entry } = appliedAndUndone(state, freeze(assets.forest));
    const media = mediaOf(next, assets.forest);

    expect(media).toEqual({
      kind: 'managed',
      contentId: contentIdOfDigit('c'),
      byteLength: forestIdentity.byteLength,
      mediaType: forestIdentity.mediaType,
    });
    expect(next.project.assets.get(assets.forest.id)?.storageKey).toBe(
      storageKeyOf(assets.forest.id, media),
    );
    expect(entry.description).toBe('Keep “Forest ambience” as a copy in the project');
  });

  it('refuses a file with no retained copy, and an asset kept in the project', () => {
    expect(refusalCodeOf(bus.execute(state, freeze(assets.rain)))).toBe('source.no-retained-copy');
    expect(refusalCodeOf(bus.execute(state, freeze(assets.footstep)))).toBe('source.not-external');
  });

  it('refuses a retained copy of other content than the link last saw', () => {
    const stale = appliedOf(
      bus.execute(
        state,
        adoptSourceVersionInvocation(assets.forest, editedForest, contentIdOfDigit('c')),
      ),
    ).next;

    expect(refusalCodeOf(bus.execute(stale, freeze(assets.forest)))).toBe(
      'source.retained-copy-stale',
    );
  });
});

describe('project.set-asset-media', () => {
  it('replaces the media and keeps the storage key derived from it', () => {
    const managed =
      '{"byteLength":10,"contentId":"c1-' +
      'f'.repeat(64) +
      '","kind":"managed","mediaType":"audio/wav"}';
    const { next, entry } = appliedAndUndone(state, setMedia(assets.rain, managed));

    expect(next.project.assets.get(assets.rain.id)?.storageKey).toBe(
      `content:c1-${'f'.repeat(64)}`,
    );
    expect(entry.description).toBe('Change where “Rain” is kept');
  });

  it('refuses media the format refuses, and changes nothing for the same media', () => {
    expect(refusalCodeOf(bus.execute(state, setMedia(assets.rain, '{"kind":"managed"}')))).toBe(
      'schema.missing-member',
    );
    expect(refusalCodeOf(bus.execute(state, setMedia(assets.rain, '{"kind":"elsewhere"}')))).toBe(
      'schema.unknown-value',
    );

    const undo = entryOf(bus.execute(state, freeze(assets.forest))).inverse[0];
    const sameAsNow = typeof undo.arguments?.['media'] === 'string' ? undo.arguments['media'] : '';
    expect(unchangedCodeOf(bus.execute(state, setMedia(assets.forest, sameAsNow)))).toBe(
      'source.media-unchanged',
    );
  });
});
