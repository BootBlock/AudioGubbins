/**
 * Facts as the Inspector lists them, each a term and its detail: an asset's
 * source, its file's metadata, and an export (REQ-EDIT-072). They are a
 * property grid, each detail end-aligned, a number or a measure in the
 * numeric family.
 */

import type { ReactNode } from 'react';

import { PropertyGrid, type PropertyRow } from '@audiogubbins/design-system';

/** One fact: what it is about, and what it is. */
export interface Fact {
  readonly term: string;
  readonly detail: string;
}

/** A detail that starts with a number, as a rate, a length or a size does. */
const NUMERIC = /^[−+-]?\d/u;

/** Facts, each a term and its detail. */
export function Facts({ facts }: { readonly facts: readonly Fact[] }): ReactNode {
  const rows: PropertyRow[] = facts.map((fact) => ({
    id: fact.term,
    label: fact.term,
    value: NUMERIC.test(fact.detail) ? (
      <span className="ag-inspector-number">{fact.detail}</span>
    ) : (
      fact.detail
    ),
  }));
  return <PropertyGrid rows={rows} />;
}
