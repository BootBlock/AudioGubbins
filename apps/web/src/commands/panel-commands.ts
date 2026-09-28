/**
 * Everything a user can do to the panels in the workspace on screen.
 *
 * Opening, closing, moving and sizing a panel, and the arrangement a drag in
 * the dock reports. REQ-UX-057 makes docking core infrastructure and
 * REQ-EDIT-073 puts every one of these through the command route, a drag
 * included, so each is reachable from a menu, the palette, a shortcut, a finger
 * and a macro alike.
 */

import {
  CommandCategory,
  unavailable,
  unchanged,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import {
  DockRegion,
  activePanelOf,
  readLayout,
  regionPhrase,
  sameArrangement,
  titleOf,
  type PanelDescriptor,
  type PanelKind,
  type WorkspaceLayout,
} from '@audiogubbins/workspace';
import { isRecord } from '../state/stored-value.js';

import { availableUnless, report, shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The panel the user is working in, or `undefined` when none is. */
function activePanel(context: ShellContext): string | undefined {
  return context.workspace.get().layout.activePanelId;
}

/** What the user calls the panel the user is working in. */
function titleOfActive(
  context: ShellContext,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): string {
  const panel = activePanelOf(context.workspace.get().layout);
  return panel === undefined ? 'The panel' : `The ${titleOf(panel, descriptors)} panel`;
}

/** Why a command acting on the panel the user is working in cannot run. */
const NO_ACTIVE_PANEL = 'No panel is active.';

/**
 * Whether a command acting on the panel the user is working in can run.
 *
 * Reads the store's own answer, so a menu entry is greyed with the reason the
 * command would give rather than claiming to be available and then refusing.
 */
function forActivePanel(
  context: ShellContext,
  problem: (id: string) => string | undefined,
): CommandAvailability {
  const id = activePanel(context);
  if (id === undefined) return unavailable(NO_ACTIVE_PANEL);

  const reason = problem(id);
  return availableUnless(reason);
}

/**
 * The command that shows a kind of panel.
 *
 * Named here, where the commands are made, so a menu and the status bar ask
 * for it rather than spelling the pattern again.
 */
export function showPanelCommandId(kind: PanelKind): string {
  return `workspace.show-${kind}`;
}

/**
 * One command per kind of panel this build has.
 *
 * A command each rather than one command taking a kind, because the set of
 * panels is fixed when the application is built. That makes each one findable
 * in the palette by the name the user calls it, and bindable to a shortcut of
 * its own, which a single parameterised command could be neither.
 */
function showCommands(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): readonly Command<ShellContext>[] {
  return [...descriptors.values()].map((descriptor) =>
    shellCommand(
      showPanelCommandId(descriptor.kind),
      `Show the ${descriptor.title} panel`,
      CommandCategory.Workspace,
      (context) => {
        const refusal = context.workspace.openPanel(descriptor.kind);
        return report(context, refusal, `The ${descriptor.title} panel is open.`);
      },
      {
        keywords: ['panel', 'show', 'open', descriptor.title.toLowerCase()],
        availability: (context) => {
          const problem = context.workspace.openingProblem(descriptor.kind);
          return availableUnless(problem);
        },
      },
    ),
  );
}

/** Closing the panel the user is working in. */
function closeCommand(descriptors: ReadonlyMap<PanelKind, PanelDescriptor>): Command<ShellContext> {
  return shellCommand(
    'workspace.close-panel',
    'Close this panel',
    CommandCategory.Workspace,
    (context) => {
      // A refusal, as every command acting on the active panel gives: returning
      // nothing, this would be recorded by the bus as a close that happened.
      const active = activePanel(context);
      if (active === undefined) return NO_ACTIVE_PANEL;

      const title = titleOfActive(context, descriptors);
      const refusal = context.workspace.closePanel(active);
      return report(context, refusal, `${title} is closed.`);
    },
    {
      keywords: ['panel', 'close', 'hide', 'dismiss'],
      description:
        'Closes the panel you are working in. The docking tabs carry no close control, so that a keyboard user can close a panel as easily as a pointer user. The Workspace menu opens it again.',
      availability: (context) => forActivePanel(context, context.workspace.closureProblem),
    },
  );
}

/**
 * What to say when an arrangement closes a panel, or `undefined` when it closes
 * none.
 *
 * A drag that moves or resizes panels is watched rather than heard, and says
 * nothing. A panel that is gone is a different thing, and this is not the only
 * route to it: the docking engine closes the panel whose tab has focus when
 * Delete or Backspace is pressed on it, which reaches the application as an
 * arrangement with a panel missing. Unannounced, a screen-reader user who
 * pressed the key they most often mean "back" by would lose the panel in
 * silence, while the same user choosing Close this panel is told.
 *
 * Worded as the close command words it, so the two routes say one thing.
 */
function panelsClosedBy(
  before: WorkspaceLayout,
  after: WorkspaceLayout,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): string | undefined {
  const kept = new Set(after.groups.flatMap((group) => group.panels).map((panel) => panel.id));
  const gone = before.groups
    .flatMap((group) => group.panels)
    .filter((panel) => !kept.has(panel.id));
  if (gone.length === 0) return undefined;

  // Named without the article and joined into one sentence. Were each name to
  // carry its own "The", two panels would read "The Assets panel, The Logs
  // panel are closed." The route is the one the comment above
  // `rearrangeCommand` names: a macro or a replayed journal supplying an
  // arrangement with more than one panel gone.
  //
  // Built from the list rather than from its head and tail. Destructured, each
  // part would be `string | undefined` under `noUncheckedIndexedAccess`, and
  // neither of the two guards that would quiet it could be right: one would
  // return nothing where a panel has just closed and the other would render
  // "The Assets and  panels are closed."
  const names = gone.map((panel) => titleOf(panel, descriptors));
  const earlier = names.slice(0, -1).join(', ');
  const last = names.slice(-1).join('');
  return earlier === ''
    ? `The ${last} panel is closed.`
    : `The ${earlier} and ${last} panels are closed.`;
}

/** The refusal for text that is no arrangement at all, written once. */
const NOT_AN_ARRANGEMENT = 'That is not an arrangement this workspace can show.';

/**
 * The workspace on screen, arranged as the caller asks.
 *
 * Returns the layout to store, or the reason the arrangement cannot be shown.
 * The arrangement carries only the groups and the active panel, and the
 * identity comes from the workspace the user is looking at, so a replayed or
 * stale arrangement can move panels and can never rename, re-classify or
 * overwrite a workspace. A whole layout from the dock would carry the name from
 * before a rename, and written back, would undo the rename.
 */
function arrangedAs(
  text: string,
  onScreen: WorkspaceLayout,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): WorkspaceLayout | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'That arrangement could not be read.';
  }

  if (!isRecord(parsed)) return NOT_AN_ARRANGEMENT;

  const active = parsed['activePanelId'];
  const candidate = {
    schemaVersion: onScreen.schemaVersion,
    id: onScreen.id,
    displayName: onScreen.displayName,
    builtIn: onScreen.builtIn,
    groups: parsed['groups'],
    ...(typeof active === 'string' ? { activePanelId: active } : {}),
  };

  // The store's rule. Its reasons are worded for a stored layout; the one a
  // drag can bring about, floating the last docked group, which the engine
  // allows, is said in a drag's words, and any other as one refusal. Told apart
  // by the kind the rule answers with, not by comparing its sentence.
  const read = readLayout(candidate, descriptors);
  if (read.layout !== undefined) return read.layout;
  return read.problem.kind === 'nothing-docked'
    ? 'That would leave nothing docked for the floating panels to float over.'
    : NOT_AN_ARRANGEMENT;
}

