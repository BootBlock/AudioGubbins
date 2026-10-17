/**
 * The Spectral panel's selection and tools (ADR-0082, REQ-UX-005): the
 * spectral selection in words, with the commands that select a band of the
 * time selection, add one to it or take one from it, widen, narrow and clear
 * it; the spectral tools; and the settings they draw with, the combination
 * mode a shape drawn with no modifier joins the selection by, the brush's
 * radius and hardness and the marquee's and lasso's softness, each set
 * through its command on the view in use.
 */

import { Fragment, useState, type ReactNode } from 'react';

import {
  Button,
  ButtonTone,
  ControlBar,
  ControlBarButton,
  ControlBarSeparator,
  Hint,
  type IconName,
  Section,
  TextField,
  ValueSlider,
} from '@audiogubbins/design-system';
import { SPECTRAL_TOOL_RANGES, ToolId, isSpectralTool } from '@audiogubbins/editor-view';
import { SpectralCombination } from '@audiogubbins/timeline';

import { TOOLS } from '../../commands/editor-presentation-commands.js';
import {
  COMBINATIONS,
  hardnessWords,
  softnessWords,
} from '../../commands/spectral-tool-commands.js';
import { spectralSelectionWords } from '../../commands/spectral-words.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { commandPress } from '../command-press.js';
import { SpectralFormRow } from './spectral-form-row.js';
import type { ShownView } from './shown-spectral.js';

/** A command that changes the spectral selection: what its button is called and drawn with. */
interface SelectionCommand {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
}

/**
 * The commands that change the spectral selection, in the toolbar's groups:
 * a band of the time selection, the area's extent, and clearing it.
 */
const SELECTION: readonly (readonly SelectionCommand[])[] = [
  [
    {
      id: 'editor.select-spectral-band',
      label: 'Select the band of the time selection',
      icon: 'select-band',
    },
    {
      id: 'editor.add-spectral-band',
      label: 'Add the band of the time selection',
      icon: 'add-to-selection',
    },
    {
      id: 'editor.subtract-spectral-band',
      label: 'Take the band of the time selection away',
      icon: 'take-from-selection',
    },
  ],
  [
    { id: 'editor.widen-spectral-time', label: 'Widen in time', icon: 'widen-in-time' },
    { id: 'editor.narrow-spectral-time', label: 'Narrow in time', icon: 'narrow-in-time' },
    { id: 'editor.widen-spectral-band', label: 'Widen the band', icon: 'widen-band' },
    { id: 'editor.narrow-spectral-band', label: 'Narrow the band', icon: 'narrow-band' },
  ],
  [{ id: 'editor.clear-spectral-selection', label: 'Clear', icon: 'clear' }],
];

/** The spectral tools, each with its glyph. */
const SPECTRAL_TOOLS: readonly (readonly [tool: ToolId, icon: IconName])[] = [
  [ToolId.SpectralMarquee, 'spectral-marquee'],
  [ToolId.SpectralLasso, 'spectral-lasso'],
  [ToolId.SpectralBrush, 'spectral-brush'],
];

/** The spectral selection in words, and the toolbar of commands that change it. */
export function SelectionSection({
  shown,
  commands,
}: {
  readonly shown: ShownView;
  readonly commands: PanelCommands;
}): ReactNode {
  const args = { view: shown.panel };
  return (
    <>
      <div className="ag-spectral-selection">
        <p className="ag-spectral-description">
          {spectralSelectionWords(shown.selection, shown.view, shown.state.timeFormat)}
        </p>
      </div>
      <ControlBar label="Spectral selection">
        {SELECTION.map((group, index) => (
          <Fragment key={group[0]?.id}>
            {index > 0 && <ControlBarSeparator />}
            {group.map(({ id, label, icon }) => (
              <ControlBarButton
                key={id}
                label={label}
                icon={icon}
                hint={label}
                {...commandPress(commands, id, args)}
              />
            ))}
          </Fragment>
        ))}
      </ControlBar>
    </>
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
      <SpectralFormRow label="Soften">
        <div className="ag-spectral-fields">
          <TextField
            label="Softness in milliseconds"
            unit="ms"
            value={milliseconds}
            onValueChange={setMilliseconds}
          />
          <TextField label="Softness in hertz" unit="Hz" value={hertz} onValueChange={setHertz} />
        </div>
      </SpectralFormRow>
      <SpectralFormRow>
        <div className="ag-spectral-actions" data-ag-align="start">
          <CommandButton
            id="editor.set-spectral-softness"
            label="Soften edges"
            commands={commands}
            args={args}
            compact
          />
          <CommandButton
            id="editor.hard-spectral-edges"
            label="Hard edges"
            tone={ButtonTone.Quiet}
            commands={commands}
            args={{ view: shown.panel }}
            compact
          />
        </div>
        <p className="ag-spectral-caption">
          {`The marquee and the lasso soften their edges by ${softnessWords(feather, shown.view.sampleRate)}.`}
        </p>
      </SpectralFormRow>
    </>
  );
}

/**
 * The combination mode, each mode a button pressed while it is the view's:
 * how a finger or a pen, which holds no key, adds to the area and takes
 * from it. What the chosen mode does, and the keys that do it instead, are
 * behind the hint, since the pressed button already shows which it is.
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
    <div className="ag-spectral-combination">
      <div className="ag-spectral-modes" role="group" aria-label="Combination mode">
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
      <Hint label="About the combination mode">
        {`A shape drawn with no modifier held ${COMBINATIONS[chosen].does} the spectral selection; Shift adds and Alt takes away.`}
      </Hint>
    </div>
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
        label="Brush"
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
        label="Hardness"
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
  const args = { view: shown.panel };
  return (
    <Section
      title="Tools"
      summary={
        isSpectralTool(shown.state.tool)
          ? `The ${TOOLS[shown.state.tool].name.toLowerCase()} is in use.`
          : 'No spectral tool is in use.'
      }
    >
      <div className="ag-spectral-tool-row">
        <ControlBar label="Spectral tools">
          {SPECTRAL_TOOLS.map(([tool, icon]) => (
            <ControlBarButton
              key={tool}
              label={TOOLS[tool].name}
              icon={icon}
              hint={TOOLS[tool].name}
              pressed={shown.state.tool === tool}
              {...commandPress(commands, `editor.tool-${tool}`, args)}
            />
          ))}
        </ControlBar>
        <CombinationControl shown={shown} commands={commands} />
      </div>
      <div className="ag-spectral-form">
        <BrushControls shown={shown} commands={commands} />
        <SoftnessControl shown={shown} commands={commands} />
      </div>
    </Section>
  );
}
