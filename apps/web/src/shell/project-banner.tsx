/**
 * The strip under the menu bar that says what project is open and how this tab
 * may use it, with the action that answers each thing it says (REQ-STOR-098,
 * REQ-STOR-021, REQ-STOR-052, REQ-UX-005).
 *
 * A project open to read names the tab changing it and offers to ask for it,
 * and to take it over once a request goes unanswered, saying what taking over
 * costs before it is done; the tab changing a project is shown each request for
 * it, to hand it over or keep it; a tab that lost a project says who took it
 * and what was lost. A recording the project holds cut short is offered first,
 * to recover or discard. A Quick Edit offers its export (REQ-EDIT-008). Where
 * no project can be opened, it says why. Each action runs a command. A change
 * of how this tab may use the project is said aloud as well as shown, and focus
 * never falls to the page when the button that had it goes.
 */

import { useRef, useSyncExternalStore, type ReactNode } from 'react';

import {
  Badge,
  BadgeTone,
  Banner,
  BannerTone,
  Button,
  ButtonTone,
  Icon,
  IconSize,
  type IconName,
} from '@audiogubbins/design-system';
import { PanelKinds } from '@audiogubbins/workspace';
import type { ProjectAccess } from '@audiogubbins/storage';

import { ExportCommand } from '../commands/import-export-ids.js';
import { showPanelCommandId } from '../commands/panel-commands.js';
import { EXPORT_BUTTON } from '../import-export-words.js';
import type { Announce } from '../commands/voiced-execution.js';
import type { Observable } from '../state/observable.js';
import type { OpenProjectState } from '../state/open-project-store.js';
import type { InterruptedRecordings } from '../state/interrupted-recordings.js';
import type { QuickEditSession } from '../state/quick-edit-store.js';
import type { StorageRootState } from '../state/storage-root-store.js';
import { OwnershipActions } from './ownership-actions.js';
import { accessSentence } from './project-words.js';
import { InterruptedRecordingsOffer } from './interrupted-recordings-offer.js';
import { RecoveryReportNotice } from './recovery-report-notice.js';
import type { RunCommand } from './settings/section.js';
import { useFocusKeptInside } from './use-focus-kept-inside.js';
import { useOwnershipAnnouncements } from './use-ownership-announcements.js';
import { quoted } from '@audiogubbins/text';

/** What the banner reads and runs. */
export interface ProjectBannerProps {
  readonly root: Observable<StorageRootState>;

  /** The open project, absent where this browser keeps no projects. */
  readonly project: Observable<OpenProjectState> | undefined;

  /** The Quick Edit in progress, absent where this browser keeps no projects. */
  readonly quickEdit: Observable<QuickEditSession | undefined> | undefined;

  /** The open project's recordings cut short, absent where this browser keeps no projects. */
  readonly interrupted: InterruptedRecordings | undefined;
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
      <Banner
        tone={BannerTone.Warning}
        icon="stored-projects"
        actions={
          <Button compact onClick={() => run(showPanelCommandId(PanelKinds.Capabilities))}>
            Show the Capabilities panel
          </Button>
        }
      >
        {root.reason}
      </Banner>
    );
  }
  if (root.kind === 'failed') {
    return (
      <Banner tone={BannerTone.Error} icon="stored-projects">
        {`Your projects could not be read. ${root.cause.summary}`}
      </Banner>
    );
  }
  if (root.kind === 'blocked' && !root.shown) {
    return (
      <Banner
        tone={BannerTone.Error}
        icon="stored-projects"
        actions={
          <Button compact tone={ButtonTone.Primary} onClick={() => run('storage.review')}>
            Decide now
          </Button>
        }
      >
        Your stored projects were made by another version of AudioGubbins, so none can be opened
        until you decide what to do with them.
      </Banner>
    );
  }
  return root.kind === 'opening' ? <Banner icon="busy" title="Opening your projects…" /> : null;
}

/** What is said with no project open, and the ways to one. */
function NoProject({ run }: { readonly run: RunCommand }): ReactNode {
  return (
    <Banner
      icon="open-project"
      title="No project is open."
      actions={
        <>
          <Button
            compact
            tone={ButtonTone.Primary}
            onClick={() => run('file.projects', { section: 'new' })}
          >
            <Icon name="add" size={IconSize.Inline} />
            New project…
          </Button>
          <Button compact onClick={() => run('file.projects', { section: 'open' })}>
            <Icon name="open-project" size={IconSize.Inline} />
            Open project…
          </Button>
          <Button compact tone={ButtonTone.Quiet} onClick={() => run('file.quick-edit')}>
            <Icon name="audio-file" size={IconSize.Inline} />
            Quick Edit a file…
          </Button>
        </>
      }
    />
  );
}

