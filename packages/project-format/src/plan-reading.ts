/**
 * Reading an edit plan, the value a paste carries (ADR-0051,
 * REQ-EXEC-136.12): its streams, each a rate, a layout and its segments, and
 * each segment's source and stages.
 *
 * The plan is read here by its shape and its bounds. Whether it is whole (each
 * segment reading a range its source has, each stage fitting the channels it
 * is given) depends on the project's assets, and is decided by the domain's
 * `validatePlan` where the plan is used, by the one rule a command and a
 * document share.
 */

import type {
  EditPlan,
  FadeCurve,
  GainCurve,
  PlanSegment,
  PlanSource,
  PlanStage,
  PlanStream,
} from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import {
  asChannelMatrix,
  asChannelScope,
  asFadeShape,
  asSignedGain,
} from './edit-value-reading.js';
import { asBoolean, asId, integerConverter, oneOfConverter } from './scalar-reading.js';
import {
  LONGEST_PROJECT_DOCUMENT,
  asChannelLayout,
  asSampleCount,
  asSampleRate,
} from './value-reading.js';

/**
 * Fewer code units than any stream, segment or stage is written in: the
 * shortest, a matrix stage with an empty matrix, takes 29.
 */
const SHORTEST_PLAN_ITEM = 16;

/**
 * The most streams, segments of one stream or stages of one segment a plan
 * holds. A plan's lists grow with the chain that made it, and pasting pasted
 * audio doubles its segments, so no count of operations bounds them; the
 * document's own length does. A list this long could not be written in a
 * project document, so the bound refuses nothing a document can hold, and
 * still keeps a hostile one from making the reader allocate past it.
 */
const MAXIMUM_PLAN_ITEMS = LONGEST_PROJECT_DOCUMENT / SHORTEST_PLAN_ITEM;

const PLAN_MEMBERS: ReadonlySet<string> = new Set(['streams']);
const STREAM_MEMBERS: ReadonlySet<string> = new Set(['sampleRate', 'layout', 'segments']);
const SEGMENT_MEMBERS: ReadonlySet<string> = new Set([
  'source',
  'start',
  'length',
  'reversed',
  'stages',
]);
const MEDIA_SOURCE_MEMBERS: ReadonlySet<string> = new Set(['kind', 'asset']);
const STREAM_SOURCE_MEMBERS: ReadonlySet<string> = new Set(['kind', 'stream']);
const GAIN_STAGE_MEMBERS: ReadonlySet<string> = new Set(['kind', 'from', 'to', 'channels', 'gain']);
const MATRIX_STAGE_MEMBERS: ReadonlySet<string> = new Set(['kind', 'range', 'matrix']);
const STAGE_RANGE_MEMBERS: ReadonlySet<string> = new Set(['from', 'to']);
const CONSTANT_MEMBERS: ReadonlySet<string> = new Set(['kind', 'gain']);
const FADE_MEMBERS: ReadonlySet<string> = new Set([
  'kind',
  'origin',
  'step',
  'length',
  'shape',
  'rising',
]);

const asSourceKind = oneOfConverter(['media', 'stream'] as const);
const asStageKind = oneOfConverter(['gain', 'matrix'] as const);
const asCurveKind = oneOfConverter(['constant', 'fade'] as const);

/** A stream of the plan a segment reads, by its place among the streams. */
const asStreamPlace = integerConverter(0, MAXIMUM_PLAN_ITEMS - 1);

/**
 * Where a fade began, in content frames. A fade made on reversed audio, or one
 * whose start was cut away, begins before the content it is on, so it may be
 * negative.
 */
const asFadeOrigin = integerConverter(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

/** Which way a fade's frames run through the content: 1 forwards, −1 backwards. */
const asStep: Converter<1 | -1> = (reading, value, parent, key) => {
  if (value === 1 || value === -1) return value;
  reading.refuse('schema.unknown-value', 'One of 1, -1 is expected here.', pathOf(parent, key));
  return undefined;
};

const readSource: Converter<PlanSource> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asSourceKind);
  if (kind === 'media') {
    checkMembers(reading, object, at, MEDIA_SOURCE_MEMBERS);
    const asset = required(reading, object, at, 'asset', asId<'AssetId'>);
    return asset === undefined ? undefined : { kind, asset };
  }
  if (kind === 'stream') {
    checkMembers(reading, object, at, STREAM_SOURCE_MEMBERS);
    const stream = required(reading, object, at, 'stream', asStreamPlace);
    return stream === undefined ? undefined : { kind, stream };
  }
  return undefined;
};

