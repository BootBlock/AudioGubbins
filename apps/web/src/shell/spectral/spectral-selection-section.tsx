/**
 * The Spectral panel's selection and tools (ADR-0082, REQ-UX-005): the
 * spectral selection in words, with the commands that select a band of the
 * time selection, add one to it or take one from it, widen, narrow and clear
 * it; the spectral tools; and the settings they draw with, the combination
 * mode a shape drawn with no modifier joins the selection by, the brush's
 * radius and hardness and the marquee's and lasso's softness, each set
 * through its command on the view in use.
 */

import { useId, useState, type ReactNode } from 'react';

import { Button, ButtonTone, TextField, ValueSlider } from '@audiogubbins/design-system';
import { SPECTRAL_TOOL_RANGES, ToolId, isSpectralTool } from '@audiogubbins/editor-view';
import { SpectralCombination } from '@audiogubbins/timeline';

import { TOOLS } from '../../commands/editor-presentation-commands.js';
import {
  COMBINATIONS,
  hardnessWords,
  softnessWords,
} from '../../commands/spectral-tool-commands.js';
import { spectralSelectionWords } from '../../commands/spectral-words.js';
import { CommandButton, useCommandReasons, type PanelCommands } from '../command-button.js';
import { SharedReasonNotes } from '../settings/reasoned-button.js';
import type { ShownView } from './shown-spectral.js';

/** The commands that change the spectral selection from the keyboard, and what each button says. */
const SELECTION: readonly (readonly [id: string, label: string])[] = [
  ['editor.select-spectral-band', 'Select the band of the time selection'],
  ['editor.add-spectral-band', 'Add the band of the time selection'],
  ['editor.subtract-spectral-band', 'Take the band of the time selection away'],
  ['editor.widen-spectral-time', 'Widen in time'],
  ['editor.narrow-spectral-time', 'Narrow in time'],
  ['editor.widen-spectral-band', 'Widen the band'],
  ['editor.narrow-spectral-band', 'Narrow the band'],
  ['editor.clear-spectral-selection', 'Clear'],
];

const SELECTION_IDS = SELECTION.map(([id]) => id);

const SPECTRAL_TOOLS: readonly ToolId[] = [
  ToolId.SpectralMarquee,
  ToolId.SpectralLasso,
  ToolId.SpectralBrush,
];

/** The spectral selection in words, and the commands that change it. */
export function SelectionSection({
  shown,
  commands,
}: {
  readonly shown: ShownView;
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  const reasons = useCommandReasons(commands, SELECTION_IDS);
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        Spectral selection
      </h3>
      <p className="ag-spectral-description">
        {spectralSelectionWords(shown.selection, shown.view, shown.state.timeFormat)}
      </p>
      <SharedReasonNotes reasons={reasons} />
      <div className="ag-inspector-row">
        {SELECTION.map(([id, label]) => (
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
    </section>
  );
}

/** A number typed, as a command reads one: an empty field is no number, so the command asks. */
function typedNumber(typed: string): number {
  return typed.trim() === '' ? Number.NaN : Number(typed);
}

/** The marquee's and the lasso's softness, typed in milliseconds and hertz. */
function SoftnessControl({
  shown,
  commands,
}: {
  readonly shown: ShownView;
  readonly commands: PanelCommands;
}): ReactNode {
  const [milliseconds, setMilliseconds] = useState('10');
  const [hertz, setHertz] = useState('50');
  const args = {
    view: shown.panel,
    milliseconds: typedNumber(milliseconds),
    hertz: typedNumber(hertz),
  };
  const { feather } = shown.state.spectralTools;
  return (
    <>
      <p>{`The marquee and the lasso soften their edges by ${softnessWords(feather, shown.view.sampleRate)}.`}</p>
      <div className="ag-inspector-row">
        <TextField
          label="Softness in milliseconds"
          value={milliseconds}
          onValueChange={setMilliseconds}
        />
        <TextField label="Softness in hertz" value={hertz} onValueChange={setHertz} />
        <CommandButton
          id="editor.set-spectral-softness"
          label="Soften the edges"
          commands={commands}
          args={args}
          compact
        />
        <CommandButton
          id="editor.hard-spectral-edges"
          label="Hard edges"
          commands={commands}
          args={{ view: shown.panel }}
          compact
        />
      </div>
    </>
  );
}

/**
 * The combination mode, each mode a button pressed while it is the view's:
 * how a finger or a pen, which holds no key, adds to the area and takes
 * from it.
 */
function CombinationControl({
  shown,
  commands,
}: {
  readonly shown: ShownView;
  readonly commands: PanelCommands;
}): ReactNode {
  const { combination: chosen } = shown.state.spectralTools;
  return (
    <>
      <p>{`A shape drawn with no modifier held ${COMBINATIONS[chosen].does} the spectral selection; Shift adds and Alt takes away.`}</p>
      <div className="ag-inspector-row" role="group" aria-label="Combination mode">
        {Object.values(SpectralCombination).map((combination) => (
          <Button
            key={combination}
            compact
            tone={combination === chosen ? ButtonTone.Primary : ButtonTone.Quiet}
            aria-pressed={combination === chosen}
            onClick={() => {
              commands.run(`editor.spectral-combination-${combination}`, { view: shown.panel });
            }}
          >
            {COMBINATIONS[combination].name}
          </Button>
        ))}
      </div>
    </>
  );
}

/** The brush's radius and hardness, each set through its command as its slider moves. */
function BrushControls({
  shown,
  commands,
}: {
  readonly shown: ShownView;
  readonly commands: PanelCommands;
}): ReactNode {
  const { brushRadius, hardness } = shown.state.spectralTools;
  const { brushRadius: radiusRange, hardness: hardnessRange } = SPECTRAL_TOOL_RANGES;
  return (
    <>
      <ValueSlider
        label="Brush radius"
        value={brushRadius}
        minimum={radiusRange.minimum}
        maximum={radiusRange.maximum}
        step={radiusRange.step}
        displayValue={`${String(brushRadius)} px`}
        describeValue={(value) => `${String(value)} pixels`}
        onValueChange={(pixels) => {
          commands.run('editor.set-brush-radius', { view: shown.panel, pixels });
        }}
      />
      <ValueSlider
        label="Brush hardness"
        value={hardness}
        minimum={hardnessRange.minimum}
        maximum={hardnessRange.maximum}
        step={hardnessRange.step}
        displayValue={hardnessWords(hardness)}
        describeValue={hardnessWords}
        onValueChange={(value) => {
          commands.run('editor.set-brush-hardness', { view: shown.panel, hardness: value });
        }}
      />
    </>
  );
}

/** The spectral tools, and the settings they draw with. */
export function ToolSection({
  shown,
  commands,
}: {
  readonly shown: ShownView;
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        Spectral tools
      </h3>
      <p>
        {isSpectralTool(shown.state.tool)
          ? `The ${TOOLS[shown.state.tool].name.toLowerCase()} is in use.`
          : 'No spectral tool is in use.'}
      </p>
      <div className="ag-inspector-row">
        {SPECTRAL_TOOLS.map((tool) => (
          <CommandButton
            key={tool}
            id={`editor.tool-${tool}`}
            label={TOOLS[tool].name}
            commands={commands}
            args={{ view: shown.panel }}
            compact
          />
        ))}
      </div>
      <CombinationControl shown={shown} commands={commands} />
      <BrushControls shown={shown} commands={commands} />
      <SoftnessControl shown={shown} commands={commands} />
    </section>
  );
}
