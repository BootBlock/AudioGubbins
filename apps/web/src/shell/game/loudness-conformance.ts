/**
 * How a member's loudness stands against the target its policy resolves to
 * (ADR-0101): the conformance report's verdict, in words, from the reading of
 * this session and the identity of the member's audio now.
 *
 * A member conforms where its integrated loudness is within the target's
 * tolerance and, where the target sets a ceiling, its true peak is under it.
 * A reading of audio that has changed since is stale and says so, rather than
 * standing for audio it did not read. Every verdict is told in words and by the
 * glyph of its kind, never by a colour alone.
 */

import { VerdictKind } from '@audiogubbins/design-system';
import type { LoudnessTarget } from '@audiogubbins/game-audio';

import type { LoudnessReading } from '../../state/loudness-store.js';
import { signed } from './game-words.js';

/** A member's loudness against its target. */
export type Conformance =
  | { readonly kind: 'no-target' }
  | { readonly kind: 'unmeasured' }
  | { readonly kind: 'measuring'; readonly percent: number }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'stale' }
  | { readonly kind: 'silent' }
  | { readonly kind: 'conforms'; readonly lufs: number }
  | { readonly kind: 'too-loud'; readonly lufs: number; readonly by: number }
  | { readonly kind: 'too-quiet'; readonly lufs: number; readonly by: number }
  | { readonly kind: 'peaks-over'; readonly peak: number; readonly by: number };

/**
 * The verdict of `reading` against `target`, for audio whose identity is now
 * `identity`, or `undefined` where it cannot be heard.
 */
export function conformance(
  target: LoudnessTarget | undefined,
  reading: LoudnessReading | undefined,
  identity: string | undefined,
): Conformance {
  if (target === undefined) return { kind: 'no-target' };
  if (reading === undefined) return { kind: 'unmeasured' };
  switch (reading.kind) {
    case 'queued':
      return { kind: 'measuring', percent: 0 };
    case 'measuring':
      return {
        kind: 'measuring',
        percent:
          reading.framesTotal === 0
            ? 0
            : Math.floor((100 * reading.framesRead) / reading.framesTotal),
      };
    case 'failed':
      return { kind: 'failed', reason: reading.reason };
    case 'measured':
      break;
  }
  if (identity !== reading.identity) return { kind: 'stale' };
  const { integratedLufs, truePeakDbtp } = reading.measurement;
  if (integratedLufs === undefined) return { kind: 'silent' };
  const ceiling = target.truePeakCeilingDbtp;
  if (ceiling !== undefined && truePeakDbtp !== undefined && truePeakDbtp > ceiling) {
    return { kind: 'peaks-over', peak: truePeakDbtp, by: truePeakDbtp - ceiling };
  }
  const off = integratedLufs - target.integratedLufs;
  if (off > target.toleranceLu) return { kind: 'too-loud', lufs: integratedLufs, by: off };
  if (-off > target.toleranceLu) return { kind: 'too-quiet', lufs: integratedLufs, by: -off };
  return { kind: 'conforms', lufs: integratedLufs };
}

/** A verdict in words, which say it without the glyph or the colour beside them. */
export function conformanceWords(verdict: Conformance): string {
  switch (verdict.kind) {
    case 'no-target':
      return 'No loudness target';
    case 'unmeasured':
      return 'Not measured';
    case 'measuring':
      return `Measuring, ${String(verdict.percent)}%`;
    case 'failed':
      return `Not measured: ${verdict.reason}`;
    case 'stale':
      return 'Changed since it was measured; measure again';
    case 'silent':
      return 'Too quiet to measure';
    case 'conforms':
      return `Conforms at ${signed(verdict.lufs)} LUFS`;
    case 'too-loud':
      return `Too loud: ${signed(verdict.lufs)} LUFS, ${signed(verdict.by)} LU over`;
    case 'too-quiet':
      return `Too quiet: ${signed(verdict.lufs)} LUFS, ${signed(verdict.by)} LU under`;
    case 'peaks-over':
      return `Peaks at ${signed(verdict.peak)} dBTP, ${signed(verdict.by)} dB over the ceiling`;
  }
}

/**
 * The kind of check a verdict is, whose glyph is drawn before its words: a
 * reading that cannot stand for the audio now, or could not be taken, warns,
 * and nothing to measure against is no verdict at all.
 */
export const CONFORMANCE_VERDICTS: Readonly<Record<Conformance['kind'], VerdictKind>> = {
  'no-target': VerdictKind.None,
  unmeasured: VerdictKind.None,
  measuring: VerdictKind.Running,
  failed: VerdictKind.Warns,
  stale: VerdictKind.Warns,
  silent: VerdictKind.Warns,
  conforms: VerdictKind.Passes,
  'too-loud': VerdictKind.Fails,
  'too-quiet': VerdictKind.Fails,
  'peaks-over': VerdictKind.Fails,
};
