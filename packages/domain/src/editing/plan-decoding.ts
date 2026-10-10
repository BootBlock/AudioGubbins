/**
 * A plan read back from a value that crossed a thread.
 *
 * A plan crosses to the feeder, render and peak workers as a structured clone
 * (ADR-0052), and a worker trusts no message, so this checks each member's
 * type, by the one reader of a message's fields, and bounds the work a plan
 * can ask for before anything renders it. Its meaning, every range and
 * channel, is then checked by `validatePlan`. The project document reads
 * plans from its own JSON with its own reader; this one reads the in-memory
 * form a clone gives.
 */

import { ambisonicLayout } from '../audio/ambisonic-layout.js';
import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  ChannelRole,
  channelLayout,
  type ChannelLayout,
} from '../audio/channel-layout.js';
import {
  Malformed,
  boundedItemsOf,
  fieldsOf,
  flagOf,
  identifierOf,
  numberOf,
  oneOfValues,
  rateOf,
  sampleCountOf,
  textOf,
  type MessageFields,
} from '../messages/message-fields.js';
import { effectChainOf } from '../processing/chain-decoding.js';
import type { EffectChain } from '../processing/effect-chain.js';
import { spectralMaskOf } from '../spectral/mask-decoding.js';
import type { PlannedSpectralEdit, PlannedSpectralOperation } from '../spectral/spectral-edit.js';
import { FadeShape } from './fades.js';
import type {
  EditPlan,
  GainCurve,
  PlanSegment,
  PlanSource,
  PlanStage,
  PlanStream,
  StreamProcessing,
} from './plan.js';

/** The most streams, segments and stages a message may hold. */
const LIMITS = { streams: 4_096, segments: 1_000_000, stages: 10_000, channels: 256 } as const;

/**
 * The value, named `field`, as a whole number of either sign: a stage's range
 * and a fade's origin are positions `validatePlan` places, not counts.
 */
function integerOf(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Malformed(field, 'a whole number');
  }
  return value;
}

/** An ambisonic layout, rebuilt from its convention, which states every channel. */
function ambisonicOf(value: unknown, field: string): ChannelLayout {
  const read = fieldsOf(value, field);
  const layout = ambisonicLayout({
    order: integerOf(read['order'], `${field}.order`),
    ordering: oneOfValues(read['ordering'], `${field}.ordering`, AmbisonicOrdering),
    normalisation: oneOfValues(
      read['normalisation'],
      `${field}.normalisation`,
      AmbisonicNormalisation,
    ),
  });
  if (!layout.ok) throw new Malformed(field, 'an ambisonic convention');
  return layout.value;
}

/** The channel layout `value` holds, named `field`, read member by member. */
export function layoutOf(value: unknown, field: string): ChannelLayout {
  const read = fieldsOf(value, field);
  if (read['ambisonic'] !== undefined) return ambisonicOf(read['ambisonic'], `${field}.ambisonic`);
  const roles = boundedItemsOf(read['roles'], `${field}.roles`, LIMITS.channels, (role, name) =>
    oneOfValues(role, name, ChannelRole),
  );
  const labels =
    read['labels'] === undefined
      ? undefined
      : boundedItemsOf(read['labels'], `${field}.labels`, LIMITS.channels, textOf);
  const layout = channelLayout(roles, labels);
  if (!layout.ok) throw new Malformed(field, 'a channel layout');
  return layout.value;
}

function curveOf(value: unknown, field: string): GainCurve {
  const read = fieldsOf(value, field);
  if (read['kind'] === 'constant') {
    return { kind: 'constant', gain: numberOf(read['gain'], `${field}.gain`) };
  }
  if (read['kind'] !== 'fade') throw new Malformed(`${field}.kind`, 'constant or fade');
  const step = read['step'];
  if (step !== 1 && step !== -1) throw new Malformed(`${field}.step`, '1 or -1');
  return {
    kind: 'fade',
    origin: integerOf(read['origin'], `${field}.origin`),
    step,
    length: integerOf(read['length'], `${field}.length`),
    shape: oneOfValues(read['shape'], `${field}.shape`, FadeShape),
    rising: flagOf(read['rising'], `${field}.rising`),
  };
}

function matrixOf(value: unknown, field: string): readonly (readonly number[])[] {
  return boundedItemsOf(value, field, LIMITS.channels, (row, name) =>
    boundedItemsOf(row, name, LIMITS.channels, numberOf),
  );
}

function stageOf(value: unknown, field: string): PlanStage {
  const read = fieldsOf(value, field);
  if (read['kind'] === 'gain') {
    const { channels } = read;
    return {
      kind: 'gain',
      from: integerOf(read['from'], `${field}.from`),
      to: integerOf(read['to'], `${field}.to`),
      ...(channels === undefined
        ? {}
        : {
            channels: boundedItemsOf(channels, `${field}.channels`, LIMITS.channels, integerOf),
          }),
      gain: curveOf(read['gain'], `${field}.gain`),
    };
  }
  if (read['kind'] !== 'matrix') throw new Malformed(`${field}.kind`, 'gain or matrix');
  const range = read['range'] === undefined ? undefined : rangeOf(read['range'], `${field}.range`);
  return {
    kind: 'matrix',
    ...(range === undefined ? {} : { range }),
    matrix: matrixOf(read['matrix'], `${field}.matrix`),
  };
}

