/**
 * What an edit plan is built with besides its asset (ADR-0051, ADR-0060,
 * ADR-0072), apart from the fold so the modules it calls on name it without
 * importing the fold.
 */

import type { AssetId, TakeStackId } from '../identity/branded-id.js';
import type { ProcessorCatalogue } from '../processing/chain-validation.js';
import type { TakeStack } from '../project/take-stack.js';
import type { ProjectChains } from './operation-validation.js';
import type { EngineVersions } from './operations.js';
import type { MediaShape } from './plan-validation.js';

/**
 * What a plan is built with besides its asset: the project's chains, which
 * rack edits and racks name, its take stacks, which punch edits name, and the
 * shape of each of its assets, whose recordings a punch reads its take from;
 * the processor types this build has, which say what layout a chain makes;
 * and the versions of the engine's algorithms it has, which a stretch, a
 * conversion of rate, a converted insertion or a converted take must have
 * been made by.
 */
export interface PlanContext {
  readonly chains: ProjectChains;
  readonly takeStacks: ReadonlyMap<TakeStackId, TakeStack>;
  readonly assets: ReadonlyMap<AssetId, MediaShape>;
  readonly catalogue: ProcessorCatalogue;
  readonly engine: EngineVersions;
}
