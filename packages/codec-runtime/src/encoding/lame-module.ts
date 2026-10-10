/**
 * LAME 3.100's encoder module (`native/mp3-encoder/mp3_module.c`): an MP3
 * encoder of one or two channels, opened from the export's MP3 encoding and
 * answering the MP3 frames each block completes.
 *
 * The encoding maps onto LAME exactly: a constant bit rate is LAME's `vbr_off`
 * at that rate, an average one its ABR (`vbr_abr`) at that mean, and a variable
 * one its default variable mode (`vbr_mtrh`) at the quality asked, 0 to 9. The
 * output rate is the input's, so LAME never resamples what the engine rendered,
 * and two channels are coded as joint stereo, LAME's own choice. LAME writes no
 * tag or information frame: the application's MP3 writer writes both from the
 * whole stream.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { Mp3Encoding } from '@audiogubbins/import-export';

import type { BlockEncoder } from './blocked-units.js';
import {
  cString,
  guarded,
  instantiateEncoderModule,
  type EncoderInstance,
} from './encoder-module.js';
import { encoderModuleFailed } from './encoding-failures.js';

const LAME_FUNCTIONS = [
  'lame_version',
  'block_frames',
  'create',
  'input',
  'output',
  'encoder_delay',
  'encode',
  'flush',
  'free',
] as const;

type LameFunction = (typeof LAME_FUNCTIONS)[number];

/** The interface's codes of the bit-rate modes. */
const MODES: Readonly<Record<Mp3Encoding['mode'], number>> = {
  constant: 0,
  average: 1,
  variable: 2,
};

/** One instance of LAME's module. */
export class LameModule {
  readonly #module: EncoderInstance<LameFunction>;

  private constructor(module: EncoderInstance<LameFunction>) {
    this.#module = module;
  }

  /** Instantiates the module from its code, refusing one this runtime does not speak to. */
  static async instantiate(
    code: WebAssembly.Module | BufferSource,
  ): Promise<DomainResult<LameModule>> {
    const module = await instantiateEncoderModule('mp3', code, LAME_FUNCTIONS);
    return module.ok ? succeed(new LameModule(module.value)) : module;
  }

  /** LAME's version, as `3.100`. */
  get version(): string {
    const { memory, call } = this.#module;
    return cString(memory, call('lame_version')());
  }

  /** An encoder of `channels` channels at `sampleRate`, or LAME's refusal of the settings. */
  open(channels: number, sampleRate: number, encoding: Mp3Encoding): DomainResult<LameSession> {
    const value = encoding.mode === 'variable' ? encoding.quality : encoding.bitRate;
    const create = this.#module.call('create');
    const opened = guarded('ag_mp3_create', () =>
      create(channels, sampleRate, MODES[encoding.mode], value),
    );
    if (!opened.ok) return opened;
    if (opened.value === 0) {
      return fail(encoderModuleFailed('ag_mp3_create', 'LAME refused the settings'));
    }
    return succeed(new LameSession(this.#module, opened.value, channels));
  }
}

/** One MP3 encoder: blocks in, the MP3 frames they complete out. */
export class LameSession implements BlockEncoder {
  readonly #module: EncoderInstance<LameFunction>;
  readonly #channels: number;
  #handle: number;

  /** The most frames one block holds. */
  readonly blockFrames: number;

  /** The samples of delay LAME puts before the audio, which the information frame states. */
  readonly encoderDelay: number;

  constructor(module: EncoderInstance<LameFunction>, handle: number, channels: number) {
    this.#module = module;
    this.#handle = handle;
    this.#channels = channels;
    this.blockFrames = module.call('block_frames')();
    this.encoderDelay = module.call('encoder_delay')(handle);
  }

  encode(planes: readonly Float32Array[], frames: number): DomainResult<readonly Uint8Array[]> {
    if (this.#handle === 0)
      return fail(encoderModuleFailed('ag_mp3_encode', 'the encoder was released'));
    const handle = this.#handle;
    const { memory, call } = this.#module;
    return this.#answer(
      'ag_mp3_encode',
      guarded('ag_mp3_encode', () => {
        for (let channel = 0; channel < this.#channels; channel += 1) {
          const address = call('input')(handle, channel) >>> 0;
          const plane = planes[channel];
          if (plane !== undefined)
            new Float32Array(memory.buffer, address, frames).set(plane.subarray(0, frames));
        }
        return call('encode')(handle, frames);
      }),
    );
  }

  flush(): DomainResult<readonly Uint8Array[]> {
    if (this.#handle === 0)
      return fail(encoderModuleFailed('ag_mp3_flush', 'the encoder was released'));
    const handle = this.#handle;
    return this.#answer(
      'ag_mp3_flush',
      guarded('ag_mp3_flush', () => this.#module.call('flush')(handle)),
    );
  }

  release(): void {
    if (this.#handle === 0) return;
    const handle = this.#handle;
    this.#handle = 0;
    // A trap while freeing leaves nothing to answer for: the instance is dropped with it.
    guarded('ag_mp3_free', () => this.#module.call('free')(handle));
  }

  /** The bytes a call answered, copied out of the module's memory before the next call. */
  #answer(name: string, length: DomainResult<number>): DomainResult<readonly Uint8Array[]> {
    if (!length.ok || length.value < 0) {
      this.release();
      return length.ok
        ? fail(encoderModuleFailed(name, `LAME answered status ${String(length.value)}`))
        : length;
    }
    if (length.value === 0) return succeed([]);
    const { memory, call } = this.#module;
    const address = call('output')(this.#handle) >>> 0;
    return succeed([new Uint8Array(memory.buffer, address, length.value).slice()]);
  }
}
