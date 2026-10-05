import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LogSeverity,
  createDiagnosticCentre,
  createLogStore,
  type LogStore,
  type Logger,
} from '@audiogubbins/diagnostics';
import { N_LOG_N_FOURFOLD, comparisonsIn } from '@audiogubbins/test-fixtures';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { DockRegion, type PanelDescriptor, type WorkspaceLayout } from './panel.js';
import { LayoutSource, readLayout, resolveLayout, resolveStoredLayout } from './layout-reading.js';
import { createLayoutStore, type LayoutRemoval, type LayoutStore } from './layout-store.js';
import { LAYOUT_IDENTIFIERS, placedLayouts } from './held-layouts.js';
import { DEFAULT_PRESET_ID, PanelKinds, buildPresets } from './presets.js';
import {
  LONGEST_WORKSPACE_NAME,
  listedName,
  nameOfACopy,
  nameOfANewWorkspace,
  workspaceName,
  writtenWorkspaceName,
} from './workspace-name.js';

const descriptor = (kind: string): PanelDescriptor => ({
  kind,
  title: kind,
  defaultRegion: DockRegion.Centre,
  allowsMultiple: false,
  closable: true,
});

const DESCRIPTORS = new Map(
  Object.values(PanelKinds).map((kind) => [kind, descriptor(kind)] as const),
);

const AVAILABLE = new Set<string>(Object.values(PanelKinds));

/**
 * Removes a layout by the one route the store offers, the removal its check
 * answers made at once: the layout removed, or why it was refused.
 */
function removed(store: LayoutStore, id: string): WorkspaceLayout | string {
  const removal = store.removable(id);
  return typeof removal === 'string' ? removal : removal.make();
}

/** What a refusal says, for the assertions that read its wording. */
function layoutProblemText(
  layout: unknown,
  descriptors: ReadonlyMap<string, PanelDescriptor>,
): string | undefined {
  return readLayout(layout, descriptors).problem?.text;
}

/** A soft hyphen, which a reader never sees unless a line breaks at it. */
const SOFT_HYPHEN = String.fromCodePoint(0xad);

/** The Hangul jungseong filler, a letter no reader sees. */
const JUNGSEONG_FILLER = String.fromCodePoint(0x1160);

/**
 * The workspace package as it loads on a runtime whose collation is Turkish
 * whatever a caller asks for, which cannot compare names by the one rule.
 */
async function whereNamesCannotBeCompared() {
  const RealCollator = Intl.Collator;
  vi.spyOn(Intl, 'Collator').mockImplementation(
    class extends RealCollator {
      constructor(_locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
        super('tr', options);
      }
    },
  );
  vi.resetModules();
  const [held, store, name] = await Promise.all([
    import('./held-layouts.js'),
    import('./layout-store.js'),
    import('./workspace-name.js'),
  ]);
  return { ...held, ...store, ...name };
}

function validLayout(overrides: Partial<WorkspaceLayout> = {}): WorkspaceLayout {
  return {
    schemaVersion: SCHEMA_VERSIONS.workspaceLayout,
    id: 'mine',
    displayName: 'My workspace',
    builtIn: false,
    groups: [
      {
        region: DockRegion.Centre,
        panels: [{ id: 'p1', kind: PanelKinds.Editor }],
        activePanelId: 'p1',
        proportion: 1,
      },
    ],
    ...overrides,
  };
}

describe('buildPresets', () => {
  it('builds every preset REQ-UX-058 names', () => {
    const ids = buildPresets(AVAILABLE).map((preset) => preset.id);
    expect(ids).toEqual([
      'editing',
      'spectral-repair',
      'recording',
      'game-audio',
      'batch-processing',
      'multitrack',
    ]);
  });

  it('marks every preset built-in, so none can be edited in place', () => {
    expect(buildPresets(AVAILABLE).every((preset) => preset.builtIn)).toBe(true);
  });

  it('starts a new user in a preset that exists', () => {
    expect(buildPresets(AVAILABLE).map((p) => p.id)).toContain(DEFAULT_PRESET_ID);
  });

  it('produces layouts that pass validation', () => {
    for (const preset of buildPresets(AVAILABLE)) {
      expect(layoutProblemText(preset, DESCRIPTORS)).toBeUndefined();
    }
  });

  it('holds every preset under an identifier in the shape a stored one is held to', () => {
    // Out of that shape, a stored layout under a preset's identifier would be
    // refused rather than kept beside the preset.
    expect(
      buildPresets(AVAILABLE).map((preset) => LAYOUT_IDENTIFIERS.isIdentifier(preset.id)),
    ).toEqual(buildPresets(AVAILABLE).map(() => true));
  });

  it('leaves out a panel kind this build does not have', () => {
    const withoutBrowser = new Set(AVAILABLE);
    withoutBrowser.delete(PanelKinds.AssetBrowser);

    const editing = buildPresets(withoutBrowser).find((preset) => preset.id === 'editing');
    const kinds = editing?.groups.flatMap((group) => group.panels.map((panel) => panel.kind));

    expect(kinds).not.toContain(PanelKinds.AssetBrowser);
    expect(kinds).toContain(PanelKinds.Editor);
  });

  it('drops a group left with no panels rather than producing an empty one', () => {
    const editorOnly = new Set<string>([PanelKinds.Editor]);
    const editing = buildPresets(editorOnly).find((preset) => preset.id === 'editing');

    expect(editing?.groups).toHaveLength(1);
    expect(
      layoutProblemText(editing, new Map([[PanelKinds.Editor, descriptor(PanelKinds.Editor)]])),
    ).toBeUndefined();
  });

  it('produces nothing at all rather than an unusable layout when no panel exists', () => {
    expect(buildPresets(new Set())).toEqual([]);
  });

  it('gives each preset a distinct arrangement, because the work differs', () => {
    const arrangements = buildPresets(AVAILABLE).map((preset) =>
      JSON.stringify(preset.groups.map((g) => [g.region, g.proportion, g.panels.length])),
    );
    expect(new Set(arrangements).size).toBe(arrangements.length);
  });
});

