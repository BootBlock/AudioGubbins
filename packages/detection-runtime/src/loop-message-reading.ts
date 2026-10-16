/**
 * Reading a loop analysis's request and answer after they crossed a thread,
 * field by field (REQ-EXEC-136.12), as `detection-message-reading.ts` reads a
 * detection's: down to each metric's verdict and each candidate, so the page
 * never shows or offers a boundary it has not checked. A reader throws at the
 * first wrong field, which the message's reader turns into a failure naming
 * it. What a request asks is checked again where it is analysed, against the
 * region it is read from (`checkLoopRequest`); here, only its shape.
 */

import {
  FadeShape,
  Malformed,
  boundedItemsOf,
  countAt,
  fieldsOf,
  flagAt,
  numberAt,
  oneOf,
  oneOfValues,
  rateAt,
  sampleArraysAt,
  textAt,
  type MessageFields,
} from '@audiogubbins/domain';
import {
  MOST_CANDIDATES,
  type AnalysedLoop,
  type CrossfadeSuitability,
  type LoopAnalysis,
  type LoopAnalysisRequest,
  type LoopCandidate,
  type LoopMetric,
  type LoopMetrics,
  type LoopSearch,
  type MetricUnit,
  type SeamReference,
  type SuggestedCrossfade,
  type Verdict,
} from '@audiogubbins/loop-analysis';

/** Every verdict, keyed by itself, so the compiler holds the list to the type. */
const VERDICTS: Readonly<Record<Verdict, Verdict>> = {
  pass: 'pass',
  warn: 'warn',
  fail: 'fail',
  'not-applicable': 'not-applicable',
};

/** The verdicts a whole loop can have: a loop always has a metric that applies. */
type LoopVerdict = Exclude<Verdict, 'not-applicable'>;
const LOOP_VERDICTS: Readonly<Record<LoopVerdict, LoopVerdict>> = {
  pass: 'pass',
  warn: 'warn',
  fail: 'fail',
};

const UNITS: Readonly<Record<MetricUnit, MetricUnit>> = {
  deviations: 'deviations',
  dBFS: 'dBFS',
  dB: 'dB',
  degrees: 'degrees',
  frames: 'frames',
  ratio: 'ratio',
};

const REFERENCES: Readonly<Record<SeamReference, SeamReference>> = {
  'post-end': 'post-end',
  'pre-start': 'pre-start',
  adjacent: 'adjacent',
};

function loopOf(value: unknown, field: string): AnalysedLoop {
  const loop = fieldsOf(value, field);
  return {
    start: countAt(loop, 'start'),
    end: countAt(loop, 'end'),
    crossfadeLength: countAt(loop, 'crossfadeLength'),
    crossfadeShape: oneOf(loop, 'crossfadeShape', FadeShape),
  };
}

function searchOf(value: unknown, field: string): LoopSearch {
  const search = fieldsOf(value, field);
  return {
    radiusFrames: countAt(search, 'radiusFrames'),
    keepLength: flagAt(search, 'keepLength'),
    candidates: countAt(search, 'candidates'),
  };
}

/** A loop analysis's request, named `field`. */
export function loopRequestOf(value: unknown, field: string): LoopAnalysisRequest {
  const request = fieldsOf(value, field);
  const search = request['search'];
  return {
    loop: loopOf(request['loop'], `${field}.loop`),
    ...(search === undefined ? {} : { search: searchOf(search, `${field}.search`) }),
  };
}

function metricOf(value: unknown, field: string): LoopMetric {
  const metric = fieldsOf(value, field);
  const { channel, reference, reason } = metric;
  return {
    value: numberAt(metric, 'value'),
    unit: oneOf(metric, 'unit', UNITS),
    verdict: oneOf(metric, 'verdict', VERDICTS),
    channel: channel === undefined ? undefined : countAt(metric, 'channel'),
    ...(reference === undefined
      ? {}
      : { reference: oneOfValues(reference, `${field}.reference`, REFERENCES) }),
    ...(reason === undefined ? {} : { reason: textAt(metric, 'reason') }),
  };
}

