import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  StandardLayouts,
  assetPlan,
  sampleCount,
  slicePlan,
  unsafeBrandId,
  type EditOperation,
  type EditRange,
  type Marker,
  type Region,
  type RegionOperation,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { randomAssetRecord, seededRandom } from '@audiogubbins/project-format/testing';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { ProjectCommandId } from '../project-command.js';
import { addAssetInvocation } from '../project-invocations.js';
import {
  appliedOf,
  assertReadsBack,
  entryOf,
  projectBus,
  refusalCodeOf,
  unchangedCodeOf,
} from '../testing/bus-runs.js';
import { referenceState } from '../testing/reference-state.js';
import { applyInvocation, withdrawInvocation } from './edit-commands.js';
import {
  addMarkerInvocation,
  removeMarkerInvocation,
  setMarkerInvocation,
} from './marker-commands.js';
import {
  addRegionInvocation,
  applyRegionEditInvocation,
  removeRegionInvocation,
  setRegionInvocation,
  withdrawRegionEditInvocation,
} from './region-commands.js';

const bus = projectBus();
const fixture = sampleProject();
const { state, assets } = referenceState(fixture);
const { footstep, forest, rain } = assets;
const loop = fixture.regions.loop;
const walkBegins = fixture.markers.start;
const ids = fixture.ids;

const at = (frames: number) => expectSuccess(sampleCount(frames));
const span = (start: number, end: number): EditRange => ({ start: at(start), end: at(end) });

function deletion(start: number, end: number): Extract<EditOperation, { kind: 'delete' }> {
  return { id: ids.next<'EditOperationId'>(), kind: 'delete', range: span(start, end) };
}

function louder(start: number, end: number): RegionOperation {
  return {
    id: ids.next<'EditOperationId'>(),
    basis: 0,
    range: span(start, end),
    edit: { kind: 'gain', gain: 2 },
  };
}

function markerOn(asset: { readonly id: Marker['assetId'] }, position: number): Marker {
  return {
    id: ids.next<'MarkerId'>(),
    assetId: asset.id,
    displayName: 'Hit',
    basis: 0,
    position: at(position),
  };
}

function regionOn(asset: { readonly id: Region['assetId'] }, start: number, end: number): Region {
  return {
    id: ids.next<'RegionId'>(),
    assetId: asset.id,
    displayName: 'Crunch',
    basis: 0,
    start: at(start),
    end: at(end),
    tags: [],
    operations: [],
  };
}

/** Runs `invocation`, checks it applied, reads back and is undone by its inverses. */
function appliedAndUndone(from: ProjectState, invocation: CommandInvocation) {
  const result = bus.execute(from, invocation);
  const { next } = appliedOf(result);
  assertReadsBack(next);
  let undone = next;
  for (const inverse of entryOf(result).inverse)
    undone = appliedOf(bus.execute(undone, inverse)).next;
  expect(undone).toEqual(from);
  return { next, entry: entryOf(result) };
}

/** `from` after every invocation, each of which must apply. */
function after(from: ProjectState, ...invocations: readonly CommandInvocation[]): ProjectState {
  let next = from;
  for (const invocation of invocations) next = appliedOf(bus.execute(next, invocation)).next;
  return next;
}

