/**
 * Ogg Vorbis exports (ADR-0091): libvorbis 1.3.7, the encoder module of its
 * own file (`libvorbis-module.ts`), whose packets the application's Ogg
 * Vorbis writer frames, writing the map's comments with libvorbis's vendor
 * string and ending the stream at the frames the encoder was given.
 */

import {
  OggVorbisWriter,
  type AudioFileWriter,
  type EncodedStreamLength,
  type WrittenChannelOrder,
} from '@audiogubbins/codecs';
import { succeed, type DomainResult } from '@audiogubbins/domain';
import type { VorbisEncoding } from '@audiogubbins/import-export';

import type { ExportEncodeRequest } from '../worker/codec-worker-messages.js';
import { BlockedUnits } from './blocked-units.js';
import { FramedFileWriter } from './framed-file-writer.js';
import type { LibvorbisModule } from './libvorbis-module.js';

/** An Ogg Vorbis export's writer, on an instance of libvorbis's module. */
export function openVorbisWriter(
  request: ExportEncodeRequest,
  encoding: VorbisEncoding,
  libvorbis: LibvorbisModule,
  order: WrittenChannelOrder,
): DomainResult<AudioFileWriter> {
  const encoder = libvorbis.open(order.length, request.sampleRate, encoding);
  if (!encoder.ok) return encoder;
  const framer = new OggVorbisWriter(request.metadata);
  const units = new BlockedUnits<EncodedStreamLength>(
    encoder.value,
    order.length,
    (inputFrames) => ({
      inputFrames,
    }),
  );
  return succeed(new FramedFileWriter(units, () => succeed(framer), order));
}
