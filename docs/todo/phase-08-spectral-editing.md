> **Status:** In progress. 2026-10-10: Phase 08 is `READY` (`d957834e`); the
> domain, timeline, persistence, engine, STFT window and field batch slices
> are committed on `phase-08-spectral`. Five architecture tests fail until
> later slices use the new exports, listed below.

# Phase 08 — Spectral Editing

Resume note. It says where the work is, what is decided and what is left. The
packet is `docs/spec/phases/phase-08-spectral-editing.md`, and the decisions
that shape the work are `ADR-0080`, `ADR-0081` and `ADR-0082`.

## Where the work is

|        |                                                                   |
| ------ | ----------------------------------------------------------------- |
| Branch | `phase-08-spectral`, worktree `../AudioGubbins-phase-08-spectral` |
| Base   | `main` at `1c357d0e`                                              |

## Gates

Light gates (owner decision, 2026-10-07): `pnpm run verify:commit` for every
change, `pnpm run spec:verify` after an edit under `docs/spec/`, and the
packet's commands at the phase's end. The review lenses the packet names are
deferred to the review after the whole specification is built. The author of
a new test sees it fail once against the code it guards.

## Decisions taken in the build

1. **Gains are linear factors.** As a level edit's gain is, `attenuate` and
   `isolate` keep a factor from 0 to just below 1, converted from the
   person's decibels where they are typed; `attenuate` at 0 is "remove".
   `ADR-0081`'s wording "by a reduction in decibels" must be amended to say
   so.
2. **Strokes soften by their own hardness**; the mask's feather softens
   rectangles and polygons only, and is none or both components above
   nothing. `ADR-0081`'s mask clause must be amended to say so.
3. **A spectral edit's `process` chain runs inside the spectral stream**,
   through the frames' own window, rather than as a plan stream of its own,
   so the stream's segments are read once. A parameter changed while it
   plays is heard once the plan is read again.
4. **`editChain`** is the one account of which edits name a chain; the rack
   commands treat a spectral `process` edit's chain as a rack edit's.
5. **Spectral edits are bypassed with the chains** in `bypassedAssetPlan`,
   for A/B.
6. **The timeline's facet is the domain's `SpectralMask`**;
   `withSpectralShape` joins a tool's shape by replacing, adding (Shift) or
   subtracting (Alt).

## Done

- Readiness: ADRs, packet, ledger (`d957834e`).
- Domain, timeline, project-format, project-commands, history words and the
  Inspector's words (`1714422f`).
- Engine realisation: `spectral/` and `pcm/spectral-content.ts`, plan
  readers, the preview's stream key and pass memory (`9445b57c`).
- STFT window on `p08-stft` (`c22898af`, `8b48c2fc`): ABI 6 to 7,
  `StftSettings.window` required, `dependency-rules.test.ts` probe pattern
  changed so `typeof StftWindow` is not taken for a browser probe.
- The renderer's field batch on WebGPU, WebGL2 and Canvas 2D (`p08-field`).
- Both merged (`f73fc31e`, `20e79c04`), their failures settled (`bc5d602a`),
  and `ADR-0081` amended for linear gains and stroke softness (`d4251292`).

## Architecture failures that settle with later slices

Five `pnpm test:architecture` failures are expected until the slices that
consume the new exports land:

- `package-exports.test.ts`: `@audiogubbins/timeline` exports
  `SpectralCombination`, `withSpectralMask` and `withSpectralShape` that
  nothing uses yet; its listed reason still names `withSpectralArea`. The
  spectral tools use them, and then the listing goes.
- The same test, `@audiogubbins/domain`: thirteen spectral exports are used
  only inside the domain. Each ends used by a consumer, or unexported.
- `dependency-rules.test.ts` cohesion, three cases:
  `packages/domain/src/index.ts` is 420 logical lines (threshold 400). Once
  the export set is final, trim it, and record a reviewed exception if it is
  still past 400. The threshold never rises.

The three failures the merge left are settled (`bc5d602a`): the heal test's
mask covers every frame holding the burst, the deepest fixtures gain
`chainedSpectralEdit`, and `WRITTEN_PLAN_DEPTH` is the larger of
6 + the chain depth and 5 + `WRITTEN_MASK_DEPTH`.

## Left

1. Remove the merged worktrees `../AudioGubbins-p08-stft` and
   `../AudioGubbins-p08-field` and their branches at the end.
2. project-format round-trip tests of spectral edits (chain, region, plan)
   and `projectDocument` 7 to 8 (`version.json`, `pnpm version:sync`).
3. The golden suite: `pnpm test:spectral-golden` (add the script), every
   operation's fingerprint from the reference and the WebAssembly DSP.
4. `packages/spectral-analysis` (new, `ADR-0080`): `SpectrogramConfig`,
   `SpectralTileKey`, tile geometry, quantisation by threshold table, the
   codec, the worker and its protocol, the host, the cache under
   `CacheCategory.Spectrogram`; added through `tools/sync-workspace-graph.mjs`.
5. `packages/editor-view`: the spectrogram layer from tiles through field
   batches, the inverse frequency mapping, the mask's overlay, edit
   outlines, the marquee, lasso and brush tools and their intents.
6. `packages/input`: persisted gesture settings (`userPreferences` 1 to 2).
7. `apps/web`: the spectrogram worker and its cache, spectral commands
   (select, widen, narrow, attenuate, remove, isolate, heal, clean up,
   compare), the Spectral panel, the Spectral Repair preset, settings,
   `editorViews` 1 to 2.
8. `tests/e2e/spectral.spec.ts`, project `chromium-spectral`,
   `test:e2e:spectral`, and the reduced renderer's spectrogram.
9. Evidence, review record (lenses deferred), handoff, ledger `PASS`.