describe('project.apply-edit', () => {
  it('adds the edit to the end of the chain, undone by withdrawing it', () => {
    const operation = deletion(1_000, 2_000);
    const { next, entry } = appliedAndUndone(state, applyInvocation(footstep, operation));

    expect(next.project.assets.get(footstep.id)?.edits).toEqual([operation]);
    expect(next.sources.get(footstep.id)).toEqual(state.sources.get(footstep.id));
    expect(entry.description).toBe('Delete part of “Gravel footstep”');
    expect(entry.inverse).toEqual([withdrawInvocation(footstep, operation)]);
  });

  it('refuses an asset the project lacks', () => {
    const operation = deletion(0, 10);
    expect(
      refusalCodeOf(
        bus.execute(
          state,
          applyInvocation(
            { id: unsafeBrandId<'AssetId'>('0123456789abcdef0123456789abcdef') },
            operation,
          ),
        ),
      ),
    ).toBe('asset.unknown');
  });

  it('refuses an operation that is not one, naming where', () => {
    const result = bus.execute(state, {
      commandId: ProjectCommandId.ApplyEdit,
      arguments: { assetId: footstep.id, operation: '{"kind":"delete"}' },
    });
    expect(result.kind === 'refused' ? result.failures.map((each) => each.summary) : []).toEqual([
      'The member "id" is required. (at “id”)',
      'The member "range" is required. (at “range”)',
    ]);
  });

  it('refuses an edit outside the asset’s audio, by the domain’s own rule', () => {
    expect(
      refusalCodeOf(bus.execute(state, applyInvocation(footstep, deletion(23_000, 24_001)))),
    ).toBe('editing.operation-invalid');
  });

  it('refuses a second edit with an identifier the chain already has', () => {
    const operation = deletion(0, 10);
    const edited = after(state, applyInvocation(footstep, operation));
    expect(
      refusalCodeOf(
        bus.execute(edited, applyInvocation(footstep, { ...operation, range: span(5, 6) })),
      ),
    ).toBe('edit.duplicate-id');
  });

  it('refuses to convert the layout while a region’s processing names channels, naming the region', () => {
    const region = regionOn(forest, 0, 4_800);
    const swap: RegionOperation = {
      id: ids.next<'EditOperationId'>(),
      basis: 0,
      range: span(0, 480),
      edit: { kind: 'swap-channels', first: 0, second: 1 },
    };
    const processed = after(
      state,
      addRegionInvocation(region),
      applyRegionEditInvocation(region, swap),
    );
    const toMono: EditOperation = {
      id: ids.next<'EditOperationId'>(),
      kind: 'convert-layout',
      layout: StandardLayouts.mono,
      matrix: [[0.5, 0.5]],
    };
    const result = bus.execute(processed, applyInvocation(forest, toMono));

    expect(refusalCodeOf(result)).toBe('edit.region-channels');
    expect(result.kind === 'refused' ? result.failures[0].summary : '').toContain('“Crunch”');
    // A level change names no channels, so the same conversion applies over it.
    const level = after(
      state,
      addRegionInvocation(region),
      applyRegionEditInvocation(region, louder(0, 480)),
    );
    appliedAndUndone(level, applyInvocation(forest, toMono));
  });
});

describe('project.withdraw-edit', () => {
  it('withdraws the last edit, undone by applying it again as it was', () => {
    const first = deletion(0, 100);
    const last = deletion(0, 100);
    const edited = after(state, applyInvocation(footstep, first), applyInvocation(footstep, last));
    const { next, entry } = appliedAndUndone(edited, withdrawInvocation(footstep, last));

    expect(next.project.assets.get(footstep.id)?.edits).toEqual([first]);
    expect(entry.description).toBe('Withdraw: Delete part of “Gravel footstep”');
    expect(entry.inverse).toEqual([applyInvocation(footstep, last)]);
  });

  it('refuses any edit but the last', () => {
    const first = deletion(0, 100);
    const edited = after(
      state,
      applyInvocation(footstep, first),
      applyInvocation(footstep, deletion(0, 100)),
    );
    expect(refusalCodeOf(bus.execute(edited, withdrawInvocation(footstep, first)))).toBe(
      'edit.not-last',
    );
    expect(refusalCodeOf(bus.execute(state, withdrawInvocation(footstep, first)))).toBe(
      'edit.not-last',
    );
  });

  it('refuses while a marker, a region, its loop or its processing is placed on the edit', () => {
    const operation = deletion(0, 100);
    const edited = after(state, applyInvocation(footstep, operation));
    const withdraw = withdrawInvocation(footstep, operation);
    const region = { ...regionOn(footstep, 0, 1_000), basis: 1 };
    const placed: readonly CommandInvocation[] = [
      addMarkerInvocation({ ...markerOn(footstep, 10), basis: 1 }),
      addRegionInvocation(region),
      setRegionInvocation({
        ...loop,
        loop: { basis: 1, start: at(0), end: at(100), crossfadeLength: at(0) },
      }),
    ];
    for (const invocation of placed) {
      expect(refusalCodeOf(bus.execute(after(edited, invocation), withdraw))).toBe(
        'edit.placed-after',
      );
    }
    const processing = { ...louder(0, 10), basis: 1 };
    const processed = after(edited, addRegionInvocation({ ...region, basis: 0 }));
    expect(
      refusalCodeOf(
        bus.execute(after(processed, applyRegionEditInvocation(region, processing)), withdraw),
      ),
    ).toBe('edit.placed-after');
    // Placed before the edit, the same things leave it free to withdraw.
    appliedAndUndone(after(edited, addMarkerInvocation(markerOn(footstep, 10))), withdraw);
  });
});

