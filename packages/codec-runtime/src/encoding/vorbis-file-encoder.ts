/**
 * Ogg Vorbis exports (ADR-0091): libvorbis 1.3.7, the prebuilt module of its
 * own file, which makes the whole Ogg stream; the application's rewriter puts
 * the map's comments in place of the encoder's, keeping its vendor string.
 *
 * The settings map onto the build's interface as follows. A quality, -1 to
 * 10, is libvorbis's variable-rate quality (`vorbis_encode_init_vbr`, at a
 * tenth of it). A nominal bit rate cannot be expressed: the build sets up its
 * encoder by quality alone, never by libvorbis's managed bit rate, so it is
 * refused, never replaced by a quality. The stream's serial number is fixed,
 * where the build would otherwise draw one at random, so the same samples and
 * settings give the same file. libvorbis takes its channels in Vorbis order,
 * which for the one or two channels the build encodes is the speaker mask's.
 */

import {
  OggVorbisCommentRewriter,
  type AudioFileWriter,
  type WrittenChannelOrder,
} from '@audiogubbins/codecs';
import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { VorbisEncoding } from '@audiogubbins/import-export';

import { unexpressible } from './encoding-failures.js';
import type { ExportEncoderRequest } from './export-encoder-request.js';
import { FramedFileWriter } from './framed-file-writer.js';
import type { PrebuiltModule } from './prebuilt-encoder.js';
import { PrebuiltUnits } from './prebuilt-units.js';

/** The serial number of every Vorbis stream AudioGubbins writes: `AGVo`. */
const VORBIS_SERIAL = 0x4147566f;

/** An Ogg Vorbis export's writer, on an instance of libvorbis's module. */
export function openVorbisWriter(
  request: ExportEncoderRequest,
  encoding: VorbisEncoding,
  libvorbis: PrebuiltModule,
  order: WrittenChannelOrder,
): DomainResult<AudioFileWriter> {
  if (encoding.mode === 'bit-rate') {
    return fail(
      unexpressible(
        'Ogg Vorbis at a nominal bit rate cannot be encoded: the libvorbis build AudioGubbins ships (wasm-media-encoders 0.7.0) sets its encoder up by quality alone. Choose a quality.',
        'ogg-vorbis.bit-rate',
      ),
    );
  }
  const encoder = libvorbis.open(order.length, request.sampleRate, [
    { value: encoding.quality, float: true },
    { value: VORBIS_SERIAL, float: false },
  ]);
  if (!encoder.ok) return encoder;
  const framer = new OggVorbisCommentRewriter(request.metadata);
  const units = new PrebuiltUnits<undefined>(encoder.value, order.length, () => undefined);
  return succeed(new FramedFileWriter(units, () => succeed(framer), order));
}
