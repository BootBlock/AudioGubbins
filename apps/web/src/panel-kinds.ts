/**
 * The panels the project system adds to the workspace: the History panel
 * (REQ-STOR-196) and the Storage panel (REQ-STOR-102, REQ-STOR-106,
 * REQ-STOR-200).
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
