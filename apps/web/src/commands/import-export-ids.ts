/**
 * The identities of the commands that import and export audio (ADR-0090,
 * ADR-0092), declared once so the menus, the dialogs, the shortcuts and the
 * commands that declare them name the same command. Each argument is a flat
 * scalar, as every invocation's is; where a command needs more, such as a
 * destination, its body asks for it inside the person's gesture.
 */

/** The commands that bring audio into the open project. */
export const ImportCommand = {
  /** Brings in the audio files the person chooses, one or several. */
  Files: 'file.import-audio',

  /** Brings in every audio file of a folder the person chooses. */
  Folder: 'file.import-audio-folder',
} as const;

/** The commands that export audio, and those of the export they start. */
export const ExportCommand = {
  /** Opens the Export dialog over the asset in the editor, its range the whole asset. */
  Audio: 'file.export-audio',

  /** Opens the Export dialog over one region, named by its `region` argument. */
  Region: 'file.export-region',

  /** Opens the Export dialog over every region of the asset, a file each. */
  EveryRegion: 'file.export-every-region',

  /** Opens the Export dialog over the selection. */
  Selection: 'file.export-selection',

  /** Starts the export the Export dialog sets, keeping its settings as the project's last. */
  Start: 'export.start',

  /** Shuts the Export dialog, starting nothing. */
  CloseDialog: 'export.close-dialog',

  /** Cancels the export, giving up what it staged. */
  Cancel: 'export.cancel',

  /**
   * Answers the collision being asked about: `answer`, one of `overwrite`,
   * `rename` and `skip`, and `applyToAll`, whether it holds for the rest of
   * the batch.
   */
  AnswerCollision: 'export.answer-collision',

  /** Delivers a held file again, named by its `job` argument. */
  Retry: 'export.retry',

  /** Delivers a held file, named by its `job` argument, to a destination chosen anew. */
  DeliverElsewhere: 'export.deliver-elsewhere',

  /** Describes the page's export, running, waiting or last ended, in the Inspector. */
  Inspect: 'export.inspect',

  /** Describes an export the open project's history records, named by its `record` argument, in the Inspector. */
  InspectRecord: 'export.inspect-record',

  /** Chooses a folder and keeps it trusted for exports. */
  TrustFolder: 'export.trust-folder',

  /** Stops keeping a trusted folder, named by its `key` argument. */
  ForgetFolder: 'export.forget-folder',

  /** Keeps the Export dialog's settings as a preset of the person's, named by its `name` argument. */
  SavePreset: 'export.save-preset',

  /** Removes a preset of the person's, named by its `preset` argument. */
  RemovePreset: 'export.remove-preset',
} as const;
