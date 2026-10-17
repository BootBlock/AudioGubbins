/**
 * The inventory itself: every component, each of its states labelled, in the
 * order the catalogue gives them.
 *
 * Each component is one section, which the capture photographs whole, so one
 * screenshot holds every state of one component. Each state sits in a wrapper
 * that carries the state it forces, and nothing else here styles a state: the
 * component's own rules draw it, as they draw the real one.
 */

import type { ReactNode } from 'react';

import { forcedStateOf, type CatalogueReading } from './specimen-catalogue.js';

/** What the page draws. */
export interface InventoryPageProps {
  readonly catalogue: CatalogueReading;

  /** Why the address could not be read, where it could not. */
  readonly settingsProblems: readonly string[];
}

/** A list of reasons the inventory cannot be drawn, in place of the inventory. */
function Refusal({ problems }: { readonly problems: readonly string[] }): ReactNode {
  return (
    <div role="alert" className="inventory-refusal" data-inventory-refusal="">
      <h1>The inventory cannot be drawn</h1>
      <ul>
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </div>
  );
}

/** The page. */
export function InventoryPage({ catalogue, settingsProblems }: InventoryPageProps): ReactNode {
  const problems = [...settingsProblems, ...(catalogue.ok ? [] : catalogue.problems)];
  if (problems.length > 0 || !catalogue.ok) return <Refusal problems={problems} />;

  return (
    <main className="inventory">
      {catalogue.components.map(({ component, specimens }) => (
        <section
          key={component}
          className="inventory-component"
          data-inventory-component={component}
          aria-label={component}
        >
          <h2 className="inventory-component-name">{component}</h2>
          <div className="inventory-states">
            {specimens.map((specimen) => (
              <figure
                key={specimen.state}
                className="inventory-specimen"
                data-inventory-state={specimen.state}
              >
                <figcaption className="inventory-state-name">{specimen.state}</figcaption>
                <div
                  className="inventory-stage"
                  data-ag-force-state={forcedStateOf(specimen.state)}
                >
                  {specimen.render()}
                </div>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