function suitabilityOf(value: unknown, field: string): CrossfadeSuitability {
  const suitability = fieldsOf(value, field);
  return {
    lengthFrames: countAt(suitability, 'lengthFrames'),
    correlation: numberAt(suitability, 'correlation'),
    shape: oneOf(suitability, 'shape', FadeShape),
    levelChangeDb: numberAt(suitability, 'levelChangeDb'),
    verdict: oneOf(suitability, 'verdict', VERDICTS),
  };
}

function metricsOf(value: unknown, field: string): LoopMetrics {
  const metrics = fieldsOf(value, field);
  const at = (name: string): LoopMetric => metricOf(metrics[name], `${field}.${name}`);
  const zeroCrossing = fieldsOf(metrics['zeroCrossing'], `${field}.zeroCrossing`);
  const stability = fieldsOf(metrics['cycleStability'], `${field}.cycleStability`);
  const crossfade = metrics['crossfade'];
  return {
    discontinuity: at('discontinuity'),
    dcMismatch: at('dcMismatch'),
    netDc: at('netDc'),
    levelMismatch: at('levelMismatch'),
    phaseMismatch: at('phaseMismatch'),
    spectralMismatch: at('spectralMismatch'),
    zeroCrossing: {
      start: metricOf(zeroCrossing['start'], `${field}.zeroCrossing.start`),
      end: metricOf(zeroCrossing['end'], `${field}.zeroCrossing.end`),
      signs: metricOf(zeroCrossing['signs'], `${field}.zeroCrossing.signs`),
    },
    crossfade: crossfade === undefined ? undefined : suitabilityOf(crossfade, `${field}.crossfade`),
    cycleStability: {
      seam: metricOf(stability['seam'], `${field}.cycleStability.seam`),
      drift: metricOf(stability['drift'], `${field}.cycleStability.drift`),
    },
  };
}

function suggestedOf(value: unknown, field: string): SuggestedCrossfade {
  const suggested = fieldsOf(value, field);
  return {
    lengthFrames: countAt(suggested, 'lengthFrames'),
    shape: oneOf(suggested, 'shape', FadeShape),
  };
}

/** A signed whole number of frames, as a boundary's move is. */
function movedAt(fields: MessageFields, field: string): number {
  const value = numberAt(fields, field);
  if (!Number.isSafeInteger(value)) throw new Malformed(field, 'a whole number of frames');
  return value;
}

function candidateOf(value: unknown, field: string): LoopCandidate {
  const candidate = fieldsOf(value, field);
  const moved = fieldsOf(candidate['moved'], `${field}.moved`);
  const crossfade = candidate['crossfade'];
  return {
    rank: countAt(candidate, 'rank'),
    start: countAt(candidate, 'start'),
    end: countAt(candidate, 'end'),
    moved: { start: movedAt(moved, 'start'), end: movedAt(moved, 'end') },
    cost: numberAt(candidate, 'cost'),
    metrics: metricsOf(candidate['metrics'], `${field}.metrics`),
    crossfade: crossfade === undefined ? undefined : suggestedOf(crossfade, `${field}.crossfade`),
    makesRoomForCrossfade: flagAt(candidate, 'makesRoomForCrossfade'),
  };
}

/** A loop analysis, named `field`. */
export function loopAnalysisOf(value: unknown, field: string): LoopAnalysis {
  const analysis = fieldsOf(value, field);
  const channels = countAt(analysis, 'channels');
  const seam = fieldsOf(analysis['seam'], `${field}.seam`);
  const tail = sampleArraysAt(seam, 'tail');
  const head = sampleArraysAt(seam, 'head');
  if (tail.length !== channels || head.length !== channels) {
    throw new Malformed(`${field}.seam`, 'a tail and a head for each channel');
  }
  return {
    version: countAt(analysis, 'version'),
    sampleRate: rateAt(analysis, 'sampleRate'),
    channels,
    windowFrames: countAt(analysis, 'windowFrames'),
    current: metricsOf(analysis['current'], `${field}.current`),
    verdict: oneOf(analysis, 'verdict', LOOP_VERDICTS),
    candidates: boundedItemsOf(
      analysis['candidates'],
      `${field}.candidates`,
      MOST_CANDIDATES,
      candidateOf,
    ),
    seam: { tail, head },
  };
}
