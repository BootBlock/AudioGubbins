/**
 * Project states for this package's tests: a fixture's project with a managed
 * source attached to each asset, and a chain of processors, so a difference has
 * one of every kind of thing to find.
 *
 * The fixture is the test's to pass, so this module reaches nothing but the
 * package's own dependencies: only a test file may take the fixtures package.
 */

import type {
  AssetId,
  EffectChain,
  IdGenerator,
  ParameterId,
  ParameterValue,
  ProcessorInstance,
  Project,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  contentIdFrom,
  type AssetSource,
  type ContentId,
  type ProjectState,
} from '@audiogubbins/project-format';

/** What a state is made from: a project and the identifiers it was made with. */
export interface StateFixture {
  readonly ids: IdGenerator;
  readonly project: Project;
}

/** A content identifier made of one hexadecimal digit repeated. */
export function contentOf(digit: string): ContentId {
  return expectSuccess(contentIdFrom(`c1-${digit.repeat(64)}`));
}

/** A processor of a type, with its parameter values. */
export function processor(
  fixture: StateFixture,
  typeKey: string,
  values: readonly (readonly [ParameterId, ParameterValue])[] = [],
): ProcessorInstance {
  return {
    kind: 'processor',
    id: fixture.ids.next<'ProcessorId'>(),
    typeKey,
    enabled: true,
    soloed: false,
    mix: 1,
    version: { implementation: 1, parameters: 1 },
    values: new Map(values),
  };
}

/** The fixture's project with a managed source for each asset and one empty chain. */
export function fixtureState<TFixture extends StateFixture>(
  fixture: TFixture,
): {
  readonly fixture: TFixture;
  readonly state: ProjectState;
  readonly chain: EffectChain;
} {
  const chain: EffectChain = { id: fixture.ids.next<'EffectChainId'>(), slots: [] };
  const sources = new Map<AssetId, AssetSource>();
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
