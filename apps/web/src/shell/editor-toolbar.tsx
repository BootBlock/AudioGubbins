/**
 * An editor view's toolbar: its tools, zoom, display mode, time format,
 * snapping and channels (REQ-EDIT-062, REQ-EDIT-065). Every control runs the
 * command of the same name, naming this view, so the toolbar, a key and the
 * palette are one action; a control shows the view's state and holds none.
 */

import type { ReactNode } from 'react';

import {
  Button,
  ButtonTone,
  ControlBar,
  ControlBarButton,
  ControlBarItem,
  OptionSelect,
} from '@audiogubbins/design-system';
import { DisplayMode, ToolId, type EditorViewState } from '@audiogubbins/editor-view';
import { TimeFormatKind } from '@audiogubbins/timeline';

import { channelNames } from '../assets/channel-names.js';
import type { EditorAsset } from '../assets/editor-asset.js';
import { DISPLAY_MODES, TOOLS } from '../commands/editor-presentation-commands.js';
import { TIME_FORMATS } from '../commands/editor-option-commands.js';

/** How the toolbar runs a command, and reads its shortcut and why it cannot run. */
export interface ToolbarCommands {
  readonly run: (id: string, args?: Readonly<Record<string, string | number | boolean>>) => void;
  readonly shortcutFor: (id: string) => string | undefined;
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
  // Every tool, in the order they are declared, so a new one is never left off.
  return Object.values(ToolId).map((tool) => {
    const id = `editor.tool-${tool}`;
    const shortcut = commands.shortcutFor(id);
    return (
      <ControlBarItem key={tool}>
        <Button
          compact
          tone={state.tool === tool ? ButtonTone.Primary : ButtonTone.Quiet}
          aria-pressed={state.tool === tool}
          title={shortcut === undefined ? TOOLS[tool].does : `${TOOLS[tool].does} (${shortcut})`}
          onClick={() => {
            commands.run(id, { view: panel });
          }}
        >
          {TOOLS[tool].name}
        </Button>
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
  const zoom = (id: string, label: string): ReactNode => {
    const shortcut = commands.shortcutFor(id);
    return (
      <ControlBarButton
        label={label}
        {...(shortcut === undefined ? {} : { shortcut })}
        onPress={() => {
          commands.run(id, { view: panel });
        }}
      />
    );
  };
  return (
    <ControlBar label="Zoom">
      {zoom('editor.zoom-in', 'Zoom in')}
      {zoom('editor.zoom-out', 'Zoom out')}
      {zoom('editor.zoom-to-fit', 'Fit')}
      {zoom('editor.zoom-to-selection', 'Selection')}
      <ControlBarItem>
        <Button
          compact
          tone={ButtonTone.Quiet}
          aria-pressed={state.snapping.enabled}
          onClick={() => {
            commands.run('editor.toggle-snapping', { view: panel });
          }}
        >
          Snap
        </Button>
      </ControlBarItem>
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
      <ZoomBar panel={panel} state={state} commands={commands} />
      <Choices panel={panel} state={state} commands={commands} />
      <ControlBar label="Channels shown">
        <ChannelButtons panel={panel} asset={asset} state={state} commands={commands} />
      </ControlBar>
    </div>
  );
}
