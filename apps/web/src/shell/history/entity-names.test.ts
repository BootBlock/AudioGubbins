import { describe, expect, it } from 'vitest';

import { instantiateProcessor, type EffectChain } from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { describeEntity, entityNamesOf } from './entity-names.js';

describe('what the History panel calls the entities a change affected (REQ-STOR-196)', () => {
  it('calls a rack’s chain by the asset whose rack it is, and a chain nothing names gone', () => {
    const fixture = sampleProject();
    const gain = PROCESSOR_CATALOGUE.get('gain');
    if (gain === undefined) throw new Error('The build has a gain.');
    const chain: EffectChain = {
      id: fixture.ids.next<'EffectChainId'>(),
      slots: [instantiateProcessor(fixture.ids.next<'ProcessorId'>(), gain)],
    };
    const { footstep } = fixture.assets;
    const state: ProjectState = {
      project: {
        ...fixture.project,
        assets: new Map([
          ...fixture.project.assets,
          [footstep.id, { ...footstep, rack: chain.id }],
        ]),
        effectChains: new Map([[chain.id, chain]]),
      },
      sources: new Map(),
    };

    const names = entityNamesOf(state);

    expect(describeEntity({ kind: 'effect-chain', id: chain.id }, names)).toBe(
      `effects of “${footstep.displayName}”`,
    );
    const gone = fixture.ids.next<'EffectChainId'>();
    expect(describeEntity({ kind: 'effect-chain', id: gone }, names)).toBe(
      'effects no longer in the project',
    );
  });
});
