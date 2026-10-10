/**
 * MP3 exports (ADR-0091): LAME 3.100, the prebuilt module of its own file,
 * framed by the application's MP3 writer, which writes the ID3v2.4 tag and
 * the LAME information frame that gapless players trim by.
 *
 * The settings map onto the build's interface as follows. A constant bit
 * rate is LAME's `vbr_off` at that rate; a variable one is LAME's default
 * variable mode (`vbr_mtrh`) at the quality asked, 0 to 9. The output rate is
 * the input's, so LAME never resamples what the engine rendered, and a
 * constant rate its MPEG version does not code is refused, since LAME would
 * encode the nearest one it does. An average
 * bit rate (LAME's ABR, `vbr_abr`) cannot be expressed: the build's interface
 * sets only a constant rate or a variable quality, so it is refused, never
 * replaced by either.
 */

import {
  Mp3StreamWriter,
  type AudioFileWriter,
  type EncodedStreamLength,
  type WrittenChannelOrder,
} from '@audiogubbins/codecs';
import { fail, succeed, type DomainResult, type SampleRate } from '@audiogubbins/domain';

import { settingsRefused } from '../codec-status.js';
import { mp3BitRates, type Mp3Encoding } from '@audiogubbins/import-export';

import { unexpressible } from './encoding-failures.js';
import type { ExportEncoderRequest } from './export-encoder-request.js';
import { framedWriter } from './framed-file-writer.js';
import type { PrebuiltModule } from './prebuilt-encoder.js';
import { PrebuiltUnits } from './prebuilt-units.js';

/** LAME's name and version as its information frame states it. */
const LAME_ENCODER = 'LAME3.100';

/** The samples LAME 3.100 puts before the audio (`ENCDELAY`). */
const LAME_ENCODER_DELAY = 576;

/** The build's parameters after the channels and rate: the bit rate, the quality, the output rate. */
function lameParameters(
  encoding: Mp3Encoding,
  sampleRate: SampleRate,
): DomainResult<readonly { readonly value: number; readonly float: boolean }[]> {
  switch (encoding.mode) {
    case 'constant': {
      // LAME takes any rate and encodes the nearest its MPEG version codes, which would
      // be a rate other than the one asked for.
      const rates = mp3BitRates(sampleRate);
      if (!rates.includes(encoding.bitRate)) {
        return fail(
          settingsRefused(
            'MP3 encoder',
            `codes at ${rates.join(', ')} kbit/s at ${String(sampleRate)} Hz, not at ${String(encoding.bitRate)}`,
          ),
        );
      }
      // A quality below zero selects the constant rate.
      return succeed([
        { value: encoding.bitRate, float: false },
        { value: -1, float: true },
        { value: sampleRate, float: false },
      ]);
    }
    case 'variable':
      return succeed([
        { value: 0, float: false },
        { value: encoding.quality, float: true },
        { value: sampleRate, float: false },
      ]);
    case 'average':
      return fail(
        unexpressible(
          'MP3 of average bit rate cannot be encoded: the LAME build AudioGubbins ships (wasm-media-encoders 0.7.0) sets a constant bit rate or a variable quality, not an average bit rate. Choose a constant or a variable bit rate.',
          'mp3.average',
        ),
      );
  }
}

/** An MP3 export's writer, on an instance of LAME's module. */
export function openMp3Writer(
  request: ExportEncoderRequest,
  encoding: Mp3Encoding,
  lame: PrebuiltModule,
  order: WrittenChannelOrder,
): DomainResult<AudioFileWriter> {
  const parameters = lameParameters(encoding, request.sampleRate);
  if (!parameters.ok) return parameters;
  const framer = Mp3StreamWriter.create({
    metadata: request.metadata,
    encoderDelay: LAME_ENCODER_DELAY,
    encoder: LAME_ENCODER,
  });
  if (!framer.ok) return framer;
  const encoder = lame.open(order.length, request.sampleRate, parameters.value);
  if (!encoder.ok) return encoder;
  const units = new PrebuiltUnits<EncodedStreamLength>(
    encoder.value,
    order.length,
    (inputFrames) => ({
      inputFrames,
    }),
  );
  return succeed(framedWriter(units, () => framer, order));
}
