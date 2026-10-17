/**
 * One thing this browser cannot do, or can do only in part, as the
 * Capabilities panel lists it (REQ-EXEC-216): a lamp and a badge in the
 * state's colour, what is missing, what that means, and what the person can
 * do about it behind the explanation's hint (design language, sections 10 and
 * 13).
 */

import type { ReactNode } from 'react';

import { Badge, BadgeTone, Hint } from '@audiogubbins/design-system';

/** Whether the thing cannot be done at all, or only in part. */
export type CapabilityState = 'unavailable' | 'reduced';

/** A capability's row. */
export function CapabilityRow({
  name,
  state,
  explanation,
  remedies,
}: {
  /** What is missing, or what cannot be done. */
  readonly name: string;
  readonly state: CapabilityState;
  /** What it means, or what AudioGubbins does instead. */
  readonly explanation: string;
  /** What the person can do about it, each a sentence. */
  readonly remedies: readonly string[];
}): ReactNode {
  return (
    <li className="ag-capability" data-ag-status={state}>
      <span className="ag-capability-lamp" aria-hidden="true" />
      <span className="ag-capability-name">{name}</span>
      {state === 'unavailable' ? (
        <Badge tone={BadgeTone.Error}>Unavailable</Badge>
      ) : (
        <Badge tone={BadgeTone.Warning}>Reduced</Badge>
      )}
      <p className="ag-capability-explanation">
        {explanation}
        {remedies.length > 0 && (
          <Hint label={`What you can do: ${name}`}>
            {remedies.map((remedy) => (
              <p key={remedy} className="ag-capability-advice">
                {remedy}
              </p>
            ))}
          </Hint>
        )}
      </p>
    </li>
  );
}
