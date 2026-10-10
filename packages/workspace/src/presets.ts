/**
 * The built-in workspace presets.
 *
 * REQ-UX-058 names them: Editing, Spectral Repair, Recording, Game Audio, Batch
 * Processing and Future Multitrack. They ship as arrangements, not as features:
 * a preset says where the Spectral panel would sit, and the phase that owns
 * spectral editing supplies the panel. Until then the preset simply has fewer
 * panels in it.
 *
 * That is why a preset names panel *kinds* rather than importing components. A
 * kind whose panel does not exist yet is left out when the preset is built,
 * which keeps this file free of the later phases' work (REQ-EXEC-136.9) while
 * the arrangement is decided once, here.
 */

import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { DockRegion, type PanelKind, type WorkspaceLayout } from './panel.js';

/** The panel kinds AudioGubbins arranges. */
export const PanelKinds = {
  /** The project's assets (REQ-UX-060). */
  AssetBrowser: 'asset-browser',

  /** Properties of whatever is selected (REQ-EDIT-072). */
  Inspector: 'inspector',

  /** An asset open for editing (REQ-UX-060). */
  Editor: 'editor',

  /** Transport and levels. */
  Transport: 'transport',

  /** Recent diagnostic messages (REQ-PRIV-165). */
  Diagnostics: 'diagnostics',

  /** What this browser can and cannot do (REQ-EXEC-216). */
  Capabilities: 'capabilities',

  /** Reference picture beside the audio (REQ-AUDIO-156). */
  Picture: 'picture',

  /** The input, its meters, monitoring and latency, armed for recording (ADR-0070). */
  Recording: 'recording',

  /** The spectral selection, the spectral tools' settings and the spectral edits (ADR-0082). */
  Spectral: 'spectral',
} as const;

/** One group of a preset, before the unavailable kinds are removed. */
interface PresetGroup {
  readonly region: DockRegion;
  readonly proportion: number;
  readonly kinds: readonly PanelKind[];
}

/** A preset, described by the kinds it arranges. */
interface Preset {
  readonly id: string;
  readonly displayName: string;
  readonly groups: readonly PresetGroup[];
}

/**
 * The six presets REQ-UX-058 names.
 *
 * Each is a task, not a feature set: Editing is for working on one file, Game
 * Audio for producing many named variations of one, Batch Processing for
 * applying one treatment to many. The arrangements differ because the work
 * does.
 */
const PRESETS: readonly Preset[] = [
  {
    id: 'editing',
    displayName: 'Editing',
    groups: [
      { region: DockRegion.Left, proportion: 0.2, kinds: [PanelKinds.AssetBrowser] },
      { region: DockRegion.Centre, proportion: 1, kinds: [PanelKinds.Editor] },
      { region: DockRegion.Right, proportion: 0.22, kinds: [PanelKinds.Inspector] },
      { region: DockRegion.Bottom, proportion: 0.16, kinds: [PanelKinds.Transport] },
    ],
  },
  {
    id: 'spectral-repair',
    displayName: 'Spectral Repair',
    groups: [
      // Repair work is done by looking closely, so the editor takes the room
      // and the browser gives way.
      { region: DockRegion.Centre, proportion: 1, kinds: [PanelKinds.Editor] },
      // The Spectral panel is in front, since the area selected and what is
      // done to it are the work; the Inspector is a tab away.
      {
        region: DockRegion.Right,
        proportion: 0.26,
        kinds: [PanelKinds.Spectral, PanelKinds.Inspector],
      },
      { region: DockRegion.Bottom, proportion: 0.14, kinds: [PanelKinds.Transport] },
    ],
  },
  {
    id: 'recording',
    displayName: 'Recording',
    groups: [
      { region: DockRegion.Centre, proportion: 1, kinds: [PanelKinds.Editor] },
      { region: DockRegion.Right, proportion: 0.24, kinds: [PanelKinds.Inspector] },
      // Levels matter most while recording, so the input and the transport
      // are given height, the input in front.
      {
        region: DockRegion.Bottom,
        proportion: 0.28,
        kinds: [PanelKinds.Recording, PanelKinds.Transport],
      },
    ],
  },
  {
    id: 'game-audio',
    displayName: 'Game Audio',
    groups: [
      // Producing many named variations means living in the asset list.
      { region: DockRegion.Left, proportion: 0.28, kinds: [PanelKinds.AssetBrowser] },
      { region: DockRegion.Centre, proportion: 1, kinds: [PanelKinds.Editor] },
      { region: DockRegion.Right, proportion: 0.24, kinds: [PanelKinds.Inspector] },
      { region: DockRegion.Bottom, proportion: 0.16, kinds: [PanelKinds.Transport] },
    ],
  },
  {
    id: 'batch-processing',
    displayName: 'Batch Processing',
    groups: [
      { region: DockRegion.Left, proportion: 0.32, kinds: [PanelKinds.AssetBrowser] },
      { region: DockRegion.Centre, proportion: 1, kinds: [PanelKinds.Editor] },
      { region: DockRegion.Right, proportion: 0.26, kinds: [PanelKinds.Inspector] },
      // A long run is worth watching, so the log is up rather than hidden.
      { region: DockRegion.Bottom, proportion: 0.24, kinds: [PanelKinds.Diagnostics] },
    ],
  },
  {
    id: 'multitrack',
    displayName: 'Multitrack',
    groups: [
      { region: DockRegion.Left, proportion: 0.18, kinds: [PanelKinds.AssetBrowser] },
      { region: DockRegion.Centre, proportion: 1, kinds: [PanelKinds.Editor] },
      { region: DockRegion.Right, proportion: 0.2, kinds: [PanelKinds.Inspector] },
      { region: DockRegion.Bottom, proportion: 0.2, kinds: [PanelKinds.Transport] },
    ],
  },
];

/**
 * Builds the built-in layouts from the presets.
 *
 * A preset's panel kinds are filtered to those this build has. A group left
 * with no panels is dropped, so a preset never produces the empty group that
 * `readLayout` would reject.
 *
 * This is what lets the arrangements be decided now while the panels arrive
 * over several phases. The Multitrack preset is an arrangement of the panels
 * that exist; it does not imply multitrack editing works.
 */
export function buildPresets(available: ReadonlySet<PanelKind>): readonly WorkspaceLayout[] {
  return PRESETS.map((preset): WorkspaceLayout => {
    const groups = preset.groups
      .map((group) => {
        const kinds = group.kinds.filter((kind) => available.has(kind));
        return {
          region: group.region,
          proportion: group.proportion,
          panels: kinds.map((kind) => ({ id: `${preset.id}:${kind}`, kind })),
          activePanelId: `${preset.id}:${kinds[0] ?? ''}`,
        };
      })
      .filter((group) => group.panels.length > 0);

    // The preset names the panel the user starts in, rather than leaving that
    // to whatever mounts the layout. A command that acts on "this panel" would
    // otherwise be unavailable until the user had clicked something, which a
    // keyboard user may never do.
    const starting = groups.find((group) => group.region === DockRegion.Centre) ?? groups[0];

    return {
      schemaVersion: SCHEMA_VERSIONS.workspaceLayout,
      id: preset.id,
      displayName: preset.displayName,
      builtIn: true,
      groups,
      ...(starting === undefined ? {} : { activePanelId: starting.activePanelId }),
    };
  }).filter((layout) => layout.groups.length > 0);
}

/**
 * The preset a new user starts in.
 *
 * Editing, because the first thing anyone does is open a file and look at it.
 */
export const DEFAULT_PRESET_ID = 'editing';
