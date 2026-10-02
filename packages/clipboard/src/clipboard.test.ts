import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  assetPlan,
  createDeterministicIdGenerator,
  derivedSampleCount,
  discreteLayout,
  regionPlan,
  sampleRate,
  shapeAfter,
  shapesOf,
  type Asset,
  type AssetId,
  type EditOperation,
  type EditPlan,
  type PlanSegment,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess, renderPlan } from '@audiogubbins/domain/testing';
import {
  NESTED_ARGUMENT_LIMITS,
  canonicalJson,
  writeEditOperation,
  type ProjectState,
} from '@audiogubbins/project-format';
import { referenceState } from '@audiogubbins/project-format/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { copyAudio, type CopiedAudio } from './copied-audio.js';
import { planPaste, type PasteRequest } from './paste-planning.js';

/**
 * Copying and pasting (ADR-0053), checked by what the result sounds like: each
 * paste is applied to its asset, and the asset's plan rendered by the domain's
 * own arithmetic is compared, sample for sample, with what the copy held and
 * the audio either side of it.
 */

const fixture = sampleProject();
const state = referenceState(fixture);
const footstep = fixture.assets.footstep;
const forest = fixture.assets.ambience;
const ids = createDeterministicIdGenerator(404);
const at = derivedSampleCount;

/** A recognisable sound for each asset: channel `c`, frame `f` is a value of both. */
function soundOf(asset: Asset): Float32Array[] {
  return asset.channelLayout.roles.map((_, channel) =>
    Float32Array.from({ length: asset.length }, (__, frame) =>
      Math.fround(((frame % 997) / 997 - 0.5) * (channel + 1) * 0.5),
    ),
  );
}

function sourcesOf(project: ProjectState): Map<AssetId, Float32Array[]> {
  return new Map([...project.project.assets.values()].map((asset) => [asset.id, soundOf(asset)]));
}

/** `state` with `asset` added beside its source, under a fresh identity. */
function withAsset(from: ProjectState, asset: Asset, like: Asset): ProjectState {
  const source = from.sources.get(like.id);
  if (source === undefined) throw new Error('The fixture asset has no source.');
  return {
    project: { ...from.project, assets: new Map(from.project.assets).set(asset.id, asset) },
    sources: new Map(from.sources).set(asset.id, source),
  };
}

/** The asset after `operations`, and its sound. */
function pasted(
  into: ProjectState,
  asset: Asset,
  operations: readonly EditOperation[],
): { readonly edited: Asset; readonly sound: readonly Float32Array[] } {
  const edited = { ...asset, edits: [...asset.edits, ...operations] };
  const assets = new Map(into.project.assets).set(asset.id, edited);
  const sources = sourcesOf({ ...into, project: { ...into.project, assets } });
  return { edited, sound: renderPlan(assetPlan(edited), sources) };
}

function copied(plan: EditPlan, start: number, end: number, channels?: readonly number[]) {
  return expectSuccess(copyAudio(state, plan, { start: at(start), end: at(end) }, channels));
}

function request(copy: CopiedAudio, asset: Asset, place: PasteRequest['place']): PasteRequest {
  return { copied: copy, asset: asset.id, place, convertRate: false };
}

/** The frames `[start, end)` of each channel of `sound`. */
function framesOf(sound: readonly Float32Array[], start: number, end: number): number[][] {
  return sound.map((channel) => [...channel.subarray(start, end)]);
}

