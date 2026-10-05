/**
 * How a test reads a plan that names no chain: the reading every reader of
 * edited sound must state, with a rack's processing that refuses any chain, so
 * a test that meets one by mistake fails rather than hearing it unprocessed.
 */

import { FailureKind, MAXIMUM_QUALITY, fail, failure } from '@audiogubbins/domain';

import type { ChainProcessing } from '../pcm/chain-processing.js';
import { ProcessedStart, type PlanProcessing } from '../pcm/processed-content.js';

/** A rack's processing that runs no chain. */
export const NO_CHAIN_PROCESSING: ChainProcessing = {
  prepare: () =>
    Promise.resolve(
      fail(failure('test.no-chain-processing', FailureKind.Rejected, 'This test runs no chain.')),
    ),
};

/** A canonical reading at Maximum quality that runs no chain. */
export const PLAIN_PLAN_PROCESSING: PlanProcessing = {
  processing: NO_CHAIN_PROCESSING,
  quality: MAXIMUM_QUALITY.settings,
  start: ProcessedStart.Canonical,
};
