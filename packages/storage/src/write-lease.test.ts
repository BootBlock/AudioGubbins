import { describeWriteLeaseScenarios } from './testing/index.js';
import { MemoryLeaseCoordinator } from './testing/memory-leases.js';
import { nodeDigest } from './testing/node-services.js';

/**
 * The single-writer scenarios over the in-memory coordinator, which every
 * window of a scenario shares as the tabs of one browser profile share Web
 * Locks, and which calls a holder's listeners as it is asked. A settling waits
 * a turn of the event loop, by which every promise already made has run, so a
 * request, a loss, and a reading window's load of storage have all arrived.
 */
describeWriteLeaseScenarios('the in-memory coordinator', {
  windows: () => {
    const coordinator = new MemoryLeaseCoordinator();
    return {
      coordinatorFor: () => coordinator,
      settle: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      },
    };
  },
  uncoordinated: () => undefined,
  refusing: () => new MemoryLeaseCoordinator({ refuses: true }),
  digest: nodeDigest,
});
