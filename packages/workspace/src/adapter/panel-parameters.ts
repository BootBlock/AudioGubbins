/**
 * What a panel was mounted with, read back from the parameters the docking
 * engine hands back untyped: its kind, and whatever else says which thing it
 * shows.
 *
 * Apart from the adapter so the dock's chrome, which names no engine type, can
 * read the kind of a panel being dragged as the adapter reads it.
 */

import type { OpenPanel } from '../panel.js';

/** The panel kind a panel was mounted with. */
export function kindOf(parameters: unknown): string | undefined {
  return typeof parameters === 'object' &&
    parameters !== null &&
    'kind' in parameters &&
    typeof parameters.kind === 'string'
    ? parameters.kind
    : undefined;
}

/**
 * The parameters a panel was mounted with besides its kind, or none. Read back
 * with the panel, since a panel's parameters say which thing it shows, and an
 * arrangement without them would show something else after the next reload.
 */
export function parametersOf(parameters: unknown): Pick<OpenPanel, 'parameters'> {
  if (typeof parameters !== 'object' || parameters === null) return {};
  const kept = Object.entries(parameters).filter(
    (entry): entry is [string, string | number | boolean] =>
      entry[0] !== 'kind' && ['string', 'number', 'boolean'].includes(typeof entry[1]),
  );
  return kept.length === 0 ? {} : { parameters: Object.fromEntries(kept) };
}