/** How the banner is coloured and marked, for what it says first. */
interface Look {
  readonly tone: BannerTone;
  readonly icon: IconName;
}

/**
 * The banner's look for the open project: a recording cut short first, since
 * it is offered first; then how this tab may use the project; then what
 * recovery found; then whether it is a Quick Edit.
 */
function lookOf(
  access: ProjectAccess,
  cutShort: boolean,
  recovered: boolean,
  quickEdit: boolean,
): Look {
  if (cutShort) return { tone: BannerTone.Warning, icon: 'interrupted-recording' };
  switch (access.kind) {
    case 'lost':
      return { tone: BannerTone.Error, icon: 'warning' };
    case 'read-only':
    case 'handed-over':
      return { tone: BannerTone.Warning, icon: 'read-only' };
    case 'closed':
      return { tone: BannerTone.Information, icon: 'project' };
    case 'writable':
      if (recovered) return { tone: BannerTone.Information, icon: 'recovered' };
      return { tone: BannerTone.Information, icon: quickEdit ? 'audio-file' : 'open-project' };
  }
}

/**
 * The open project: its name, or the file it is a Quick Edit of, how this tab
 * may use it, and what recovery found.
 */
function OpenProject({
  open,
  quickEdit,
  interrupted,
  run,
}: {
  readonly open: Extract<OpenProjectState, { kind: 'open' }>;
  readonly quickEdit: QuickEditSession | undefined;
  readonly interrupted: InterruptedRecordings | undefined;
  readonly run: RunCommand;
}): ReactNode {
  const { snapshot } = open;
  const name = quoted(snapshot.model.state.project.displayName);
  const said = accessSentence(snapshot.access, name);
  const quick = quickEdit?.project === snapshot.project ? quickEdit : undefined;
  const cutShort = useSyncExternalStore(
    interrupted?.subscribe ?? subscribeToNothing,
    () => interrupted?.get().recordings.length ?? 0,
  );
  const look = lookOf(
    snapshot.access,
    cutShort > 0,
    open.report !== undefined,
    quick !== undefined,
  );

  return (
    <Banner
      tone={look.tone}
      icon={look.icon}
      // The name stands alone where nothing else is said of the project; every
      // sentence about it names it already.
      {...(quick === undefined && said === undefined ? { title: name } : {})}
      actions={
        <>
          {quick !== undefined && (
            <Button compact onClick={() => run(ExportCommand.Audio)}>
              <Icon name="export" size={IconSize.Inline} />
              {EXPORT_BUTTON}
            </Button>
          )}
          {interrupted !== undefined && (
            <InterruptedRecordingsOffer offers={interrupted} run={run} />
          )}
          <OwnershipActions snapshot={snapshot} name={name} request={open.request} run={run} />
          {open.report !== undefined && (
            <RecoveryReportNotice report={open.report} name={name} run={run} />
          )}
        </>
      }
    >
      {(quick !== undefined || said !== undefined) && (
        <OpenProjectSentence
          quickFile={quick?.fileName}
          said={said}
          readOnly={snapshot.access.kind === 'read-only'}
          name={name}
        />
      )}
    </Banner>
  );
}

/**
 * What the banner says of the open project: the Quick Edit file it holds, its
 * read-only mark, and what is said of its access, each where there is one.
 */
function OpenProjectSentence({
  quickFile,
  said,
  readOnly,
  name,
}: {
  readonly quickFile: string | undefined;
  readonly said: string | undefined;
  readonly readOnly: boolean;
  readonly name: string;
}): ReactNode {
  return (
    <>
      {quickFile !== undefined && (
        <>
          <Badge tone={BadgeTone.Accent}>Quick Edit</Badge>{' '}
          <span>{`${quoted(quickFile)}, kept in the project ${name}`}</span>
        </>
      )}
      {quickFile !== undefined && said !== undefined && ' '}
      {readOnly && (
        <>
          <Badge tone={BadgeTone.Warning}>Read only</Badge>{' '}
        </>
      )}
      {said !== undefined && <span>{said}</span>}
    </>
  );
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
  interrupted,
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
      <Banner icon="busy" title="Opening the project…" />
    ) : (
      <OpenProject open={open} quickEdit={quick} interrupted={interrupted} run={run} />
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
