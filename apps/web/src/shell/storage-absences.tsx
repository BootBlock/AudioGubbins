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

/** The list, or nothing where the browser lacks nothing. */
export function StorageAbsences({
  absences,
}: {
  readonly absences: readonly StorageCapabilityAbsence[];
}): ReactNode {
  if (absences.length === 0) return null;
  return (
    <div role="group" aria-label="Keeping projects">
      <h3 className="ag-section-heading">Keeping projects</h3>
      <ul className="ag-capability-list">
        {absences.map((absence) => (
          <li key={absence.key} className="ag-capability">
            <span className="ag-capability-name">{absence.reason}</span>
            <span className="ag-capability-status" data-ag-status="reduced">
              Reduced
            </span>
            <p className="ag-capability-explanation">{absence.fallback}</p>
            {absence.remedy !== undefined && (
              <p className="ag-capability-remedy">{absence.remedy}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