describe('project.add-asset and project.remove-asset with edits', () => {
  it('refuses to add an asset that already has edits', () => {
    const { asset, source } = randomAssetRecord(seededRandom(5), ids, state.project.id);
    const edited = { ...asset, edits: [deletion(0, 1)] };
    expect(refusalCodeOf(bus.execute(state, addAssetInvocation(edited, source)))).toBe(
      'asset.added-with-edits',
    );
  });

  it('refuses to remove an asset with edits, or one pasted from, saying so', () => {
    const own = after(state, applyInvocation(forest, deletion(0, 10)));
    const removeForest = {
      commandId: ProjectCommandId.RemoveAsset,
      arguments: { assetId: forest.id },
    };
    const refused = bus.execute(own, removeForest);
    expect(refusalCodeOf(refused)).toBe('asset.in-use');
    expect(refused.kind === 'refused' ? refused.failures[0].summary : '').toBe(
      '“Forest ambience” still has 1 edit. Remove them first.',
    );

    const payload = expectSuccess(slicePlan(assetPlan(forest), at(0), at(100)));
    const paste: EditOperation = {
      id: ids.next<'EditOperationId'>(),
      kind: 'insert',
      at: at(0),
      payload,
      convertRate: false,
    };
    const pasted = bus.execute(after(state, applyInvocation(rain, paste)), removeForest);
    expect(pasted.kind === 'refused' ? pasted.failures[0].summary : '').toBe(
      '“Forest ambience” still has 1 asset with audio pasted from it. Remove them first.',
    );
  });
});

describe('project.add-marker', () => {
  it('adds the marker, undone by removing it', () => {
    const marker = markerOn(footstep, 12_000);
    const { next, entry } = appliedAndUndone(state, addMarkerInvocation(marker));

    expect(next.project.markers.get(marker.id)).toEqual(marker);
    expect(entry.description).toBe('Add marker “Hit”');
    expect(entry.inverse).toEqual([removeMarkerInvocation(marker)]);
  });

  it('places a marker at a later basis on the timeline the edits made', () => {
    const edited = after(state, applyInvocation(footstep, deletion(0, 12_000)));
    const late = { ...markerOn(footstep, 12_000), basis: 1 };
    appliedAndUndone(edited, addMarkerInvocation(late));
    expect(
      refusalCodeOf(bus.execute(edited, addMarkerInvocation({ ...late, position: at(12_001) }))),
    ).toBe('editing.marker-outside');
  });

  it('refuses a duplicate identifier, an unknown asset, a basis the asset lacks and a place outside it', () => {
    expect(refusalCodeOf(bus.execute(state, addMarkerInvocation(walkBegins)))).toBe(
      'marker.duplicate-id',
    );
    expect(
      refusalCodeOf(
        bus.execute(
          state,
          addMarkerInvocation({ ...markerOn(footstep, 0), assetId: ids.next<'AssetId'>() }),
        ),
      ),
    ).toBe('marker.asset-unknown');
    expect(
      refusalCodeOf(
        bus.execute(state, addMarkerInvocation({ ...markerOn(footstep, 0), basis: 1 })),
      ),
    ).toBe('editing.basis-unknown');
    expect(refusalCodeOf(bus.execute(state, addMarkerInvocation(markerOn(footstep, 24_001))))).toBe(
      'editing.marker-outside',
    );
    // The asset's end is a boundary a marker may stand on.
    appliedAndUndone(state, addMarkerInvocation(markerOn(footstep, 24_000)));
  });
});

