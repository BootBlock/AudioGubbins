/**
 * The panels the application adds to the workspace's own: the project
 * system's History panel (REQ-STOR-196) and Storage panel (REQ-STOR-102,
 * REQ-STOR-106, REQ-STOR-200), the Analysis panel the assistants report in
 * (ADR-0062), the Library of saved chains and presets (ADR-0060), the Effects
 * rack (ADR-0060) and the Model packs manager (REQ-AUDIO-139).
 *
 * Named here, beside the composition root that describes them and the shell
 * that draws them, rather than among the workspace package's presets: no preset
 * places them, and the workspace knows a panel's kind only as a name.
 */
export const ProjectPanelKinds = {
  /** Every state the open project has been in, and what can be done with each. */
  History: 'history',

  /** What the stored projects take, and the cleanup that frees it. */
  Storage: 'storage',
} as const;

/** The panels of the editing tools the workspace package does not name. */
export const EditingPanelKinds = {
  /** What the assistants found in the audio of the editor in use, and what they recommend. */
  Analysis: 'analysis',

  /** The person's saved chains and presets, and applying them. */
  Library: 'library',

  /** The rack of what the editor in use acts on: its chains of processors, and their controls. */
  Rack: 'rack',
} as const;

/** The panels of local machine learning (ADR-0062). */
export const ModelPanelKinds = {
  /** The model packs kept here and offered, and installing, updating and removing them. */
  ModelPacks: 'model-packs',
} as const;
