/**
 * libvorbis 1.3.7's encoder module (`native/vorbis-encoder/vorbis_module.c`):
 * a Vorbis encoder of one to eight channels, opened from the export's Vorbis
 * encoding and answering packets, the three headers first, which the Ogg
 * Vorbis writer frames.
 *
 * A quality, -1 to 10, is libvorbis's variable-rate quality
 * (`vorbis_encode_init_vbr`, at a tenth of it). A nominal bit rate is the
 * average libvorbis's bit-rate manager holds the stream to, with no hard
 * limit either way (`vorbis_encode_init` with the nominal alone, libvorbis's
 * average-bit-rate mode): a person who names a bit rate expects the file's
 * size to follow it, which a quality chosen to approximate it would only do
 * for some material. Channels are given in the speaker mask's order, and the
 * module hands them to libvorbis in the Vorbis order of their count.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { VorbisEncoding } from '@audiogubbins/import-export';

import type { BlockEncoder } from './blocked-units.js';
import {
  cString,
  guarded,
  instantiateEncoderModule,
  type EncoderInstance,
} from './encoder-module.js';
import { encoderModuleFailed } from './encoding-failures.js';

const LIBVORBIS_FUNCTIONS = [
  'version',
  'block_frames',
  'create',
  'input',
  'output',
  'packet_lengths',
  'encode',
  'flush',
  'free',
] as const;

type LibvorbisFunction = (typeof LIBVORBIS_FUNCTIONS)[number];

/** The interface's codes of the setup modes. */
const MODES: Readonly<Record<VorbisEncoding['mode'], number>> = {
  quality: 0,
  'bit-rate': 1,
};

/** One instance of libvorbis's module. */
export class LibvorbisModule {
  readonly #module: EncoderInstance<LibvorbisFunction>;

  private constructor(module: EncoderInstance<LibvorbisFunction>) {
    this.#module = module;
  }

  /** Instantiates the module from its code, refusing one this runtime does not speak to. */
  static async instantiate(
    code: WebAssembly.Module | BufferSource,
  ): Promise<DomainResult<LibvorbisModule>> {
    const module = await instantiateEncoderModule('vorbis', code, LIBVORBIS_FUNCTIONS);
    return module.ok ? succeed(new LibvorbisModule(module.value)) : module;
  }

  /** libvorbis's name for itself, as `Xiph.Org libVorbis 1.3.7`. */
  get version(): string {
    const { memory, call } = this.#module;
    return cString(memory, call('version')());
  }

  /** An encoder of `channels` channels at `sampleRate`, or libvorbis's refusal of the settings. */
  open(
    channels: number,
    sampleRate: number,
    encoding: VorbisEncoding,
  ): DomainResult<LibvorbisSession> {
    const value = encoding.mode === 'quality' ? encoding.quality : encoding.nominalBitRate;
    const create = this.#module.call('create');
    const opened = guarded('ag_vorbis_create', () =>
      create(channels, sampleRate, MODES[encoding.mode], value),
    );
    if (!opened.ok) return opened;
    if (opened.value === 0) {
      return fail(encoderModuleFailed('ag_vorbis_create', 'libvorbis refused the settings'));
    }
    return succeed(new LibvorbisSession(this.#module, opened.value, channels));
  }
}

/** One Vorbis encoder: blocks in, the packets they complete out. */
export class LibvorbisSession implements BlockEncoder {
  readonly #module: EncoderInstance<LibvorbisFunction>;
  readonly #channels: number;
  #handle: number;

  /** The most frames one block holds. */
  readonly blockFrames: number;

  constructor(module: EncoderInstance<LibvorbisFunction>, handle: number, channels: number) {
    this.#module = module;
    this.#handle = handle;
    this.#channels = channels;
    this.blockFrames = module.call('block_frames')();
  }

  encode(planes: readonly Float32Array[], frames: number): DomainResult<readonly Uint8Array[]> {
    if (this.#handle === 0) {
      return fail(encoderModuleFailed('ag_vorbis_encode', 'the encoder was released'));
    }
    const handle = this.#handle;
    const { memory, call } = this.#module;
    return this.#answer(
      'ag_vorbis_encode',
      guarded('ag_vorbis_encode', () => {
        for (let channel = 0; channel < this.#channels; channel += 1) {
          const address = call('input')(handle, channel) >>> 0;
          const plane = planes[channel];
          if (plane !== undefined) {
            new Float32Array(memory.buffer, address, frames).set(plane.subarray(0, frames));
          }
        }
        return call('encode')(handle, frames);
      }),
    );
  }

  flush(): DomainResult<readonly Uint8Array[]> {
    if (this.#handle === 0) {
      return fail(encoderModuleFailed('ag_vorbis_flush', 'the encoder was released'));
    }
    const handle = this.#handle;
    return this.#answer(
      'ag_vorbis_flush',
      guarded('ag_vorbis_flush', () => this.#module.call('flush')(handle)),
    );
  }

  release(): void {
    if (this.#handle === 0) return;
    const handle = this.#handle;
    this.#handle = 0;
    // A trap while freeing leaves nothing to answer for: the instance is dropped with it.
    guarded('ag_vorbis_free', () => this.#module.call('free')(handle));
  }

  /** The packets a call answered, copied out of the module's memory before the next call. */
  #answer(name: string, count: DomainResult<number>): DomainResult<readonly Uint8Array[]> {
    if (!count.ok || count.value < 0) {
      this.release();
      return count.ok
        ? fail(encoderModuleFailed(name, `libvorbis answered status ${String(count.value)}`))
        : count;
    }
    const { memory, call } = this.#module;
    const lengths = new Uint32Array(
      memory.buffer,
      call('packet_lengths')(this.#handle) >>> 0,
      count.value,
    );
    const bytes = new Uint8Array(memory.buffer, call('output')(this.#handle) >>> 0);
    const packets: Uint8Array[] = [];
    let offset = 0;
    for (const length of lengths) {
      packets.push(bytes.slice(offset, offset + length));
      offset += length;
    }
    return succeed(packets);
  }
}
