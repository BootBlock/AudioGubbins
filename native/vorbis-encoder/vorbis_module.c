/*
 * The Vorbis encoder module's interface (ADR-0091): libvorbis 1.3.7 with
 * libogg 1.3.6's bit packer, built from the source in third_party/, behind the
 * few calls the codec worker makes.
 *
 * An encoder is created from typed settings and answers Vorbis packets: the
 * three header packets first, then the audio packets each call completes, in
 * its own output buffer with each packet's length, which the caller copies
 * before the next call. The application's Ogg writer frames them, writes the
 * comment header from the export's metadata and states the stream's length,
 * so this module makes no Ogg page. The interface is versioned
 * (ag_vorbis_abi_version), and the caller refuses a module of another version.
 *
 * Channels are given in the speaker mask's bit order, as every encoder the
 * codec worker drives takes them, and are handed to libvorbis in the Vorbis I
 * order of their count (section 4.3.9), one to eight channels.
 *
 * Copyright 2026 AudioGubbins contributors. Licensed under the Apache License,
 * Version 2.0.
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <vorbis/codec.h>
#include <vorbis/vorbisenc.h>

#define EXPORT(name) __attribute__((export_name(name)))

/* The interface's version, raised on any change the caller would notice. */
#define AG_VORBIS_ABI_VERSION 1u

/* The most frames one call takes. */
#define AG_VORBIS_BLOCK_FRAMES 4096

/* The most channels Vorbis I orders. */
#define AG_VORBIS_MAX_CHANNELS 8

/* The packets and bytes the output first holds; it grows as a call needs. */
#define AG_VORBIS_FIRST_PACKETS 64
#define AG_VORBIS_FIRST_BYTES 65536

/* How the encoder is set up, as the export settings name it. */
enum ag_vorbis_mode {
    AG_VORBIS_QUALITY = 0, /* value: libvorbis's quality, -1 to 10 */
    AG_VORBIS_NOMINAL = 1  /* value: the average bit rate held to, kbit/s */
};

/* For each channel of a count in mask order, its index in the Vorbis order. */
static const uint8_t VORBIS_INDEX[AG_VORBIS_MAX_CHANNELS][AG_VORBIS_MAX_CHANNELS] = {
    {0},                      /* mono */
    {0, 1},                   /* left, right */
    {0, 2, 1},                /* left, right, centre */
    {0, 1, 2, 3},             /* left, right, rear pair */
    {0, 2, 1, 3, 4},          /* left, right, centre, surround pair */
    {0, 2, 1, 5, 3, 4},       /* left, right, centre, LFE, surround pair */
    {0, 2, 1, 6, 5, 3, 4},    /* left, right, centre, LFE, rear centre, side pair */
    {0, 2, 1, 7, 5, 6, 3, 4}, /* left, right, centre, LFE, rear pair, side pair */
};

typedef struct ag_vorbis_encoder {
    vorbis_info info;
    vorbis_comment comment;
    vorbis_dsp_state dsp;
    vorbis_block block;
    uint32_t channels;
    int headers_pending;
    float *input[AG_VORBIS_MAX_CHANNELS];
    unsigned char *bytes;
    uint32_t byte_capacity;
    uint32_t byte_count;
    uint32_t *lengths;
    uint32_t packet_capacity;
    uint32_t packet_count;
} ag_vorbis_encoder;

EXPORT("ag_vorbis_abi_version") uint32_t ag_vorbis_abi_version(void) {
    return AG_VORBIS_ABI_VERSION;
}

/* libvorbis's identification of itself, which the comment header's vendor string carries. */
EXPORT("ag_vorbis_version") const char *ag_vorbis_version(void) {
    return vorbis_version_string();
}

EXPORT("ag_vorbis_block_frames") uint32_t ag_vorbis_block_frames(void) {
    return AG_VORBIS_BLOCK_FRAMES;
}

