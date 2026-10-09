/**
 * The versions of the engine's algorithms that make what an edit sounds like
 * (REQ-AUDIO-145, ADR-0061), which the engine owns because it implements
 * them: each is raised whenever its algorithm changes a bit of what it makes.
 *
 * A stretch and a conversion of rate persist the version they were made by,
 * and a plan is built only of edits this build's versions made, so a project
 * from another build is refused where it would sound otherwise. A
 * machine-learning processor states the resampler's version among its own,
 * since its pass converts to and from its model's rate.
 */

import type { EngineVersions } from '@audiogubbins/domain';

/** The version of the canonical resampler, which every conversion of rate runs. */
export const CANONICAL_RESAMPLER_VERSION = 1;

/** The version of the stretch, the phase vocoder that changes a length without its pitch. */
const STRETCH_VERSION = 1;

/** This build's versions, as a plan is built with them. */
export const ENGINE_VERSIONS: EngineVersions = {
  stretch: STRETCH_VERSION,
  resampler: CANONICAL_RESAMPLER_VERSION,
};
