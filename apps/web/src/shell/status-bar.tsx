/**
 * The status bar: where the workspace is, and anything the user should know.
 *
 * Its own surface rather than part of the shell's tree, because it is one
 * thing: a strip of short statements, each with the action that answers it
 * where there is one.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { commandId, type CommandId } from '@audiogubbins/commands';
import { usePublishedBlockSize } from '@audiogubbins/design-system';
import { PanelKinds } from '@audiogubbins/workspace';

import { showPanelCommandId } from '../commands/panel-commands.js';
import {
  MAKING_ROOM_SAFELY,
  subjectOf,
  wholeNotice,
  type NoticeAbout,
  type StandingRecovery,
} from '../state/recovery-notices.js';
import { describeUnsaved, type PersistenceState } from '../state/state-storage.js';
import { QuickAction } from './panels.js';

/** What the status bar shows. */
export interface StatusBarProps {
  /** The name of the workspace on screen. */
  readonly workspaceName: string;

  /** A chord waiting for its next press, as the platform writes it. */
  readonly pendingChord: string | undefined;

  readonly diagnosticModeActive: boolean;

  /** The parts whose last write the browser refused, and why. */
  readonly persistence: PersistenceState;

  /** Every notice that something could not be read, and whether text waits for room. */
  readonly recovery: StandingRecovery;

  /** How many capabilities this browser lacks. */
  readonly missingCapabilities: number;

  readonly run: (id: CommandId, args?: Readonly<Record<string, string>>) => void;
}

/**
 * The command that dismisses a notice, with its arguments where it takes any:
 * the command of the store the notice came from, so one never dismisses
 * another.
 */
function dismissalOf(
  about: NoticeAbout,
): readonly [id: CommandId, args?: Readonly<Record<string, string>>] {
  return about === 'profiles'
    ? [commandId('shortcuts.dismiss-notice')]
    : [commandId('workspace.dismiss-notice'), { part: about }];
}

/**
 * Whether what `box` holds reaches past what it shows, downwards or sideways.
 *
 * Either axis, though its items wrap: the bar scrolls both ways, and what lies
 * past its end is brought into view from the keyboard only as what lies below
 * it is, from the bar itself.
 */
function overflowing(box: HTMLElement): boolean {
  return box.scrollHeight > box.clientHeight || box.scrollWidth > box.clientWidth;
}

/**
 * Whether the bar's contents reach past what it shows, kept in step as they and
 * the bar grow and shrink.
 *
 * Measured whenever an item comes or goes, and whenever the bar or an item in
 * it changes size: the window resized, the page zoomed, the text made larger, a
 * notice's words changed. Each item is watched as well as the bar, because a
 * bar held at its cap keeps its size while what it holds grows under it; and
 * afresh as they come and go, so one that has gone is not held on to.
 */
function useOverflows(bar: RefObject<HTMLElement | null>): boolean {
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const box = bar.current;
    if (box === null) return undefined;
    const measure = (): void => {
      setOverflows(overflowing(box));
    };
    const sizes = new ResizeObserver(measure);
    const watchEach = (): void => {
      sizes.disconnect();
      sizes.observe(box);
      for (const item of box.children) sizes.observe(item);
      measure();
    };
    const items = new MutationObserver(watchEach);
    items.observe(box, { childList: true });
    watchEach();
    return () => {
      items.disconnect();
      sizes.disconnect();
    };
  }, [bar]);

  return overflows;
}

/** How focus reaches the bar, as {@link useFocusInBar} answers it. */
interface FocusInBar {
  /**
   * A stop of the Tab order while what the bar holds reaches past what it
   * shows, downwards or sideways, and only then: its items are text, and a
   * keyboard reader can bring text that is out of sight into view, the advice
   * on making room among it, only from the bar itself. Otherwise focusable
   * only by the page, to keep focus in the bar.
   */
  readonly tabIndex: 0 | -1;

  /** Called as a notice is dismissed, so focus stays in the bar as it goes. */
  readonly dismissing: () => void;
}

