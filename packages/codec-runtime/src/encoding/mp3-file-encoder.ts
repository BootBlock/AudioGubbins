/**
 * MP3 exports (ADR-0091): LAME 3.100, the encoder module of its own file
 * (`lame-module.ts`), framed by the application's MP3 writer, which writes the
 * ID3v2.4 tag and the LAME information frame that gapless players trim by,
 * naming LAME's version and the delay LAME states.
 */

import {
  Mp3StreamWriter,
  type AudioFileWriter,
  type EncodedStreamLength,
  type WrittenChannelOrder,
} from '@audiogubbins/codecs';
import { flatMapResult, succeed, type DomainResult } from '@audiogubbins/domain';
import type { Mp3Encoding } from '@audiogubbins/import-export';

import type { ExportEncodeRequest } from '../worker/codec-worker-messages.js';
import { BlockedUnits } from './blocked-units.js';
import { FramedFileWriter } from './framed-file-writer.js';
import type { LameModule } from './lame-module.js';

/** An MP3 export's writer, on an instance of LAME's module. */
export function openMp3Writer(
  request: ExportEncodeRequest,
  encoding: Mp3Encoding,
  lame: LameModule,
  order: WrittenChannelOrder,
): DomainResult<AudioFileWriter> {
  const opened = lame.open(order.length, request.sampleRate, encoding);
  if (!opened.ok) return opened;
  const encoder = opened.value;
  const framer = Mp3StreamWriter.create({
    metadata: request.metadata,
    encoderDelay: encoder.encoderDelay,
    encoder: `LAME${lame.version}`,
  });
  if (!framer.ok) encoder.release();
  return flatMapResult(framer, (writer) => {
    const units = new BlockedUnits<EncodedStreamLength>(encoder, order.length, (inputFrames) => ({
      inputFrames,
    }));
    return succeed(new FramedFileWriter(units, () => succeed(writer), order));
  });
}
