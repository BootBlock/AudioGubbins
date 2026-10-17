/**
 * The Spectral panel's spectrogram settings (ADR-0080, ADR-0082): how the
 * editor in use analyses its spectrogram and the levels and colours it draws
 * it in, in words, with the commands that change each. It runs the view's
 * commands and writes nothing itself.
 *
 * A closed section, since the settings are tuned now and then rather than as
 * an area is repaired; its summary still says how the spectrogram is drawn.
 */

import type { ReactNode } from 'react';

import { Section } from '@audiogubbins/design-system';

import { analysisWords, colourWords, rangeWords } from '../../commands/spectrogram-commands.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
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

/** What each setting's button is called, by its command, for the summary to name the one in use. */
const SETTING_LABELS: ReadonlyMap<string, string> = new Map(
  SPECTROGRAM_SETTINGS.flatMap(([, buttons]) => buttons),
);

const SAMPLES = new Intl.NumberFormat('en-GB');

/**
 * How the spectrogram is drawn, in a few words for the closed section's
 * summary: the window's length and shape, the overlap and the colours, each
 * named as the button that chooses it is.
 */
function summaryOf({ analysis, colours }: ShownView['state']['spectrogram']): string {
  const window = SETTING_LABELS.get(`editor.spectrogram-window-${analysis.window}`);
  const ramp = SETTING_LABELS.get(`editor.spectrogram-colours-${colours}`);
  return [
    SAMPLES.format(analysis.windowLength),
    window,
    `${String(analysis.overlap)}×`,
    ramp?.toLowerCase(),
  ]
    .filter((part) => part !== undefined)
    .join(' · ');
}

/** The view's spectrogram settings in words, and the commands that change them. */
export function SpectrogramSection({
  shown,
  commands,
}: {
  readonly shown: ShownView;
  readonly commands: PanelCommands;
}): ReactNode {
  const { spectrogram } = shown.state;
  return (
    <Section title="Spectrogram" summary={summaryOf(spectrogram)} defaultOpen={false}>
      <div className="ag-spectral-words">
        <p>{analysisWords(spectrogram.analysis)}</p>
        <p>{rangeWords(spectrogram.range)}</p>
        <p>{colourWords(spectrogram.colours)}</p>
      </div>
      {SPECTROGRAM_SETTINGS.map(([group, buttons]) => (
        <div className="ag-spectral-setting" key={group} role="group" aria-label={group}>
          <span className="ag-spectral-setting-name" aria-hidden="true">
            {group}
          </span>
          <div className="ag-spectral-actions" data-ag-align="start">
            {buttons.map(([id, label]) => (
              <CommandButton
                key={id}
                id={id}
                label={label}
                commands={commands}
                args={{ view: shown.panel }}
                compact
              />
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}
