/**
 * Sounds the session holds and no project does (ADR-0090, ADR-0021): a
 * compressed file decoded once, as an import decodes it, into the storage's
 * staging rather than into a project, for the editor to open while the
 * session holds it. A reference picture's sound is one: it is the session's,
 * never the project's, so it takes no marker, region or edit.
 *
 * The file is recognised from its bytes and refused, with the reason an import
 * gives, where no codec decodes it here; a file read where it lies is no sound
 * to decode, and is imported instead. The codec worker's analysis of its
 * headers comes next, and the storage's room is checked for the decoded audio
 * before any of it is written, as an import's is. The codec worker decodes it
 * where it lies, and its blocks are written as they arrive into one file of
 * the staging (`rendition-receiving.ts`), 32-bit floats at the stream's own
 * rate, never resampled, never held whole. That data, under the header that
 * makes it a WAV file (`stored-wav.ts`), is read back through the read
 * contract before anything names it, and is the file every thread reads the
 * sound from.
 *
 * Staging is a cache, never a root: storage pressure may give it up, and so
 * does a window starting alone. While any sound is held or being decoded, the
 * area shares the storage-wide lock, so no window starting clears the staging
 * under it; with none held, it shares nothing. A stream refused, failed part
 * way or cancelled keeps nothing, and the codec worker is told; a sound the
 * session lets go is removed.
 */

import type { DecoderIdentity } from '@audiogubbins/codecs';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import type { ExternalFile, MediaSharing } from '@audiogubbins/media-store';
import type { StorageTree } from '@audiogubbins/project-format';

import { describedAs } from './decoded-import.js';
import type { FileDecoding, StreamAnalysis } from './decoded-stream.js';
import { analyseFile, checkRoom, renditionBytes, type StorageRoom } from './import-analysis.js';
import { renditionReadBackDiffers } from './import-failures.js';
import { receiveRendition } from './rendition-receiving.js';
import { sessionSoundPath } from './staging-paths.js';
import { headFloatWav } from './stored-wav.js';

/** What the area works with, each made once by the composition root. */
export interface SessionSoundServices {
  /** The tree the staging lies in. */
  readonly tree: StorageTree;

  /** Tokens no other window draws, which name each sound's file. */
  readonly nextToken: () => string;

  /** The room the storage has left, read before anything is written. */
  readonly room: StorageRoom;

  /** The storage-wide lock, shared while any sound is held or being decoded. */
  readonly sharing: MediaSharing;
}

/** A sound decoded into the staging, held until the session lets it go. */
export interface SessionSound {
  /** What the session names it by, to let it go. */
  readonly token: string;

  /** Where its data lies in the staging: 32-bit floats, interleaved. */
  readonly dataPath: string;

  /** The WAV header that, followed by the data, makes the file its threads read. */
  readonly header: Uint8Array<ArrayBuffer>;

  /** Its own rate, the file's, never resampled. */
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  readonly frames: SampleCount;
  readonly decoder: DecoderIdentity;
}

/** A file read where it lies, which is audio to import, not a sound to decode. */
function readInPlace(): DomainFailure {
  return failure(
    'import.sound-read-in-place',
    FailureKind.Rejected,
    'The file is audio that AudioGubbins reads where it lies rather than decoding, so it is imported as audio, not opened on its own. Import it as audio instead.',
  );
}

/** The sounds the session holds (see the module comment). */
export class SessionSounds {
  readonly #services: SessionSoundServices;
  readonly #held = new Map<string, string>();
  #holding = 0;
  #release: (() => void) | undefined;

  constructor(services: SessionSoundServices) {
    this.#services = services;
  }

  /**
   * Decodes the sound of `file`, through `decoding`, into the staging, and
   * holds it (see the module comment). Rejects with the signal's reason,
   * having kept nothing, where it is cancelled.
   */
  async decode(
    file: ExternalFile,
    decoding: FileDecoding,
    signal?: AbortSignal,
  ): Promise<DomainResult<SessionSound>> {
    const recognised = await analyseFile(file, signal);
    if (!recognised.ok) return recognised;
    if (recognised.value.kind !== 'decode') return fail(readInPlace());
    const analysed = await decoding.analyse(signal);
    if (!analysed.ok) return analysed;
    const analysis = analysed.value;
    const format = { sampleRate: analysis.sampleRate, layout: analysis.layout };
    const bytes = renditionBytes(format, analysis.statedFrames);
    if (!bytes.ok) return bytes;
    const room = await checkRoom(
      bytes.value === undefined
        ? { kind: 'unknown', atLeast: 0 }
        : { kind: 'known', bytes: bytes.value },
      this.#services.room,
      () => undefined,
    );
    if (!room.ok) return room;
    await this.#hold(signal);
    let kept = false;
    try {
      const decoded = await this.#decoded(decoding, analysis, format, signal);
      kept = decoded.ok;
      return decoded;
    } finally {
      if (!kept) this.#let();
    }
  }

  /** Lets go of the sound `token` names, removing its file; nothing where none is held. */
  async discard(token: string): Promise<void> {
    const path = this.#held.get(token);
    if (path === undefined) return;
    this.#held.delete(token);
    try {
      await this.#services.tree.remove(path);
    } finally {
      this.#let();
    }
  }

  /** The stream decoded and written, headed and read back, and held. */
  async #decoded(
    decoding: FileDecoding,
    analysis: StreamAnalysis,
    format: { readonly sampleRate: SampleRate; readonly layout: ChannelLayout },
    signal?: AbortSignal,
  ): Promise<DomainResult<SessionSound>> {
    const started = await decoding.decode(signal);
    if (!started.ok) return started;
    const described = await describedAs(started.value, analysis);
    if (!described.ok) return described;
    const token = this.#services.nextToken();
    const dataPath = sessionSoundPath(token);
    const received = await receiveRendition(
      started.value,
      analysis.layout,
      { tree: this.#services.tree, path: dataPath },
      () => undefined,
      signal,
    );
    if (!received.ok) return received;
    const header = await headFloatWav(
      received.value.data,
      format,
      received.value.frames,
      renditionReadBackDiffers,
      signal,
    );
    if (!header.ok) {
      await received.value.discard();
      return header;
    }
    this.#held.set(token, dataPath);
    return succeed({
      token,
      dataPath,
      header: header.value,
      sampleRate: analysis.sampleRate,
      layout: analysis.layout,
      frames: received.value.frames,
      decoder: analysis.decoder,
    });
  }

  /** Shares the storage-wide lock for one more sound held or being decoded. */
  async #hold(signal?: AbortSignal): Promise<void> {
    if (this.#holding === 0 && this.#release === undefined) {
      this.#release = await this.#services.sharing.share(signal);
    }
    this.#holding += 1;
  }

  /** Lets go of one, and of the lock where no sound is held or being decoded. */
  #let(): void {
    this.#holding -= 1;
    if (this.#holding > 0) return;
    this.#release?.();
    this.#release = undefined;
  }
}
