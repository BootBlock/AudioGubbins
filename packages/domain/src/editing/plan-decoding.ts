/**
 * A plan read back from a value that crossed a thread.
 *
 * A plan crosses to the feeder, render and peak workers as a structured clone
 * (ADR-0052), and a worker trusts no message, so this checks each member's
 * type and bounds the work a plan can ask for before anything renders it. Its
 * meaning, every range and channel, is then checked by `validatePlan`. The
 * project document reads plans from its own JSON with its own reader; this
 * one reads the in-memory form a clone gives.
 *
 * Reading goes on past the first problem with a stand-in value, as the
 * project format's reader does, and the first problem is what is answered.
 */

import {
  ChannelRole,
  StandardLayouts,
  channelLayout,
  type ChannelLayout,
} from '../audio/channel-layout.js';
import { isWellFormedId, unsafeBrandId } from '../identity/branded-id.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import {
  ZERO_SAMPLES,
  sampleCount,
  sampleRate,
  type SampleCount,
  type SampleRate,
} from '../time/sample-time.js';
import { FadeShape } from './operations.js';
import type { EditPlan, GainCurve, PlanSegment, PlanSource, PlanStage, PlanStream } from './plan.js';

/** The most streams, segments and stages a message may hold. */
const LIMITS = { streams: 4_096, segments: 1_000_000, stages: 10_000, channels: 256 } as const;

const ROLES: ReadonlySet<string> = new Set(Object.values(ChannelRole));
const SHAPES: ReadonlySet<string> = new Set(Object.values(FadeShape));

function isRole(value: unknown): value is ChannelRole {
  return typeof value === 'string' && ROLES.has(value);
}

function isShape(value: unknown): value is FadeShape {
  return typeof value === 'string' && SHAPES.has(value);
}

type Fields = Readonly<Record<string, unknown>>;

/** A reading of one message: the first problem found, and the segments it may still hold. */
class Check {
  problem: string | undefined;
  segments: number = LIMITS.segments;

  wrong(what: string): void {
    this.problem ??= what;
  }

  fields(value: unknown, what: string): Fields {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value));
    }
    this.wrong(what);
    return {};
  }

  list(value: unknown, what: string, limit: number): readonly unknown[] {
    if (Array.isArray(value) && value.length <= limit) return value.map((item: unknown) => item);
    this.wrong(what);
    return [];
  }

  integer(value: unknown, what: string): number {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    this.wrong(what);
    return 0;
  }

  finite(value: unknown, what: string): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    this.wrong(what);
    return 0;
  }

  frames(value: unknown, what: string): SampleCount {
    const count = sampleCount(this.integer(value, what));
    if (count.ok) return count.value;
    this.wrong(what);
    return ZERO_SAMPLES;
  }

  rate(value: unknown): SampleRate | undefined {
    const rate = sampleRate(this.integer(value, 'a sample rate'));
    if (rate.ok) return rate.value;
    this.wrong('a sample rate');
    return undefined;
  }
}

function layoutOf(check: Check, value: unknown): ChannelLayout {
  const read = check.fields(value, 'a layout');
  const roles = check.list(read['roles'], 'a layout’s roles', LIMITS.channels).map((role) => {
    if (isRole(role)) return role;
    check.wrong('a channel role');
    return ChannelRole.Discrete;
  });
  const labels =
    read['labels'] === undefined
      ? undefined
      : check.list(read['labels'], 'a layout’s labels', LIMITS.channels).map((label) => {
          if (typeof label === 'string') return label;
          check.wrong('a channel label');
          return '';
        });
  if (read['ambisonic'] !== undefined) check.wrong('a layout a plan can carry');
  const layout = channelLayout(roles, labels);
  if (layout.ok) return layout.value;
  check.wrong('a channel layout');
  return StandardLayouts.mono;
}

