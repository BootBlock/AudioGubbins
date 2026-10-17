/**
 * An editor view's toolbar: its tools, zoom, display mode, time format,
 * snapping and channels (REQ-EDIT-062, REQ-EDIT-065), and, while a spectral
 * tool is in use, the combination mode its shapes join the selection by where
 * no modifier is held, which is how a finger or a pen adds and takes away
 * (ADR-0082). Every control runs the command of the same name, naming this
 * view, so the toolbar, a key and the palette are one action; a control shows
 * the view's state and holds none.
 *
 * Drawn as one row (design language, section 11, "Toolbar"): the tools as a
 * tool group whose chosen tool is lit as a call to action, the spectral tools
 * after a separator, zoom and snapping as icon buttons, and the choices at the
 * row's trailing end. Each icon button keeps the name it had as text, and says
 * what it does on hover or focus.
 */

import type { ReactNode } from 'react';

import {
  Button,
  ButtonTone,
  ControlBar,
  ControlBarButton,
  ControlBarItem,
  ControlBarSeparator,
  IconButton,
  OptionSelect,
  type IconName,
} from '@audiogubbins/design-system';
import {
  DisplayMode,
  ToolId,
  isSpectralTool,
  type EditorViewState,
} from '@audiogubbins/editor-view';
import { SpectralCombination, TimeFormatKind } from '@audiogubbins/timeline';

import { channelNames } from '../assets/channel-names.js';
import type { EditorAsset } from '../assets/editor-asset.js';
import { DISPLAY_MODES, TOOLS } from '../commands/editor-presentation-commands.js';
import { TIME_FORMATS } from '../commands/editor-option-commands.js';
import { COMBINATIONS } from '../commands/spectral-tool-commands.js';

/** How the toolbar runs a command, and reads its shortcut and its name. */
export interface ToolbarCommands {
  readonly run: (id: string, args?: Readonly<Record<string, string | number | boolean>>) => void;
  readonly shortcutFor: (id: string) => string | undefined;
  /** The command's name, as the menus and the palette say it: an icon button's hint. */
  readonly labelFor: (id: string) => string;
}

/** Each tool's glyph. */
const TOOL_GLYPHS: Readonly<Record<ToolId, IconName>> = {
  [ToolId.Select]: 'selection-tool',
  [ToolId.TimeSelect]: 'time-selection',
  [ToolId.Hand]: 'hand-tool',
  [ToolId.Zoom]: 'zoom',
  [ToolId.Razor]: 'razor',
  [ToolId.Marker]: 'marker',
  [ToolId.Region]: 'region',
  [ToolId.SpectralMarquee]: 'spectral-marquee',
  [ToolId.SpectralLasso]: 'spectral-lasso',
  [ToolId.SpectralBrush]: 'spectral-brush',
};

/** Each combination mode's glyph. */
const COMBINATION_GLYPHS: Readonly<Record<SpectralCombination, IconName>> = {
  [SpectralCombination.Replace]: 'replace-selection',
  [SpectralCombination.Add]: 'add-to-selection',
  [SpectralCombination.Subtract]: 'take-from-selection',
};

/** Each display mode's glyph, drawn in the select beside its name. */
const DISPLAY_GLYPHS: Readonly<Record<DisplayMode, IconName>> = {
  [DisplayMode.Waveform]: 'waveform',
  [DisplayMode.Spectrogram]: 'spectrogram',
  [DisplayMode.Stacked]: 'waveform-above-spectrogram',
  [DisplayMode.Overlay]: 'waveform-over-spectrogram',
};

/** The shortcut of the command `id`, as a button's optional prop. */
function shortcutOf(commands: ToolbarCommands, id: string): { readonly shortcut?: string } {
  const shortcut = commands.shortcutFor(id);
  return shortcut === undefined ? {} : { shortcut };
}

function ToolButtons({
  panel,
  state,
  commands,
}: {
  readonly panel: string;
  readonly state: EditorViewState;
  readonly commands: ToolbarCommands;
}): ReactNode {
  // Every tool, in the order they are declared, so a new one is never left off;
  // the spectral tools after a separator, as a group of their own.
  const tools = Object.values(ToolId);
  return tools.map((tool, index) => {
    const id = `editor.tool-${tool}`;
    const chosen = state.tool === tool;
    const previous = tools[index - 1];
    const startsSpectral =
      previous !== undefined && isSpectralTool(tool) && !isSpectralTool(previous);
    return [
      startsSpectral && <ControlBarSeparator key={`${tool}-separator`} />,
      <ControlBarItem key={tool}>
        <IconButton
          compact
          icon={TOOL_GLYPHS[tool]}
          label={TOOLS[tool].name}
          tone={chosen ? ButtonTone.Primary : ButtonTone.Quiet}
          pressed={chosen}
          hint={TOOLS[tool].does}
          {...shortcutOf(commands, id)}
          onClick={() => {
            commands.run(id, { view: panel });
          }}
        />
      </ControlBarItem>,
    ];
  });
}

