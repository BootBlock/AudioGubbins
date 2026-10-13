/**
 * The Export dialog's state while it is open (ADR-0092): what it exports, the
 * settings the person is setting up, where they want the file, and what the
 * import-export package's planning makes of them, worked out afresh on every
 * change so the dialog says what is wrong as the person sets it, and on every
 * change in what the codecs can do here, such as the bit rates the browser's
 * encoder is found to take.
 *
 * The settings are one typed record whichever way they were reached: the
 * project's last, a preset, or the expert controls. A change made in the
 * expert controls is kept as the edited settings and stays to be chosen
 * again after a preset is tried, so a preset never loses the person's work.
 *
 * It holds the dialog and nothing else: the export is started, and the
 * project's last settings kept, by the command that reads it. It closes
 * itself once the project it was opened in is no longer open.
 */

import type { AssetId, DomainResult, ProjectId } from '@audiogubbins/domain';
import {
  planExport,
  type CollisionPolicy,
  type ExportClock,
  type ExportContext,
  type ExportFormat,
  type ExportRange,
  type ExportSettings,
  type PlannedFile,
} from '@audiogubbins/import-export';

import {
  ditherFollowingDepth,
  ditherIsDefault,
  inFormat,
  openingSettings,
  overRange,
  presetSettingsOver,
  type OfferedPreset,
} from './export-draft.js';
import { observable, type Observable } from './observable.js';
import type { OpenProjectState } from './open-project-store.js';

/**
 * Where the person wants the export delivered, as the dialog holds it before
 * it starts: a file or a folder they will be asked for as it starts, a folder
 * they keep trusted, or a download. A folder takes a collision policy; a file
 * they chose in a save dialog has been agreed to be replaced already.
 */
export type ExportDestinationDraft =
  | { readonly kind: 'file' }
  | { readonly kind: 'folder'; readonly policy: CollisionPolicy }
  | { readonly kind: 'trusted-folder'; readonly key: string; readonly policy: CollisionPolicy }
  | { readonly kind: 'download' };

/** Where the dialog's settings came from: the project's last, a preset, or the person's edits. */
export type ExportSettingsSource =
  | { readonly kind: 'kept' }
  | { readonly kind: 'default' }
  | { readonly kind: 'preset'; readonly id: string }
  | { readonly kind: 'edited' };

/** What the dialog is opened over. */
export interface ExportDialogRequest {
  readonly project: ProjectId;

  /** The asset whose audio is exported. */
  readonly asset: AssetId;

  /** What it is planned against, which the asset and the project's state gave as it opened. */
  readonly context: ExportContext;

  /**
   * Told of each change in what the context's codecs can do here, followed
   * while the dialog is open so its plan is made again.
   */
  readonly codecChanges: Pick<Observable<unknown>, 'subscribe'>;

  /** When it was opened, for the `{date}` of a file name. */
  readonly clock: ExportClock;
  readonly range: ExportRange;

  /** The selection of the asset as it opened, where there is one, offered as a range. */
  readonly selection: Extract<ExportRange, { readonly kind: 'selection' }> | undefined;

  /** The settings the project kept from its last export, where it has. */
  readonly kept: ExportSettings | undefined;

  /** Whether the browser gives save and folder dialogs; where not, the export is downloaded. */
  readonly dialogs: boolean;
}

/** The dialog, open. */
export interface OpenExportDialog extends Omit<
  ExportDialogRequest,
  'range' | 'kept' | 'codecChanges'
> {
  readonly kind: 'open';
  readonly settings: ExportSettings;
  readonly source: ExportSettingsSource;

  /** The settings as the person last edited them, kept to be chosen again, where they edited any. */
  readonly edited: ExportSettings | undefined;

  /**
   * Whether the dither is the person's own: set in the expert controls, or
   * other than its depth's default in the settings shown. Until it is, a new
   * depth brings the dither that depth defaults to.
   */
  readonly ditherChosen: boolean;
  readonly destination: ExportDestinationDraft;

  /** The files the settings make, or every reason they cannot be made, as the package plans them. */
  readonly planned: DomainResult<readonly PlannedFile[]>;
}

/** The dialog: shut, or open. */
export type ExportDialogState = { readonly kind: 'closed' } | OpenExportDialog;

const CLOSED: ExportDialogState = { kind: 'closed' };

/** Where a dialog delivers first: one file to a save dialog, several to a folder, or a download. */
function firstDestination(dialogs: boolean, files: number): ExportDestinationDraft {
  if (!dialogs) return { kind: 'download' };
  return files === 1 ? { kind: 'file' } : { kind: 'folder', policy: 'prompt' };
}

/** How many files a plan makes, or one where it cannot be made yet. */
function fileCount(planned: DomainResult<readonly PlannedFile[]>): number {
  return planned.ok ? planned.value.length : 1;
}

