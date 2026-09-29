/**
 * Project states for this package's tests: the fixtures' sample project with a
 * managed source attached to each asset, and a chain of processors, so a
 * difference has one of every kind of thing to find.
 */

import type {
  EffectChain,
  ParameterId,
  ParameterValue,
  ProcessorInstance,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  contentIdFrom,
  type AssetSource,
  type ContentId,
  type ProjectState,
} from '@audiogubbins/project-format';
import { sampleProject, type ProjectFixture } from '@audiogubbins/test-fixtures';

/** A content identifier made of one hexadecimal digit repeated. */
export function contentOf(digit: string): ContentId {
  return expectSuccess(contentIdFrom(`c1-${digit.repeat(64)}`));
}

/** A processor of a type, with its parameter values. */
export function processor(
  fixture: ProjectFixture,
  typeKey: string,
  values: readonly (readonly [ParameterId, ParameterValue])[] = [],
): ProcessorInstance {
  return {
    id: fixture.ids.next<'ProcessorId'>(),
    typeKey,
    enabled: true,
    soloed: false,
    values: new Map(values),
  };
}

/** The sample project with a managed source for each asset and one empty chain. */
export function fixtureState(): {
  readonly fixture: ProjectFixture;
  readonly state: ProjectState;
  readonly chain: EffectChain;
} {
  const fixture = sampleProject();
  const chain: EffectChain = { id: fixture.ids.next<'EffectChainId'>(), processors: [] };
  const sources = new Map<ProjectFixture['assets']['footstep']['id'], AssetSource>();
  let digit = 0;
  for (const asset of fixture.project.assets.values()) {
    digit += 1;
    sources.set(asset.id, {
      media: {
        kind: 'managed',
        contentId: contentOf(String(digit)),
        byteLength: 1_000 * digit,
        mediaType: 'audio/wav',
      },
    });
  }
  return {
    fixture,
    chain,
    state: {
      project: { ...fixture.project, effectChains: new Map([[chain.id, chain]]) },
      sources,
    },
  };
}
