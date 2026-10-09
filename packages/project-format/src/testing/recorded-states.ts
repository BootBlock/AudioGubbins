/**
 * Project states with recordings, for tests (ADR-0071, ADR-0072): the
 * reference state with two takes recorded over a range of its footstep, each
 * a recorded asset with its provenance, gathered in a punch stack the
 * footstep's chain punches with, and that state with the punch's crossfade
 * copied and pasted.
 */

import {
  AssetOrigin,
  FadeShape,
  TakeState,
  assetPlan,
  derivedSampleCount,
  slicePlan,
  type Asset,
  type EditOperation,
  type TakeStack,
} from '@audiogubbins/domain';

import { expectSuccess, TEST_CATALOGUE, TEST_ENGINE } from '@audiogubbins/domain/testing';

import {
  CaptureProfileKind,
  RecordingEnding,
  type RecordedProvenance,
} from '../recorded-provenance.js';
import { storageKeyOf, type AssetSource, type ProjectState } from '../project-state.js';
import { contentIdOfDigit, referenceState, type SampleProject } from './project-states.js';

/** The frames each take holds before the punched range: its pre-roll. */
const PRE_ROLL = 4_800;

/** The punched range of the footstep. */
const PUNCHED = { start: 12_000, end: 24_000 } as const;

/** A recorded asset of `footstep`'s rate and layout, `length` frames long, and its source. */
function recordedAsset(
  fixture: SampleProject,
  footstep: Asset,
  digit: string,
  length: number,
): { readonly asset: Asset; readonly source: AssetSource } {
  const id = fixture.ids.next<'AssetId'>();
  const media = {
    kind: 'managed',
    contentId: contentIdOfDigit(digit),
    byteLength: 44 + length * 4,
    mediaType: 'audio/wav',
  } as const;
  const recording: RecordedProvenance = {
    recordedAt: 1_760_000_000_000,
    device: { label: 'USB Audio Interface (2-ch)', group: 'group-7', channelCount: 2 },
    profile: { kind: CaptureProfileKind.RawStudio, name: 'Raw/Studio' },
    requested: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
    },
    granted: { echoCancellation: false, noiseSuppression: true, sampleRate: footstep.sampleRate },
    sampleRate: footstep.sampleRate,
    layout: footstep.channelLayout,
    length: derivedSampleCount(length),
    ending: RecordingEnding.Stopped,
  };
  return {
    asset: {
      id,
      displayName: `Take ${digit}`,
      origin: AssetOrigin.Recorded,
      sampleRate: footstep.sampleRate,
      channelLayout: footstep.channelLayout,
      length: derivedSampleCount(length),
      storageKey: storageKeyOf(id, media),
      edits: [],
    },
    source: {
      media,
      provenance: {
        importedAt: 1_760_000_060_000,
        byteLength: media.byteLength,
        mediaType: media.mediaType,
        originProjectId: fixture.project.id,
        recording,
      },
    },
  };
}

/**
 * The reference state with a punch over 12,000 to 24,000 of the footstep, its
 * stack holding two takes of 4,800 frames of pre-roll and the range, the
 * second chosen; the first take's recording runs on past the range.
 */
export function punchedState(fixture: SampleProject): ProjectState {
  const state = referenceState(fixture);
  const footstep = state.project.assets.get(fixture.assets.footstep.id);
  if (footstep === undefined) throw new Error('The reference state has no footstep.');
  const length = PUNCHED.end - PUNCHED.start;
  const first = recordedAsset(fixture, footstep, 'e', PRE_ROLL + length + 2_400);
  const second = recordedAsset(fixture, footstep, 'f', PRE_ROLL + length);
  const chosen = fixture.ids.next<'TakeId'>();
  const stack: TakeStack = {
    id: fixture.ids.next<'TakeStackId'>(),
    name: 'Footstep punch',
    takes: [
      {
        id: fixture.ids.next<'TakeId'>(),
        asset: first.asset.id,
        name: 'Take 1',
        note: 'A little early.',
        state: TakeState.Rejected,
        compensation: 0,
      },
      {
        id: chosen,
        asset: second.asset.id,
        name: 'Take 2',
        note: '',
        state: TakeState.Kept,
        compensation: 0,
      },
    ],
    chosen,
    punch: {
      length: derivedSampleCount(length),
      preRoll: derivedSampleCount(PRE_ROLL),
      postRoll: derivedSampleCount(0),
      crossfade: { length: derivedSampleCount(480), shape: FadeShape.EqualPower },
      resampler: 1,
    },
  };
  const punch: EditOperation = {
    id: fixture.ids.next<'EditOperationId'>(),
    kind: 'process',
    range: { start: derivedSampleCount(PUNCHED.start), end: derivedSampleCount(PUNCHED.end) },
    edit: { kind: 'punch', stack: stack.id },
  };
  const assets = new Map(state.project.assets)
    .set(footstep.id, { ...footstep, edits: [...footstep.edits, punch] })
    .set(first.asset.id, first.asset)
    .set(second.asset.id, second.asset);
  return {
    project: {
      ...state.project,
      assets,
      takeStacks: new Map([[stack.id, stack]]),
    },
    sources: new Map(state.sources)
      .set(first.asset.id, first.source)
      .set(second.asset.id, second.source),
  };
}

/**
 * The punched state with the footstep's first crossfade copied and pasted at
 * its start, so its chain holds a paste whose plan mixes streams (ADR-0072).
 */
export function pastedPunchState(fixture: SampleProject): ProjectState {
  const state = punchedState(fixture);
  const footstep = state.project.assets.get(fixture.assets.footstep.id);
  if (footstep === undefined) throw new Error('The punched state has its footstep.');
  const plan = expectSuccess(
    assetPlan(footstep, {
      chains: state.project.effectChains,
      takeStacks: state.project.takeStacks,
      assets: state.project.assets,
      catalogue: TEST_CATALOGUE,
      engine: TEST_ENGINE,
    }),
  );
  const paste: EditOperation = {
    id: fixture.ids.next<'EditOperationId'>(),
    kind: 'insert',
    at: derivedSampleCount(0),
    payload: expectSuccess(slicePlan(plan, PUNCHED.start - 100, PUNCHED.start + 600)),
  };
  const assets = new Map(state.project.assets).set(footstep.id, {
    ...footstep,
    edits: [...footstep.edits, paste],
  });
  return { ...state, project: { ...state.project, assets } };
}
