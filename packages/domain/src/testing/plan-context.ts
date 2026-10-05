/**
 * A plan context for a test whose audio names no chain of processors: no
 * project chains and no processor types, so a rack edit or a rack in the test
 * is refused rather than heard as nothing.
 */

import type { PlanContext } from '../editing/plan-building.js';

export const PLAN_WITHOUT_CHAINS: PlanContext = { chains: new Map(), catalogue: new Map() };
