/**
 * Reading a stored layout: whether a value, or the text storage holds, is a
 * layout this build can mount, built from the fields it checks, and what is
 * mounted in its place where it is not.
 *
 * REQ-UX-059 and the Phase 01 packet require a corrupt layout to fall back to a
 * known default *without touching project data*. That is the important promise:
 * a user whose arrangement is damaged loses their arrangement, opens the
 * application, and finds their work intact.
 *
 * Apart from the store of the layouts a user has, which holds layouts already
 * read: the reading is asked of the mounted layout's text, of each entry of a
 * stored collection and of an arrangement a drag reports, and none of those is
 * an operation of the store.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import { asQuoted, asWrittenName, type NameProblem } from '@audiogubbins/text';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { LAYOUT_IDENTIFIERS } from './held-layouts.js';
import { LONGEST_WORKSPACE_NAME, writtenWorkspaceName } from './workspace-name.js';

import {
  DockRegion,
  leavesNothingDocked,
  type FloatingPlacement,
  type OpenPanel,
  type PanelDescriptor,
  type PanelGroup,
  type PanelKind,
  type WorkspaceLayout,
} from './panel.js';

/** How a layout came to be in use. */
export const LayoutSource = {
  /** The layout was stored and read back without trouble. */
  Stored: 'stored',

  /** Nothing was stored, so a built-in preset was used. */
  Default: 'default',

  /**
   * What was stored could not be used, so a built-in preset replaced it.
   *
   * Distinct from `default` because the user should be told. Silently replacing
   * a layout a user arranged, with no explanation, teaches them the application
   * forgets things.
   */
  Recovered: 'recovered',
} as const;

/** How a layout came to be in use. */
export type LayoutSource = (typeof LayoutSource)[keyof typeof LayoutSource];

/** The preset mounted in place of a stored layout that could not be used, and why. */
export interface RecoveredLayout {
  readonly layout: WorkspaceLayout;
  readonly source: typeof LayoutSource.Recovered;

  /** Why the stored layout could not be used, which the user is told. */
  readonly reason: string;
}

/** A layout chosen from a stored value, and how it came to be in use. */
export type LayoutResolution =
  | {
      readonly layout: WorkspaceLayout;
      readonly source: typeof LayoutSource.Stored | typeof LayoutSource.Default;
    }
  | RecoveredLayout;

/**
 * A layout chosen from stored text, and how it came to be in use.
 *
 * A recovered one carries the text that could not be used, which is still in
 * storage and is written over by the next write of the layout: the caller
 * keeps it somewhere first.
 */
export type ResolvedLayout =
  Exclude<LayoutResolution, RecoveredLayout> | (RecoveredLayout & { readonly text: string });

/** Whether a value is an object with string keys. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a value is a non-empty string. */
function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** The regions a group may be in, for a stored group's region to be read against. */
const REGIONS: ReadonlySet<unknown> = new Set(Object.values(DockRegion));

/** Whether a value is a region a group may be in. */
function isRegion(value: unknown): value is DockRegion {
  return REGIONS.has(value);
}

/**
 * How a stored panel's title is refused, by the part of the rule that refused
 * it.
 *
 * The title is drawn on the panel's tab and said in the heading of the
 * Workspace menu's panel entries and in the announcement of a panel moved or
 * closed, so a title with no bound is a sentence of any length in a live
 * region. Held to the bound a workspace's name has, because a title names
 * what a person named, as an asset.
 */
const STORED_TITLE_REFUSED: Readonly<Record<NameProblem['kind'], string>> = {
  blank: 'The stored layout gives a panel an empty title.',
  'too-long': `The stored layout gives a panel a title longer than ${String(LONGEST_WORKSPACE_NAME)} characters.`,
};

/** A value a panel's parameter may have. */
type ParameterValue = string | number | boolean;

/** Whether a value is one a panel's parameter may have. */
function isParameterValue(value: unknown): value is ParameterValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * A stored panel's parameters, as a new record of the values checked, or why
 * they cannot be read.
 *
 * Built with `Object.fromEntries`, which gives every name a property of its
 * own: assigned one by one, a parameter named `__proto__` would set the
 * record's prototype rather than be kept.
 */
function readParameters(value: unknown): Readonly<Record<string, ParameterValue>> | string {
  if (!isRecord(value)) {
    return 'The stored layout gives a panel parameters that are not named values.';
  }

  const read: [string, ParameterValue][] = [];
  for (const [name, one] of Object.entries(value)) {
    if (!isParameterValue(one)) {
      return `The stored layout gives a panel a parameter, "${asQuoted(name)}", that is not text, a number, or true or false.`;
    }
    read.push([name, one]);
  }
  return Object.fromEntries(read);
}

