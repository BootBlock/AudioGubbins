/**
 * The strip under the menu bar that says what project is open and how this tab
 * may use it, with the action that answers each thing it says (REQ-STOR-098,
 * REQ-STOR-021, REQ-STOR-052, REQ-UX-005).
 *
 * A project open to read names the tab changing it and offers to ask for it,
 * and to take it over once a request goes unanswered, saying what taking over
 * costs before it is done; the tab changing a project is shown each request for
 * it, to hand it over or keep it; a tab that lost a project says who took it
 * and what was lost. Where no project can be opened, it says why. Each action
 * runs a command. A change of how this tab may use the project is said aloud as
 * well as shown, and focus never falls to the page when the button that had it
 * goes.
 */

import { useRef, useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import { PanelKinds } from '@audiogubbins/workspace';
import type { ProjectSnapshot } from '@audiogubbins/storage';

import { showPanelCommandId } from '../commands/panel-commands.js';
import type { Announce } from '../commands/voiced-execution.js';
import type { Observable } from '../state/observable.js';
import type { OpenProjectState } from '../state/open-project-store.js';
import type { QuickEditSession } from '../state/quick-edit-store.js';
import type { StorageRootState } from '../state/storage-root-store.js';
import { quoted } from '../wording.js';
import { OwnershipActions } from './ownership-actions.js';
import { accessSentence } from './project-words.js';
import { RecoveryReportNotice } from './recovery-report-notice.js';
import type { RunCommand } from './settings/section.js';
import { useFocusKeptInside } from './use-focus-kept-inside.js';
import { useOwnershipAnnouncements } from './use-ownership-announcements.js';

/** What the banner reads and runs. */
export interface ProjectBannerProps {
  readonly root: Observable<StorageRootState>;

  /** The open project, absent where this browser keeps no projects. */
  readonly project: Observable<OpenProjectState> | undefined;

  /** The Quick Edit in progress, absent where this browser keeps no projects. */
  readonly quickEdit: Observable<QuickEditSession | undefined> | undefined;
  readonly run: RunCommand;
  readonly announce: Announce;
}

/** What is said where projects cannot be reached, and the action that answers it. */
function RootNotice({
  root,
  run,
}: {
  readonly root: StorageRootState;
  readonly run: RunCommand;
}): ReactNode {
  if (root.kind === 'unavailable') {
    return (
      <>
        <p className="ag-project-banner-text">{root.reason}</p>
        <Button compact onClick={() => run(showPanelCommandId(PanelKinds.Capabilities))}>
          Show the Capabilities panel
        </Button>
      </>
    );
  }
  if (root.kind === 'failed') {
    return (
      <p className="ag-project-banner-text">{`Your projects could not be read. ${root.cause.summary}`}</p>
    );
  }
  if (root.kind === 'blocked' && !root.shown) {
    return (
      <>
        <p className="ag-project-banner-text">
          Your stored projects were made by another version of AudioGubbins, so none can be opened
          until you decide what to do with them.
        </p>
        <Button compact onClick={() => run('storage.review')}>
          Decide now
        </Button>
      </>
    );
  }
  return root.kind === 'opening' ? (
    <p className="ag-project-banner-text">Opening your projects…</p>
  ) : null;
}

/** What is said with no project open, and the ways to one. */
function NoProject({ run }: { readonly run: RunCommand }): ReactNode {
  return (
    <>
      <p className="ag-project-banner-text">No project is open.</p>
      <Button compact onClick={() => run('file.projects', { section: 'new' })}>
        New project…
      </Button>
      <Button compact onClick={() => run('file.projects', { section: 'open' })}>
        Open project…
      </Button>
      <Button compact onClick={() => run('file.quick-edit')}>
        Quick Edit a file…
      </Button>
    </>
  );
}

/**
 * The open project: its name, or the file it is a Quick Edit of, how this tab
 * may use it, and what recovery found.
 */
function OpenProject({
  open,
  quickEdit,
  run,
}: {
  readonly open: Extract<OpenProjectState, { kind: 'open' }>;
  readonly quickEdit: QuickEditSession | undefined;
  readonly run: RunCommand;
}): ReactNode {
  const { snapshot } = open;
  const name = quoted(snapshot.model.state.project.displayName);
  const said = accessSentence(snapshot.access, name);
  return (
    <>
      <p className="ag-project-banner-name">
        {quickEdit?.project === snapshot.project
          ? `Quick Edit of ${quoted(quickEdit.fileName)}, kept in the project ${name}`
          : name}
      </p>
      {said !== undefined && (
        <p className="ag-project-banner-text" data-ag-status={statusOf(snapshot)}>
          {said}
        </p>
      )}
      <OwnershipActions snapshot={snapshot} name={name} request={open.request} run={run} />
      {open.report !== undefined && (
        <RecoveryReportNotice report={open.report} name={name} run={run} />
      )}
    </>
  );
}

/** How the access is coloured: reduced while the project cannot be changed here. */
function statusOf(snapshot: ProjectSnapshot): 'reduced' | 'unavailable' {
  return snapshot.access.kind === 'lost' ? 'unavailable' : 'reduced';
}

/** Nothing to hear of, where the browser keeps no projects. */
const NO_PROJECT: OpenProjectState = { kind: 'none' };
const subscribeToNothing = (): (() => void) => () => undefined;
const noQuickEdit = (): undefined => undefined;

/** The banner (see the module comment). */
export function ProjectBanner({
  root,
  project,
  quickEdit,
  run,
  announce,
}: ProjectBannerProps): ReactNode {
  const rootState = useSyncExternalStore(root.subscribe, root.get);
  const open = useSyncExternalStore(
    project?.subscribe ?? subscribeToNothing,
    project?.get ?? (() => NO_PROJECT),
  );
  const quick = useSyncExternalStore(
    quickEdit?.subscribe ?? subscribeToNothing,
    quickEdit?.get ?? noQuickEdit,
  );
  useOwnershipAnnouncements(open, announce);
  const strip = useRef<HTMLElement>(null);
  const focus = useFocusKeptInside(strip);

  const content =
    rootState.kind !== 'ready' ? (
      <RootNotice root={rootState} run={run} />
    ) : open.kind === 'none' ? (
      <NoProject run={run} />
    ) : open.kind === 'opening' ? (
      <p className="ag-project-banner-text">Opening the project…</p>
    ) : (
      <OpenProject open={open} quickEdit={quick} run={run} />
    );

  return (
    <section
      ref={strip}
      className="ag-project-banner"
      aria-label="Project"
      tabIndex={-1}
      onBlur={focus.onBlur}
      onClickCapture={focus.pressed}
    >
      {content}
    </section>
  );
}