describe('readLayout', () => {
  it('rejects a layout that does not say whether it is built in', () => {
    // Declared non-optional by the type and checked by nothing, so a layout
    // carrying the wrong answer was one the user could neither reset nor
    // delete.
    const { builtIn: _removed, ...without } = validLayout();

    expect(layoutProblemText(without, DESCRIPTORS)).toContain('built-in');
  });

  it('rejects a layout that marks a panel active which it does not hold', () => {
    // This one reached the user: "Close this panel" was offered, ran, announced
    // "The panel is closed." and closed nothing.
    const dangling = { ...validLayout(), activePanelId: 'a-panel-from-another-workspace' };

    expect(layoutProblemText(dangling, DESCRIPTORS)).toContain('does not hold');
  });

  it('accepts a layout that marks no panel active at all', () => {
    const { activePanelId: _absent, ...without } = validLayout();

    expect(layoutProblemText(without, DESCRIPTORS)).toBeUndefined();
  });

  it('accepts a well-formed layout', () => {
    expect(layoutProblemText(validLayout(), DESCRIPTORS)).toBeUndefined();
  });

  it('rejects a layout whose name is too long to be read out', () => {
    // Another page on this address can write the stored layouts, and the name
    // is said whole when the workspace is switched to.
    const long = { ...validLayout(), displayName: 'w'.repeat(LONGEST_WORKSPACE_NAME + 1) };

    expect(layoutProblemText(long, DESCRIPTORS)).toContain(
      `longer than ${String(LONGEST_WORKSPACE_NAME)} characters`,
    );
    expect(
      layoutProblemText(
        { ...validLayout(), displayName: 'w'.repeat(LONGEST_WORKSPACE_NAME) },
        DESCRIPTORS,
      ),
    ).toBeUndefined();
  });

  it.each([
    ['not an object', 'a string'],
    ['null', null],
    ['a number', 42],
  ])('rejects %s', (_name, value) => {
    expect(layoutProblemText(value, DESCRIPTORS)).toBeDefined();
  });

  it('rejects a layout written for another format version', () => {
    const problem = layoutProblemText(validLayout({ schemaVersion: 999 }), DESCRIPTORS);
    expect(problem).toContain('999');
  });

  it('rejects a layout with no name', () => {
    expect(layoutProblemText(validLayout({ displayName: '  ' }), DESCRIPTORS)).toContain('no name');
  });

  it('refuses a layout stored under an identifier out of shape, quoting none of it, and reads the rest', () => {
    // Kept as stored, an identifier of any length and any characters would key
    // the layout and could be quoted where a message names it.
    const outOfShape = [
      'a\u202Egnp.exe',
      'x'.repeat(1_000_000),
      'a/b',
      'a\nb',
      '-a',
      'a--b',
      'a b',
      'Mine',
    ];
    const stored = [...outOfShape, 'kept', 'écoute-2'].map((id) => validLayout({ id }));

    for (const id of outOfShape) {
      expect(layoutProblemText(validLayout({ id }), DESCRIPTORS)).toBe(
        'The stored layout has an identifier AudioGubbins does not give.',
      );
    }
    expect(stored.flatMap((one) => readLayout(one, DESCRIPTORS).layout?.id ?? [])).toEqual([
      'kept',
      'écoute-2',
    ]);
    expect(layoutProblemText(validLayout({ id: '' }), DESCRIPTORS)).toBe(
      'The stored layout has no identifier.',
    );
  });

  it('refuses a layout stored under a device name Windows reserves, or a letter a reader cannot see, and reads the rest', () => {
    const refused = ['con', 'nul', 'com1', 'lpt9', JUNGSEONG_FILLER, `a${JUNGSEONG_FILLER}b`];
    const stored = [...refused, 'con-2', 'kept'].map((id) => validLayout({ id }));

    for (const id of refused) {
      expect(layoutProblemText(validLayout({ id }), DESCRIPTORS), JSON.stringify(id)).toBe(
        'The stored layout has an identifier AudioGubbins does not give.',
      );
    }
    expect(stored.flatMap((one) => readLayout(one, DESCRIPTORS).layout?.id ?? [])).toEqual([
      'con-2',
      'kept',
    ]);
  });

  it('reads a stored layout under an identifier of the bound storage holds, and sets aside one a byte past it', () => {
    expect(readLayout(validLayout({ id: 'x'.repeat(227) }), DESCRIPTORS).layout?.id).toBe(
      'x'.repeat(227),
    );
    expect(layoutProblemText(validLayout({ id: 'x'.repeat(228) }), DESCRIPTORS)).toBe(
      'The stored layout has an identifier AudioGubbins does not give.',
    );
  });

  it('rejects a layout with no panels at all', () => {
    expect(layoutProblemText(validLayout({ groups: [] }), DESCRIPTORS)).toContain('no panels');
  });

  it('rejects a group in a region that does not exist', () => {
    const broken = validLayout({
      groups: [
        {
          region: 'nowhere' as DockRegion,
          panels: [{ id: 'p1', kind: PanelKinds.Editor }],
          activePanelId: 'p1',
          proportion: 1,
        },
      ],
    });
    expect(layoutProblemText(broken, DESCRIPTORS)).toContain('unknown region');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a group sized %s', (proportion) => {
    const broken = validLayout({
      groups: [
        {
          region: DockRegion.Centre,
          panels: [{ id: 'p1', kind: PanelKinds.Editor }],
          activePanelId: 'p1',
          proportion,
        },
      ],
    });
    expect(layoutProblemText(broken, DESCRIPTORS)).toContain('impossible size');
  });

  it('rejects the same panel opened twice', () => {
    const broken = validLayout({
      groups: [
        {
          region: DockRegion.Centre,
          panels: [
            { id: 'p1', kind: PanelKinds.Editor },
            { id: 'p1', kind: PanelKinds.Inspector },
          ],
          activePanelId: 'p1',
          proportion: 1,
        },
      ],
    });
    expect(layoutProblemText(broken, DESCRIPTORS)).toContain('twice');
  });

  it('names the panel kind it does not know, so the user can work out why', () => {
    const fromTheFuture = validLayout({
      groups: [
        {
          region: DockRegion.Centre,
          panels: [{ id: 'p1', kind: 'spectral-editor-from-a-later-version' }],
          activePanelId: 'p1',
          proportion: 1,
        },
      ],
    });
    expect(layoutProblemText(fromTheFuture, DESCRIPTORS)).toContain(
      'spectral-editor-from-a-later-version',
    );
  });

  it('quotes only a short plain form of what storage held, never the value whole', () => {
    // Every page on one address shares that storage. Quoted whole, four
    // megabytes of a panel kind went into the log, into a diagnostic bundle
    // with it, into the status bar, and into an assertive live region read at
    // the reader as they arrived.
    const huge = 'C:/'.repeat(400_000);
    const crafted = validLayout({
      groups: [
        {
          region: DockRegion.Centre,
          panels: [{ id: 'p1', kind: huge }],
          activePanelId: 'p1',
          proportion: 1,
        },
      ],
    });

    const text = layoutProblemText(crafted, DESCRIPTORS);
    expect(text).toBeDefined();
    expect(text?.length ?? 0).toBeLessThan(200);
    expect(text).toContain('C:/C:/C:/');
    expect(text).toContain('\u2026');

    // A value that is not text says what it was, rather than reading as one.
    const listed = validLayout({
      groups: [
        {
          region: DockRegion.Centre,
          panels: [{ id: 'p1', kind: ['a', 'b'] as unknown as string }],
          activePanelId: 'p1',
          proportion: 1,
        },
      ],
    });
    expect(layoutProblemText(listed, DESCRIPTORS)).toContain('a value of another kind');
  });

  it('rejects a group whose active panel is not in it', () => {
    const broken = validLayout({
      groups: [
        {
          region: DockRegion.Centre,
          panels: [{ id: 'p1', kind: PanelKinds.Editor }],
          activePanelId: 'p2',
          proportion: 1,
        },
      ],
    });
    expect(layoutProblemText(broken, DESCRIPTORS)).toBe(
      'The stored layout marks a panel active that is not in its group.',
    );
  });

  /** A layout whose one panel carries the fields given, as storage might hold them. */
  const withPanel = (fields: Readonly<Record<string, unknown>>): unknown => ({
    ...validLayout(),
    groups: [
      {
        region: DockRegion.Centre,
        panels: [{ id: 'p1', kind: PanelKinds.Editor, ...fields }],
        activePanelId: 'p1',
        proportion: 1,
      },
    ],
  });

  it('refuses a stored title that is not text, is empty or is past the bound, saying which', () => {
    // Checked by nothing, a title of any value would be drawn on the tab
    // and said in the menu and in announcements.
    expect(layoutProblemText(withPanel({ title: 42 }), DESCRIPTORS)).toBe(
      'The stored layout gives a panel a title that is not text.',
    );
    expect(layoutProblemText(withPanel({ title: '  ' }), DESCRIPTORS)).toBe(
      'The stored layout gives a panel an empty title.',
    );
    expect(
      layoutProblemText(withPanel({ title: 'w'.repeat(LONGEST_WORKSPACE_NAME + 1) }), DESCRIPTORS),
    ).toBe(
      `The stored layout gives a panel a title longer than ${String(LONGEST_WORKSPACE_NAME)} characters.`,
    );
    expect(
      layoutProblemText(withPanel({ title: 'w'.repeat(LONGEST_WORKSPACE_NAME) }), DESCRIPTORS),
    ).toBeUndefined();
  });

  it("holds a panel's stored title to the bound a workspace's name has", () => {
    // A title names what a person named, as a workspace's name does, so the
    // one bound moves both.
    const atTheBound = 'w'.repeat(LONGEST_WORKSPACE_NAME);

    expect(layoutProblemText(withPanel({ title: atTheBound }), DESCRIPTORS)).toBeUndefined();
    expect(layoutProblemText(withPanel({ title: `${atTheBound}w` }), DESCRIPTORS)).toBe(
      `The stored layout gives a panel a title longer than ${String(LONGEST_WORKSPACE_NAME)} characters.`,
    );
  });

  it.each([
    ['a list', ['a1']],
    ['text', 'a1'],
    ['nothing', null],
  ])('refuses parameters that are %s rather than named values', (_case, parameters) => {
    expect(layoutProblemText(withPanel({ parameters }), DESCRIPTORS)).toBe(
      'The stored layout gives a panel parameters that are not named values.',
    );
  });

  it.each([
    ['nothing', null],
    ['a list', [1]],
    ['a record', { id: 'a1' }],
    ['a number that is not finite', Number.NaN],
  ])('refuses a parameter that is %s, naming it', (_case, value) => {
    expect(layoutProblemText(withPanel({ parameters: { asset: value } }), DESCRIPTORS)).toBe(
      'The stored layout gives a panel a parameter, "asset", that is not text, a number, or true or false.',
    );
  });

  it('keeps a valid title and parameters through a read, and nothing it did not check', () => {
    const panel = {
      id: 'p1',
      kind: PanelKinds.Editor,
      title: 'Drum loop.wav',
      parameters: { asset: 'a1', gain: 0.5, solo: true },
    };
    const text = JSON.stringify({ ...(withPanel({ ...panel, note: 'x' }) as object), extra: 1 });
    const read = readLayout(JSON.parse(text), DESCRIPTORS).layout;

    expect(read).toStrictEqual(
      validLayout({
        groups: [
          { region: DockRegion.Centre, panels: [panel], activePanelId: 'p1', proportion: 1 },
        ],
      }),
    );

    // A parameter named as the prototype is kept as a parameter of its own.
    const named = JSON.parse('{"__proto__": "kept"}');
    const parameters = readLayout(withPanel({ parameters: named }), DESCRIPTORS).layout?.groups[0]
      ?.panels[0]?.parameters;
    expect(parameters !== undefined && Object.hasOwn(parameters, '__proto__')).toBe(true);
  });
});