/** The combination mode, each mode a button pressed while it is the view's. */
function CombinationButtons({
  panel,
  state,
  commands,
}: {
  readonly panel: string;
  readonly state: EditorViewState;
  readonly commands: ToolbarCommands;
}): ReactNode {
  return Object.values(SpectralCombination).map((combination) => {
    const id = `editor.spectral-combination-${combination}`;
    const chosen = state.spectralTools.combination === combination;
    return (
      <ControlBarItem key={combination}>
        <IconButton
          compact
          icon={COMBINATION_GLYPHS[combination]}
          label={COMBINATIONS[combination].name}
          tone={chosen ? ButtonTone.Primary : ButtonTone.Quiet}
          pressed={chosen}
          hint={`A shape drawn with no modifier held ${COMBINATIONS[combination].does} the spectral selection.`}
          {...shortcutOf(commands, id)}
          onClick={() => {
            commands.run(id, { view: panel });
          }}
        />
      </ControlBarItem>
    );
  });
}

function ChannelButtons({
  panel,
  asset,
  state,
  commands,
}: {
  readonly panel: string;
  readonly asset: EditorAsset;
  readonly state: EditorViewState;
  readonly commands: ToolbarCommands;
}): ReactNode {
  return channelNames(asset.layout).map((name, channel) => {
    const shown = !state.hiddenChannels.includes(channel);
    return (
      <ControlBarItem key={name}>
        <Button
          compact
          tone={ButtonTone.Quiet}
          // Named by the channel alone, with pressed as shown: named by what a
          // press would do as well, it read "Hide Left, pressed", and a reader
          // could not tell whether the channel was shown or had been hidden.
          aria-pressed={shown}
          onClick={() => {
            commands.run('editor.toggle-channel', { view: panel, channel });
          }}
        >
          {name}
        </Button>
      </ControlBarItem>
    );
  });
}

/** Zoom, and snapping. */
function ZoomBar({
  panel,
  state,
  commands,
}: {
  readonly panel: string;
  readonly state: EditorViewState;
  readonly commands: ToolbarCommands;
}): ReactNode {
  const button = (id: string, label: string, icon: IconName, pressed?: boolean): ReactNode => (
    <ControlBarButton
      label={label}
      icon={icon}
      hint={commands.labelFor(id)}
      {...shortcutOf(commands, id)}
      {...(pressed === undefined ? {} : { pressed })}
      onPress={() => {
        commands.run(id, { view: panel });
      }}
    />
  );
  return (
    <ControlBar label="Zoom">
      {button('editor.zoom-in', 'Zoom in', 'zoom-in')}
      {button('editor.zoom-out', 'Zoom out', 'zoom-out')}
      {button('editor.zoom-to-fit', 'Fit', 'zoom-to-fit')}
      {button('editor.zoom-to-selection', 'Selection', 'zoom-to-selection')}
      <ControlBarSeparator />
      {button('editor.toggle-snapping', 'Snap', 'snap', state.snapping.enabled)}
    </ControlBar>
  );
}

/** The display mode and the time format. */
function Choices({
  panel,
  state,
  commands,
}: {
  readonly panel: string;
  readonly state: EditorViewState;
  readonly commands: ToolbarCommands;
}): ReactNode {
  return (
    <div className="ag-editor-choices">
      <OptionSelect
        label="Display"
        value={state.displayMode}
        options={Object.values(DisplayMode).map((mode) => ({
          value: mode,
          label: DISPLAY_MODES[mode],
          icon: DISPLAY_GLYPHS[mode],
        }))}
        onValueChange={(mode) => {
          commands.run(`editor.display-${mode}`, { view: panel });
        }}
      />
      <OptionSelect
        label="Time"
        value={state.timeFormat.kind}
        options={Object.values(TimeFormatKind).map((kind) => ({
          value: kind,
          label: TIME_FORMATS[kind],
        }))}
        onValueChange={(kind) => {
          commands.run(`editor.time-format-${kind}`, { view: panel });
        }}
      />
    </div>
  );
}

/** An editor view's toolbar. */
export function EditorToolbar({
  panel,
  asset,
  state,
  commands,
}: {
  readonly panel: string;
  readonly asset: EditorAsset;
  readonly state: EditorViewState;
  readonly commands: ToolbarCommands;
}): ReactNode {
  return (
    <div className="ag-editor-toolbars">
      <ControlBar label="Tools">
        <ToolButtons panel={panel} state={state} commands={commands} />
      </ControlBar>
      {isSpectralTool(state.tool) && (
        <ControlBar label="Combination mode">
          <CombinationButtons panel={panel} state={state} commands={commands} />
        </ControlBar>
      )}
      <ZoomBar panel={panel} state={state} commands={commands} />
      <ControlBar label="Channels shown">
        <ChannelButtons panel={panel} asset={asset} state={state} commands={commands} />
      </ControlBar>
      <Choices panel={panel} state={state} commands={commands} />
    </div>
  );
}
