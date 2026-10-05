/**
 * The Storage panel: what the stored projects take, part by part, and the
 * cleanup that frees it, the deleted projects waiting to be purged among it
 * (REQ-STOR-200, REQ-STOR-102, REQ-STOR-106, REQ-STOR-027).
 *
 * The storage is measured when the panel is first shown and whenever the person
 * asks, and again after a cleanup. Nothing is removed without a plan the person
 * has read, and nothing past the caches without their confirmation. Every
 * action is a command.
 */

import { cleanedSentences } from '../../cleanup-words.js';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import type { StorageUsage } from '@audiogubbins/storage';
import { counted } from '@audiogubbins/text';

import type { Observable } from '../../state/observable.js';
import type { LibraryState } from '../../state/project-library-store.js';
import type { StorageUsageState } from '../../state/storage-usage-store.js';
import { describeBytes } from '../../wording.js';
import { DeletedProjects } from '../projects/deleted-projects.js';
import type { RunCommand } from '../settings/section.js';
import { CleanupPlanView } from './cleanup-plan.js';
import { choiceOf, partsOf } from './storage-words.js';

/** What the panel reads and runs. */
export interface StoragePanelProps {
  readonly title: string;
  readonly usage: Observable<StorageUsageState>;
  readonly library: Observable<LibraryState>;
  readonly run: RunCommand;

  /** Why the storage cannot be measured now, or `undefined` where it can. */
  readonly unavailable: string | undefined;
}

/** What each part of the storage takes, and what could not be counted. */
function Usage({ usage }: { readonly usage: StorageUsage }): ReactNode {
  return (
    <>
      <dl className="ag-usage">
        {partsOf(usage).map((part) => (
          <div key={part.name} className="ag-usage-part">
            <dt>{part.name}</dt>
            <dd>{describeBytes(part.bytes)}</dd>
          </div>
        ))}
      </dl>
      {usage.unreadable.length > 0 && (
        <p data-ag-status="reduced">
          {`${counted(usage.unreadable.length, 'stored file', 'stored files')} could not be read, so ${usage.unreadable.length === 1 ? 'it is' : 'they are'} not counted.`}
        </p>
      )}
    </>
  );
}

/** The panel (see the module comment). */
export function StoragePanel({
  title,
  usage,
  library,
  run,
  unavailable,
}: StoragePanelProps): ReactNode {
  const state = useSyncExternalStore(usage.subscribe, usage.get);
  const kept = useSyncExternalStore(library.subscribe, library.get);
  const headers = kept.entries.flatMap((entry) => (entry.kind === 'project' ? [entry.header] : []));
  const measured = state.usage !== undefined;

  // Measured once as the panel is first shown, where it can be.
  useEffect(() => {
    if (!measured && unavailable === undefined) run('storage.measure');
  }, [measured, unavailable, run]);

  return (
    <section className="ag-panel ag-storage">
      <h2 className="ag-panel-title">{title}</h2>
      {unavailable !== undefined && <p>{unavailable}</p>}
      {state.working !== undefined && (
        <p role="status">{state.working === 'cleaning' ? 'Cleaning up…' : 'Measuring…'}</p>
      )}
      {state.usage !== undefined && <Usage usage={state.usage} />}
      {state.outcomes === undefined
        ? undefined
        : cleanedSentences(state.outcomes).map((sentence) => <p key={sentence}>{sentence}</p>)}
      <div className="ag-settings-row">
        <Button compact onClick={() => run('storage.measure')}>
          Measure again
        </Button>
        <Button compact onClick={() => run('storage.plan-cleanup')}>
          Plan a cleanup
        </Button>
      </div>
      {state.plan !== undefined && (
        // Made afresh for each plan, so what was left out of the last is not
        // carried into a plan that no longer has it.
        <CleanupPlanView
          key={state.plan.steps.map(choiceOf).join(',')}
          plan={state.plan}
          nameOf={(project) => headers.find((header) => header.id === project)?.name}
          run={run}
        />
      )}
      <DeletedProjects headers={headers} run={run} />
    </section>
  );
}