describe('a floating group', () => {
  // Built as an untyped value, because what is under test is whatever storage
  // might hold, including a placement that is not one.
  const floating = (placement: unknown): unknown => ({
    ...validLayout(),
    groups: [
      {
        region: DockRegion.Centre,
        panels: [{ id: 'p1', kind: PanelKinds.Editor }],
        activePanelId: 'p1',
        proportion: 1,
      },
      {
        region: DockRegion.Floating,
        panels: [{ id: 'p2', kind: PanelKinds.Inspector }],
        activePanelId: 'p2',
        proportion: 1,
        ...(placement === undefined ? {} : { placement }),
      },
    ],
  });

  it('is accepted with somewhere to sit', () => {
    expect(
      layoutProblemText(floating({ x: 0.3, y: 0.2, width: 0.4, height: 0.5 }), DESCRIPTORS),
    ).toBeUndefined();
  });

  it('is refused with nowhere to sit', () => {
    expect(layoutProblemText(floating(undefined), DESCRIPTORS)).toContain('floating group sits');
  });

  it.each([
    ['no width', { x: 0.3, y: 0.2, width: 0, height: 0.5 }],
    ['a position off the workspace', { x: 1.5, y: 0.2, width: 0.4, height: 0.5 }],
    ['a size that is not a number', { x: 0.3, y: 0.2, width: Number.NaN, height: 0.5 }],
  ])('is refused with %s', (_case, placement) => {
    expect(layoutProblemText(floating(placement), DESCRIPTORS)).toContain('impossible position');
  });

  it('is refused with nothing docked for it to float over', () => {
    // Accepted, so a stored layout, or a drag that floated the last docked
    // group, mounted floating panels over an empty workspace: the state the
    // move and the close both refuse.
    const alone = {
      ...validLayout(),
      groups: [
        {
          region: DockRegion.Floating,
          panels: [{ id: 'p2', kind: PanelKinds.Inspector }],
          activePanelId: 'p2',
          proportion: 1,
          placement: { x: 0.3, y: 0.2, width: 0.4, height: 0.5 },
        },
      ],
    };

    expect(layoutProblemText(alone, DESCRIPTORS)).toContain('nothing docked');
  });

  it('names this refusal by its own kind, so a caller can word it for a drag', () => {
    const alone = validLayout({
      groups: [
        {
          region: DockRegion.Floating,
          panels: [{ id: 'p2', kind: PanelKinds.Inspector }],
          activePanelId: 'p2',
          proportion: 1,
          placement: { x: 0.3, y: 0.2, width: 0.4, height: 0.5 },
        },
      ],
    });

    expect(readLayout(alone, DESCRIPTORS).problem?.kind).toBe('nothing-docked');
    expect(readLayout(validLayout({ groups: [] }), DESCRIPTORS).problem?.kind).toBe('invalid');
  });

  it('is the only kind of group that may say where it floats', () => {
    const docked = validLayout({
      groups: [
        {
          region: DockRegion.Centre,
          panels: [{ id: 'p1', kind: PanelKinds.Editor }],
          activePanelId: 'p1',
          proportion: 1,
          placement: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
    });
    expect(layoutProblemText(docked, DESCRIPTORS)).toContain('docked group a floating position');
  });
});

describe('resolveLayout', () => {
  let store: LogStore;
  let logger: Logger;
  const fallback = validLayout({ id: 'editing', displayName: 'Editing', builtIn: true });

  beforeEach(() => {
    store = createLogStore();
    logger = createDiagnosticCentre(
      store,
      { now: () => 0 },
      {
        defaultSeverity: LogSeverity.Trace,
        categoryOverrides: {},
      },
    ).loggerFor('workspace');
  });

  it('uses a stored layout that is usable', () => {
    const stored = validLayout();
    const resolved = resolveLayout(stored, fallback, DESCRIPTORS, logger);

    expect(resolved.source).toBe(LayoutSource.Stored);
    expect(resolved.layout).toStrictEqual(stored);
  });

  it('uses the preset when nothing was stored', () => {
    expect(resolveLayout(undefined, fallback, DESCRIPTORS, logger).source).toBe(
      LayoutSource.Default,
    );
    expect(resolveLayout(null, fallback, DESCRIPTORS, logger).source).toBe(LayoutSource.Default);
  });

  it('falls back to the preset rather than failing, when the stored layout is damaged', () => {
    const resolved = resolveLayout('not a layout', fallback, DESCRIPTORS, logger);

    expect(resolved.source).toBe(LayoutSource.Recovered);
    expect(resolved.layout).toBe(fallback);
  });

  it('says why, so the user is not silently given a different workspace', () => {
    const resolved = resolveLayout({ schemaVersion: 999 }, fallback, DESCRIPTORS, logger);
    expect(resolved.source === LayoutSource.Recovered && resolved.reason).toContain('999');
  });

  it('records the recovery locally', () => {
    resolveLayout('not a layout', fallback, DESCRIPTORS, logger);
    expect(store.snapshot().map((record) => record.message)).toContain(
      'A stored workspace layout could not be used.',
    );
  });

  it('never throws, whatever it is given', () => {
    for (const nonsense of [0, '', [], {}, { groups: null }, { groups: [{}] }, Symbol.iterator]) {
      expect(() => resolveLayout(nonsense, fallback, DESCRIPTORS, logger)).not.toThrow();
    }
  });
});

describe('resolveStoredLayout', () => {
  const fallback = validLayout({ id: 'editing', displayName: 'Editing', builtIn: true });
  const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('workspace');

  it('uses the preset when nothing was stored', () => {
    expect(resolveStoredLayout(null, fallback, DESCRIPTORS, logger).source).toBe(
      LayoutSource.Default,
    );
  });

  it('says a layout that is not JSON could not be read', () => {
    const resolved = resolveStoredLayout('{"groups": [', fallback, DESCRIPTORS, logger);

    expect(resolved).toEqual({
      layout: fallback,
      source: LayoutSource.Recovered,
      reason: 'The stored workspace could not be read.',
      text: '{"groups": [',
    });
  });

  it('validates a layout that parses, and gives that problem as the reason', () => {
    const stored = '{"schemaVersion": 999}';
    const resolved = resolveStoredLayout(stored, fallback, DESCRIPTORS, logger);

    expect(resolved.source === LayoutSource.Recovered && resolved.reason).toContain('999');
    // With the text that could not be used, for the caller to keep before the
    // next write of the layout goes over it.
    expect(resolved.source === LayoutSource.Recovered && resolved.text).toBe(stored);
  });

  it('mounts a stored layout that parses and validates', () => {
    const stored = validLayout();
    const resolved = resolveStoredLayout(JSON.stringify(stored), fallback, DESCRIPTORS, logger);

    expect(resolved.source).toBe(LayoutSource.Stored);
    expect(resolved.layout).toEqual(stored);
  });
});

describe('createLayoutStore', () => {
  let store: LayoutStore;

  beforeEach(() => {
    store = createLayoutStore(buildPresets(AVAILABLE), [validLayout()]);
  });

  it('holds the presets and the user layouts', () => {
    expect(store.all()).toHaveLength(7);
    expect(store.get('editing')?.builtIn).toBe(true);
    expect(store.get('mine')?.builtIn).toBe(false);
  });

  it('lists the built-in layouts first', () => {
    expect(store.all()[0]?.builtIn).toBe(true);
    expect(store.all().at(-1)?.builtIn).toBe(false);
  });

  it('saves a new arrangement of a user layout, and never a name, which it keeps as it holds it', () => {
    // An arrangement is all it takes: the name and the identifier of the
    // layout it is handed are not read, so no name reaches the list unheld.
    const arrangement = validLayout({
      id: 'elsewhere',
      displayName: 'Renamed',
      activePanelId: 'p1',
    });

    expect(store.save('mine', arrangement)).toBeUndefined();
    expect(store.get('mine')).toEqual({ ...validLayout(), activePanelId: 'p1' });
    expect(store.get('elsewhere')).toBeUndefined();

    expect(store.save('mine', validLayout())).toBeUndefined();
    expect(store.get('mine')).not.toHaveProperty('activePanelId');
  });

  it('answers the layout an operation would act on, or why it would be refused, as the operation does', () => {
    const shipped = store.get('editing');
    /** The layout a removal acts on, or the refusal. */
    const actedOn = (answer: LayoutRemoval | string) =>
      typeof answer === 'string' ? answer : answer.layout;

    expect(store.renamable('mine')).toBe(store.get('mine'));
    expect(store.renamable('editing')).toBe('A built-in workspace keeps its name.');
    expect(actedOn(store.removable('mine'))).toBe(store.get('mine'));
    expect(store.removable('absent')).toBe('There is no workspace with the identifier "absent".');
    expect(store.resettable('editing')).toBe(shipped);
    expect(store.resettable('mine')).toContain('not a built-in workspace');
  });

  it('makes the removal its check answers, on the layout the check found', () => {
    const mine = store.get('mine');

    const removal = store.removable('mine');
    if (typeof removal === 'string') throw new Error(removal);

    expect(removal.make()).toBe(mine);
    expect(store.get('mine')).toBeUndefined();
  });

  it('refuses a removal made after the store changed the layout it found', () => {
    const removal = store.removable('mine');
    if (typeof removal === 'string') throw new Error(removal);
    const renamed = store.rename('mine', 'Renamed');
    if (typeof renamed === 'string') throw new Error(renamed);

    expect(() => removal.make()).toThrow(
      'The removal of the workspace under "mine" was made after the store changed it.',
    );
    expect(store.get('mine')).toBe(renamed.after);

    // A removal kept past another removal of its layout refuses too, where a
    // workspace saved since holds the identifier the other freed.
    const first = store.removable('mine');
    const second = store.removable('mine');
    if (typeof first === 'string' || typeof second === 'string') {
      throw new Error('A user layout is removable.');
    }
    first.make();
    const saved = store.saveAs(validLayout(), 'Mine');
    if (typeof saved === 'string') throw new Error(saved);
    expect(saved.id).toBe('mine');

    expect(() => second.make()).toThrow(
      'The removal of the workspace under "mine" was made after the store changed it.',
    );
    expect(store.get('mine')).toBe(saved);
  });

  /** Removes the layout under `id`, and answers it. */
  function removedFrom(held: LayoutStore, id: string): WorkspaceLayout {
    const removal = held.removable(id);
    if (typeof removal === 'string') throw new Error(removal);
    return removal.make();
  }

  it('puts back a workspace it removed, under the identifier and the name it had', () => {
    // A deletion was one press with no way back.
    const before = store.all();
    const removed = removedFrom(store, 'mine');

    expect(store.restore(removed)).toEqual(removed);
    expect(store.get('mine')).toEqual(removed);
    expect(store.all()).toEqual(before);
  });

  it('puts one back under a free identifier and a numbered name where another has taken both since', () => {
    const removed = removedFrom(store, 'mine');
    const underItsIdentifier = store.saveAs(validLayout(), 'Mine');
    const underItsName = store.saveAs(validLayout(), 'My workspace');
    if (typeof underItsIdentifier === 'string') throw new Error(underItsIdentifier);
    if (typeof underItsName === 'string') throw new Error(underItsName);
    expect(underItsIdentifier.id).toBe('mine');

    const restored = store.restore(removed);

    expect(restored).toEqual({ ...removed, id: 'my-workspace-2', displayName: 'My workspace 2' });
    expect(store.get('mine')).toBe(underItsIdentifier);
    expect(store.get(underItsName.id)).toBe(underItsName);
    expect(store.get('my-workspace-2')).toBe(restored);
  });

  it('throws for a layout no removal of its made, or one it has put back already', () => {
    expect(() => store.restore(validLayout({ id: 'elsewhere' }))).toThrow(
      'A workspace was put back that no removal of this store made.',
    );

    const removed = removedFrom(store, 'mine');
    store.restore(removed);
    expect(() => store.restore(removed)).toThrow(
      'A workspace was put back that no removal of this store made.',
    );
    expect(store.all().filter((one) => one.id === 'mine')).toHaveLength(1);
  });

  it('refuses to save over a built-in layout, so the preset stays available', () => {
    const refusal = store.save('editing', validLayout());
    expect(refusal?.kind).toBe('built-in');
    expect(refusal?.text).toContain('built-in');
    expect(store.get('editing')?.displayName).toBe('Editing');
    expect(store.get('editing')?.builtIn).toBe(true);
  });

  it('never marks a saved layout built-in, whatever it claims', () => {
    expect(store.save('mine', validLayout({ builtIn: true }))).toBeUndefined();
    expect(store.get('mine')?.builtIn).toBe(false);

    const added = store.saveAs(validLayout({ builtIn: true }), 'Sneaky');
    if (typeof added === 'string') throw new Error(added);
    expect(store.get(added.id)?.builtIn).toBe(false);
  });

  it('holds no user layout under an identifier out of shape, which no reading gives one', () => {
    expect(() => createLayoutStore(buildPresets(AVAILABLE), [validLayout({ id: 'a/b' })])).toThrow(
      'A layout was held that was never read: its identifier is out of shape.',
    );
  });

  it('saves nothing under an identifier it does not hold, which a new layout is added by', () => {
    // Taking any identifier from its caller, the store added a layout under
    // an identifier it had not allocated.
    const refusal = store.save('absent', validLayout({ id: 'absent', displayName: 'Absent' }));
    expect(refusal).toEqual({
      kind: 'refused',
      text: 'There is no workspace with the identifier "absent".',
    });
    expect(store.get('absent')).toBeUndefined();
  });

  it('duplicates a built-in layout into an editable copy', () => {
    const copy = store.duplicate('editing', 'My editing');
    if (typeof copy === 'string') throw new Error(copy);

    expect(copy.builtIn).toBe(false);
    expect(copy.displayName).toBe('My editing');
    expect(copy.groups).toEqual(store.get('editing')?.groups);
  });

  it('duplicates nothing when there is nothing to duplicate', () => {
    const before = store.all();
    expect(store.duplicate('absent', 'X')).toContain('no workspace with the identifier');
    expect(store.duplicate('absent')).toContain('no workspace with the identifier');
    expect(store.all()).toEqual(before);
  });

  it('writes no name it would refuse to read back, saving, saving as or copying', () => {
    // A name past the bound, written, is set aside by the store's next read.
    // Saving takes no name, so the one the layout carries is never written.
    const long = 'w'.repeat(121);
    const before = store.all();

    expect(store.save('mine', validLayout({ displayName: long }))).toBeUndefined();
    expect(store.saveAs(validLayout(), long)).toBe(
      "A workspace's name can be at most 120 characters long.",
    );
    expect(store.duplicate('editing', long)).toBe(
      "A workspace's name can be at most 120 characters long.",
    );
    expect(store.duplicate('editing', '   ')).toBe('A workspace needs a name.');
    expect(store.all()).toEqual(before);
  });

  it('renames a user layout, and answers it as it was and as it is', () => {
    expect(store.rename('mine', 'Something else')).toEqual({
      before: validLayout(),
      after: validLayout({ displayName: 'Something else' }),
    });
    expect(store.get('mine')?.displayName).toBe('Something else');
  });

  it('refuses to rename a built-in layout', () => {
    expect(store.rename('editing', 'Mine now')).toContain('built-in');
  });

  it('refuses an empty name', () => {
    expect(store.rename('mine', '   ')).toContain('name');
  });

  it('deletes a user layout, and answers the layout deleted', () => {
    expect(removed(store, 'mine')).toEqual(validLayout());
    expect(store.get('mine')).toBeUndefined();
  });

  it('refuses to delete a built-in layout', () => {
    expect(removed(store, 'editing')).toContain('built-in');
    expect(store.get('editing')).toBeDefined();
  });

  it('answers a reset of a built-in layout with the layout as it ships, and changes nothing it holds', () => {
    const original = store.get('editing');
    const before = store.all();

    // The store holds a built-in layout only as it ships, since nothing saves
    // over, renames or removes one, so a reset leaves the store as it is: what
    // returns to how it ships is the layout on screen, where the caller mounts
    // the answer.
    expect(store.resettable('editing')).toBe(original);
    expect(store.all()).toEqual(before);
  });

  it('refuses to reset a layout that never shipped', () => {
    expect(store.resettable('mine')).toContain('not a built-in');
  });

  it('reports an operation on a layout that is not there', () => {
    expect(store.rename('absent', 'X')).toContain('no workspace with the identifier');
    expect(removed(store, 'absent')).toContain('no workspace with the identifier');
  });
});

describe('the identifier of a layout the store adds', () => {
  const presets = buildPresets(AVAILABLE);

  it('is allocated by the store, and never lands on a layout it holds, a built-in one included', () => {
    // "Recording!" derives a preset's identifier, and "Mine" the identifier
    // of a workspace the user made. Taken from the caller, either would put
    // the workspace saved in the place of the one holding it, and a preset
    // replaced so could be neither reset nor deleted.
    const store = createLayoutStore(presets, [validLayout()]);
    const before = store.all();

    const copy = store.duplicate('mine', 'Editing, mine');
    const named = store.saveAs(validLayout(), 'Mixing, mine');
    const asAPreset = store.saveAs(validLayout(), 'Recording!');
    const asYours = store.saveAs(validLayout(), 'Mine');
    const added = [copy, named, asAPreset, asYours].filter((one) => typeof one !== 'string');
    if (typeof asAPreset === 'string' || typeof asYours === 'string' || added.length !== 4) {
      throw new Error('a layout was refused');
    }

    expect(new Set([...added, ...before].map((one) => one.id)).size).toBe(before.length + 4);
    expect(store.all().slice(0, before.length)).toEqual(before);
    expect(asAPreset.id).toBe('recording-2');
    expect(asYours.id).toBe('mine-2');
  });

  it('is derived from the name, readable where storage or a message quotes it', () => {
    const store = createLayoutStore(presets);
    const saved = store.saveAs(validLayout(), "Jane's  Mix!");
    const unnamed = store.saveAs(validLayout(), '***');

    expect(typeof saved === 'string' ? saved : saved.id).toBe('jane-s-mix');
    expect(typeof unnamed === 'string' ? unnamed : unnamed.id).toBe('workspace');
  });

  it("keeps a stored layout under a built-in identifier beside the preset, as the user's", () => {
    // Read into the store under its own identifier, it took the preset's
    // place, and the preset could not be switched to or reset.
    const shipped = presets.find((one) => one.id === 'editing');
    const store = createLayoutStore(presets, [
      validLayout({ id: 'editing', displayName: 'Mine', builtIn: true }),
    ]);

    expect(store.get('editing')).toEqual(shipped);
    const kept = store.all().filter((one) => one.displayName === 'Mine');
    expect(kept).toHaveLength(1);
    expect(kept[0]?.id).toBe('editing-2');
    expect(kept[0]?.builtIn).toBe(false);
  });
});

describe('the workspace on screen among the stored ones', () => {
  const presets = buildPresets(AVAILABLE);
  const first = validLayout({ id: 'twin', displayName: 'First' });
  const second = validLayout({ id: 'twin', displayName: 'Second' });

  it('is the stored one it is the same as, where several share its identifier', () => {
    // Matched by the identifier alone, the second was taken for the first, and
    // saving it wrote over the first.
    const placed = placedLayouts(presets, [first, second], second);

    expect(placed.layouts.map((one) => [one.id, one.displayName])).toEqual([
      ['twin', 'First'],
      ['twin-2', 'Second'],
    ]);
    expect(placed.onScreen).toEqual({ ...second, id: 'twin-2' });

    const store = createLayoutStore(presets, placed.layouts);
    expect(
      store.save(placed.onScreen.id, { ...placed.onScreen, activePanelId: 'p1' }),
    ).toBeUndefined();
    expect(store.get('twin')).toEqual(first);
  });

  it('is listed as it is on screen in the place of the one stored under its identifier, where only that one is', () => {
    // The layout's own key is written with each change and is the newer.
    // Listed as stored, the older is written over it at the next write of the
    // collection, a switch away from it among them.
    const changed = { ...first, displayName: 'First, renamed', activePanelId: 'p1' };
    const placed = placedLayouts(presets, [first], changed);

    expect(placed.layouts).toEqual([changed]);
    expect(placed.onScreen).toEqual(changed);
  });

  it('is listed as its own where several share its identifier and none is the same', () => {
    // Under a name of its own too: the stored "Second" has the name it has.
    const changed = { ...second, activePanelId: 'p1' };
    const placed = placedLayouts(presets, [first, second], changed);

    expect(placed.layouts.map((one) => one.id)).toEqual(['twin', 'twin-2', 'twin-3']);
    expect(placed.onScreen).toEqual({ ...changed, id: 'twin-3', displayName: 'Second 2' });
  });

  it('is listed again where nothing stored is it, beside a preset whose identifier it has', () => {
    const unlisted = validLayout({ id: 'mine', displayName: 'Mine' });
    expect(placedLayouts(presets, [first], unlisted)).toEqual({
      layouts: [first, unlisted],
      onScreen: unlisted,
    });

    const underAPreset = validLayout({ id: 'editing', displayName: 'Mine' });
    const placed = placedLayouts(presets, [], underAPreset);
    expect(placed.onScreen).toEqual({ ...underAPreset, id: 'editing-2' });
    expect(placed.layouts).toEqual([placed.onScreen]);
  });

  it("is the preset where it is built in under a preset's identifier, under the preset's name", () => {
    const preset = presets[0];
    if (preset === undefined) throw new Error('no preset was built');

    expect(placedLayouts(presets, [first], preset)).toEqual({ layouts: [first], onScreen: preset });
    const renamed = { ...preset, displayName: 'Written by hand' };
    expect(placedLayouts(presets, [first], renamed).onScreen).toEqual(preset);
  });

  it("is the user's where it claims to be built in under an identifier no preset has, or a stored one's", () => {
    // Taken at its claim, it is a layout the store does not hold, and every
    // change to the workspace on screen is refused.
    const claimed = validLayout({ id: 'x', displayName: 'Claimed', builtIn: true });
    const unheld = placedLayouts(presets, [first], claimed);
    const asTheUsers = { ...claimed, builtIn: false };
    expect(unheld).toEqual({ layouts: [first, asTheUsers], onScreen: asTheUsers });

    const overFirst = { ...first, builtIn: true, activePanelId: 'p1' };
    const underFirst = placedLayouts(presets, [first], overFirst);
    const newer = { ...overFirst, builtIn: false };
    expect(underFirst).toEqual({ layouts: [newer], onScreen: newer });

    for (const placed of [unheld, underFirst]) {
      const store = createLayoutStore(presets, placed.layouts);
      expect(store.save(placed.onScreen.id, placed.onScreen)).toBeUndefined();
    }
  });

  it('is listed under its name numbered from two where another has it, and its own where it is the stored name', () => {
    // A name the layout's own key carries is held to the list of the day it
    // is given, and another workspace may have it in a list read later.
    const mixing = validLayout({ id: 'mixing', displayName: 'Mixing' });
    const renamed = placedLayouts(presets, [first, mixing], { ...first, displayName: 'MIXING' });
    expect(renamed.onScreen.displayName).toBe('MIXING 2');
    expect(renamed.layouts.map((one) => one.displayName)).toEqual(['MIXING 2', 'Mixing']);

    const unlisted = validLayout({ id: 'new', displayName: 'Editing (built in)' });
    expect(placedLayouts(presets, [mixing], unlisted).onScreen.displayName).toBe(
      'Editing (built in) 2',
    );

    // A stored layout's name is its own, however the others are named.
    const namesake = validLayout({ id: 'namesake', displayName: 'First' });
    expect(placedLayouts(presets, [first, namesake], first).onScreen.displayName).toBe('First');
  });

  /** "X", then "X 2" to "X <count>", each a stored layout of its own. */
  const numberedNames = (count: number): WorkspaceLayout[] =>
    Array.from({ length: count }, (_, index) =>
      index === 0
        ? validLayout({ id: 'x', displayName: 'X' })
        : validLayout({ id: `x-${String(index + 1)}`, displayName: `X ${String(index + 1)}` }),
    );

  it('is numbered past every stored name of its own, one that differs by a soft hyphen among them', () => {
    const onScreen = validLayout({ id: 'mine', displayName: 'X' });

    expect(placedLayouts(presets, numberedNames(40), onScreen).onScreen.displayName).toBe('X 41');

    // Keyed by a folding of the text, the stored "X\u00AD 3" is not "X 3".
    const softly = [
      ...numberedNames(2),
      validLayout({ id: 'x-3', displayName: `X${SOFT_HYPHEN} 3` }),
    ];
    expect(placedLayouts(presets, softly, onScreen).onScreen.displayName).toBe('X 4');
  });

  it('places the workspace on screen beside thousands of stored numbered names of its own name, in comparisons that grow slower than n log² n', () => {
    // Asked of every stored name for each number, "X" beside "X" to "X n" takes
    // about n squared comparisons at every start, and a stored collection of
    // thousands holds the start for minutes. Counted, not timed: four times the
    // names may cost 5.5 times the comparisons, above the 4.8 of n log n and
    // under the 5.8 of n log² n, where one by one they cost sixteen, and a
    // count past that is stopped there.
    const onScreen = validLayout({ id: 'mine', displayName: 'X' });
    const comparisonsFor = (count: number, ceiling?: number): number => {
      const stored = numberedNames(count);
      let placed = '';
      const counted = comparisonsIn(() => {
        placed = placedLayouts(presets, stored, onScreen).onScreen.displayName;
      }, ceiling);
      expect(placed).toBe(`X ${String(count + 1)}`);
      return counted;
    };

    const thousand = comparisonsFor(1000);
    expect(comparisonsFor(4000, N_LOG_N_FOURFOLD * thousand) / thousand).toBeLessThan(
      N_LOG_N_FOURFOLD,
    );
  });
});

describe('a runtime that cannot compare names', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('reads every stored layout and places the workspace on screen, each name as it is', async () => {
    const workspace = await whereNamesCannotBeCompared();
    const presets = buildPresets(AVAILABLE);
    const mixing = validLayout({ id: 'mixing', displayName: 'Mixing' });
    const renamed = validLayout({ id: 'renamed', displayName: 'Renamed' });

    // Whether another has the name on screen cannot be decided, so it is kept.
    const unlisted = validLayout({ id: 'new', displayName: 'MIXING' });
    const placed = workspace.placedLayouts(presets, [mixing, renamed], unlisted);
    expect(placed.layouts.map((one) => one.displayName)).toEqual(['Mixing', 'Renamed', 'MIXING']);
    expect(placed.onScreen).toEqual(unlisted);

    const onRenamed = { ...renamed, displayName: 'Mixing' };
    expect(workspace.placedLayouts(presets, [mixing, renamed], onRenamed).onScreen).toEqual(
      onRenamed,
    );

    const store = workspace.createLayoutStore(presets, placed.layouts);
    expect(store.all().filter((one) => !one.builtIn)).toEqual(placed.layouts);
    expect(store.save('new', { ...unlisted, activePanelId: 'p1' })).toBeUndefined();
    expect(removed(store, 'renamed')).toEqual(renamed);
  });

  it('places a stored layout on screen under a name of its own, and throws nothing, where the runtime cannot make its collator', async () => {
    vi.spyOn(Intl, 'Collator').mockImplementation(function () {
      throw new RangeError('Incorrect locale information provided');
    });
    vi.resetModules();
    const workspace = await import('./held-layouts.js');
    const mixing = validLayout({ id: 'mixing', displayName: 'Mixing' });
    const onScreen = { ...mixing, displayName: 'Mastering' };

    const placed = workspace.placedLayouts(buildPresets(AVAILABLE), [mixing], onScreen);
    expect(placed.onScreen).toEqual(onScreen);
    expect(placed.layouts).toEqual([onScreen]);
  });

  it('refuses in words to save as, copy or rename, and changes nothing', async () => {
    const workspace = await whereNamesCannotBeCompared();
    const store = workspace.createLayoutStore(buildPresets(AVAILABLE), [
      validLayout({ displayName: 'Mine' }),
    ]);
    const before = store.all();
    const REFUSED =
      'This browser cannot compare names as AudioGubbins does, so a workspace cannot be saved as a new one, copied or renamed here.';

    expect(workspace.NAMING_REFUSED).toBe(REFUSED);
    expect(store.saveAs(validLayout())).toBe(REFUSED);
    expect(store.saveAs(validLayout(), 'Mastering')).toBe(REFUSED);
    expect(store.duplicate('editing')).toBe(REFUSED);
    expect(store.duplicate('mine', 'Mine again')).toBe(REFUSED);
    expect(store.rename('mine', 'Mastering')).toBe(REFUSED);
    expect(store.all()).toEqual(before);

    // What is refused before a name is read is refused as before.
    expect(store.duplicate('nothing')).toBe(workspace.noWorkspaceWith('nothing'));
    expect(store.rename('editing', 'Mastering')).toBe('A built-in workspace keeps its name.');
  });

  it('puts back a workspace it removed under the name it had, which it cannot compare', async () => {
    // Refused here, a workspace deleted by mistake would be kept from the user
    // for want of a comparison, though its name was held to the list once.
    const workspace = await whereNamesCannotBeCompared();
    const store = workspace.createLayoutStore(buildPresets(AVAILABLE), [
      validLayout({ displayName: 'Mine' }),
    ]);
    const removal = store.removable('mine');
    if (typeof removal === 'string') throw new Error(removal);
    const removed = removal.make();

    expect(store.restore(removed)).toEqual(removed);
    expect(store.get('mine')).toEqual(removed);
  });
});

describe('a name another workspace has', () => {
  const presets = buildPresets(AVAILABLE);
  const IN_USE = 'There is already a workspace called “Mixing”. Choose another name.';

  it('is refused by saving as, copying and renaming alike, compared as a reader hears it', () => {
    // Two workspaces of one name were two entries the menu, the settings and
    // "Switched to …" could not tell apart.
    const store = createLayoutStore(presets, [
      validLayout({ displayName: 'Mine' }),
      validLayout({ id: 'mixing', displayName: 'Mixing' }),
    ]);
    const before = store.all();

    expect(store.saveAs(validLayout(), 'mixing')).toBe(IN_USE);
    expect(store.duplicate('editing', ' MIXING ')).toBe(IN_USE);
    expect(store.rename('mine', 'Mixing')).toBe(IN_USE);
    expect(store.all()).toEqual(before);
  });

  it("is refused where it is a built-in workspace's name as the list shows it, the mark and all", () => {
    // The menu and the settings list a built-in workspace with its mark, so a
    // workspace given "Editing (built in)" would be listed as the preset is.
    const MARKED = 'There is already a workspace called “Editing (built in)”. Choose another name.';
    const store = createLayoutStore(presets, [validLayout({ displayName: 'Mine' })]);
    const before = store.all();

    expect(store.saveAs(validLayout(), 'Editing (built in)')).toBe(MARKED);
    expect(store.duplicate('editing', 'editing (Built In)')).toBe(MARKED);
    expect(store.rename('mine', ' EDITING  (built in) ')).toBe(MARKED);
    expect(store.rename('mine', 'Editing')).toBe(MARKED);
    expect(store.all()).toEqual(before);

    // A stored name is read as it is stored, the mark and all.
    const stored = createLayoutStore(presets, [validLayout({ displayName: 'Editing (built in)' })]);
    expect(stored.get('mine')?.displayName).toBe('Editing (built in)');
  });

  it('is the name a workspace has already, which renaming it to is no refusal', () => {
    const store = createLayoutStore(presets, [validLayout({ displayName: 'Mine' })]);

    const same = store.rename('mine', 'Mine');
    expect(typeof same !== 'string' && same.after === same.before).toBe(true);
    const corrected = store.rename('mine', 'MINE');
    expect(typeof corrected !== 'string' && corrected.after.displayName).toBe('MINE');
    expect(store.get('mine')?.displayName).toBe('MINE');
  });

  it('is not given to a copy nobody named, which takes the first free number', () => {
    const store = createLayoutStore(presets);

    const names = [1, 2, 3].map(() => {
      const copy = store.duplicate('editing');
      return typeof copy === 'string' ? copy : copy.displayName;
    });
    expect(names).toEqual(['Editing copy', 'Editing copy 2', 'Editing copy 3']);

    // A copy of a copy is numbered in the series of the name it is a copy of,
    // rather than called "Editing copy copy".
    const nameOf = (copy: WorkspaceLayout | string): string =>
      typeof copy === 'string' ? copy : copy.displayName;
    expect(nameOf(store.duplicate('editing-copy'))).toBe('Editing copy 4');
    expect(nameOf(store.duplicate('editing-copy-2'))).toBe('Editing copy 5');
  });

  it('is given without the space typed around it, and refused where another has it so', () => {
    const store = createLayoutStore(presets, [validLayout({ displayName: 'Mine' })]);

    const saved = store.saveAs(validLayout(), '  Mixing ');
    expect(typeof saved === 'string' ? saved : saved.displayName).toBe('Mixing');
    const copied = store.duplicate('editing', ' Editing, mine\t');
    expect(typeof copied === 'string' ? copied : copied.displayName).toBe('Editing, mine');
    expect(store.rename('mine', ' Mastering ')).not.toBeTypeOf('string');
    expect(store.get('mine')?.displayName).toBe('Mastering');

    expect(store.saveAs(validLayout(), 'Mixing ')).toBe(
      'There is already a workspace called “Mixing”. Choose another name.',
    );
  });

  it('names a copy of a stored name without the space around it, which the store keeps as stored', () => {
    const store = createLayoutStore(presets, [validLayout({ displayName: ' Mine ' })]);

    expect(store.get('mine')?.displayName).toBe(' Mine ');
    const copy = store.duplicate('mine');
    expect(typeof copy === 'string' ? copy : copy.displayName).toBe('Mine copy');
  });

  it('is not given to a workspace saved with no name, which takes the first free number', () => {
    const store = createLayoutStore(presets);

    const names = [1, 2].map(() => {
      const saved = store.saveAs(validLayout());
      return typeof saved === 'string' ? saved : saved.displayName;
    });
    expect(names).toEqual(['My workspace', 'My workspace 2']);
  });

  it('is held to no stored layout, whose name is its own however the others are named', () => {
    // Two stored workspaces of one name are both read and both kept, and a
    // new arrangement of either is saved under the name it has.
    const store = createLayoutStore(presets, [
      validLayout({ id: 'one', displayName: 'Twin' }),
      validLayout({ id: 'two', displayName: 'Twin' }),
    ]);

    expect(store.save('two', validLayout())).toBeUndefined();
    expect(store.all().filter((one) => one.displayName === 'Twin')).toHaveLength(2);
  });
});

describe('the name a workspace is given', () => {
  it('refuses a name too long to be read out, and accepts one at the bound', () => {
    expect(workspaceName('w'.repeat(121))).toEqual({
      kind: 'too-long',
      text: "A workspace's name can be at most 120 characters long.",
    });
    expect(workspaceName('w'.repeat(120))).toBe('w'.repeat(120));
    expect(workspaceName(` ${'w'.repeat(120)} `)).toBe('w'.repeat(120));
    expect(workspaceName('   ')).toEqual({
      kind: 'blank',
      text: 'A workspace needs a name.',
    });
  });

  it('names a copy within the bound a name has, cutting a long name at a word', () => {
    // A name near the bound made a copy's name longer than it, and the store
    // refused a name the reader never typed.
    const none = (): boolean => false;
    const fits = 'a'.repeat(115);
    expect(nameOfACopy(fits, none)).toBe(`${fits} copy`);
    expect(nameOfACopy('Editing', none)).toBe('Editing copy');

    // Twenty-three words and a spare end are 118 characters; cut to leave room
    // for what a copy adds, the twenty-three words fit whole.
    const long = `${'word '.repeat(23)}end`;
    expect(nameOfACopy(long, none)).toBe(`${'word '.repeat(22)}word… copy`);
    expect(workspaceName(nameOfACopy(long, none))).toBe(nameOfACopy(long, none));

    // Where the cut falls inside a word, the copy ends at the word before it.
    const midWord = `${'word '.repeat(22)}wordy end`;
    expect(nameOfACopy(midWord, none)).toBe(`${'word '.repeat(21)}word… copy`);
  });

  it('cuts a name to the characters its bound allows, however many code units they are', () => {
    // Cut in code units, a name of emoji kept fifty-seven of the hundred and
    // fourteen characters the bound leaves it.
    const none = (): boolean => false;
    expect(nameOfACopy('😀'.repeat(120), none)).toBe(`${'😀'.repeat(114)}… copy`);
    const emoji = nameOfACopy('😀'.repeat(120), none);
    expect(workspaceName(emoji)).toBe(emoji);
  });

  it('numbers a name within the bound, the number included', () => {
    // The number takes two characters more, so the cut falls inside the
    // twenty-third word and the name ends at the word before it.
    const long = `${'word '.repeat(23)}end`;
    const taken = new Set([`${'word '.repeat(22)}word… copy`]);
    const numbered = nameOfACopy(long, (name) => taken.has(name));

    expect(numbered).toBe(`${'word '.repeat(21)}word… copy 2`);
    expect(workspaceName(numbered)).toBe(numbered);
    expect(nameOfANewWorkspace((name) => name === 'My workspace')).toBe('My workspace 2');
  });

  it('refuses a value that is not text as a blank name', () => {
    expect(writtenWorkspaceName(42)).toEqual({
      kind: 'blank',
      text: 'The stored layout has no name.',
    });
  });

  it('reads a stored name as it is written, and refuses one blank or past the bound in words for a stored layout', () => {
    // One rule and one bound for a name given and a name stored, so the store
    // never writes a name its own next read refuses; the stored form keeps
    // the space around a name, since a stored name is kept as it is stored.
    expect(writtenWorkspaceName('  ')).toEqual({
      kind: 'blank',
      text: 'The stored layout has no name.',
    });
    expect(writtenWorkspaceName('w'.repeat(LONGEST_WORKSPACE_NAME + 1))).toEqual({
      kind: 'too-long',
      text: `The stored layout's name is longer than ${String(LONGEST_WORKSPACE_NAME)} characters.`,
    });
    expect(writtenWorkspaceName(' Mixing ')).toBe(' Mixing ');
    expect(writtenWorkspaceName('w'.repeat(LONGEST_WORKSPACE_NAME))).toBe(
      'w'.repeat(LONGEST_WORKSPACE_NAME),
    );

    const given = workspaceName(` ${'w'.repeat(LONGEST_WORKSPACE_NAME)} `);
    expect(given).toBe('w'.repeat(LONGEST_WORKSPACE_NAME));
    expect(writtenWorkspaceName(given)).toBe(given);
  });

  it('names a copy by the word "copy", and a copy of a name heard as a copy\'s in its series', () => {
    const none = (): boolean => false;
    expect(nameOfACopy('Mixing', none)).toBe('Mixing copy');
    expect(nameOfACopy('Editing Copy', none)).toBe('Editing copy');
    expect(nameOfACopy('Editing  COPY 4', (name) => name === 'Editing copy')).toBe(
      'Editing copy 2',
    );
  });
});

describe('a workspace named in a list', () => {
  it('is marked where it ships, and named as it is where the user made it', () => {
    expect(listedName(validLayout({ displayName: 'Editing', builtIn: true }))).toBe(
      'Editing (built in)',
    );
    expect(listedName(validLayout({ displayName: 'Editing copy' }))).toBe('Editing copy');
  });
});

describe('refusals name a workspace the way the user does', () => {
  it('calls a workspace the user made by its name when it cannot be reset', () => {
    // It quoted the internal identifier, which the user has never seen.
    const store = createLayoutStore(buildPresets(AVAILABLE), [
      validLayout({ id: 'mixing-desk-2', displayName: 'Mixing desk' }),
    ]);

    expect(store.resettable('mixing-desk-2')).toBe(
      '“Mixing desk” is not a built-in workspace, so there is nothing to reset it to. Delete it instead.',
    );
  });

  it('says it is quoting an identifier when there is nothing to name', () => {
    const store = createLayoutStore(buildPresets(AVAILABLE));
    expect(removed(store, 'gone')).toBe('There is no workspace with the identifier "gone".');
  });
});
