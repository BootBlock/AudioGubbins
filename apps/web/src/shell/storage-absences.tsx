/**
 * What this browser lacks for keeping projects, as the Capabilities panel lists
 * it: each missing part, why it matters, what the person can do, and what
 * AudioGubbins does instead (REQ-EXEC-216, REQ-STOR-098).
 *
 * The wording is the capabilities package's, written once there, so the panel,
 * a notice and a diagnostic bundle say the same thing.
 */

import type { ReactNode } from 'react';

import type { StorageCapabilityAbsence } from '@audiogubbins/capabilities';

import { CapabilityRow } from './capability-row.js';

/** The list, or nothing where the browser lacks nothing. */
export function StorageAbsences({
  absences,
}: {
  readonly absences: readonly StorageCapabilityAbsence[];
}): ReactNode {
  if (absences.length === 0) return null;
  return (
    <div className="ag-capability-group" role="group" aria-label="Keeping projects">
      <h3 className="ag-capability-heading">Keeping projects</h3>
      <ul className="ag-capability-list">
        {absences.map((absence) => (
          <CapabilityRow
            key={absence.key}
            name={absence.reason}
            state="reduced"
            explanation={absence.fallback}
            remedies={absence.remedy === undefined ? [] : [absence.remedy]}
          />
        ))}
      </ul>
    </div>
  );
}
