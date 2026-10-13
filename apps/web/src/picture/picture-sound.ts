/**
 * The sound of a reference picture, opened as an asset (REQ-AUDIO-156's
 * extraction of embedded audio "where technically practical"), so it can be
 * shown in an editor view beside the picture.
 *
 * It is the session's, never the project's (ADR-0021): it takes no marker,
 * region or edit, and importing the file is how its sound joins a project. It
 * is extracted only when the person asks, and takes the path an import takes,
 * but into the storage's staging rather than into a project: the codec worker
 * is made ready, then the storage worker has it recognise the file from its
 * bytes and analyse it, refusing it with the reason an import gives, checks
 * its room for the decoded audio, and writes the stream the codec worker
 * decodes, at the sound's own rate, never resampled, as a WAV file of its own
 * (`session-sounds.ts` in the storage). The editor reads that file as it reads
 * any stored asset, in ranges on each thread that reads it, so no sample of it
 * passes through the page and nothing of it is held whole.
 *
 * Where this browser keeps nothing, there is nowhere to decode it into, and it
 * is refused with the reason. A sound abandoned while it is decoded keeps
 * nothing; one opened stays the session's, held in the staging until the page
 * closes or the same picture's sound is opened again, which takes its place.
 */

import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { ENGINE_VERSIONS, PcmDescriptionKind, type MediaEntry } from '@audiogubbins/audio-engine';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  AssetOrigin,
  assetPlan,
  channelCount,
  type Asset,
  type AssetId,
  type IdGenerator,
} from '@audiogubbins/domain';
import type { HeldSound, ImportsClient } from '@audiogubbins/storage-runtime';

import { revisionOf, type EditorAsset } from '../assets/editor-asset.js';
import type { CodecServices } from '../codecs/codec-services.js';
import { pageFileOf } from '../io/page-files.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import { sampleRateWords } from '../wording.js';
import type { ReferencePicture } from './reference-picture.js';

/** The storage worker's holding of the session's sounds. */
type SoundHolding = Pick<ImportsClient, 'holdSound' | 'letGoSound'>;

/** Why a browser that keeps nothing cannot open a picture's sound. */
const NOWHERE =
  'This browser keeps no storage for AudioGubbins, and a picture’s sound is decoded into that storage before it is opened, so it cannot be opened here.';

/** Why a picture's sound takes no marker, region or edit. */
const SESSION_ONLY =
  'The sound of a reference picture is not part of a project, so it cannot be marked or edited. Import the file as audio to mark and edit it.';

/** What the person knows a picture's sound by, the same for each opening of one file. */
function soundId(file: File): string {
  return `picture-sound:${file.name}:${String(file.size)}:${String(file.lastModified)}`;
}

/** The file a sound's plan reads, `held`, as the asset `record` it is read as. */
function heldMedia(record: Asset, held: HeldSound): MediaEntry {
  return {
    asset: record.id,
    // The held file, which names this decoding of the sound alone.
    identity: record.storageKey,
    sampleRate: held.sampleRate,
    channels: channelCount(held.layout),
    length: held.frames,
    file: held.file,
  };
}

/**
 * The asset the sound `held` makes of `file`, read from the file the storage
 * holds it in, under the identity `asset`; or why it makes none.
 */
