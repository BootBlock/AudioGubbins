/**
 * The Picture panel: reference video beside the audio (REQ-AUDIO-156), dockable
 * and able to fill the screen. It shows the picture the reference picture
 * holds, its timecode at the playhead over the picture's corner, the frame
 * there and where the picture starts, the frame-rate interpretation, the offset
 * and its calibration, a marker at the frame shown, and the picture's own
 * sound, extracted when the person asks and where the browser can decode it in
 * the memory the page can spare.
 *
 * While it is open it keeps the picture on the transport: it hands the
 * reference picture the audible position of the asset the picture is bound to,
 * each display frame while the asset plays and each time the playhead or the
 * binding moves while it is parked, and the binding's policy corrects the
 * picture within a frame while playing and exactly while parked (ADR-0046). A
 * file the browser cannot decode is said with the reason, and the audio is
 * untouched.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import { Button, EmptyState, Hint, OptionSelect, PanelHeader } from '@audiogubbins/design-system';
import { frameRatesEqual } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import { FRAME_RATES } from '../commands/picture-commands.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import type { PictureState } from '../picture/reference-picture.js';
import { CommandButton } from './command-button.js';
import { Readouts, Timecode } from './picture-readouts.js';
import { NotedFileButton } from './settings/reasoned-button.js';

/** The picture's element, placed in the panel while it is open. */
function PictureView({ parts }: { readonly parts: EditorPanelParts }): ReactNode {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = holder.current;
    if (element === null) return undefined;
    element.append(parts.picture.element);
    return () => {
      parts.picture.element.remove();
    };
  }, [parts]);
  return <div ref={holder} className="ag-picture-frame" />;
}

/**
 * Keeps the picture on the transport's clock while the panel is open: each
 * display frame while the asset plays, since the position moves every frame,
 * and parked, only when the playhead, the transport or the binding changes, so
 * an idle page runs nothing.
 */