/**
 * Arranging the panels of the workspace on screen.
 *
 * Dragging a panel, resizing a group or moving a tab is a gesture, and
 * REQ-EDIT-073 lists gestures among the actions that go through the command
 * system. Handed from the dock straight to the store, what it reports would be
 * the one change the interface made by another route.
 *
 * The arrangement travels as JSON text because an invocation's arguments must
 * be serialisable, and it is checked here before the store sees it, because a
 * macro or a replayed journal can supply one no dock produced. A move is not
 * announced when it applies: the user is watching the panels move, and a
 * resize reports many arrangements in a second. A panel that is gone from the
 * arrangement is announced ({@link panelsClosedBy}), because it is not a move.
 *
 * Not offered in the palette. Nothing a user types can supply an arrangement,
 * and offered, it would match a search for "move" beside the commands that move
 * a panel from the keyboard; a keyboard or touch user who chose it would be
 * told to drag.
 *
 * It arranges the workspace the user is looking at. The identity is not the
 * caller's to give, so nothing a dock reports can rename a workspace or write
 * itself over another one.
 */
function rearrangeCommand(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): Command<ShellContext> {
  return shellCommand(
    'workspace.rearrange',
    'Rearrange the panels',
    CommandCategory.Workspace,
    (context, invocation) => {
      const text = textArgument(invocation, 'arrangement');
      if (text === undefined) {
        return 'This runs when a panel or the edge between two groups is dragged. From the keyboard or a finger, use "Move this panel to the left" and the commands beside it.';
      }

      // A refusal changes nothing, here or on screen. The dock that reported
      // the arrangement has drawn it already, and puts itself back (see
      // `dock-rearrangement.ts`); a macro or a replayed journal drew nothing.
      const arranged = arrangedAs(text, context.workspace.get().layout, descriptors);
      if (typeof arranged === 'string') return arranged;
      if (sameArrangement(arranged, context.workspace.get().layout)) {
        return unchanged('panels.already-arranged', 'The panels are already arranged that way.');
      }

      const closed = panelsClosedBy(context.workspace.get().layout, arranged, descriptors);
      context.workspace.rearranged(arranged);
      if (closed !== undefined) context.interaction.announce(closed);
      return undefined;
    },
    {
      keywords: ['dock', 'drag'],
      description:
        'Records where panels were dragged. It runs for you when you drag a panel by its tab, or the edge between two groups.',
      discoverable: false,
    },
  );
}

