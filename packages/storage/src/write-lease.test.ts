import { describeWriteLeaseScenarios } from './testing/index.js';
import { MemoryLeaseCoordinator } from './testing/memory-leases.js';

/**
 * The single-writer scenarios over the in-memory coordinator, which every
 * window of a scenario shares as the tabs of one browser profile share Web
 * Locks, and which calls a holder's listeners as it is asked, so one turn of
 * the microtask queue lets a request or a loss arrive.
 */
describeWriteLeaseScenarios('the in-memory coordinator', {
  windows: () => {
    const coordinator = new MemoryLeaseCoordinator();
    return {
      coordinatorFor: () => coordinator,
      settle: async () => {
        await Promise.resolve();
      },
    };
  },
  uncoordinated: () => undefined,
});