describe('copying (ADR-0053)', () => {
  it('takes the range of the plan shown, with the unedited record of the media it reads', () => {
    const copy = copied(assetPlan(footstep), 1_000, 3_000);

    expect(copy.origin).toBe(state.project.id);
    expect(renderPlan(copy.payload, sourcesOf(state))).toEqual(
      framesOf(soundOf(footstep), 1_000, 3_000).map((frames) => Float32Array.from(frames)),
    );
    expect(copy.records).toEqual([
      { asset: state.project.assets.get(footstep.id), source: state.sources.get(footstep.id) },
    ]);
  });

  it('takes a region’s own processing with it, as the region sounds', () => {
    const loop = {
      ...fixture.regions.loop,
      operations: [
        {
          id: ids.next<'EditOperationId'>(),
          basis: 0,
          range: { start: at(0), end: at(24_000) },
          edit: { kind: 'gain', gain: 0.5 } as const,
        },
      ],
    };
    const plan = regionPlan(footstep, loop);
    const copy = copied(plan, 100, 200);

    expect(renderPlan(copy.payload, sourcesOf(state))).toEqual(
      soundOf(footstep).map((channel) =>
        Float32Array.from(channel.subarray(100, 200), (sample) => Math.fround(sample * 0.5)),
      ),
    );
  });

  it('takes only the channels chosen, keeping their roles', () => {
    const copy = copied(assetPlan(forest), 0, 10, [1]);

    expect(copy.payload.streams[0].layout.roles).toEqual(['right']);
    expect(renderPlan(copy.payload, sourcesOf(state))).toEqual([
      Float32Array.from(soundOf(forest)[1]?.subarray(0, 10) ?? []),
    ]);
  });
});

