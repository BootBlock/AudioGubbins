/**
 * The fixed shape of a game preview's plan (ADR-0104): the streams that are
 * there from the first plan to the last, at the same places, so every plan
 * that continues another keeps them.
 *
 * Its first stream is the preview's sound in the project's layout, the mix of
 * its buses folded from stereo by the domain's conversion where the project is
 * not stereo. Then each bus, sorted by name: the mix of the emitter streams
 * that play on it, through its gain. Then each emitter's stream for each bus
 * its pool plays on, in the scenario's order: the mix of its lanes of that bus
 * through its spatial panner, whose position carries the emitter's motion. Then
 * each emitter's first `limit + 1` lanes, one stream for each of its buses. A
 * voice's bus is its member's, or Godot's `Master` where it sets none, so a
 * pool of members on two buses plays through two emitter streams, each panned
 * alike.
 */

import {
  StandardLayouts,
  layoutsMatch,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type IdGenerator,
  type ProcessorCatalogue,
  type ProcessorId,
} from '@audiogubbins/domain';

import { busName, type BusName } from '../policy/bus-name.js';
import { busChain, pannerChain, type OneProcessorChain } from './preview-chains.js';
import type { GamePreviewScenario } from './preview-scenario.js';
import type { EmitterPlay } from './trigger-schedule.js';

/** The bus Godot plays a player on where it names none. */
export const MASTER_BUS: BusName = (() => {
  const made = busName('Master');
  if (!made.ok) throw new Error('"Master" is a bus name.');
  return made.value;
})();

export const STEREO = StandardLayouts.stereo;

/** Whether `layout` is the preview's stereo. */
export function isStereo(layout: ChannelLayout): boolean {
  return layoutsMatch(layout, STEREO);
}

/** One emitter's streams: one for each bus its pool plays on. */
export interface EmitterStreams {
  /** Sorted by name. */
  readonly buses: readonly BusName[];
  /** The stream of each bus, in the order of `buses`. */
  readonly streams: readonly number[];
  /** The panner chain of each, in the order of `buses`. */
  readonly panners: readonly OneProcessorChain[];
  /** Its first lanes: for each lane, its stream for each bus. */
  readonly lanes: readonly (readonly number[])[];
}

export interface BusStream {
  readonly bus: BusName;
  readonly stream: number;
  readonly gain: OneProcessorChain;
}

export interface PlanLayout {
  /** Sorted by name. */
  readonly buses: readonly BusStream[];
  readonly emitters: readonly EmitterStreams[];
  /** How many streams the fixed shape takes; every voice's come after. */
  readonly streams: number;
}

function byName(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The buses `play`'s pool plays on, sorted by name. */
function busesOf(play: EmitterPlay): readonly BusName[] {
  return [...new Set(play.pool.map((member) => member.bus ?? MASTER_BUS))].toSorted(byName);
}

/** The fixed shape of the plan of `plays` in `scenario`, its chains' identifiers from `ids`. */
export function planLayout(
  scenario: GamePreviewScenario,
  plays: readonly EmitterPlay[],
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
): DomainResult<PlanLayout> {
  const emitterBuses = plays.map(busesOf);
  const names = [...new Set(emitterBuses.flat())].toSorted(byName);
  let next = 1;
  const buses: BusStream[] = [];
  for (const bus of names) {
    const level = scenario.busLevels.find((one) => one.bus === bus)?.decibels ?? 0;
    const gain = busChain(level, catalogue, ids);
    if (!gain.ok) return gain;
    buses.push({ bus, stream: next, gain: gain.value });
    next += 1;
  }
  const panned: { readonly streams: number[]; readonly panners: OneProcessorChain[] }[] = [];
  for (const [index, play] of plays.entries()) {
    const shape: { readonly streams: number[]; readonly panners: OneProcessorChain[] } = {
      streams: [],
      panners: [],
    };
    for (let bus = 0; bus < (emitterBuses[index]?.length ?? 0); bus += 1) {
      const panner = pannerChain(scenario, play.rules, play.emitter.motion, catalogue, ids);
      if (!panner.ok) return panner;
      shape.streams.push(next);
      shape.panners.push(panner.value);
      next += 1;
    }
    panned.push(shape);
  }
  const emitters = plays.map((play, index): EmitterStreams => {
    const own = emitterBuses[index] ?? [];
    const lanes = Array.from({ length: play.rules.voices.limit + 1 }, () => own.map(() => next++));
    return {
      buses: own,
      streams: panned[index]?.streams ?? [],
      panners: panned[index]?.panners ?? [],
      lanes,
    };
  });
  return succeed({ buses, emitters, streams: next });
}

/** Where each running change of a preview is made: each emitter's panners and each bus's gain. */
export interface PreviewControls {
  readonly emitters: ReadonlyMap<
    string,
    readonly { readonly bus: BusName; readonly stream: number; readonly panner: ProcessorId }[]
  >;
  readonly buses: ReadonlyMap<BusName, { readonly stream: number; readonly gain: ProcessorId }>;
}

/** The controls of `layout`, emitters keyed by identifier. */
export function controlsOf(layout: PlanLayout, plays: readonly EmitterPlay[]): PreviewControls {
  return {
    emitters: new Map(
      plays.map((play, index) => {
        const { buses = [], streams = [], panners = [] } = layout.emitters[index] ?? {};
        return [
          play.emitter.id,
          panners.map((panner, place) => ({
            bus: buses[place] ?? MASTER_BUS,
            stream: streams[place] ?? 0,
            panner: panner.processor.id,
          })),
        ];
      }),
    ),
    buses: new Map(
      layout.buses.map((one) => [one.bus, { stream: one.stream, gain: one.gain.processor.id }]),
    ),
  };
}
