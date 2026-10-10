import { describe, expect, it } from 'vitest';

import {
  MaskEffect,
  NO_FEATHER,
  sampleCount,
  type EditTarget,
  type Region,
  type SpectralEdit,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { appliedOf, projectBus } from '../testing/bus-runs.js';
import { referenceState } from '../testing/reference-state.js';
import { addRegionInvocation } from './region-invocations.js';
import { processTargetInvocation } from './target-invocations.js';

const bus = projectBus();
const fixture = sampleProject();
const reference = referenceState(fixture);
const { rain } = reference.assets;
const ids = fixture.ids;

const at = (frames: number) => expectSuccess(sampleCount(frames));
// A stereo asset, so a level edit can name one channel and a channel edit two.
const shower: Region = {
  id: ids.next<'RegionId'>(),
  assetId: rain.id,
  displayName: 'Shower',
  basis: 0,
  start: at(0),
  end: at(1_000),
  tags: [],
  operations: [],
};
const state = appliedOf(projectBus().execute(reference.state, addRegionInvocation(shower))).next;

const range = { start: at(100), end: at(900) };
const assetTarget: EditTarget = { kind: 'asset', asset: rain.id, range, channels: [1] };
const regionTarget: EditTarget = {
  kind: 'region',
  asset: rain.id,
  region: shower.id,
  basis: 0,
  range,
  channels: [1],
};

describe('processing made on an edit target', () => {
  it("processes a region target in the region's own chain, leaving the asset's alone", () => {
    const id = ids.next<'EditOperationId'>();
    const { next } = appliedOf(
      bus.execute(state, processTargetInvocation(regionTarget, id, { kind: 'gain', gain: 2 })),
    );
    expect(next.project.regions.get(shower.id)?.operations).toEqual([
      { id, basis: 0, range, channels: [1], edit: { kind: 'gain', gain: 2 } },
    ]);
    expect(next.project.assets.get(rain.id)?.edits).toEqual(rain.edits);
  });

  it("processes an asset target in the asset's chain", () => {
    const id = ids.next<'EditOperationId'>();
    const { next } = appliedOf(
      bus.execute(state, processTargetInvocation(assetTarget, id, { kind: 'silence' })),
    );
    expect(next.project.assets.get(rain.id)?.edits.at(-1)).toEqual({
      id,
      kind: 'process',
      range,
      channels: [1],
      edit: { kind: 'silence' },
    });
    expect(next.project.regions.get(shower.id)?.operations).toEqual(shower.operations);
  });

  it.each([
    ['an asset', assetTarget],
    ['a region', regionTarget],
  ])('keeps no channel scope on a channel edit of %s, which names its own', (_, target) => {
    const id = ids.next<'EditOperationId'>();
    const { next } = appliedOf(
      bus.execute(
        state,
        processTargetInvocation(target, id, { kind: 'swap-channels', first: 0, second: 1 }),
      ),
    );
    const made =
      target.kind === 'region'
        ? next.project.regions.get(shower.id)?.operations.at(-1)
        : next.project.assets.get(rain.id)?.edits.at(-1);
    expect(made).toBeDefined();
    expect(made !== undefined && 'channels' in made).toBe(false);
  });

  it.each([
    ['an asset', assetTarget],
    ['a region', regionTarget],
  ])('keeps the channel scope on a spectral edit of %s, which acts on channels', (_, target) => {
    const id = ids.next<'EditOperationId'>();
    const edit: SpectralEdit = {
      kind: 'spectral',
      mask: {
        shapes: [
          {
            kind: 'rectangle',
            effect: MaskEffect.Add,
            range: { start: at(100), end: at(700) },
            band: { low: 100, high: 400 },
          },
        ],
        feather: NO_FEATHER,
      },
      resolution: 256,
      operation: { kind: 'heal' },
    };
    const { next } = appliedOf(bus.execute(state, processTargetInvocation(target, id, edit)));
    const made =
      target.kind === 'region'
        ? next.project.regions.get(shower.id)?.operations.at(-1)
        : next.project.assets.get(rain.id)?.edits.at(-1);
    expect(made).toMatchObject({ channels: [1], edit });
  });
});
