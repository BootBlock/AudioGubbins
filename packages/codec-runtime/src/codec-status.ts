/**
 * What the codec module's answers mean: a negative answer is one of its
 * failures (`crates/codec-bindings`), each turned here into the failure a
 * caller can act on, with a code that means one thing wherever it is raised.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

/** The module's failures; `BAD_HANDLE` to `EXHAUSTED` in `codec-bindings`. */
const CodecStatus = {
  Done: 0,
  BadHandle: -1,
  TooSmall: -2,
  Unreadable: -3,
  Changed: -4,
  Unrecognised: -5,
  NoAudioTrack: -6,
  Unsupported: -7,
  Malformed: -8,
  Refused: -9,
  Exhausted: -10,
} as const;

/** What each failure is, for the person and for the caller. */
const FAILURES: ReadonlyMap<number, readonly [string, FailureKind, string]> = new Map([
  [
    CodecStatus.BadHandle,
    [
      'codec-runtime.lost-object',
      FailureKind.Unrecoverable,
      'The codec module lost an object it made.',
    ],
  ],
  [
    CodecStatus.TooSmall,
    [
      'codec-runtime.buffer-too-small',
      FailureKind.Unrecoverable,
      'The codec module was given a buffer too small for the call.',
    ],
  ],
  [
    CodecStatus.Unreadable,
    ['codec-runtime.unreadable', FailureKind.Retryable, 'The file could not be read.'],
  ],
  [
    CodecStatus.Changed,
    [
      'codec-runtime.source-changed',
      FailureKind.Conflict,
      'The file changed while it was read, so what was read is not one version of it.',
    ],
  ],
  [
    CodecStatus.Unrecognised,
    [
      'codec-runtime.unrecognised',
      FailureKind.Rejected,
      'The file is in no format the codec module reads.',
    ],
  ],
  [
    CodecStatus.NoAudioTrack,
    ['codec-runtime.no-audio-track', FailureKind.Rejected, 'The file holds no audio.'],
  ],
  [
    CodecStatus.Unsupported,
    [
      'codec-runtime.unsupported',
      FailureKind.Rejected,
      "The file's audio is in a codec, or a form of one, the codec module does not decode.",
    ],
  ],
  [
    CodecStatus.Malformed,
    [
      'codec-runtime.malformed',
      FailureKind.IntegrityViolation,
      "The file breaks its format's rules, or part of its audio will not decode, so none of it is kept.",
    ],
  ],
  [
    CodecStatus.Refused,
    [
      'codec-runtime.refused',
      FailureKind.Rejected,
      'The codec module refused the settings or samples it was given.',
    ],
  ],
  [
    CodecStatus.Exhausted,
    [
      'codec-runtime.exhausted',
      FailureKind.Unrecoverable,
      'The codec module can make no more objects of this kind.',
    ],
  ],
]);

/**
 * The failure a negative answer from the module is, naming the `call` that
 * answered it; `cause` is what the host's read threw, where it threw.
 */
export function codecFailure(status: number, call: string, cause?: string): DomainFailure {
  const known = FAILURES.get(status);
  const details = { call, status, ...(cause === undefined ? {} : { cause }) };
  if (known === undefined) {
    return failure(
      'codec-runtime.unknown-status',
      FailureKind.Unrecoverable,
      `The codec module answered a status this runtime does not know: ${String(status)}.`,
      { details },
    );
  }
  const [code, kind, summary] = known;
  return failure(code, kind, summary, { details });
}

/** The failure of a call on an object already released. */
export function released(object: string): DomainFailure {
  return failure(
    'codec-runtime.released',
    FailureKind.Rejected,
    `The ${object} was released, so it can do no more.`,
  );
}

/** The failure of samples whose planes do not fit the object they are given to. */
export function planesRefused(object: string, problem: string): DomainFailure {
  return failure('codec-runtime.planes-refused', FailureKind.Rejected, `The ${object} ${problem}.`);
}

/** The failure of settings that are not what the object takes. */
export function settingsRefused(object: string, problem: string): DomainFailure {
  return failure(
    'codec-runtime.settings-refused',
    FailureKind.Rejected,
    `The ${object} ${problem}.`,
  );
}

/**
 * Whether `value` is a whole number the ABI's unsigned 32 bits carry: a
 * WebAssembly `i32` takes any number, wrapping what it cannot hold.
 */
export function isWholeU32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}