/** One stored panel, as a new panel of the fields checked, or why it cannot be read. */
function readPanel(
  value: unknown,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
  seenPanelIds: Set<string>,
): OpenPanel | string {
  if (!isRecord(value)) return 'The stored layout has a panel that is not a panel.';

  const id = value['id'];
  if (!isFilledString(id)) return 'The stored layout has a panel with no identifier.';

  if (seenPanelIds.has(id)) {
    return `The stored layout opens the panel "${asQuoted(id)}" twice.`;
  }
  seenPanelIds.add(id);

  const kind = value['kind'];
  if (typeof kind !== 'string' || !descriptors.has(kind)) {
    // A panel kind this build does not know is the ordinary consequence of
    // opening a layout saved by a newer version. It is a reason to fall back
    // rather than an error, and saying which kind is what lets the user work
    // out why.
    return `The stored layout holds a panel this version does not know: "${asQuoted(kind)}".`;
  }

  // Held as a workspace's stored name is, and kept as it is written.
  const title = value['title'];
  if (title !== undefined) {
    if (typeof title !== 'string') {
      return 'The stored layout gives a panel a title that is not text.';
    }
    const named = asWrittenName(title, LONGEST_WORKSPACE_NAME);
    if (typeof named !== 'string') return STORED_TITLE_REFUSED[named.kind];
  }

  const given = value['parameters'];
  const parameters = given === undefined ? undefined : readParameters(given);
  if (typeof parameters === 'string') return parameters;

  return {
    id,
    kind,
    ...(title === undefined ? {} : { title }),
    ...(parameters === undefined ? {} : { parameters }),
  };
}

/**
 * One stored panel group, as a new group of the fields checked, or why it
 * cannot be read.
 *
 * Takes `unknown` rather than a typed group. The data came from storage, where
 * nothing guarantees it matches the type it is supposed to have, and a
 * validator that starts by asserting the type it is checking has already given
 * up (REQ-EXEC-136.12).
 */
function readGroup(
  value: unknown,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
  seenPanelIds: Set<string>,
): PanelGroup | string {
  if (!isRecord(value)) return 'The stored layout has a panel group that is not a group.';

  const region = value['region'];
  if (!isRegion(region)) {
    return `The stored layout places a group in an unknown region, "${asQuoted(region)}".`;
  }

  const proportion = value['proportion'];
  if (
    typeof proportion !== 'number' ||
    !Number.isFinite(proportion) ||
    proportion <= 0 ||
    proportion > 1
  ) {
    return 'The stored layout gives a group an impossible size.';
  }

  const stored = value['panels'];
  if (!Array.isArray(stored) || stored.length === 0) {
    return 'The stored layout has an empty panel group.';
  }

  const panels: OpenPanel[] = [];
  for (const one of stored) {
    const panel = readPanel(one, descriptors, seenPanelIds);
    if (typeof panel === 'string') return panel;
    panels.push(panel);
  }

  const activePanelId = value['activePanelId'];
  if (typeof activePanelId !== 'string' || !panels.some((one) => one.id === activePanelId)) {
    return 'The stored layout marks a panel active that is not in its group.';
  }

  // A floating group needs to say where it floats, and a docked one must not,
  // because the docking engine would be told two different things about it.
  const group = { region, panels, activePanelId, proportion };
  const placement = value['placement'];
  if (region === DockRegion.Floating) {
    const floating = readPlacement(placement);
    return typeof floating === 'string' ? floating : { ...group, placement: floating };
  }
  if (placement !== undefined) return 'The stored layout gives a docked group a floating position.';

  return group;
}

/** Whether a value is a finite number in a range. */
function isWithin(value: unknown, lowest: number, highest: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= lowest && value <= highest;
}

/**
 * A floating group's placement, as a new placement of the fields checked, or
 * why it cannot be used.
 */
function readPlacement(placement: unknown): FloatingPlacement | string {
  if (!isRecord(placement)) return 'The stored layout does not say where a floating group sits.';

  const { x, y, width, height } = placement;
  if (
    isWithin(width, 0.01, 1) &&
    isWithin(height, 0.01, 1) &&
    isWithin(x, 0, 1) &&
    isWithin(y, 0, 1)
  ) {
    return { x, y, width, height };
  }
  return 'The stored layout gives a floating group an impossible position or size.';
}

/**
 * Why a layout cannot be mounted: which rule refused it, and what to say.
 *
 * The kind rather than the sentence, because a caller has to tell one refusal
 * apart from the others and the sentence is text for a reader, which can be
 * reworded without changing which branch a command takes.
 */
export interface LayoutProblem {
  /**
   * `nothing-docked` for a layout of floating panels alone, which a drag can
   * bring about and a caller words for a drag; `invalid` for every other.
   */
  readonly kind: 'nothing-docked' | 'invalid';

  /** British-English explanation, written for a stored layout. */
  readonly text: string;
}

/** A layout with only floating panels, and nothing for them to float over. */
const NOTHING_DOCKED: LayoutProblem = {
  kind: 'nothing-docked',
  text: 'The stored layout has only floating panels, and nothing docked for them to float over.',
};

/** Any other reason a layout cannot be mounted. */
function invalid(text: string): LayoutProblem {
  return { kind: 'invalid', text };
}

/**
 * A value read as a layout this build can mount: the layout, or why it cannot
 * be one.
 */
export type LayoutReading =
  | { readonly layout: WorkspaceLayout; readonly problem?: undefined }
  | { readonly layout?: undefined; readonly problem: LayoutProblem };

