import { describe, expect, it } from 'vitest';

import {
  AssetOrigin,
  StandardLayouts,
  createDeterministicIdGenerator,
  createProject,
  derivedSampleCount,
  instantiateProcessor,
  sampleRate,
  type Asset,
  type EditPlan,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { nobleTextSha256, type AvailabilityContext } from '@audiogubbins/model-packs';
import { PINNED_RUNTIME_SHA256, PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import type { ProjectState } from '@audiogubbins/project-format';

import { projectNeeds } from './pack-needs.js';

const ids = createDeterministicIdGenerator(71);
const RATE = expectSuccess(sampleRate(48_000));
const LAYOUT = StandardLayouts.mono;

/** Nothing kept and nothing offered, on a device that runs every pack. */
const NOTHING_KEPT: AvailabilityContext = {
  packs: [],
  catalogue: [],
  runtime: { name: 'onnxruntime-web', version: '1.30.0', webAssemblySha256: PINNED_RUNTIME_SHA256 },
  device: { status: 'full', explanation: '', missingRequired: [], missingPreferred: [] },
  sha256: nobleTextSha256,
};

/** A chain of one processor of the machine-learning type `typeKey`. */
function modelChain(typeKey: string): EffectChain {
  const descriptor = PROCESSOR_CATALOGUE.get(typeKey);
  if (descriptor === undefined) throw new Error(`The catalogue lists ${typeKey}.`);
  return { id: ids.next(), slots: [instantiateProcessor(ids.next(), descriptor)] };
}

describe('what a project needs of the model packs (REQ-AUDIO-139)', () => {
  it('needs the model of a chain that pasted audio carries, as of the project’s own chains', () => {
    const own = modelChain('deepfilternet-3');
    const carried = modelChain('mossformer2-se-48k');
    const payload: EditPlan = {
      streams: [
        {
          sampleRate: RATE,
          layout: LAYOUT,
          segments: [],
          processing: { kind: 'chain', chain: carried, input: LAYOUT },
        },
      ],
    };
    const asset: Asset = {
      id: ids.next<'AssetId'>(),
      displayName: 'Pasted into',
      origin: AssetOrigin.Imported,
      sampleRate: RATE,
      channelLayout: LAYOUT,
      length: derivedSampleCount(100),
      storageKey: 'pasted',
      edits: [
        {
          id: ids.next<'EditOperationId'>(),
          kind: 'insert',
          at: derivedSampleCount(0),
          payload,
        },
      ],
    };
    const project = createProject(ids.next<'ProjectId'>(), 'Pasted', {
      sampleRate: RATE,
      channelLayout: LAYOUT,
    });
    const state: ProjectState = {
      project: {
        ...project,
        assets: new Map([[asset.id, asset]]),
        effectChains: new Map([[own.id, own]]),
      },
      sources: new Map(),
    };

    const needs = projectNeeds(state, NOTHING_KEPT);

    expect(needs.map((need) => [need.label, need.availability.condition])).toEqual([
      ['DeepFilterNet 3', 'required-unavailable'],
      ['MossFormer2 SE 48K', 'required-unavailable'],
    ]);
  });
});