/**
 * Moving and sizing the panel the user is working in.
 *
 * The docking engine moves a panel with the browser's drag-and-drop and sizes a
 * group by dragging a splitter. Neither exists for a keyboard, and a touch
 * screen produces no drag-and-drop at all, so without these commands the
 * workspace on a tablet could be looked at and not arranged. REQ-UX-057 asks
 * for panels that move between regions and REQ-UX-005 makes keyboard and touch
 * first-class, so each operation is a command: reachable from the menu, the
 * palette, a shortcut, a finger and a future macro alike.
 *
 * One command per region rather than one command taking a region, for the same
 * reason there is one command per panel kind: each is findable in the palette
 * by the name a user would look for, and bindable to a key of its own.
 */
function arrangementCommands(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): readonly Command<ShellContext>[] {
  return [
    ...regionCommands(descriptors),
    ...sizingCommands(descriptors),
    ...nudgeCommands(descriptors),
    ...tabOrderCommands(descriptors),
  ];
}

/**
 * A command that acts on the panel the user is working in.
 *
 * The one shape all four families have: find the active panel, refuse when
 * there is none, do the thing, and say what happened in the panel's own name.
 * Written once, because what differs between the families is a store method, a
 * sentence and a list of keywords, which is data.
 */
function activePanelCommand(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
  entry: {
    readonly id: string;
    readonly label: string;
    readonly keywords: readonly string[];
    readonly act: (context: ShellContext, panel: string) => string | undefined;
    readonly said: (title: string) => string;
    readonly problem: (context: ShellContext, panel: string) => string | undefined;
  },
): Command<ShellContext> {
  return shellCommand(
    entry.id,
    entry.label,
    CommandCategory.Workspace,
    (context) => {
      const panel = activePanel(context);
      if (panel === undefined) return NO_ACTIVE_PANEL;

      const title = titleOfActive(context, descriptors);
      return report(context, entry.act(context, panel), entry.said(title));
    },
    {
      keywords: entry.keywords,
      availability: (context) => forActivePanel(context, (panel) => entry.problem(context, panel)),
    },
  );
}

/** Moving the panel the user is working in to another region. */
function regionCommands(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): readonly Command<ShellContext>[] {
  const destinations: readonly { readonly region: DockRegion; readonly label: string }[] = [
    { region: DockRegion.Left, label: 'Move this panel to the left' },
    { region: DockRegion.Centre, label: 'Move this panel to the middle' },
    { region: DockRegion.Right, label: 'Move this panel to the right' },
    { region: DockRegion.Bottom, label: 'Move this panel to the bottom' },
    { region: DockRegion.Floating, label: 'Float this panel' },
  ];

  return destinations.map(({ region, label }) =>
    activePanelCommand(descriptors, {
      id: `workspace.move-panel-${region}`,
      label,
      keywords: ['panel', 'move', 'arrange', 'dock', region],
      act: (context, panel) => context.workspace.movePanel(panel, region),
      said: (title) => `${title} is now ${regionPhrase(region)}.`,
      problem: (context, panel) => context.workspace.movingProblem(panel, region),
    }),
  );
}

