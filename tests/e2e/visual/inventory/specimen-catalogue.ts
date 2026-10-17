/**
 * The specimens the inventory draws, read from the specimens files and
 * grouped by component.
 *
 * Each component group writes one specimens file, and the page finds them all
 * by a glob, so a file that exports something else, or two files that both
 * draw one component in one state, would otherwise be noticed by nobody: the
 * page would draw what it could and the capture would compare it. Such a file
 * is refused here instead, with the file and the reason, and the page shows
 * the refusal where the specimens would be.
 */

import type { Specimen } from './specimen.js';

/**
 * The states a pointer or the keyboard puts a control in, which the page
 * forces through `data-ag-force-state` on the specimen's wrapper rather than
 * by a real pointer: a capture cannot hover over every specimen at once.
 */
export const FORCED_STATES = ['hover', 'focus-visible', 'active', 'pressed'] as const;

export type ForcedState = (typeof FORCED_STATES)[number];

/** The forced state a specimen's state names, or nothing for a state its props draw. */
export function forcedStateOf(state: string): ForcedState | undefined {
  return FORCED_STATES.find((one) => one === state);
}

/** One component and its specimens, in the order the files list them. */
export interface ComponentSpecimens {
  readonly component: string;
  readonly specimens: readonly Specimen[];
}

/** The catalogue, or every reason it could not be read. */
export type CatalogueReading =
  | { readonly ok: true; readonly components: readonly ComponentSpecimens[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Whether a value is a specimen: a component, a state and a function that draws it. */
function isSpecimen(value: unknown): value is Specimen {
  return (
    typeof value === 'object' &&
    value !== null &&
    'component' in value &&
    typeof value.component === 'string' &&
    value.component !== '' &&
    'state' in value &&
    typeof value.state === 'string' &&
    value.state !== '' &&
    'render' in value &&
    typeof value.render === 'function'
  );
}

/** The specimens a module default-exports, or why it does not. */
function specimensOf(
  path: string,
  module: unknown,
): { readonly specimens: readonly Specimen[] } | { readonly problem: string } {
  const exported =
    typeof module === 'object' && module !== null && 'default' in module
      ? module.default
      : undefined;
  if (!Array.isArray(exported)) {
    return { problem: `${path} does not default-export a list of specimens.` };
  }
  const specimens: Specimen[] = [];
  for (const [index, entry] of exported.entries()) {
    if (!isSpecimen(entry)) {
      return {
        problem: `${path}: entry ${String(index)} is not a specimen (a component, a state and a render function).`,
      };
    }
    specimens.push(entry);
  }
  return { specimens };
}

/**
 * Reads every specimens module, as the glob gives them, by path.
 *
 * Files are read in the order of their paths, so the page's order, and with it
 * the capture's, does not depend on the order the bundler happens to list them
 * in. Components keep the order their first specimen appears in.
 */
export function readCatalogue(modules: Readonly<Record<string, unknown>>): CatalogueReading {
  const problems: string[] = [];
  const byComponent = new Map<string, Specimen[]>();
  const seen = new Map<string, string>();

  for (const path of Object.keys(modules).toSorted()) {
    const read = specimensOf(path, modules[path]);
    if ('problem' in read) {
      problems.push(read.problem);
      continue;
    }
    for (const specimen of read.specimens) {
      const key = `${specimen.component} / ${specimen.state}`;
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        problems.push(`${key} is drawn by both ${earlier} and ${path}.`);
        continue;
      }
      seen.set(key, path);
      const list = byComponent.get(specimen.component);
      if (list === undefined) byComponent.set(specimen.component, [specimen]);
      else list.push(specimen);
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  if (byComponent.size === 0) return { ok: false, problems: ['No specimens file draws anything.'] };
  return {
    ok: true,
    components: [...byComponent].map(([component, specimens]) => ({ component, specimens })),
  };
}

/**
 * The catalogue narrowed to one component, or refused where no specimen draws
 * it: a capture of a component that is not there must not pass as a capture
 * of nothing.
 */
export function narrowCatalogue(
  catalogue: CatalogueReading,
  component: string | undefined,
): CatalogueReading {
  if (!catalogue.ok || component === undefined) return catalogue;
  const found = catalogue.components.filter((one) => one.component === component);
  return found.length === 0
    ? { ok: false, problems: [`No specimen draws a component called ${component}.`] }
    : { ok: true, components: found };
}
