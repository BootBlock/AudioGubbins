/**
 * How a recording view reads the recording part: the input, monitoring and
 * the calibration as they change, the inputs watched while the view is shown,
 * and the diagnostics read from all of it.
 *
 * Showing a view watches the inputs and the permission, which asks the
 * browser nothing the person would see, and opens no input: only arming or
 * calibrating does.
 */

import { useEffect, useSyncExternalStore } from 'react';

import { diagnosticsOf, type DiagnosticsReading } from '../../recording/input-diagnostics.js';
import type { InputView } from '../../recording/input-view.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import type { Observable } from '../../state/observable.js';

/** The input as it changes. */
export function useInputView(recording: RecordingParts): InputView {
  return useSyncExternalStore(recording.input.view.subscribe, recording.input.view.get);
}

/** Watches the inputs and the permission while the calling view is shown. */
export function useWatchedInputs(recording: RecordingParts): void {
  useEffect(() => recording.watch(), [recording]);
}

/** The recording diagnostics, as far as what they rest on is known. */
export function useRecordingDiagnostics(
  recording: RecordingParts,
  settings: Observable<AudioSettings>,
): DiagnosticsReading {
  const input = useInputView(recording);
  const { recording: chosen } = useSyncExternalStore(settings.subscribe, settings.get);
  const storage = useSyncExternalStore(recording.storage.subscribe, recording.storage.get);
  return diagnosticsOf({
    input,
    settings: chosen,
    storage,
    suspensionRisk: recording.suspensionRisk,
  });
}