function rangeOf(value: unknown, field: string): { readonly from: number; readonly to: number } {
  const read = fieldsOf(value, field);
  return {
    from: integerOf(read['from'], `${field}.from`),
    to: integerOf(read['to'], `${field}.to`),
  };
}

function sourceOf(value: unknown, field: string): PlanSource {
  const read = fieldsOf(value, field);
  if (read['kind'] === 'media') {
    return { kind: 'media', asset: identifierOf<'AssetId'>(read['asset'], `${field}.asset`) };
  }
  if (read['kind'] === 'silence') {
    return { kind: 'silence', channels: integerOf(read['channels'], `${field}.channels`) };
  }
  if (read['kind'] === 'mix') {
    return {
      kind: 'mix',
      streams: boundedItemsOf(read['streams'], `${field}.streams`, LIMITS.streams, integerOf),
    };
  }
  if (read['kind'] !== 'stream') {
    throw new Malformed(`${field}.kind`, 'media, stream, silence or mix');
  }
  return { kind: 'stream', stream: integerOf(read['stream'], `${field}.stream`) };
}

function segmentOf(value: unknown, field: string): PlanSegment {
  const read = fieldsOf(value, field);
  return {
    source: sourceOf(read['source'], `${field}.source`),
    start: sampleCountOf(read['start'], `${field}.start`),
    length: sampleCountOf(read['length'], `${field}.length`),
    reversed: flagOf(read['reversed'], `${field}.reversed`),
    stages: boundedItemsOf(read['stages'], `${field}.stages`, LIMITS.stages, stageOf),
  };
}

function chainOf(value: unknown, field: string): EffectChain {
  const chain = effectChainOf(value, field);
  if (!chain.ok) throw new Malformed(field, `a chain (${chain.failures[0].summary})`);
  return chain.value;
}

function spectralOperationOf(value: unknown, field: string): PlannedSpectralOperation {
  const read = fieldsOf(value, field);
  switch (read['kind']) {
    case 'attenuate':
    case 'isolate':
      return { kind: read['kind'], gain: numberOf(read['gain'], `${field}.gain`) };
    case 'heal':
      return { kind: 'heal' };
    case 'process':
      return {
        kind: 'process',
        chain: chainOf(read['chain'], `${field}.chain`),
        input: layoutOf(read['input'], `${field}.input`),
      };
    default:
      throw new Malformed(`${field}.kind`, 'attenuate, isolate, heal or process');
  }
}

function spectralEditOf(value: unknown, field: string): PlannedSpectralEdit {
  const read = fieldsOf(value, field);
  const { channels } = read;
  return {
    mask: spectralMaskOf(read['mask'], `${field}.mask`),
    resolution: integerOf(read['resolution'], `${field}.resolution`),
    operation: spectralOperationOf(read['operation'], `${field}.operation`),
    ...(channels === undefined
      ? {}
      : { channels: boundedItemsOf(channels, `${field}.channels`, LIMITS.channels, integerOf) }),
  };
}

function processingOf(read: MessageFields, field: string): StreamProcessing {
  switch (read['kind']) {
    case 'stretch':
      return { kind: 'stretch', length: sampleCountOf(read['length'], `${field}.length`) };
    case 'chain':
      return {
        kind: 'chain',
        chain: chainOf(read['chain'], `${field}.chain`),
        input: layoutOf(read['input'], `${field}.input`),
      };
    case 'spectral':
      return { kind: 'spectral', edit: spectralEditOf(read['edit'], `${field}.edit`) };
    default:
      throw new Malformed(`${field}.kind`, 'chain, stretch or spectral');
  }
}

/** Reads streams whose segments together stay within the bound a plan may ask for. */
class StreamReader {
  #segments: number = LIMITS.segments;

  stream(value: unknown, field: string): PlanStream {
    const read = fieldsOf(value, field);
    const listed = read['segments'];
    const segments = boundedItemsOf(listed, `${field}.segments`, this.#segments, segmentOf);
    this.#segments -= segments.length;
    const processing =
      read['processing'] === undefined
        ? undefined
        : processingOf(fieldsOf(read['processing'], `${field}.processing`), `${field}.processing`);
    return {
      sampleRate: rateOf(read['sampleRate'], `${field}.sampleRate`),
      layout: layoutOf(read['layout'], `${field}.layout`),
      segments,
      ...(processing === undefined ? {} : { processing }),
    };
  }
}

/** The plan `value` holds, named `field`, bounded; a field reader for a message that carries one. */
export function editPlanOf(value: unknown, field: string): EditPlan {
  const reader = new StreamReader();
  const [first, ...rest] = boundedItemsOf(
    fieldsOf(value, field)['streams'],
    `${field}.streams`,
    LIMITS.streams,
    (stream, name) => reader.stream(stream, name),
  );
  if (first === undefined) throw new Malformed(`${field}.streams`, 'a list of at least one');
  return { streams: [first, ...rest] };
}