/**
 * Growing and shrinking the group the panel is in.
 *
 * Each says what it did. These exist for the users who cannot drag, and silent,
 * they would leave a screen-reader user who moved a panel from the palette
 * hearing the palette close and then nothing; every other workspace command
 * says its result.
 */
function sizingCommands(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): readonly Command<ShellContext>[] {
  const resizing = (
    id: string,
    label: string,
    steps: number,
    keywords: readonly string[],
  ): Command<ShellContext> =>
    activePanelCommand(descriptors, {
      id,
      label,
      keywords: ['panel', 'size', 'resize', ...keywords],
      act: (context, panel) => context.workspace.resizeGroup(panel, steps),
      said: (title) => `${title} has ${steps > 0 ? 'more' : 'less'} room.`,
      problem: (context, panel) => context.workspace.resizingProblem(panel, steps),
    });

  return [
    resizing('workspace.grow-panel', 'Give this panel more room', 1, ['grow', 'wider', 'taller']),
    resizing('workspace.shrink-panel', 'Give this panel less room', -1, [
      'shrink',
      'narrower',
      'shorter',
    ]),
  ];
}

/**
 * Nudging a floating group.
 *
 * The engine moves one by dragging its header, which is a pointer gesture:
 * without these, a panel could be floated, resized and re-docked from the
 * keyboard, and moved only by dragging (WCAG 2.5.7).
 *
 * Each says which way it went. One step is a twentieth of the workspace, so
 * crossing it takes about twenty presses, and "the panel has moved" twenty
 * times tells a reader who cannot see it nothing they did not already know.
 */
function nudgeCommands(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): readonly Command<ShellContext>[] {
  const nudging = (
    id: string,
    label: string,
    x: number,
    y: number,
    way: string,
  ): Command<ShellContext> =>
    activePanelCommand(descriptors, {
      id,
      label,
      keywords: ['panel', 'float', 'move', 'nudge', way],
      act: (context, panel) => context.workspace.nudgeGroup(panel, x, y),
      said: (title) => `${title} has moved ${way}.`,
      problem: (context, panel) => context.workspace.nudgingProblem(panel, x, y),
    });

  return [
    nudging('workspace.nudge-panel-left', 'Nudge this floating panel left', -1, 0, 'left'),
    nudging('workspace.nudge-panel-right', 'Nudge this floating panel right', 1, 0, 'right'),
    nudging('workspace.nudge-panel-up', 'Nudge this floating panel up', 0, -1, 'up'),
    nudging('workspace.nudge-panel-down', 'Nudge this floating panel down', 0, 1, 'down'),
  ];
}

/**
 * Moving a panel along its group's tabs.
 *
 * The engine reorders them by dragging one over another, which is the other
 * gesture with no alternative.
 */
function tabOrderCommands(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): readonly Command<ShellContext>[] {
  const reordering = (
    id: string,
    label: string,
    places: number,
    keywords: readonly string[],
  ): Command<ShellContext> =>
    activePanelCommand(descriptors, {
      id,
      label,
      keywords: ['panel', 'tab', 'order', 'reorder', ...keywords],
      act: (context, panel) => context.workspace.reorderPanel(panel, places),
      said: (title) => `${title} has moved ${places < 0 ? 'earlier' : 'later'} in its group.`,
      problem: (context, panel) => context.workspace.reorderingProblem(panel, places),
    });

  return [
    reordering('workspace.move-tab-earlier', 'Move this panel earlier in its group', -1, [
      'earlier',
      'left',
      'first',
    ]),
    reordering('workspace.move-tab-later', 'Move this panel later in its group', 1, [
      'later',
      'right',
      'last',
    ]),
  ];
}

/** Every command that acts on the panels of the workspace on screen. */
export function panelCommands(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): readonly Command<ShellContext>[] {
  return [
    rearrangeCommand(descriptors),
    ...arrangementCommands(descriptors),
    closeCommand(descriptors),
    ...showCommands(descriptors),
  ];
}