/** A reading that refuses the value, for the reason given. */
function refused(problem: LayoutProblem): LayoutReading {
  return { problem };
}

/**
 * Reads a value as a layout this build can mount: a new layout built of the
 * fields it checks, or the reason it cannot be one.
 *
 * Every check here is one that would otherwise fail at mount time, where the
 * failure takes the whole workspace with it rather than falling back to a
 * preset. Built rather than asserted, so the layout carries only what was
 * checked, and the one reading answers both whether a value is a layout and
 * why it is not: a field the type declares and nothing checks is a value the
 * interface draws unchecked.
 */
export function readLayout(
  value: unknown,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): LayoutReading {
  if (!isRecord(value)) return refused(invalid('The stored layout is not a layout.'));

  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== SCHEMA_VERSIONS.workspaceLayout) {
    return refused(
      invalid(
        `The stored layout was written for workspace format ${asQuoted(schemaVersion)}, and this version reads format ${String(SCHEMA_VERSIONS.workspaceLayout)}.`,
      ),
    );
  }

  const id = value['id'];
  if (!isFilledString(id)) return refused(invalid('The stored layout has no identifier.'));
  // Held to the shape an identifier is derived in, and to the bound storage
  // holds one to, since it keys storage and a message can quote it; not quoted
  // here, since it is text of any length.
  if (!LAYOUT_IDENTIFIERS.isIdentifier(id)) {
    return refused(invalid('The stored layout has an identifier AudioGubbins does not give.'));
  }

  const displayName = writtenWorkspaceName(value['displayName']);
  if (typeof displayName !== 'string') return refused(invalid(displayName.text));

  // Checked because the type declares it and nothing else would notice. A
  // layout carrying the wrong answer here is one the user can neither reset nor
  // delete, because both refuse on the value they are given.
  const builtIn = value['builtIn'];
  if (typeof builtIn !== 'boolean') {
    return refused(invalid('The stored layout does not say whether it is a built-in one.'));
  }

  const stored = value['groups'];
  if (!Array.isArray(stored) || stored.length === 0) {
    return refused(invalid('The stored layout has no panels.'));
  }

  const seenPanelIds = new Set<string>();
  const groups: PanelGroup[] = [];
  for (const one of stored) {
    const group = readGroup(one, descriptors, seenPanelIds);
    if (typeof group === 'string') return refused(invalid(group));
    groups.push(group);
  }

  if (leavesNothingDocked(groups)) return refused(NOTHING_DOCKED);

  // The panel the whole layout marks active, as distinct from each group's own
  // active tab. Absent is allowed; naming a panel that is not open is not,
  // since every command that acts on "this panel" would be offered and then do
  // nothing.
  const activePanelId = value['activePanelId'];
  if (
    activePanelId !== undefined &&
    !(typeof activePanelId === 'string' && seenPanelIds.has(activePanelId))
  ) {
    return refused(invalid('The stored layout marks a panel active that it does not hold.'));
  }

  const active = activePanelId === undefined ? {} : { activePanelId };
  return { layout: { schemaVersion, id, displayName, builtIn, groups, ...active } };
}

/**
 * Chooses the layout to mount.
 *
 * Never throws and never returns nothing: there is always a workspace to show.
 * A user whose stored layout is damaged gets the preset and an explanation, not
 * an empty window.
 */
export function resolveLayout(
  stored: unknown,
  fallback: WorkspaceLayout,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
  logger: Logger,
): LayoutResolution {
  if (stored === undefined || stored === null) {
    return { layout: fallback, source: LayoutSource.Default };
  }

  const read = readLayout(stored, descriptors);
  return read.layout === undefined
    ? recovered(fallback, read.problem.text, logger)
    : { layout: read.layout, source: LayoutSource.Stored };
}

/**
 * The fallback, mounted in place of a stored layout that cannot be used, with
 * the reason, which is logged: the one account of a recovery, for text that is
 * not JSON and for a layout that is not one alike.
 */
function recovered(fallback: WorkspaceLayout, reason: string, logger: Logger): RecoveredLayout {
  logger.warning('A stored workspace layout could not be used.', { reason });
  return { layout: fallback, source: LayoutSource.Recovered, reason };
}

/**
 * Chooses the layout to mount from the text storage holds.
 *
 * Parsing is part of the decision rather than something the caller does first,
 * so text that is not JSON has a reason of its own, and nothing but a parsed
 * value reaches the channel meant for one.
 */
export function resolveStoredLayout(
  text: string | null,
  fallback: WorkspaceLayout,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
  logger: Logger,
): ResolvedLayout {
  if (text === null) return { layout: fallback, source: LayoutSource.Default };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Text that is not JSON at all is a damaged layout like any other, with a
    // reason of its own: nothing in it could be read, which is different from
    // something in it being wrong.
    return { ...recovered(fallback, 'The stored workspace could not be read.', logger), text };
  }

  const resolved = resolveLayout(parsed, fallback, descriptors, logger);
  return resolved.source === LayoutSource.Recovered ? { ...resolved, text } : resolved;
}
