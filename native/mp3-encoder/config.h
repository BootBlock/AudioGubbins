/*
 * LAME's build configuration for wasm32-wasi, in place of the config.h its
 * configure script writes, with what that script decides for a host it has no
 * processor-specific case for: the C library's headers and fixed-width types,
 * no assembly or vector code, and neither of the x86 shortcuts
 * (TAKEHIRO_IEEE754_HACK, USE_FAST_LOG). NDEBUG is left undefined, as LAME's
 * own release build leaves it, so its internal checks still stop a corrupt
 * encoder, which the module reports as a trap.
 *
 * Copyright 2026 AudioGubbins contributors. Licensed under the Apache License,
 * Version 2.0.
 */

#ifndef AUDIOGUBBINS_LAME_CONFIG_H
#define AUDIOGUBBINS_LAME_CONFIG_H

#define STDC_HEADERS 1
#define HAVE_ERRNO_H 1
#define HAVE_FCNTL_H 1
#define HAVE_LIMITS_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRING_H 1
#define HAVE_STRINGS_H 1
#define HAVE_UNISTD_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_MEMORY_H 1
#define HAVE_STRCHR 1
#define HAVE_MEMCPY 1
#define PROTOTYPES 1

#define SIZEOF_SHORT 2
#define SIZEOF_INT 4
#define SIZEOF_LONG 4
#define SIZEOF_LONG_LONG 8
#define SIZEOF_FLOAT 4
#define SIZEOF_DOUBLE 8
#define SIZEOF_UNSIGNED_SHORT 2
#define SIZEOF_UNSIGNED_INT 4
#define SIZEOF_UNSIGNED_LONG 4

#define HAVE_INT8_T 1
#define HAVE_INT16_T 1
#define HAVE_INT32_T 1
#define HAVE_INT64_T 1
#define HAVE_UINT8_T 1
#define HAVE_UINT16_T 1
#define HAVE_UINT32_T 1
#define HAVE_UINT64_T 1

/* What configure adds where the C library names no IEEE-754 types. */
typedef float ieee754_float32_t;
typedef double ieee754_float64_t;

#define PACKAGE "lame"
#define LAME_LIBRARY_BUILD 1

#endif