/* Sets libvorbis up for the settings, answering 0 where it takes them. */
static int set_up(vorbis_info *info, uint32_t channels, uint32_t sample_rate, uint32_t mode,
                  float value) {
    switch (mode) {
    case AG_VORBIS_QUALITY:
        if (!(value >= -1.0f && value <= 10.0f)) return -1;
        return vorbis_encode_init_vbr(info, (long)channels, (long)sample_rate, value / 10.0f);
    case AG_VORBIS_NOMINAL:
        if (!(value >= 1.0f && value <= 1000000.0f) || (float)(long)value != value) return -1;
        /* An average held by libvorbis's bit-rate manager, with no hard limit either way. */
        return vorbis_encode_init(info, (long)channels, (long)sample_rate, -1,
                                  (long)value * 1000, -1);
    default:
        return -1;
    }
}

static void release(ag_vorbis_encoder *encoder) {
    for (uint32_t channel = 0; channel < AG_VORBIS_MAX_CHANNELS; channel += 1) {
        free(encoder->input[channel]);
    }
    free(encoder->bytes);
    free(encoder->lengths);
    free(encoder);
}

/*
 * An encoder of `channels` (1 to 8) at `sample_rate`, set up by `mode` and
 * `value`, or NULL where libvorbis refuses the settings or memory runs out.
 */
EXPORT("ag_vorbis_create")
ag_vorbis_encoder *ag_vorbis_create(uint32_t channels, uint32_t sample_rate, uint32_t mode,
                                    float value) {
    if (channels < 1 || channels > AG_VORBIS_MAX_CHANNELS) return NULL;
    ag_vorbis_encoder *encoder = calloc(1, sizeof(ag_vorbis_encoder));
    if (encoder == NULL) return NULL;
    encoder->channels = channels;
    encoder->headers_pending = 1;
    for (uint32_t channel = 0; channel < channels; channel += 1) {
        encoder->input[channel] = calloc(AG_VORBIS_BLOCK_FRAMES, sizeof(float));
        if (encoder->input[channel] == NULL) {
            release(encoder);
            return NULL;
        }
    }
    encoder->bytes = malloc(AG_VORBIS_FIRST_BYTES);
    encoder->lengths = malloc(AG_VORBIS_FIRST_PACKETS * sizeof(uint32_t));
    if (encoder->bytes == NULL || encoder->lengths == NULL) {
        release(encoder);
        return NULL;
    }
    encoder->byte_capacity = AG_VORBIS_FIRST_BYTES;
    encoder->packet_capacity = AG_VORBIS_FIRST_PACKETS;
    vorbis_info_init(&encoder->info);
    if (set_up(&encoder->info, channels, sample_rate, mode, value) != 0) {
        /* Clearing twice is safe where libvorbis's own failed setup cleared it already. */
        vorbis_info_clear(&encoder->info);
        release(encoder);
        return NULL;
    }
    vorbis_comment_init(&encoder->comment);
    if (vorbis_analysis_init(&encoder->dsp, &encoder->info) != 0) {
        vorbis_comment_clear(&encoder->comment);
        vorbis_info_clear(&encoder->info);
        release(encoder);
        return NULL;
    }
    vorbis_block_init(&encoder->dsp, &encoder->block);
    return encoder;
}

/* The plane `channel` (in mask order) is written into before ag_vorbis_encode, or NULL past the last. */
EXPORT("ag_vorbis_input") float *ag_vorbis_input(ag_vorbis_encoder *encoder, uint32_t channel) {
    return channel < encoder->channels ? encoder->input[channel] : NULL;
}

EXPORT("ag_vorbis_output") const unsigned char *ag_vorbis_output(const ag_vorbis_encoder *encoder) {
    return encoder->bytes;
}

/* The length of each packet the last call answered, in order. */
EXPORT("ag_vorbis_packet_lengths")
const uint32_t *ag_vorbis_packet_lengths(const ag_vorbis_encoder *encoder) {
    return encoder->lengths;
}