describe('project.set-marker', () => {
  it('moves a marker, undone by setting it back as it was', () => {
    const moved = { ...walkBegins, position: at(6_000) };
    const { next, entry } = appliedAndUndone(state, setMarkerInvocation(moved));

    expect(next.project.markers.get(walkBegins.id)).toEqual(moved);
    expect(entry.description).toBe('Move marker “Walk begins”');
    expect(entry.inverse).toEqual([setMarkerInvocation(walkBegins)]);
  });

  it('renames a marker, saying both names', () => {
    const { entry } = appliedAndUndone(
      state,
      setMarkerInvocation({ ...walkBegins, displayName: 'Heel' }),
    );
    expect(entry.description).toBe('Rename marker “Walk begins” to “Heel”');
  });

  it('changes nothing for the marker as it is, and refuses an unknown one or another asset', () => {
    expect(unchangedCodeOf(bus.execute(state, setMarkerInvocation(walkBegins)))).toBe(
      'marker.unchanged',
    );
    expect(refusalCodeOf(bus.execute(state, setMarkerInvocation(markerOn(footstep, 0))))).toBe(
      'marker.unknown',
    );
    expect(
      refusalCodeOf(bus.execute(state, setMarkerInvocation({ ...walkBegins, assetId: forest.id }))),
    ).toBe('marker.asset-changed');
    expect(
      refusalCodeOf(
        bus.execute(state, setMarkerInvocation({ ...walkBegins, position: at(24_001) })),
      ),
    ).toBe('editing.marker-outside');
  });
});

describe('project.remove-marker', () => {
  it('removes the marker, undone by adding it back whole', () => {
    const { next, entry } = appliedAndUndone(state, removeMarkerInvocation(walkBegins));

    expect(next.project.markers.has(walkBegins.id)).toBe(false);
    expect(entry.description).toBe('Remove marker “Walk begins”');
    expect(entry.inverse).toEqual([addMarkerInvocation(walkBegins)]);
  });

  it('refuses an unknown marker, and an identifier of the wrong shape', () => {
    expect(refusalCodeOf(bus.execute(state, removeMarkerInvocation(markerOn(footstep, 0))))).toBe(
      'marker.unknown',
    );
    expect(
      refusalCodeOf(
        bus.execute(state, {
          commandId: ProjectCommandId.RemoveMarker,
          arguments: { markerId: 'Walk begins' },
        }),
      ),
    ).toBe('argument.id-malformed');
  });
});

describe('project.add-region', () => {
  it('adds the region, undone by removing it', () => {
    const region = { ...regionOn(forest, 0, 48_000), tags: ['rain'] };
    const { next, entry } = appliedAndUndone(state, addRegionInvocation(region));

    expect(next.project.regions.get(region.id)).toEqual(region);
    expect(entry.description).toBe('Add region “Crunch”');
    expect(entry.inverse).toEqual([removeRegionInvocation(region)]);
  });

  it('refuses a duplicate, processing given with it, an unknown asset, bounds outside and a crossfade longer than its loop', () => {
    const region = regionOn(footstep, 0, 1_000);
    expect(refusalCodeOf(bus.execute(state, addRegionInvocation(loop)))).toBe(
      'region.duplicate-id',
    );
    expect(
      refusalCodeOf(
        bus.execute(state, addRegionInvocation({ ...region, operations: [louder(0, 10)] })),
      ),
    ).toBe('region.added-with-processing');
    expect(
      refusalCodeOf(
        bus.execute(state, addRegionInvocation({ ...region, assetId: ids.next<'AssetId'>() })),
      ),
    ).toBe('region.asset-unknown');
    expect(
      refusalCodeOf(bus.execute(state, addRegionInvocation({ ...region, end: at(24_001) }))),
    ).toBe('editing.region-outside');
    expect(
      refusalCodeOf(
        bus.execute(
          state,
          addRegionInvocation({
            ...region,
            loop: { basis: 0, start: at(0), end: at(10), crossfadeLength: at(11) },
          }),
        ),
      ),
    ).toBe('editing.loop-crossfade');
  });
});