/** The Export dialog's state (see the module comment). */
export class ExportDialogStore implements Observable<ExportDialogState> {
  private readonly state = observable<ExportDialogState>(CLOSED);

  /** Stops following the open dialog's codecs, where it follows them. */
  private unfollow: (() => void) | undefined;

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  /** Follows `project`, closing the dialog once the project it was opened in is no longer open. */
  constructor(project: Observable<OpenProjectState>) {
    project.subscribe(() => {
      const shown = this.state.get();
      if (shown.kind === 'closed') return;
      const open = project.get();
      if (open.kind === 'open' && open.snapshot.project === shown.project) return;
      this.shut();
    });
  }

  /** Opens the dialog over `request`, in place of any it showed. */
  readonly open = (request: ExportDialogRequest): void => {
    const { range, kept, codecChanges, ...rest } = request;
    const settings = openingSettings(kept, request.context, range);
    const planned = planExport(settings, request.context, request.clock);
    this.unfollow?.();
    this.unfollow = codecChanges.subscribe(() => {
      this.replan();
    });
    this.state.set({
      ...rest,
      kind: 'open',
      settings,
      source: { kind: kept === undefined ? 'default' : 'kept' },
      edited: undefined,
      ditherChosen: !ditherIsDefault(settings),
      destination: firstDestination(request.dialogs, fileCount(planned)),
      planned,
    });
  };

  /** Shuts the dialog; answers whether it was open. */
  readonly close = (): boolean => {
    if (this.state.get().kind === 'closed') return false;
    this.shut();
    return true;
  };

  /** Sets the settings `offered` gives over the range shown. */
  readonly choosePreset = (offered: OfferedPreset): void => {
    this.change((open) => {
      const settings = presetSettingsOver(offered, open.context, open.settings.range);
      return {
        settings,
        source: { kind: 'preset', id: offered.preset.id },
        edited: open.edited,
        ditherChosen: !ditherIsDefault(settings),
      };
    });
  };

  /** Sets the settings as the person last edited them, where they edited any. */
  readonly chooseEdited = (): void => {
    this.change((open) =>
      open.edited === undefined
        ? open
        : {
            settings: open.edited,
            source: { kind: 'edited' },
            edited: open.edited,
            ditherChosen: !ditherIsDefault(open.edited),
          },
    );
  };

  /**
   * Changes the settings as the expert controls do, `change` given them and
   * what they are planned against, keeping the result as the edited
   * settings; a dither the person has not set follows the depth
   * (`ditherFollowingDepth`).
   */
  readonly edit = (
    change: (settings: ExportSettings, context: ExportContext) => ExportSettings,
  ): void => {
    this.change((open) => {
      const { settings, ditherChosen } = ditherFollowingDepth(
        open.settings,
        change(open.settings, open.context),
        open.ditherChosen,
      );
      return { settings, source: { kind: 'edited' }, edited: settings, ditherChosen };
    });
  };

  /**
   * Changes the format, as an edit: see `inFormat`, whose dither is the new
   * format's default, so the dither follows the depth again.
   */
  readonly chooseFormat = (format: ExportFormat): void => {
    this.change((open) => {
      if (open.settings.format === format) return open;
      const settings = inFormat(open.settings, format, open.context);
      return { settings, source: { kind: 'edited' }, edited: settings, ditherChosen: false };
    });
  };

  /** Changes the range, as an edit: see `overRange`. */
  readonly chooseRange = (range: ExportRange): void => {
    this.edit((settings) => overRange(settings, range));
  };

  /** Changes where the export is delivered. */
  readonly chooseDestination = (destination: ExportDestinationDraft): void => {
    const shown = this.state.get();
    if (shown.kind === 'open') this.state.set({ ...shown, destination });
  };

  /** Shuts the dialog, no longer following its codecs. */
  private shut(): void {
    this.unfollow?.();
    this.unfollow = undefined;
    this.state.set(CLOSED);
  }

  /** Plans the open dialog's settings again, as what its codecs can do has changed. */
  private replan(): void {
    const shown = this.state.get();
    if (shown.kind === 'closed') return;
    this.state.set({ ...shown, planned: planExport(shown.settings, shown.context, shown.clock) });
  }

  /** Replaces the open dialog's settings, its source and its edits as `change` says, and plans them. */
  private change(
    change: (
      open: OpenExportDialog,
    ) => Pick<OpenExportDialog, 'settings' | 'source' | 'edited' | 'ditherChosen'>,
  ): void {
    const shown = this.state.get();
    if (shown.kind === 'closed') return;
    const next = change(shown);
    if (next === shown) return;
    this.state.set({
      ...shown,
      ...next,
      planned: planExport(next.settings, shown.context, shown.clock),
    });
  }
}