export function pictureSoundAsset(
  file: File,
  held: HeldSound,
  asset: AssetId,
): EditorAsset | string {
  const record: Asset = {
    id: asset,
    displayName: `Sound of ${file.name}`,
    origin: AssetOrigin.Imported,
    sampleRate: held.sampleRate,
    channelLayout: held.layout,
    length: held.frames,
    storageKey: `session-sound:${held.token}`,
    edits: [],
  };
  const plan = assetPlan(record, {
    chains: new Map(),
    takeStacks: new Map(),
    assets: new Map([[asset, record]]),
    catalogue: PROCESSOR_CATALOGUE,
    engine: ENGINE_VERSIONS,
  });
  if (!plan.ok) return plan.failures[0].summary;
  const media = [heldMedia(record, held)];
  const { decoder } = held;
  const id = soundId(file);
  const content = `${id}:${String(held.frames)}:${String(channelCount(held.layout))}:${String(held.sampleRate)}:${decoder.name} ${decoder.version}`;
  return {
    id,
    name: record.displayName,
    description: `The sound of the reference picture, decoded by ${decoder.name} ${decoder.version} at its own rate of ${sampleRateWords(held.sampleRate)}.`,
    sampleRate: held.sampleRate,
    layout: held.layout,
    length: held.frames,
    content,
    revision: revisionOf(content),
    describe: () => ({
      kind: PcmDescriptionKind.Edited,
      sampleRate: held.sampleRate,
      plan: plan.value,
      media,
    }),
    // A picture's sound has no chain to run.
    unracked: undefined,
    original: undefined,
    owner: { kind: 'session', reason: SESSION_ONLY },
    markers: [],
    regions: [],
  };
}

/** What the decoder of pictures' sound is made with. */
interface DecoderOptions {
  readonly codecs: Pick<CodecServices, 'ready'>;
  /** The storage worker's holding of sounds, or `undefined` where this browser keeps nothing. */
  readonly sounds: SoundHolding | undefined;
  readonly ids: IdGenerator;
  readonly picture: ReferencePicture;
  readonly catalogue: AssetCatalogue;
  readonly logger: Logger;
}

/** Opens a picture's sound when asked, one at a time (see the module comment). */
export class PictureSoundDecoder {
  readonly #options: DecoderOptions;
  /** The token each open sound is held by, by the identity of its asset. */
  readonly #held = new Map<string, string>();
  #current: AbortController | undefined;

  constructor(options: DecoderOptions) {
    this.#options = options;
  }

  /** Opens the sound of `file` as an asset, abandoning any opening before. */
  decode(file: File): void {
    this.#current?.abort();
    const controller = new AbortController();
    this.#current = controller;
    void this.#open(file, controller.signal);
  }

  /** Abandons the sound being opened, which keeps nothing of it. */
  abandon(): void {
    this.#current?.abort();
    this.#current = undefined;
  }

  /** Opens the sound of `file`, telling the picture how it went, unless `signal` abandons it. */
  async #open(file: File, signal: AbortSignal): Promise<void> {
    const { codecs, sounds, ids, picture, catalogue, logger } = this.#options;
    // Read afresh after each wait, since the picture may be closed during it.
    const abandoned = (): boolean => signal.aborted;
    const unavailable = (reason: string): void => {
      logger.info('A reference picture’s sound was not opened.', { reason });
      picture.soundIs({ kind: 'unavailable', reason });
    };
    if (sounds === undefined) {
      unavailable(NOWHERE);
      return;
    }
    picture.soundIs({ kind: 'decoding' });
    const ready = await codecs.ready();
    if (abandoned()) return;
    if (!ready.ok) {
      unavailable(ready.failures[0].summary);
      return;
    }
    // Lent as itself, as a file chosen alone is: the worker reads it where it lies.
    const held = await sounds.holdSound(
      pageFileOf({
        file,
        fileName: file.name,
        mediaType: file.type,
        lastModified: file.lastModified,
      }),
      signal,
    );
    if (abandoned()) {
      // Answered as the abandoning crossed: what was held is let go.
      if (held.ok) await sounds.letGoSound(held.value.token);
      return;
    }
    if (!held.ok) {
      unavailable(held.failures[0].summary);
      return;
    }
    const asset = pictureSoundAsset(file, held.value, ids.next<'AssetId'>());
    if (typeof asset === 'string') {
      await sounds.letGoSound(held.value.token);
      unavailable(asset);
      return;
    }
    const before = this.#held.get(asset.id);
    this.#held.set(asset.id, held.value.token);
    catalogue.add(asset);
    picture.soundIs({ kind: 'decoded', asset: asset.id });
    // The sound it takes the place of is read by no view now.
    if (before !== undefined) await sounds.letGoSound(before);
  }
}
