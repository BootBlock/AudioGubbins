import { describe, expect, it } from 'vitest';

import type { GameAssetGroup } from './game-asset-group.js';
import { groupPath, walkAncestry } from './group-forest.js';
import type { GameAssetGroupId } from './group-ids.js';

const id = (text: string): GameAssetGroupId => text as GameAssetGroupId;

function forest(...groups: GameAssetGroup[]): ReadonlyMap<GameAssetGroupId, GameAssetGroup> {
  return new Map(groups.map((group) => [group.id, group]));
}

const sfx: GameAssetGroup = { id: id('sfx'), name: 'SFX', policy: {} };
const steps: GameAssetGroup = { id: id('steps'), name: 'Steps', parent: id('sfx'), policy: {} };
const grass: GameAssetGroup = { id: id('grass'), name: 'Grass', parent: id('steps'), policy: {} };

describe('the walk up a group’s parents (ADR-0101)', () => {
  it('reaches the root, the starting group first', () => {
    expect(walkAncestry(forest(sfx, steps, grass), id('grass'))).toEqual({
      line: [grass, steps, sfx],
      end: { kind: 'root' },
    });
    expect(groupPath(forest(sfx, steps, grass), id('grass'))).toEqual(['SFX', 'Steps', 'Grass']);
  });

  it('ends at the group it comes back to, so a cycle never runs on', () => {
    const looped = forest({ ...sfx, parent: id('grass') }, steps, grass);

    expect(walkAncestry(looped, id('steps'))).toEqual({
      line: [steps, { ...sfx, parent: id('grass') }, grass],
      end: { kind: 'cycle', at: id('steps') },
    });
    expect(() => groupPath(looped, id('steps'))).toThrow(/own ancestor/);
  });

  it('ends at a parent the forest does not hold', () => {
    expect(walkAncestry(forest(steps, grass), id('grass'))).toEqual({
      line: [grass, steps],
      end: { kind: 'unknown', id: id('sfx') },
    });
    expect(() => groupPath(forest(steps, grass), id('grass'))).toThrow(/not in the forest/);
  });
});
