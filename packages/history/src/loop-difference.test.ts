import { describe, expect, it } from 'vitest';

import { FadeShape } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { diffStates } from './state-diff.js';
import { fixtureState } from './testing/states.js';

describe('the difference of two states in a region’s loop', () => {
  it('names the loop where only its crossfade’s shape changed, since the region then sounds otherwise', () => {
    const { state, fixture } = fixtureState(sampleProject());
    const { loop } = fixture.regions;
    const current = loop.loop;
    if (current === undefined) throw new Error('The fixture region loops.');
    const reshaped: ProjectState = {
      ...state,
      project: {
        ...state.project,
        regions: new Map([
          [loop.id, { ...loop, loop: { ...current, crossfadeShape: FadeShape.SCurve } }],
        ]),
      },
    };

    expect(current.crossfadeShape).not.toBe(FadeShape.SCurve);
    expect(diffStates(state, reshaped).regions.changed).toEqual([
      { id: loop.id, fields: ['loop'] },
    ]);
  });
});