describe('pasting (ADR-0053)', () => {
  it('inserts what was copied at a position, the audio either side unchanged', () => {
    const copy = copied(assetPlan(footstep), 1_000, 1_500);
    const planned = expectSuccess(
      planPaste(state, request(copy, footstep, { kind: 'at', at: at(10_000) }), ids),
    );

    expect(planned.records).toEqual([]);
    expect(planned.operations.map((operation) => operation.kind)).toEqual(['insert']);
    const { sound } = pasted(state, footstep, planned.operations);
    const original = soundOf(footstep);
    expect(framesOf(sound, 0, 10_000)).toEqual(framesOf(original, 0, 10_000));
    expect(framesOf(sound, 10_000, 10_500)).toEqual(framesOf(original, 1_000, 1_500));
    expect(framesOf(sound, 10_500, 24_500)).toEqual(framesOf(original, 10_000, 24_000));
  });

  it('replaces a range with what was copied, as one deletion and one insertion', () => {
    const copy = copied(assetPlan(footstep), 0, 100);
    const planned = expectSuccess(
      planPaste(
        state,
        request(copy, footstep, { kind: 'replace', range: { start: at(500), end: at(2_500) } }),
        ids,
      ),
    );

    expect(planned.operations.map((operation) => operation.kind)).toEqual(['delete', 'insert']);
    const { sound } = pasted(state, footstep, planned.operations);
    const original = soundOf(footstep);
    expect(sound[0]?.length).toBe(24_000 - 2_000 + 100);
    expect(framesOf(sound, 500, 600)).toEqual(framesOf(original, 0, 100));
    expect(framesOf(sound, 600, 700)).toEqual(framesOf(original, 2_500, 2_600));
  });

  it('fits a stereo copy to a mono asset by the stated conversion, averaging left and right', () => {
    const copy = copied(assetPlan(forest), 0, 50);
    const planned = expectSuccess(
      planPaste(state, request(copy, footstep, { kind: 'at', at: at(0) }), ids),
    );

    const { sound } = pasted(state, footstep, planned.operations);
    const [left, right] = soundOf(forest);
    expect(framesOf(sound, 0, 50)).toEqual([
      Array.from({ length: 50 }, (_, frame) =>
        Math.fround(((left?.[frame] ?? 0) + (right?.[frame] ?? 0)) * 0.5),
      ),
    ]);
  });

  it('refuses channels the domain states no conversion for, saying why', () => {
    const odd: Asset = {
      ...forest,
      id: ids.next<'AssetId'>(),
      channelLayout: expectSuccess(discreteLayout(3)),
    };
    const withOdd = withAsset(state, odd, forest);
    const copy = expectSuccess(copyAudio(withOdd, assetPlan(odd), { start: at(0), end: at(10) }));
    const refused = planPaste(withOdd, request(copy, footstep, { kind: 'at', at: at(0) }), ids);

    expect(expectFailureCode(refused)).toBe('clipboard.layout-differs');
    expect(refused.ok ? '' : refused.failures[0].summary).toMatch(
      /^The copied audio’s channels cannot be fitted to this audio’s: ./u,
    );
  });

  it('pastes audio at another rate only when it is asked to convert it', () => {
    const slower: Asset = {
      ...footstep,
      id: ids.next<'AssetId'>(),
      sampleRate: expectSuccess(sampleRate(44_100)),
    };
    const withSlower = withAsset(state, slower, footstep);
    const copy = expectSuccess(
      copyAudio(withSlower, assetPlan(slower), { start: at(0), end: at(441) }),
    );
    const place = { kind: 'at', at: at(0) } as const;

    expect(expectFailureCode(planPaste(withSlower, request(copy, footstep, place), ids))).toBe(
      'editing.payload-rate',
    );
    const converted = expectSuccess(
      planPaste(withSlower, { ...request(copy, footstep, place), convertRate: true }, ids),
    );
    const [insertion] = converted.operations;
    const before = shapesOf(footstep).at(-1);
    if (before === undefined) throw new Error('No shape.');
    // 441 frames at 44.1 kHz are 480 at 48 kHz.
    expect(shapeAfter(before, insertion).length - before.length).toBe(480);
  });

  it('brings the records of media another project lacks, and refuses one it holds differently', () => {
    const other = referenceState(sampleProject(77));
    const copy = copied(assetPlan(footstep), 0, 100);
    const target = other.project.assets.values().next().value;
    if (target === undefined) throw new Error('The other project has no asset.');

    const planned = expectSuccess(
      planPaste(other, request(copy, target, { kind: 'at', at: at(0) }), ids),
    );
    expect(planned.records).toEqual(copy.records);

    const record = copy.records[0];
    if (record === undefined) throw new Error('The copy reads no media.');
    const { media } = record.source;
    if (media.kind !== 'managed') throw new Error('The footstep is managed.');
    // The same asset, held with the bytes of another file.
    const clashing: ProjectState = {
      project: {
        ...other.project,
        assets: new Map(other.project.assets).set(record.asset.id, record.asset),
      },
      sources: new Map(other.sources).set(record.asset.id, {
        media: { ...media, byteLength: media.byteLength + 2 },
      }),
    };
    expect(
      expectFailureCode(planPaste(clashing, request(copy, target, { kind: 'at', at: at(0) }), ids)),
    ).toBe('clipboard.source-differs');
  });

  it('splits a payload too long for one argument into consecutive insertions between its segments', () => {
    const count = 200_000;
    const segments: PlanSegment[] = Array.from({ length: count }, (_, index) => ({
      source: { kind: 'media', asset: footstep.id },
      start: at(index % 24_000),
      length: at(1),
      reversed: index % 2 === 1,
      stages: [],
    }));
    const copy: CopiedAudio = {
      origin: state.project.id,
      payload: {
        streams: [{ sampleRate: footstep.sampleRate, layout: StandardLayouts.mono, segments }],
      },
      records: copied(assetPlan(footstep), 0, 1).records,
    };
    const planned = expectSuccess(
      planPaste(state, request(copy, footstep, { kind: 'at', at: at(7) }), ids),
    );

    expect(planned.operations.length).toBeGreaterThan(1);
    let position = 7;
    const joined: PlanSegment[] = [];
    for (const operation of planned.operations) {
      if (operation.kind !== 'insert') throw new Error('A paste at a position only inserts.');
      expect(operation.at).toBe(position);
      expect(canonicalJson(writeEditOperation(operation)).length).toBeLessThanOrEqual(
        NESTED_ARGUMENT_LIMITS.maximumLength,
      );
      joined.push(...operation.payload.streams[0].segments);
      position += operation.payload.streams[0].segments.length;
    }
    expect(joined).toEqual(segments);
    // The whole would not have fitted, so the split was needed.
    expect(
      canonicalJson(
        writeEditOperation({
          id: ids.next<'EditOperationId'>(),
          kind: 'insert',
          at: at(7),
          payload: copy.payload,
          convertRate: false,
        }),
      ).length,
    ).toBeGreaterThan(NESTED_ARGUMENT_LIMITS.maximumLength);
  });
});
