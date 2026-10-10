/**
 * What the Editor and Picture panels are given: the stores they read, the
 * peaks, spectrograms and graphics a surface draws with, where a renderer's
 * report goes, and how a control runs a command with what it names and asks a
 * command's label, shortcut and reason. Built once from the application, as
 * every panel's context is.
 */

import type { GraphicsPlatform } from '@audiogubbins/capabilities';
import type { Logger } from '@audiogubbins/diagnostics';
import type { SpectrogramHost } from '@audiogubbins/spectral-analysis';
import type { PeakHost } from '@audiogubbins/waveform';

import type { SpectrogramDsp } from './spectrogram-reports.js';
import type { SurfaceStores } from './view-sources.js';
import type { VoicedOptions } from '../state/interaction-store.js';
import type { ReferencePicture } from '../picture/reference-picture.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import type { ChosenFiles } from '../state/chosen-files.js';
import type { EditorViewStore } from '../state/editor-view-store.js';
import type { Observable } from '../state/observable.js';
import type { RendererReports } from '../state/renderer-reports.js';

/** What a command a control runs is given. */
export type ControlArguments = Readonly<Record<string, string | number | boolean>>;

/** What the editor's panels are given. */
export interface EditorPanelParts {
  readonly stores: SurfaceStores & { readonly editorViews: EditorViewStore };
  readonly assets: AssetCatalogue;
  readonly picture: ReferencePicture;
  readonly chosenFiles: Pick<ChosenFiles, 'offer'>;
  readonly peaks: PeakHost;
  readonly spectrograms: SpectrogramHost;
  /** Which DSP the spectrogram worker runs, once a view has shown a spectrogram. */
  readonly spectrogramDsp: Observable<SpectrogramDsp | undefined>;
  readonly graphics: GraphicsPlatform;
  readonly rendererReports: RendererReports;
  readonly logger: Logger;
  readonly run: (id: string, args?: ControlArguments, options?: VoicedOptions) => void;
  /** Says a sentence politely, where what it reports is shown in its own place already. */
  readonly announce: (text: string) => void;
  readonly unavailableReason: (id: string) => string | undefined;
  readonly labelFor: (id: string) => string;
  readonly shortcutFor: (id: string) => string | undefined;
}
