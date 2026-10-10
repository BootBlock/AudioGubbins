/**
 * Each format's own encoding controls in the Export dialog (ADR-0092): one
 * row of a table for each format, so a format is a new row and never another
 * arm of a switch. Every value its encoding type allows is offered; whether
 * the value suits the rate and the channels is the package's validation to
 * say, beside the controls.
 */

import type { ReactNode } from 'react';

import type { ExportContext, ExportFormat, ExportSettingsOf } from '@audiogubbins/import-export';

import { LOSSY_ROWS } from './lossy-encodings.js';
import { PCM_ROWS } from './pcm-encodings.js';
import type { EncodingProps, EncodingRows } from './setting-fields.js';

const CONTROLS: EncodingRows = { ...PCM_ROWS, ...LOSSY_ROWS };

/** The controls of one format's settings, setting the whole record as `onSettings` is told. */
function controlsOf<F extends ExportFormat>(
  settings: ExportSettingsOf<F>,
  context: ExportContext,
  onSettings: (settings: ExportSettingsOf<F>) => void,
): ReactNode {
  const Controls: (props: EncodingProps<F>) => ReactNode = CONTROLS[settings.format];
  return (
    <Controls
      settings={settings}
      context={context}
      onEncoding={(encoding) => {
        onSettings({ ...settings, encoding });
      }}
    />
  );
}

/** The encoding controls of `settings`' format. */
export function EncodingControls<F extends ExportFormat>({
  settings,
  context,
  onSettings,
}: {
  readonly settings: ExportSettingsOf<F>;
  readonly context: ExportContext;
  readonly onSettings: (settings: ExportSettingsOf<F>) => void;
}): ReactNode {
  return controlsOf(settings, context, onSettings);
}
