/**
 * Facts as the Inspector lists them, each a term and its detail: an asset's
 * source, its file's metadata, and an export (REQ-EDIT-072).
 */

import type { ReactNode } from 'react';

/** One fact: what it is about, and what it is. */
export interface Fact {
  readonly term: string;
  readonly detail: string;
}

/** Facts, each a term and its detail. */
export function Facts({ facts }: { readonly facts: readonly Fact[] }): ReactNode {
  return (
    <dl className="ag-inspector-facts">
      {facts.map((fact) => (
        <div key={fact.term}>
          <dt>{fact.term}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
