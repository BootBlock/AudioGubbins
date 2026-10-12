/**
 * The Spectral panel's spectrogram settings (ADR-0080, ADR-0082): how the
 * editor in use analyses its spectrogram and the levels and colours it draws
 * it in, in words, with the commands that change each. It runs the view's
 * commands and writes nothing itself.
 */

import { useId, type ReactNode } from 'react';

import { analysisWords, colourWords, rangeWords } from '../../commands/spectrogram-commands.js';
import { CommandButton, useCommandReasons, type PanelCommands } from '../command-button.js';
import { SharedReasonNotes } from '../settings/reasoned-button.js';
import type { ShownView } from './shown-spectral.js';

/** The commands that change the spectrogram, in groups, and what each button says. */
const SPECTROGRAM_SETTINGS: readonly (readonly [
  group: string,
  buttons: readonly (readonly [id: string, label: string])[],
])[] = [
  [
    'Analysis',
    [
      ['editor.spectrogram-window-shorter', 'Shorter windows'],
      ['editor.spectrogram-window-longer', 'Longer windows'],
      ['editor.spectrogram-window-hann', 'Hann'],
      ['editor.spectrogram-window-blackman-harris', 'Blackman–Harris'],
    ],
  ],
  [
    'Overlap',
    [
      ['editor.spectrogram-overlap-1', 'None'],
      ['editor.spectrogram-overlap-2', '2 times'],
      ['editor.spectrogram-overlap-4', '4 times'],
      ['editor.spectrogram-overlap-8', '8 times'],
    ],
  ],
  [
    'Levels',
    [
      ['editor.spectrogram-floor-lower', 'Lower floor'],
      ['editor.spectrogram-floor-raise', 'Raise floor'],
      ['editor.spectrogram-ceiling-lower', 'Lower ceiling'],
      ['editor.spectrogram-ceiling-raise', 'Raise ceiling'],
      ['editor.spectrogram-range-default', 'Usual levels'],
    ],
  ],
  [
    'Colours',
    [
      ['editor.spectrogram-colours-theme', 'Theme colours'],
      ['editor.spectrogram-colours-greyscale', 'Greys'],
    ],
  ],
];

const SETTING_IDS = SPECTROGRAM_SETTINGS.flatMap(([, buttons]) => buttons.map(([id]) => id));

/** The view's spectrogram settings in words, and the commands that change them. */
export function SpectrogramSection({
  shown,
  commands,
}: {
  readonly shown: ShownView;
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  const reasons = useCommandReasons(commands, SETTING_IDS);
  const { spectrogram } = shown.state;
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        Spectrogram
      </h3>
      <p>{analysisWords(spectrogram.analysis)}</p>
      <p>{rangeWords(spectrogram.range)}</p>
      <p>{colourWords(spectrogram.colours)}</p>
      <SharedReasonNotes reasons={reasons} />
      {SPECTROGRAM_SETTINGS.map(([group, buttons]) => (
        <div className="ag-inspector-row" key={group} role="group" aria-label={group}>
          {buttons.map(([id, label]) => (
            <CommandButton
              key={id}
              id={id}
              label={label}
              commands={commands}
              args={{ view: shown.panel }}
              compact
              shared={reasons}
            />
          ))}
        </div>
      ))}
    </section>
  );
}
