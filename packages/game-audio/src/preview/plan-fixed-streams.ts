/**
 * The fixed streams of a game preview's plan written for its horizon and end
 * (ADR-0104, `plan-layout.ts`): the sound, the mix of the buses to the
 * horizon, folded to the project's layout; each bus the mix of its emitters'
 * streams through its gain; each emitter's stream of a bus the mix of its
 * lanes of the bus through its panner, one segment for each set of lanes it
 * had, its motion laid as automation through the end.
 */

import {
  conversionMatrix,
  derivedSampleCount,
  type PlanSegment,
  type PlanStage,
} from '@audiogubbins/domain';

import { motionLanes } from './motion.js';
import { STEREO, isStereo } from './plan-layout.js';
import type { Working } from './plan-build.js';
import { pannerAutomation } from './preview-chains.js';

function reading(
  source: PlanSegment['source'],
  start: number,
  length: number,
  stages: readonly PlanStage[] = [],
): PlanSegment {
  return {
    source,
    start: derivedSampleCount(start),
    length: derivedSampleCount(length),
    reversed: false,
    stages,
  };
}

/** One stream read whole, or the mix of two or more. */
function sourceOf(streams: readonly number[]): PlanSegment['source'] {
  const [only] = streams;
  return streams.length === 1 && only !== undefined
    ? { kind: 'stream', stream: only }
    : { kind: 'mix', streams };
}

/** The first stream: the buses' mix to the horizon, folded to the project's layout. */
export function writeOutput(working: Working, horizon: number): void {
  const { fixed } = working;
  const fold = conversionMatrix(STEREO, fixed.output);
  const stages: PlanStage[] =
    fold.ok && !isStereo(fixed.output) ? [{ kind: 'matrix', matrix: fold.value }] : [];
  working.streams[0] = {
    sampleRate: fixed.rate,
    layout: fixed.output,
    segments: [reading(sourceOf(fixed.layout.buses.map((bus) => bus.stream)), 0, horizon, stages)],
  };
}

/** Each bus: the mix of the emitter streams that play on it, through its gain, to the end. */
export function writeBuses(working: Working): void {
  const { layout, rate } = working.fixed;
  for (const bus of layout.buses) {
    const feeding = layout.emitters.flatMap((emitter) =>
      emitter.buses.flatMap((name, place) => {
        const stream = emitter.streams[place];
        return name === bus.bus && stream !== undefined ? [stream] : [];
      }),
    );
    working.streams[bus.stream] = {
      sampleRate: rate,
      layout: STEREO,
      segments: [reading(sourceOf(feeding), 0, working.end)],
      processing: { kind: 'chain', chain: bus.gain.chain, input: STEREO },
    };
  }
}

/**
 * Each emitter's streams: the mix of its lanes of the bus, one segment for
 * each set of lanes it had, through its panner, its motion laid through the
 * end where `lay` asks and kept otherwise.
 */
export function writeEmitters(working: Working, lay: boolean): void {
  const { fixed, end } = working;
  for (const [emitter, own] of fixed.layout.emitters.entries()) {
    const play = fixed.plays[emitter];
    const epochs = working.epochs[emitter] ?? [];
    const lanes = working.lanes[emitter] ?? [];
    for (const [place, stream] of own.streams.entries()) {
      const panner = own.panners[place];
      if (panner === undefined || play === undefined) continue;
      const segments = epochs.map((epoch, index) => {
        const until = epochs[index + 1]?.from ?? end;
        const read = lanes.slice(0, epoch.lanes).flatMap((buses) => buses[place] ?? []);
        return reading(sourceOf(read), epoch.from, until - epoch.from);
      });
      const previous = working.streams[stream]?.processing;
      const kept = previous?.kind === 'chain' ? previous.automation : undefined;
      const path = play.emitter.motion;
      const automation =
        path.kind === 'still'
          ? undefined
          : lay || kept === undefined
            ? pannerAutomation(
                panner.processor,
                fixed.panner,
                motionLanes(path, fixed.scenario.listener, fixed.scenario.space, fixed.rate, end),
              )
            : kept;
      working.streams[stream] = {
        sampleRate: fixed.rate,
        layout: STEREO,
        segments,
        processing: {
          kind: 'chain',
          chain: panner.chain,
          input: STEREO,
          ...(automation === undefined ? {} : { automation }),
        },
      };
    }
  }
}
