/*
 * libogg's integer types for wasm32-wasi, in place of the config_types.h its
 * configure script writes from config_types.h.in: the C library's fixed-width
 * types, which every host the script supports would also choose.
 *
 * Copyright 2026 AudioGubbins contributors. Licensed under the Apache License,
 * Version 2.0.
 */

#ifndef __CONFIG_TYPES_H__
#define __CONFIG_TYPES_H__

#include <stdint.h>

typedef int16_t ogg_int16_t;
typedef uint16_t ogg_uint16_t;
typedef int32_t ogg_int32_t;
typedef uint32_t ogg_uint32_t;
typedef int64_t ogg_int64_t;
typedef uint64_t ogg_uint64_t;

#endif
