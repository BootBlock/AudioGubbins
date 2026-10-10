/**
 * The modules the build carries for the codec worker (ADR-0091), as the page
 * compiles them: the codec module, built from the crates, and each encoder
 * module, or why this copy carries none.
 *
 * Imported only when the codec worker is first needed, so the page that
 * imports and exports nothing loads none of their bytes; and a module of its
 * own, so nothing else that the page or a test loads names a module only the
 * build makes.
 */

import { CODEC_MODULE_BYTES } from 'virtual:audiogubbins/codec-module';
import { ENCODER_MODULE as MP3_ENCODER } from 'virtual:audiogubbins/mp3-encoder-module';
import { ENCODER_MODULE as VORBIS_ENCODER } from 'virtual:audiogubbins/vorbis-encoder-module';

import type { BundledModule } from './codec-thread.js';

export const CODEC_MODULE: BundledModule = { kind: 'bundled', bytes: CODEC_MODULE_BYTES };
export const MP3_MODULE: BundledModule = MP3_ENCODER;
export const VORBIS_MODULE: BundledModule = VORBIS_ENCODER;
