/**
 * What the person changes while a run plays, heard at once (ADR-0104): a still
 * emitter moved, the listener moved or turned, a bus fader, the pan width and
 * the panning strength, each a running change of the values of a panner or a
 * bus gain in the plan playing, so nothing playing starts again.
 *
 * The values are the preview plan's own for the scenario as it now stands, so
 * the domain alone decides what a position in the listener's frame or a level
 * is: the scenario set up is laid as a plan with nothing in it, which costs its
 * fixed streams and no voice, and each panner and gain the run plays is given
 * the values its counterpart there has. A moving emitter's position is its
 * path's automation, which a changed path or listener lays again only from the
 * next run, as does every other change, the panel says.
 */

import {
  createDeterministicIdGenerator,
  type EditPlan,
  type ParameterValues,
  type PlanStream,
} from '@audiogubbins/domain';
import {
  previewPlan,
  simulatePreview,
  type GamePreviewScenario,
  type PreviewControls,
} from '@audiogubbins/game-audio';

import type { PreviewSetup } from './preview-setup.js';

/** The values each panner and gain of a plan is given, by the place of its stream. */
export type LiveValues = ReadonlyMap<number, ParameterValues>;

/** Whether `emitter` is still in both scenarios, so where it stands is a running change. */
function stillInBoth(
  running: GamePreviewScenario,
  now: GamePreviewScenario,
  emitter: string,
): boolean {
  const before = running.emitters.find((one) => one.id === emitter);
  const after = now.emitters.find((one) => one.id === emitter);
  return before?.motion.kind === 'still' && after?.motion.kind === 'still';
}

/** The values of the first processor of `stream`'s chain, where it has one. */
function chainValues(stream: PlanStream | undefined): ParameterValues | undefined {
  const processing = stream?.processing;
  if (processing?.kind !== 'chain') return undefined;
  const [first] = processing.chain.slots;
  return first?.kind === 'processor' ? first.values : undefined;
}

/**
 * The values the panners and gains of a run of `setup`, whose plan has
 * `controls`, take for `now`, the scenario as it is set up now; `undefined`
 * where `now` cannot be played as it stands, or is of another space.
 */
export function liveValues(
  setup: PreviewSetup,
  controls: PreviewControls,
  now: GamePreviewScenario,
): LiveValues | undefined {
  const running = setup.scenario;
  if (now.space !== running.space) return undefined;
  const empty = simulatePreview({
    scenario: now,
    emitterRules: setup.subjects.emitterRules,
    poolOf: setup.subjects.poolOf,
    hand: [],
    sampleRate: setup.rate,
    voiceBudget: setup.budget,
    horizonFrame: 0,
  });
  if (!empty.ok) return undefined;
  const laid = previewPlan(
    empty.value,
    now,
    setup.members,
    setup.catalogue,
    // Its identifiers are never heard: only its values are taken.
    createDeterministicIdGenerator(0),
    setup.layout,
  );
  if (!laid.ok) return undefined;
  const { streams } = laid.value.plan;
  const values = new Map<number, ParameterValues>();
  for (const [emitter, panners] of controls.emitters) {
    if (!stillInBoth(running, now, emitter)) continue;
    const there = laid.value.controls.emitters.get(emitter) ?? [];
    for (const panner of panners) {
      const twin = there.find((one) => one.bus === panner.bus);
      const set = chainValues(twin === undefined ? undefined : streams[twin.stream]);
      if (set !== undefined) values.set(panner.stream, set);
    }
  }
  for (const [bus, gain] of controls.buses) {
    const twin = laid.value.controls.buses.get(bus);
    const set = chainValues(twin === undefined ? undefined : streams[twin.stream]);
    if (set !== undefined) values.set(gain.stream, set);
  }
  return values;
}

/** `plan` with each stream `values` names given its values for the first processor of its chain. */
export function withLiveValues(plan: EditPlan, values: LiveValues): EditPlan {
  if (values.size === 0) return plan;
  const [first, ...rest] = plan.streams.map((stream, place): PlanStream => {
    const set = values.get(place);
    const processing = stream.processing;
    if (set === undefined || processing?.kind !== 'chain') return stream;
    const slots = processing.chain.slots.map((slot, index) =>
      index === 0 && slot.kind === 'processor' ? { ...slot, values: set } : slot,
    );
    return { ...stream, processing: { ...processing, chain: { ...processing.chain, slots } } };
  });
  return first === undefined ? plan : { ...plan, streams: [first, ...rest] };
}
