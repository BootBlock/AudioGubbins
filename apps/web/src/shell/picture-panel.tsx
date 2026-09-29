/**
 * The Picture panel: reference video beside the audio (REQ-AUDIO-156), dockable
 * and able to fill the screen. It shows the picture the reference picture
 * holds, its timecode and frame at the playhead, the frame-rate interpretation,
 * the offset and its calibration, a marker at the frame shown, and the
 * picture's own sound, extracted when the person asks and where the browser can
 * decode it in the memory the page can spare.
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

import { Button, OptionSelect } from '@audiogubbins/design-system';
import { formatPosition, frameRatesEqual, TimeFormatKind } from '@audiogubbins/timeline';
import { pictureFrameAt, pictureTimeAt, pictureTimecodeAt } from '@audiogubbins/video-reference';

import type { EditorAsset } from '../assets/editor-asset.js';
import { FRAME_RATES } from '../commands/picture-commands.js';
import type { PictureState } from '../picture/reference-picture.js';
import {
  NotedButton,
  NotedFileButton,
  ReasonedButton,
  SharedReasonNotes,
  useSharedReasons,
} from './settings/reasoned-button.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import { useDisplayFrame } from './use-display-frame.js';

const FRAMES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

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

/** The timecode and frame at the playhead, read each display frame while the asset plays. */
function Readouts({
  parts,
  asset,
  state,
}: {
  readonly parts: EditorPanelParts;
  readonly asset: EditorAsset;
  readonly state: PictureState;
}): ReactNode {
  const playhead = useDisplayFrame(
    () => parts.stores.playhead(asset),
    parts.stores.playing(asset.id),
  );
  const { binding, media } = state;
  if (binding === undefined) return null;
  const time = pictureTimeAt(binding, playhead);
  const outside =
    time < 0
      ? 'The playhead is before the picture starts.'
      : media.kind === 'ready' && time >= media.duration
        ? 'The playhead is past the end of the picture.'
        : undefined;
  return (
    <>
      {outside !== undefined && <p className="ag-panel-note">{outside}</p>}
      <dl className="ag-readings">
        <div className="ag-reading">
          <dt>Timecode</dt>
          <dd role="timer">{pictureTimecodeAt(binding, playhead)}</dd>
        </div>
        <div className="ag-reading">
          <dt>Frame</dt>
          <dd>{FRAMES.format(pictureFrameAt(binding, playhead))}</dd>
        </div>
        <div className="ag-reading">
          <dt>Picture starts at</dt>
          <dd>
            {formatPosition(binding.offset, asset.sampleRate, { kind: TimeFormatKind.Clock })}
          </dd>
        </div>
      </dl>
    </>
  );
}

/** The picture's commands, by the label each has in the panel. */
const ACTIONS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'picture.nudge-earlier', label: 'A frame earlier' },
  { id: 'picture.nudge-later', label: 'A frame later' },
  { id: 'picture.align-with-playhead', label: 'Line up with the playhead' },
  { id: 'picture.mark-frame', label: 'Marker at this frame' },
  { id: 'picture.bind-to-editor', label: 'Follow the editor in use' },
  { id: 'picture.full-screen', label: 'Full screen' },
  { id: 'picture.close', label: 'Close' },
];

/**
 * The picture's commands as buttons, each in the tab order while it cannot run,
 * with the reason said once above them rather than hidden in a tooltip.
 */
function PictureActions({ parts }: { readonly parts: EditorPanelParts }): ReactNode {
  const reasons = useSharedReasons(
    Object.fromEntries(ACTIONS.map(({ id }) => [id, parts.unavailableReason(id)])),
  );
  return (
    <>
      <SharedReasonNotes reasons={reasons} />
      <div className="ag-picture-actions" role="group" aria-label="Picture">
        {ACTIONS.map(({ id, label }) => (
          <NotedButton
            key={id}
            compact
            reasonId={reasons.idOf(id)}
            onPress={() => {
              parts.run(id);
            }}
          >
            {label}
          </NotedButton>
        ))}
      </div>
    </>
  );
}

/** The control that extracts the picture's sound, with why it cannot beside it. */
function ExtractSound({ parts }: { readonly parts: EditorPanelParts }): ReactNode {
  return (
    <ReasonedButton
      reason={parts.unavailableReason('picture.extract-sound')}
      onPress={() => {
        parts.run('picture.extract-sound');
      }}
    >
      Open its sound as an asset
    </ReasonedButton>
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

/** A picture the browser decoded: shown, read out, and calibrated. */
function ReadyPicture({
  parts,
  asset,
  state,
}: {
  readonly parts: EditorPanelParts;
  readonly asset: EditorAsset | undefined;
  readonly state: PictureState;
}): ReactNode {
  const { binding } = state;
  return (
    <>
      <PictureView parts={parts} />
      {asset === undefined ? (
        <p className="ag-panel-note">The picture follows no asset. Bind it to the editor in use.</p>
      ) : (
        <Readouts parts={parts} asset={asset} state={state} />
      )}
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
      <PictureActions parts={parts} />
      <SoundNote parts={parts} state={state} />
    </>
  );
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
    <section className="ag-panel ag-picture">
      <h2 className="ag-panel-title">{title}</h2>
      <p className="ag-panel-note">
        Reference picture for sound to picture. It follows the audio and is never edited.
      </p>
      {chooser}
      {media.kind === 'loading' && <p role="status">{`Opening ${media.name}…`}</p>}
      {media.kind === 'undecodable' && (
        <p role="alert" data-ag-status="unavailable">
          {`${media.name} cannot be shown: ${media.reason} The audio is not affected.`}
        </p>
      )}
      {media.kind === 'ready' && <ReadyPicture parts={parts} asset={asset} state={state} />}
    </section>
  );
}