/* Adds a packet to the output, answering 0, or -1 where memory runs out. */
static int append(ag_vorbis_encoder *encoder, const ogg_packet *packet) {
    uint32_t length = (uint32_t)packet->bytes;
    if (encoder->packet_count == encoder->packet_capacity) {
        uint32_t capacity = encoder->packet_capacity * 2;
        uint32_t *grown = realloc(encoder->lengths, capacity * sizeof(uint32_t));
        if (grown == NULL) return -1;
        encoder->lengths = grown;
        encoder->packet_capacity = capacity;
    }
    if (encoder->byte_capacity - encoder->byte_count < length) {
        uint32_t capacity = encoder->byte_capacity;
        while (capacity - encoder->byte_count < length) capacity *= 2;
        unsigned char *grown = realloc(encoder->bytes, capacity);
        if (grown == NULL) return -1;
        encoder->bytes = grown;
        encoder->byte_capacity = capacity;
    }
    memcpy(encoder->bytes + encoder->byte_count, packet->packet, length);
    encoder->byte_count += length;
    encoder->lengths[encoder->packet_count] = length;
    encoder->packet_count += 1;
    return 0;
}

/*
 * Starts a call's output: the header packets, where none has been answered
 * yet. Answers 0, or a negative status.
 */
static int begin(ag_vorbis_encoder *encoder) {
    encoder->byte_count = 0;
    encoder->packet_count = 0;
    if (!encoder->headers_pending) return 0;
    encoder->headers_pending = 0;
    ogg_packet identification, comment, setup;
    int status =
        vorbis_analysis_headerout(&encoder->dsp, &encoder->comment, &identification, &comment, &setup);
    if (status != 0) return status;
    return append(encoder, &identification) | append(encoder, &comment) | append(encoder, &setup);
}

/* Answers every packet libvorbis has completed: the count, or a negative status. */
static int32_t drain(ag_vorbis_encoder *encoder) {
    ogg_packet packet;
    for (;;) {
        int status = vorbis_analysis_blockout(&encoder->dsp, &encoder->block);
        if (status < 0) return status;
        if (status == 0) return (int32_t)encoder->packet_count;
        status = vorbis_analysis(&encoder->block, NULL);
        if (status == 0) status = vorbis_bitrate_addblock(&encoder->block);
        if (status != 0) return status;
        while ((status = vorbis_bitrate_flushpacket(&encoder->dsp, &packet)) == 1) {
            if (append(encoder, &packet) != 0) return -1;
        }
        if (status < 0) return status;
    }
}

/*
 * Encodes the first `frames` frames of the input planes, answering the count
 * of packets in the output, or a negative status.
 */
EXPORT("ag_vorbis_encode") int32_t ag_vorbis_encode(ag_vorbis_encoder *encoder, uint32_t frames) {
    if (frames > AG_VORBIS_BLOCK_FRAMES) return -100;
    int status = begin(encoder);
    if (status != 0) return status;
    if (frames == 0) return (int32_t)encoder->packet_count;
    float **buffer = vorbis_analysis_buffer(&encoder->dsp, (int)frames);
    const uint8_t *order = VORBIS_INDEX[encoder->channels - 1];
    for (uint32_t channel = 0; channel < encoder->channels; channel += 1) {
        memcpy(buffer[order[channel]], encoder->input[channel], frames * sizeof(float));
    }
    status = vorbis_analysis_wrote(&encoder->dsp, (int)frames);
    if (status != 0) return status;
    return drain(encoder);
}

/* Ends the stream, answering the count of its last packets, or a negative status. */
EXPORT("ag_vorbis_flush") int32_t ag_vorbis_flush(ag_vorbis_encoder *encoder) {
    int status = begin(encoder);
    if (status != 0) return status;
    status = vorbis_analysis_wrote(&encoder->dsp, 0);
    if (status != 0) return status;
    return drain(encoder);
}

EXPORT("ag_vorbis_free") void ag_vorbis_free(ag_vorbis_encoder *encoder) {
    vorbis_block_clear(&encoder->block);
    vorbis_dsp_clear(&encoder->dsp);
    vorbis_comment_clear(&encoder->comment);
    vorbis_info_clear(&encoder->info);
    release(encoder);
}