const readGainCurve: Converter<GainCurve> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asCurveKind);
  if (kind === 'constant') {
    checkMembers(reading, object, at, CONSTANT_MEMBERS);
    const gain = required(reading, object, at, 'gain', asSignedGain);
    return gain === undefined ? undefined : { kind, gain };
  }
  if (kind === 'fade') {
    checkMembers(reading, object, at, FADE_MEMBERS);
    return readFade(reading, object, at);
  }
  return undefined;
};

function readFade(reading: Reading, object: JsonObject, at: string): FadeCurve | undefined {
  const origin = required(reading, object, at, 'origin', asFadeOrigin);
  const step = required(reading, object, at, 'step', asStep);
  const length = required(reading, object, at, 'length', asSampleCount);
  const shape = required(reading, object, at, 'shape', asFadeShape);
  const rising = required(reading, object, at, 'rising', asBoolean);
  return origin === undefined ||
    step === undefined ||
    length === undefined ||
    shape === undefined ||
    rising === undefined
    ? undefined
    : { kind: 'fade', origin, step, length, shape, rising };
}

const readStageRange: Converter<{ readonly from: number; readonly to: number }> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = objectOf(reading, value, parent, key, STAGE_RANGE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const from = required(reading, object, at, 'from', asSampleCount);
  const to = required(reading, object, at, 'to', asSampleCount);
  return from === undefined || to === undefined ? undefined : { from, to };
};

const readStage: Converter<PlanStage> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asStageKind);
  if (kind === 'gain') {
    checkMembers(reading, object, at, GAIN_STAGE_MEMBERS);
    const from = required(reading, object, at, 'from', asSampleCount);
    const to = required(reading, object, at, 'to', asSampleCount);
    const channels = optional(reading, object, at, 'channels', asChannelScope);
    const gain = required(reading, object, at, 'gain', readGainCurve);
    return from === undefined || to === undefined || gain === undefined
      ? undefined
      : { kind, from, to, ...(channels === undefined ? {} : { channels }), gain };
  }
  if (kind === 'matrix') {
    checkMembers(reading, object, at, MATRIX_STAGE_MEMBERS);
    const range = optional(reading, object, at, 'range', readStageRange);
    const matrix = required(reading, object, at, 'matrix', asChannelMatrix);
    return matrix === undefined
      ? undefined
      : { kind, ...(range === undefined ? {} : { range }), matrix };
  }
  return undefined;
};

const asStages = listConverter(MAXIMUM_PLAN_ITEMS, readStage);

const readSegment: Converter<PlanSegment> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SEGMENT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const source = required(reading, object, at, 'source', readSource);
  const start = required(reading, object, at, 'start', asSampleCount);
  const length = required(reading, object, at, 'length', asSampleCount);
  const reversed = required(reading, object, at, 'reversed', asBoolean);
  const stages = required(reading, object, at, 'stages', asStages);
  return source === undefined ||
    start === undefined ||
    length === undefined ||
    reversed === undefined ||
    stages === undefined
    ? undefined
    : { source, start, length, reversed, stages };
};

const asSegments = listConverter(MAXIMUM_PLAN_ITEMS, readSegment);

const readStream: Converter<PlanStream> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, STREAM_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const sampleRate = required(reading, object, at, 'sampleRate', asSampleRate);
  const layout = required(reading, object, at, 'layout', asChannelLayout);
  const segments = required(reading, object, at, 'segments', asSegments);
  return sampleRate === undefined || layout === undefined || segments === undefined
    ? undefined
    : { sampleRate, layout, segments };
};

const asStreams = listConverter(MAXIMUM_PLAN_ITEMS, readStream);

/** Reads an edit plan, or a clipboard payload, which is one. */
export const readEditPlan: Converter<EditPlan> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, PLAN_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const streams = required(reading, object, at, 'streams', asStreams);
  if (streams === undefined) return undefined;
  const [first, ...rest] = streams;
  if (first === undefined) {
    reading.refuse(
      'edit.plan-without-stream',
      'A plan holds at least one stream.',
      pathOf(at, 'streams'),
    );
    return undefined;
  }
  return { streams: [first, ...rest] };
};