/**
 * How focus reaches the bar: by Tab while it scrolls, and by the page when a
 * dismissal takes the button that had it.
 *
 * The button a user presses to dismiss a notice goes with the notice, and left
 * alone, focus would go to the page's body with it. It moves to the first
 * control left in the status bar, or to the bar itself when none is. Watched by
 * how many notices stand, which only a dismissal changes, rather than by the
 * list, which is new with every render.
 */
function useFocusInBar(bar: RefObject<HTMLElement | null>, standing: number): FocusInBar {
  const dismissed = useRef(false);
  const overflows = useOverflows(bar);

  useEffect(() => {
    if (!dismissed.current) return;
    dismissed.current = false;
    const next = bar.current?.querySelector('button');
    (next ?? bar.current)?.focus();
  }, [bar, standing]);

  return {
    tabIndex: overflows ? 0 : -1,
    dismissing: () => {
      dismissed.current = true;
    },
  };
}

/** Draws the status bar. */
export function StatusBar({
  workspaceName,
  pendingChord,
  diagnosticModeActive,
  persistence,
  recovery,
  missingCapabilities,
  run,
}: StatusBarProps): ReactNode {
  const bar = useRef<HTMLElement>(null);
  const focus = useFocusInBar(bar, recovery.notices.length);

  // The bar's height, published for the notice surface to clear. The notice is
  // fixed to the bottom of the page, and without this it would be drawn over
  // the bar and over the Dismiss buttons in it, which would fail WCAG 2.4.11
  // for anything focused there. The bar wraps its notices and grows to a third
  // of the screen, so a fixed offset would be wrong at every size but one.
  usePublishedBlockSize(bar, '--ag-status-bar-block-size');

  return (
    <footer className="ag-status-bar" ref={bar} tabIndex={focus.tabIndex} aria-label="Status">
      <span className="ag-status-item">{workspaceName}</span>

      {pendingChord !== undefined && (
        <span className="ag-status-item" data-ag-status="reduced">
          {`${pendingChord} …`}
        </span>
      )}

      {diagnosticModeActive && (
        <span className="ag-status-item" data-ag-status="reduced">
          Diagnostic mode
        </span>
      )}

      {persistence.unsaved.length > 0 && (
        <span className="ag-status-item" data-ag-status="unavailable">
          {describeUnsaved(persistence)}
        </span>
      )}

      {recovery.notices.map(({ about, notice }) => (
        // One element for the notice and its button, so they wrap together: as
        // siblings in the bar, a Dismiss could wrap to the start of the next
        // line, beside the next notice, which it does not dismiss.
        <span key={about} className="ag-status-notice">
          <span className="ag-status-item" data-ag-status="unavailable">
            {wholeNotice(notice)}
          </span>
          <QuickAction
            // Drawn short, named in full: eight words on a button in a one-line
            // bar would spill over the workspace on a narrow screen.
            label={`Dismiss the notice about ${subjectOf(about)}`}
            shown="Dismiss"
            onPress={() => {
              focus.dismissing();
              run(...dismissalOf(about));
            }}
          />
        </span>
      ))}

      {recovery.waitsForRoom && (
        // After the notices it advises on, once for them all, with nothing to
        // dismiss it: it stands while text waits for room, notices or not.
        <span className="ag-status-item" data-ag-status="unavailable">
          {MAKING_ROOM_SAFELY}
        </span>
      )}

      <span className="ag-status-spacer" />

      {/*
        Shown only when there is something to say, and worded for the number
        there is, so a browser that has everything never reads "0 capabilities
        unavailable" and one that lacks one never reads "1 capabilities
        unavailable". It carries the action that opens the panel it speaks of,
        named as the menu names that panel, so the user who presses it knows the
        tab they are looking for.
      */}
      {missingCapabilities > 0 && (
        <>
          <span className="ag-status-item" data-ag-status="reduced">
            {missingCapabilities === 1
              ? 'One capability is unavailable'
              : `${String(missingCapabilities)} capabilities are unavailable`}
          </span>
          <QuickAction
            label="Show the Capabilities panel"
            onPress={() => {
              run(commandId(showPanelCommandId(PanelKinds.Capabilities)));
            }}
          />
        </>
      )}
    </footer>
  );
}
