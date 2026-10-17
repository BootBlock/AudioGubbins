/**
 * The Spectral panel (ADR-0082, REQ-AUDIO-016): what the editor in use has
 * selected in time and frequency, in words; the spectral tools and the settings
 * they draw with; the pen's pressure and the fixed strength; how the
 * spectrogram is analysed and drawn; the operations that repair the area, with
 * what each is given; and the spectral edits of the sound shown, each worded as
 * the Inspector words it and compared with before it by its command.
 *
 * It reads the stores and runs commands; it writes nothing itself (`CLAUDE.md`
 * G2), and it follows every change to them, an undo included.
 */

import type { ReactNode } from 'react';

import { Banner, EmptyState, Section } from '@audiogubbins/design-system';

import { PressureControls } from '../pressure-controls.js';
import { SpectralEdits } from './spectral-edits.js';
import { OperationsSection } from './spectral-operations.js';
import { SelectionSection, ToolSection } from './spectral-selection-section.js';
import { SpectrogramSection } from './spectrogram-section.js';
import { useShownView, type ShownView, type SpectralContext } from './shown-spectral.js';

/** The pen's pressure and the fixed strength, which the brush acts with. */
function PressureSection({
  shown,
  context,
}: {
  readonly shown: ShownView;
  readonly context: SpectralContext;
}): ReactNode {
  return (
    <Section title="Brush strength">
      <PressureControls pressure={shown.pressure} run={context.run} />
    </Section>
  );
}

/** The Spectral panel. */
export function SpectralPanel({
  title,
  context,
}: {
  readonly title: string;
  readonly context: SpectralContext;
}): ReactNode {
  const shown = useShownView(context);
  return (
    <section className="ag-panel ag-spectral">
      <h2 className="ag-panel-title">{title}</h2>
      {shown === undefined ? (
        <EmptyState
          icon="spectral"
          title="No audio open"
          text="Open audio in an editor to select and repair an area of it here."
        />
      ) : (
        <div className="ag-spectral-body">
          <SelectionSection shown={shown} commands={context} />
          <ToolSection shown={shown} commands={context} />
          <PressureSection shown={shown} context={context} />
          <SpectrogramSection shown={shown} commands={context} />
          {shown.project === undefined ? (
            <Banner icon="information">
              It is not part of the project, so it keeps no spectral edits. Import a file to repair
              it.
            </Banner>
          ) : (
            <>
              <OperationsSection shown={shown} context={context} />
              <SpectralEdits shown={shown} context={context} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