function curveOf(check: Check, value: unknown): GainCurve {
  const read = check.fields(value, 'a gain');
  if (read['kind'] === 'constant') return { kind: 'constant', gain: check.finite(read['gain'], 'a gain') };
  const { step, shape, rising } = read;
  if (read['kind'] !== 'fade' || !isShape(shape) || typeof rising !== 'boolean' || (step !== 1 && step !== -1)) {
    check.wrong('a fade');
    return { kind: 'constant', gain: 1 };
  }
  return {
    kind: 'fade',
    origin: check.integer(read['origin'], 'a fade’s origin'),
    step,
    length: check.integer(read['length'], 'a fade’s length'),
    shape,
    rising,
  };
}

function stageOf(check: Check, value: unknown): PlanStage {
  const read = check.fields(value, 'a stage');
  if (read['kind'] === 'gain') {
    const channels =
      read['channels'] === undefined
        ? undefined
        : check
            .list(read['channels'], 'a stage’s channels', LIMITS.channels)
            .map((channel) => check.integer(channel, 'a channel'));
    return {
      kind: 'gain',
      from: check.integer(read['from'], 'a stage’s range'),
      to: check.integer(read['to'], 'a stage’s range'),
      ...(channels === undefined ? {} : { channels }),
      gain: curveOf(check, read['gain']),
    };
  }
  if (read['kind'] !== 'matrix') check.wrong('a stage');
  const range = read['range'] === undefined ? undefined : check.fields(read['range'], 'a stage’s range');
  const matrix = check
    .list(read['matrix'], 'a matrix', LIMITS.channels)
    .map((row) =>
      check.list(row, 'a matrix row', LIMITS.channels).map((factor) => check.finite(factor, 'a matrix factor')),
    );
  return {
    kind: 'matrix',
    ...(range === undefined
      ? {}
      : { range: { from: check.integer(range['from'], 'a range'), to: check.integer(range['to'], 'a range') } }),
    matrix,
  };
}

function sourceOf(check: Check, value: unknown): PlanSource {
  const read = check.fields(value, 'a segment’s source');
  const asset = read['asset'];
  if (read['kind'] === 'media' && typeof asset === 'string' && isWellFormedId(asset)) {
    return { kind: 'media', asset: unsafeBrandId<'AssetId'>(asset) };
  }
  if (read['kind'] !== 'stream') check.wrong('a segment’s source');
  return { kind: 'stream', stream: check.integer(read['stream'], 'a stream') };
}

function segmentOf(check: Check, value: unknown): PlanSegment {
  const read = check.fields(value, 'a segment');
  const reversed = read['reversed'];
  if (typeof reversed !== 'boolean') check.wrong('a segment’s direction');
  return {
    source: sourceOf(check, read['source']),
    start: check.frames(read['start'], 'a segment’s start'),
    length: check.frames(read['length'], 'a segment’s length'),
    reversed: reversed === true,
    stages: check.list(read['stages'], 'a segment’s stages', LIMITS.stages).map((stage) => stageOf(check, stage)),
  };
}

function streamOf(check: Check, value: unknown): PlanStream | undefined {
  const read = check.fields(value, 'a stream');
  const rate = check.rate(read['sampleRate']);
  const segments = check.list(read['segments'], 'a stream’s segments', check.segments);
  check.segments -= segments.length;
  return rate === undefined
    ? undefined
    : {
        sampleRate: rate,
        layout: layoutOf(check, read['layout']),
        segments: segments.map((segment) => segmentOf(check, segment)),
      };
}

/** The plan `value` holds, bounded, or why it holds none. */
export function editPlanFrom(value: unknown): DomainResult<EditPlan> {
  const check = new Check();
  const streams = check
    .list(check.fields(value, 'a plan')['streams'], 'a plan’s streams', LIMITS.streams)
    .map((stream) => streamOf(check, stream))
    .filter((stream) => stream !== undefined);
  const [first, ...rest] = streams;
  if (first === undefined) check.wrong('a plan with a stream');
  return check.problem === undefined && first !== undefined
    ? succeed({ streams: [first, ...rest] })
    : fail(
        failure(
          'editing.plan-unreadable',
          FailureKind.Rejected,
          `A plan that crossed a thread is not ${check.problem ?? 'a plan'}.`,
        ),
      );
}