function useFollowing(
  parts: EditorPanelParts,
  asset: EditorAsset | undefined,
  playing: boolean,
): void {
  useEffect(() => {
    if (asset === undefined) return undefined;
    const follow = (): void => {
      parts.picture.follow(parts.stores.playhead(asset), playing ? 'playing' : 'parked');
    };
    if (!playing) {
      follow();
      const stops = [
        parts.stores.cues.subscribe(follow),
        parts.stores.audio.subscribe(follow),
        parts.picture.subscribe(follow),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    }
    let request = requestAnimationFrame(function each() {
      follow();
      request = requestAnimationFrame(each);
    });
    return () => {
      cancelAnimationFrame(request);
    };
  }, [parts, asset, playing]);
}

/** One of the picture's commands in its bar, drawn as its command's glyph. */
interface PictureCommand {
  readonly id: string;
  readonly label: string;
}

/** The picture's commands in its bar, by the label each has in the panel. */
const ACTIONS: readonly PictureCommand[] = [
  { id: 'picture.nudge-earlier', label: 'A frame earlier' },
  { id: 'picture.nudge-later', label: 'A frame later' },
  { id: 'picture.align-with-playhead', label: 'Line up with the playhead' },
  { id: 'picture.mark-frame', label: 'Marker at this frame' },
  { id: 'picture.bind-to-editor', label: 'Follow the editor in use' },
  { id: 'picture.full-screen', label: 'Full screen' },
];

/**
 * One of the picture's commands as its glyph. While it cannot run it stays in
 * the tab order, described by its reason, which opens on hover or focus
 * (ADR-0013).
 */
function PictureAction({
  command,
  parts,
}: {
  readonly command: PictureCommand;
  readonly parts: EditorPanelParts;
}): ReactNode {
  return <CommandButton id={command.id} label={command.label} commands={parts} compact iconOnly />;
}

/** The picture's bar: its commands, then how its frames are read. */
function PictureBar({
  parts,
  state,
}: {
  readonly parts: EditorPanelParts;
  readonly state: PictureState;
}): ReactNode {
  const { binding } = state;
  return (
    <div className="ag-picture-bar">
      <div className="ag-picture-actions" role="group" aria-label="Picture">
        {ACTIONS.map((command) => (
          <PictureAction key={command.id} command={command} parts={parts} />
        ))}
      </div>
      <OptionSelect
        label="Frame rate"
        value={
          FRAME_RATES.find(
            (each) => binding !== undefined && frameRatesEqual(each.rate, binding.frames),
          )?.key ?? ''
        }
        options={FRAME_RATES.map(({ key, name }) => ({ value: key, label: name }))}
        onValueChange={(key) => {
          parts.run(`picture.frame-rate-${key}`);
        }}
      />
    </div>
  );
}

/** The control that extracts the picture's sound, unavailable with its reason. */
function ExtractSound({ parts }: { readonly parts: EditorPanelParts }): ReactNode {
  return (
    <CommandButton
      id="picture.extract-sound"
      label="Open its sound as an asset"
      commands={parts}
      compact
    />
  );
}

/** What the panel says of the picture's own sound, and the control that extracts it. */
function SoundNote({
  parts,
  state,
}: {
  readonly parts: EditorPanelParts;
  readonly state: PictureState;
}) {
  const { sound } = state;
  switch (sound.kind) {
    case 'none':
      return <ExtractSound parts={parts} />;
    case 'decoding':
      return <p className="ag-panel-note">Decoding the picture’s sound…</p>;
    case 'unavailable':
      return (
        <>
          <p className="ag-panel-note">{sound.reason}</p>
          <ExtractSound parts={parts} />
        </>
      );
    case 'decoded': {
      const view = parts.stores.editorViews.get().focused;
      return (
        <p className="ag-panel-note">
          The picture’s sound is open as an asset.{' '}
          {view !== undefined && (
            <Button
              compact
              onClick={() => {
                parts.run('editor.open-asset', { view, asset: sound.asset });
              }}
            >
              Show it in the editor in use
            </Button>
          )}
        </p>
      );
    }
  }
}

/** A picture the browser decoded: shown with its timecode, its bar, read out, and its sound. */
function ReadyPicture({
  parts,
  asset,
  state,
}: {
  readonly parts: EditorPanelParts;
  readonly asset: EditorAsset | undefined;
  readonly state: PictureState;
}): ReactNode {
  return (
    <>
      <div className="ag-picture-wrap">
        <PictureView parts={parts} />
        {asset !== undefined && <Timecode parts={parts} asset={asset} state={state} />}
      </div>
      <PictureBar parts={parts} state={state} />
      {asset === undefined ? (
        <p className="ag-panel-note">The picture follows no asset. Bind it to the editor in use.</p>
      ) : (
        <Readouts parts={parts} asset={asset} state={state} />
      )}
      <SoundNote parts={parts} state={state} />
    </>
  );
}

/** The panel's body for the picture it holds: none yet, one opening, one it cannot show, or one shown. */
function PictureBody({
  parts,
  asset,
  state,
  chooser,
}: {
  readonly parts: EditorPanelParts;
  readonly asset: EditorAsset | undefined;
  readonly state: PictureState;
  readonly chooser: ReactNode;
}): ReactNode {
  const { media } = state;
  switch (media.kind) {
    case 'none':
      return (
        <EmptyState
          icon="picture"
          title="No picture open"
          text="Open a video to see it beside the audio."
          actions={chooser}
        />
      );
    case 'loading':
      return <p role="status" className="ag-panel-note">{`Opening ${media.name}…`}</p>;
    case 'undecodable':
      return (
        <p role="alert" className="ag-picture-refused">
          {`${media.name} cannot be shown: ${media.reason} The audio is not affected.`}
        </p>
      );
    case 'ready':
      return <ReadyPicture parts={parts} asset={asset} state={state} />;
  }
}

/** The Picture panel. */
export function PicturePanel({
  title,
  parts,
}: {
  readonly title: string;
  readonly parts: EditorPanelParts;
}): ReactNode {
  const state = useSyncExternalStore(parts.picture.subscribe, parts.picture.get);
  useSyncExternalStore(parts.stores.audio.subscribe, parts.stores.audio.get);
  // Binding and marking a frame read the editor in use.
  useSyncExternalStore(parts.stores.editorViews.subscribe, parts.stores.editorViews.get);
  const asset = state.asset === undefined ? undefined : parts.assets.find(state.asset);
  useFollowing(
    parts,
    state.media.kind === 'ready' ? asset : undefined,
    asset !== undefined && parts.stores.playing(asset.id),
  );
  const { media } = state;
  const chooser = (
    <NotedFileButton
      reasonId={undefined}
      accept="video/*"
      onFile={(file) => {
        parts.run('picture.open', { file: parts.chosenFiles.offer(file) });
      }}
    >
      {media.kind === 'none' ? 'Open a video' : 'Open another video'}
    </NotedFileButton>
  );
  return (
    <section className="ag-panel ag-processing-panel ag-picture">
      <PanelHeader
        title={title}
        icon="picture"
        actions={
          <>
            <Hint label="About the picture">
              <p>
                Reference picture for sound to picture. It follows the audio and is never edited.
              </p>
            </Hint>
            {media.kind !== 'none' && chooser}
            <CommandButton id="picture.close" label="Close" commands={parts} iconOnly />
          </>
        }
      />
      <div className="ag-panel-body">
        <PictureBody parts={parts} asset={asset} state={state} chooser={chooser} />
      </div>
    </section>
  );
}
