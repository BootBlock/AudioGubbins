/**
 * What a project needs of the model packs (REQ-AUDIO-139): each
 * machine-learning processor of a chain it runs (`projectChains`: its own and
 * those audio pasted into it carries), as the need its model makes, once for
 * each model, and which of the requirement's conditions holds for it with the
 * catalogue as last read, so the pack manager can say what the open project is
 * missing and offer the version that would bring it.
 */

import { processorsOf, projectChains } from '@audiogubbins/domain';
import type { AvailabilityContext, PackAvailability } from '@audiogubbins/model-packs';
import type { ProjectState } from '@audiogubbins/project-format';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

import { processorAvailability } from './model-availability.js';

/** A model the project needs, the processor it serves, and which condition holds for it. */
export interface ProjectNeed {
  /** What identifies the need: the processor type and the model's pack, version and hash. */
  readonly key: string;
  /** The processor's label, as the catalogue gives it. */
  readonly label: string;
  readonly availability: PackAvailability;
}

/**
 * Every model the chains `state` runs name, once each, in the order the chains
 * hold them, and which condition holds for each in `context`.
 */
export function projectNeeds(
  state: ProjectState,
  context: AvailabilityContext,
): readonly ProjectNeed[] {
  const needs = new Map<string, ProjectNeed>();
  for (const chain of projectChains(state.project)) {
    for (const processor of processorsOf(chain.slots)) {
      const { model } = processor.version;
      if (model === undefined) continue;
      const key = `${processor.typeKey}:${model.pack}@${model.version}:${model.modelHash}`;
      if (needs.has(key)) continue;
      // Decided as the page's gate decides whether the processor runs, so the
      // manager and an unavailable processor say the same.
      const availability = processorAvailability(processor, context);
      if (availability === undefined) continue;
      needs.set(key, {
        key,
        label: PROCESSOR_CATALOGUE.get(processor.typeKey)?.label ?? processor.typeKey,
        availability,
      });
    }
  }
  return [...needs.values()];
}
