/**
 * The modules the build carries for the codec worker (ADR-0091): the codec
 * module, built from the crates, and the MP3 and Vorbis encoder modules, built
 * from their vendored sources.
 *
 * Imported only when the codec worker is first needed, so the page that
 * imports and exports nothing loads none of their bytes; and a module of its
 * own, so nothing else that the page or a test loads names a module only the
 * build makes.
 */

import { CODEC_MODULE_BYTES } from 'virtual:audiogubbins/codec-module';
import { ENCODER_MODULE_BYTES as MP3 } from 'virtual:audiogubbins/mp3-encoder-module';
import { ENCODER_MODULE_BYTES as VORBIS } from 'virtual:audiogubbins/vorbis-encoder-module';

/** Each module's bytes, by the name the page gives it. */
export const BUNDLED_MODULE_BYTES = { codec: CODEC_MODULE_BYTES, mp3: MP3, vorbis: VORBIS };
