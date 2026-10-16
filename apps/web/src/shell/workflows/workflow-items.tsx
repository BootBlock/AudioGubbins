/**
 * What a workflow's plan will do, item by item, before anything runs
 * (ADR-0105): each planned item with every change it makes, each skipped one
 * with why, and each refused one with every reason. How an item stands is a
 * word as well as a mark, never a colour alone.
 */

import type { ReactNode } from 'react';

import type { DomainResult } from '@audiogubbins/domain';
import { itemKey, type WorkflowItem, type WorkflowPlan } from '@audiogubbins/guided-workflows';
import type { ProjectState } from '@audiogubbins/project-format';
import { counted } from '@audiogubbins/text';

import { ITEM_STANDING, targetName } from './workflow-words.js';

function itemDetail(item: WorkflowItem): readonly string[] {
  switch (item.kind) {
    case 'planned':
      return item.changes;
    case 'skipped':
      return [item.reason];
    case 'refused':
      return item.failures.map((failure) => failure.summary);
  }
}

/** How many items of each standing `plan` holds, in words. */
function planSummary(plan: WorkflowPlan): string {
  const of = (kind: WorkflowItem['kind']): number =>
    plan.items.filter((item) => item.kind === kind).length;
  const parts = [
    `${counted(of('planned'), 'item', 'items')} to change`,
    ...(of('skipped') === 0 ? [] : [`${String(of('skipped'))} skipped`]),
    ...(of('refused') === 0 ? [] : [`${String(of('refused'))} refused`]),
  ];
  return `${parts.join(', ')}.`;
}

export function WorkflowItems({
  plan,
  state,
}: {
  readonly plan: DomainResult<WorkflowPlan>;
  readonly state: ProjectState;
}): ReactNode {
  if (!plan.ok) {
    return (
      <section className="ag-workflow-section" aria-label="What it will do">
        <ul className="ag-workflow-blockers" aria-label="Why nothing can be planned yet">
          {plan.failures.map((failure) => (
            <li key={failure.code + failure.summary} data-ag-status="unavailable">
              {failure.summary}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const { items } = plan.value;
  return (
    <section className="ag-workflow-section" aria-label="What it will do">
      <p className="ag-workflow-summary" aria-live="polite">
        {items.length === 0 ? 'There is nothing to run it on.' : planSummary(plan.value)}
      </p>
      <ul className="ag-workflow-items">
        {items.map((item) => (
          <li key={itemKey(item.target)} className="ag-workflow-item" data-ag-standing={item.kind}>
            <span className="ag-workflow-item-name">{targetName(item.target, state)}</span>
            <span className="ag-workflow-standing">{ITEM_STANDING[item.kind]}</span>
            <ul className="ag-workflow-changes">
              {itemDetail(item).map((line, index) => (
                <li key={String(index)}>{line}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
