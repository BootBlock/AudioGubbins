/**
 * The recording part: the input, monitoring, the latency calibration, and what
 * the recording views read of them (`ADR-0070`), composed from the media input
 * adapter the composition root read once, the page's one audio context, and
 * the recording package's machines.
 *
 * Nothing here asks the browser anything when it is made. The inputs and the
 * permission are watched while a recording view is shown or an input is open,
 * the storage estimate is read when a view begins watching, and an input is
 * opened only by arming it or by calibrating.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { MediaInput, SupportedCaptureConstraints } from '@audiogubbins/capabilities';

import type { OpenCapture } from '../audio/capture-parts.js';
import type { AudioContextHost } from '../audio/context-host.js';
import type { PlaybackControl } from '../audio/playback-control.js';
import { previewQualityOf, type AudioSettingsStore } from '../state/audio-settings-store.js';
import type { AudioView } from '../state/audio-view-store.js';
import { observable, type Observable } from '../state/observable.js';
import type { WorkspaceStore } from '../state/workspace-store.js';
import { CalibrationControl, calibrating } from './calibration-control.js';
import { InputControl } from './input-control.js';
import type { PageWatch } from './open-input-watch.js';
import type { StorageReading } from './input-diagnostics.js';
import type { InputOpening } from './input-opener.js';
import type { MeasureRoundTrip } from './loopback-measure.js';
import { MonitoringControl } from './monitoring-control.js';
import { followRecordingFocus } from './recording-focus.js';

/** What the recording commands and views reach. */
export interface RecordingParts {
  readonly input: InputControl;
  readonly monitoring: MonitoringControl;
  readonly calibration: CalibrationControl;
  /** Whether recording is the Inspector's subject. */
  readonly focus: Observable<boolean>;
  /** The storage estimate, as last read. */
  readonly storage: Observable<StorageReading>;
  /** Whether this platform may suspend capture in the background or under a screen lock. */
  readonly suspensionRisk: boolean;
  /** Which capture constraints the browser recognises, or `undefined` where it cannot say. */
  readonly supported: SupportedCaptureConstraints | undefined;
  /**
   * Watches the inputs and the permission, and reads the storage estimate,
   * until the answer is called: what a recording view does while it is shown.
   */
  readonly watch: () => () => void;
}

/** What the recording part is made from. */
export interface RecordingPartOptions {
  readonly media: MediaInput;
  readonly host: AudioContextHost;
  readonly openCapture: OpenCapture;
  readonly settings: AudioSettingsStore;
  readonly playback: PlaybackControl;
  readonly audio: Observable<AudioView>;
  readonly workspace: WorkspaceStore;
  readonly measure: MeasureRoundTrip;
  readonly page: PageWatch;
  /** The browser's storage estimate, where it offers one; a figure it leaves out is not known. */
  readonly estimate:
    (() => Promise<{ readonly quota?: number; readonly usage?: number }>) | undefined;
  readonly suspensionRisk: boolean;
  /** Calls a callback after a delay, and answers how to cancel it. */
  readonly schedule: (callback: () => void, milliseconds: number) => () => void;
  readonly now: () => number;
  readonly announce: (text: string) => void;
  readonly logger: Logger;
}

/** Makes the recording part; answers its parts and how to let go of everything it opened. */
export function startRecording(options: RecordingPartOptions): {
  readonly parts: RecordingParts;
  readonly dispose: () => void;
} {
  const { settings, announce, logger } = options;
  const opening: InputOpening = {
    media: options.media,
    host: options.host,
    openCapture: options.openCapture,
    latencyHint: () => settings.get().chosen.settings.latencyHint,
  };
  const monitoring = new MonitoringControl({
    settings,
    quality: () => previewQualityOf(settings.get()),
    announce,
  });
  const input = new InputControl({
    opening,
    settings,
    monitoring,
    page: options.page,
    suspensionRisk: options.suspensionRisk,
    announce,
    logger,
  });
  const calibration = new CalibrationControl({
    opening,
    settings,
    input: input.view,
    playback: options.playback,
    audio: options.audio,
    measure: options.measure,
    schedule: options.schedule,
    now: options.now,
    announce,
  });
  const focus = followRecordingFocus(options.workspace, input.view);
  const storage = observable<StorageReading>({ kind: 'unread' });
  const readStorage = async (): Promise<void> => {
    const estimate = options.estimate;
    if (estimate === undefined) {
      storage.set({ kind: 'read', estimate: undefined });
      return;
    }
    try {
      const { quota, usage } = await estimate();
      storage.set({
        kind: 'read',
        estimate: quota === undefined || usage === undefined ? undefined : { quota, usage },
      });
    } catch (error) {
      // A browser may refuse an estimate, as one in private browsing can, which
      // is the same to a person as giving none.
      if (!(error instanceof Error)) throw error;
      logger.info('The storage estimate could not be read.', { reason: error.message });
      storage.set({ kind: 'read', estimate: undefined });
    }
  };
  return {
    parts: {
      input,
      monitoring,
      calibration,
      focus: focus.focus,
      storage,
      suspensionRisk: options.suspensionRisk,
      supported: options.media.supportedConstraints,
      watch: () => {
        void readStorage();
        return input.watchDevices();
      },
    },
    dispose: () => {
      focus.stop();
      input.dispose();
      monitoring.dispose();
      if (calibrating(calibration.stage.get())) calibration.cancel();
    },
  };
}
