/*
 * The MP3 encoder module's interface (ADR-0091): LAME 3.100, built from the
 * source in third_party/lame, behind the few calls the codec worker makes.
 *
 * An encoder is created from typed settings, takes planar float blocks of at
 * most AG_MP3_BLOCK_FRAMES frames written into its own input planes, and
 * answers the MP3 frames each call completes in its own output buffer, which
 * the caller copies before the next call. The interface is versioned
 * (ag_mp3_abi_version), and the caller refuses a module of another version.
 *
 * LAME writes frames alone: no ID3 tag and no information frame, since the
 * application's MP3 writer writes both from the whole stream. The output rate
 * is the input's, so LAME never resamples, and its reports are silenced
 * through its own interface. Settings LAME refuses answer no encoder.
 *
 * Copyright 2026 AudioGubbins contributors. Licensed under the Apache License,
 * Version 2.0.
 */

#include <stdarg.h>
#include <stdint.h>
#include <stdlib.h>

#include "lame.h"

#define EXPORT(name) __attribute__((export_name(name)))

/* The interface's version, raised on any change the caller would notice. */
#define AG_MP3_ABI_VERSION 1u

/* The most frames one call takes. */
#define AG_MP3_BLOCK_FRAMES 4096

/* LAME's own bound on what one call can answer: 1.25 times the frames, and 7,200 bytes. */
#define AG_MP3_OUTPUT_BYTES (AG_MP3_BLOCK_FRAMES * 5 / 4 + 7200)

/* How the bit rate is set, as the export settings name it. */
enum ag_mp3_mode {
    AG_MP3_CONSTANT = 0, /* value: the bit rate, kbit/s */
    AG_MP3_AVERAGE = 1,  /* value: the mean bit rate, kbit/s */
    AG_MP3_VARIABLE = 2  /* value: LAME's VBR quality, 0 the best to 9 */
};

typedef struct ag_mp3_encoder {
    lame_t lame;
    float input[2][AG_MP3_BLOCK_FRAMES];
    unsigned char output[AG_MP3_OUTPUT_BYTES];
} ag_mp3_encoder;

static void silent(const char *format, va_list arguments) {
    (void)format;
    (void)arguments;
}

EXPORT("ag_mp3_abi_version") uint32_t ag_mp3_abi_version(void) {
    return AG_MP3_ABI_VERSION;
}

/* LAME's version, as "3.100", which the information frame names its encoder by. */
EXPORT("ag_mp3_lame_version") const char *ag_mp3_lame_version(void) {
    return get_lame_short_version();
}

EXPORT("ag_mp3_block_frames") uint32_t ag_mp3_block_frames(void) {
    return AG_MP3_BLOCK_FRAMES;
}

/* Whether a bit rate given as a float is a whole, positive number of kbit/s. */
static int whole_kbps(float value) {
    return value >= 1.0f && value <= 1000.0f && (float)(int)value == value;
}

/* Applies the bit-rate settings, answering 0 where LAME takes them. */
static int set_rate(lame_t lame, uint32_t mode, float value) {
    switch (mode) {
    case AG_MP3_CONSTANT:
        if (!whole_kbps(value)) return -1;
        return lame_set_VBR(lame, vbr_off) | lame_set_brate(lame, (int)value);
    case AG_MP3_AVERAGE:
        if (!whole_kbps(value)) return -1;
        return lame_set_VBR(lame, vbr_abr) | lame_set_VBR_mean_bitrate_kbps(lame, (int)value);
    case AG_MP3_VARIABLE:
        if (!(value >= 0.0f && value <= 9.0f)) return -1;
        return lame_set_VBR(lame, vbr_mtrh) | lame_set_VBR_quality(lame, value);
    default:
        return -1;
    }
}

/*
 * An encoder of `channels` (1 or 2) at `sample_rate`, its bit rate set by
 * `mode` and `value`, or NULL where LAME refuses the settings or memory runs
 * out. Two channels are coded as joint stereo, LAME's own choice for stereo.
 */
EXPORT("ag_mp3_create")
ag_mp3_encoder *ag_mp3_create(uint32_t channels, uint32_t sample_rate, uint32_t mode,
                              float value) {
    if (channels < 1 || channels > 2) return NULL;
    ag_mp3_encoder *encoder = calloc(1, sizeof(ag_mp3_encoder));
    if (encoder == NULL) return NULL;
    lame_t lame = lame_init();
    if (lame == NULL) {
        free(encoder);
        return NULL;
    }
    encoder->lame = lame;
    int refused = lame_set_errorf(lame, silent) | lame_set_debugf(lame, silent) |
                  lame_set_msgf(lame, silent) |
                  lame_set_num_channels(lame, (int)channels) |
                  lame_set_in_samplerate(lame, (int)sample_rate) |
                  lame_set_out_samplerate(lame, (int)sample_rate) |
                  lame_set_mode(lame, channels == 1 ? MONO : JOINT_STEREO) |
                  lame_set_bWriteVbrTag(lame, 0) | lame_set_findReplayGain(lame, 0) |
                  set_rate(lame, mode, value);
    lame_set_write_id3tag_automatic(lame, 0);
    if (refused != 0 || lame_init_params(lame) < 0) {
        lame_close(lame);
        free(encoder);
        return NULL;
    }
    return encoder;
}

/* The plane `channel`'s samples are written into before ag_mp3_encode, or NULL past the last. */
EXPORT("ag_mp3_input") float *ag_mp3_input(ag_mp3_encoder *encoder, uint32_t channel) {
    return channel < (uint32_t)lame_get_num_channels(encoder->lame) ? encoder->input[channel]
                                                                      : NULL;
}

EXPORT("ag_mp3_output") const unsigned char *ag_mp3_output(const ag_mp3_encoder *encoder) {
    return encoder->output;
}

/* The samples of delay LAME puts before the audio, which the information frame states. */
EXPORT("ag_mp3_encoder_delay") uint32_t ag_mp3_encoder_delay(const ag_mp3_encoder *encoder) {
    return (uint32_t)lame_get_encoder_delay(encoder->lame);
}

/*
 * Encodes the first `frames` frames of the input planes, answering the bytes
 * written to the output, or a negative LAME error.
 */
EXPORT("ag_mp3_encode") int32_t ag_mp3_encode(ag_mp3_encoder *encoder, uint32_t frames) {
    if (frames > AG_MP3_BLOCK_FRAMES) return -100;
    return lame_encode_buffer_ieee_float(encoder->lame, encoder->input[0], encoder->input[1],
                                         (int)frames, encoder->output, AG_MP3_OUTPUT_BYTES);
}

/* Ends the stream, answering its last bytes' count, or a negative LAME error. */
EXPORT("ag_mp3_flush") int32_t ag_mp3_flush(ag_mp3_encoder *encoder) {
    return lame_encode_flush(encoder->lame, encoder->output, AG_MP3_OUTPUT_BYTES);
}

EXPORT("ag_mp3_free") void ag_mp3_free(ag_mp3_encoder *encoder) {
    lame_close(encoder->lame);
    free(encoder);
}