describe('project.set-region', () => {
  it('sets the properties, keeping identity, asset and processing, undone by setting them back', () => {
    const processing = louder(0, 10);
    const processed = after(state, applyRegionEditInvocation(loop, processing));
    const renamed = { ...loop, displayName: 'Run loop', end: at(20_000), tags: ['run'] };
    const { next, entry } = appliedAndUndone(processed, setRegionInvocation(renamed));

    expect(next.project.regions.get(loop.id)).toEqual({ ...renamed, operations: [processing] });
    expect(entry.description).toBe('Change region “Run loop”');
  });

  it('keeps the region on its asset whatever asset the properties name', () => {
    const elsewhere = setRegionInvocation({ ...loop, displayName: 'Moved', assetId: forest.id });
    const { next } = appliedAndUndone(state, elsewhere);
    expect(next.project.regions.get(loop.id)?.assetId).toBe(footstep.id);
  });

  it('changes nothing for the region as it is, and refuses properties that are not an object or do not fit', () => {
    expect(unchangedCodeOf(bus.execute(state, setRegionInvocation(loop)))).toBe('region.unchanged');
    expect(
      refusalCodeOf(
        bus.execute(state, {
          commandId: ProjectCommandId.SetRegion,
          arguments: { regionId: loop.id, region: '[]' },
        }),
      ),
    ).toBe('region.properties-malformed');
    expect(
      refusalCodeOf(bus.execute(state, setRegionInvocation({ ...loop, end: at(24_001) }))),
    ).toBe('editing.region-outside');
    expect(refusalCodeOf(bus.execute(state, setRegionInvocation(regionOn(footstep, 0, 10))))).toBe(
      'region.unknown',
    );
  });
});

describe('project.remove-region', () => {
  it('removes a region without processing, undone by adding it back', () => {
    const { next, entry } = appliedAndUndone(state, removeRegionInvocation(loop));

    expect(next.project.regions.has(loop.id)).toBe(false);
    expect(entry.description).toBe('Remove region “Walk loop”');
    expect(entry.inverse).toEqual([addRegionInvocation(loop)]);
  });

  it('refuses while the region has processing, and applies once it is withdrawn', () => {
    const processing = louder(0, 10);
    const processed = after(state, applyRegionEditInvocation(loop, processing));
    expect(refusalCodeOf(bus.execute(processed, removeRegionInvocation(loop)))).toBe(
      'region.has-processing',
    );
    const withdrawn = after(processed, withdrawRegionEditInvocation(loop, processing));
    appliedAndUndone(withdrawn, removeRegionInvocation(loop));
  });
});

describe('project.apply-region-edit', () => {
  it('adds processing to the end of the region’s chain, undone by withdrawing it', () => {
    const processing = louder(100, 200);
    const { next, entry } = appliedAndUndone(state, applyRegionEditInvocation(loop, processing));

    expect(next.project.regions.get(loop.id)?.operations).toEqual([processing]);
    expect(next.project.assets.get(footstep.id)?.edits).toEqual([]);
    expect(entry.description).toBe('Change the level of region “Walk loop”');
    expect(entry.inverse).toEqual([withdrawRegionEditInvocation(loop, processing)]);
  });

  it('refuses a duplicate identifier, processing that does not fit and an unknown region', () => {
    const processing = louder(0, 10);
    const processed = after(state, applyRegionEditInvocation(loop, processing));
    expect(refusalCodeOf(bus.execute(processed, applyRegionEditInvocation(loop, processing)))).toBe(
      'region.duplicate-operation',
    );
    expect(
      refusalCodeOf(bus.execute(state, applyRegionEditInvocation(loop, louder(0, 24_001)))),
    ).toBe('editing.region-operation-invalid');
    expect(
      refusalCodeOf(
        bus.execute(state, applyRegionEditInvocation(regionOn(footstep, 0, 10), processing)),
      ),
    ).toBe('region.unknown');
  });
});

describe('project.withdraw-region-edit', () => {
  it('withdraws the last processing, undone by applying it again', () => {
    const first = louder(0, 10);
    const last = louder(10, 20);
    const processed = after(
      state,
      applyRegionEditInvocation(loop, first),
      applyRegionEditInvocation(loop, last),
    );
    const { next, entry } = appliedAndUndone(processed, withdrawRegionEditInvocation(loop, last));

    expect(next.project.regions.get(loop.id)?.operations).toEqual([first]);
    expect(entry.description).toBe('Withdraw: Change the level of region “Walk loop”');
  });

  it('refuses any processing but the last', () => {
    const first = louder(0, 10);
    const processed = after(
      state,
      applyRegionEditInvocation(loop, first),
      applyRegionEditInvocation(loop, louder(10, 20)),
    );
    expect(refusalCodeOf(bus.execute(processed, withdrawRegionEditInvocation(loop, first)))).toBe(
      'region.not-last',
    );
  });
});
