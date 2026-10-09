/**
 * The designed failures of reaching the browser's audio input, one code each,
 * so a recording view can say what happened and what the person can do.
 *
 * The browser refuses an input with a `DOMException` whose name says why; each
 * name the specification gives `getUserMedia` maps to one failure here, and any
 * other is a fault rather than a refusal. A failure never carries a device's
 * label, which is personal data (REQ-PRIV-165).
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

/** The failure of a page the browser will not give an input to, because it is not secure. */
export function insecureContext(): DomainFailure {
  return failure(
    'media-input.insecure-context',
    FailureKind.Unrecoverable,
    'Recording needs a secure page, served over HTTPS or from this computer, and this page is not one.',
  );
}

/** The failure of a browser that offers no audio input to a page, or not the part asked for. */
export function unsupported(what: string): DomainFailure {
  return failure(
    'media-input.unsupported',
    FailureKind.Unrecoverable,
    `This browser does not offer ${what}.`,
  );
}

/** The failure of an input the person, or the browser's policy for this page, did not allow. */
function notAllowed(): DomainFailure {
  return failure(
    'media-input.not-allowed',
    FailureKind.Rejected,
    "Permission to use the microphone was refused, by the person or by the browser's settings for this page.",
  );
}

/** The failure of a device that is not there to open. */
function notFound(): DomainFailure {
  return failure(
    'media-input.not-found',
    FailureKind.Rejected,
    'No audio input matching the one asked for is connected.',
  );
}

/** The failure of a device that cannot give what was required of it, naming the constraint. */
function overconstrained(constraint: string): DomainFailure {
  return failure(
    'media-input.overconstrained',
    FailureKind.Rejected,
    'The audio input cannot meet what was required of it.',
    { details: { constraint } },
  );
}

/** The failure of a device that is there but could not be read, as one another program holds is. */
function notReadable(): DomainFailure {
  return failure(
    'media-input.not-readable',
    FailureKind.Retryable,
    'The audio input could not be started; another program may be using it.',
  );
}

/** The failure of a stream that holds no audio track, which an audio request must give. */
export function noAudioTrack(): DomainFailure {
  return failure(
    'media-input.no-audio-track',
    FailureKind.IntegrityViolation,
    'The browser opened the input but gave no audio track to record from.',
  );
}

/** The name of a refusal: a `DOMException`'s, or that of the older form of `OverconstrainedError`. */
function refusalName(error: unknown): string | undefined {
  if (error instanceof DOMException) return error.name;
  // Browsers that predate OverconstrainedError becoming a DOMException throw it as an object of its own.
  if (typeof error === 'object' && error !== null) {
    const name: unknown = Reflect.get(error, 'name');
    if (name === 'OverconstrainedError') return name;
  }
  return undefined;
}

/**
 * The failure a refusal of `getUserMedia` stands for, or `undefined` where what
 * was thrown is no refusal the specification names, which the caller rethrows.
 */
export function refusalOf(error: unknown): DomainFailure | undefined {
  switch (refusalName(error)) {
    // A SecurityError is the page's permissions policy refusing the microphone.
    case 'NotAllowedError':
    case 'SecurityError':
      return notAllowed();
    case 'NotFoundError':
      return notFound();
    case 'OverconstrainedError': {
      const constraint: unknown =
        typeof error === 'object' && error !== null ? Reflect.get(error, 'constraint') : undefined;
      return overconstrained(typeof constraint === 'string' ? constraint : '');
    }
    // Firefox raises AbortError for a device that failed to start, as others raise NotReadableError.
    case 'NotReadableError':
    case 'AbortError':
      return notReadable();
    default:
      return undefined;
  }
}
