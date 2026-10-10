> **Status:** In progress. 2026-10-10: Phase 08 is `READY` (`d957834e`); the
> slices are merged on `phase-08-spectral`, the architecture tests pass, and
> the spectral browser suite and the evidence are left.

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
7. **The DSP delivery belongs to the engine**, so
   `packages/spectral-analysis` takes it without depending on
   `audio-runtime`; one compiled module per page serves the engine and the
   spectrogram worker.
8. **Brush radius, hardness and softness are each editor view's**, as its
   tool is, in `EditorViewState.spectralTools`; the spectrogram's settings
   and display range are the view's too. Both are in `editorViews` 2.
9. **The domain's entry is past the cohesion threshold by review**: every
   name has a consumer, and its record beside the rule is held to a size.

## Done

- Readiness: ADRs, packet, ledger (`d957834e`).
- Domain, timeline, project-format, project-commands, history words and the
  Inspector's words (`1714422f`); engine realisation (`9445b57c`).
- STFT window, ABI 6 to 7, and the renderer's field batch (`f73fc31e`,
  `20e79c04`, `bc5d602a`); `ADR-0081` amended (`d4251292`).
- Spectral golden suite, `pnpm test:spectral-golden` (`fecde8c8`).
- Persistence round trips, `projectDocument` 7 to 8 (`ff29864e`).
- Field batch in the renderer's browser suites, a Canvas 2D loss fix
  (`0ed8d22b`).
- Spectral tools, mask overlay, edit outlines, inverse frequency mapping,
  pressure preference, `userPreferences` 1 to 2 (`28e98664`).
- `test:touch-pen`, `chromium-timeline`, the projects suites and the tablet
  notice, failing since earlier phases (`bbd02c40`, `71c74157`).
- `packages/spectral-analysis` (`78e37117`).
- Spectral commands, keyboard selection, Spectral panel, preset, Inspector,
  Settings (`23e590d2`).
- Spectrogram layer, worker, tile cache, display settings, `editorViews` 1
  to 2 (`2b4f71e8`).
- Architecture failures settled (`a5479df5`).

## Known failures outside this phase

- WebKit "reports no error when reloaded while it is still starting": the
  storage worker is sometimes refused by Cross-Origin-Embedder-Policy
  during the reload.
- Firefox "keeps a panel the user widened at its width across a reload":
  the panel returns 240 px wide.
- The ml-golden projects need `pnpm packs:build` and
  `AUDIOGUBBINS_PACK_CACHE`; this machine has no pack cache.

## Left

1. `tests/e2e/spectral.spec.ts`, project `chromium-spectral`,
   `test:e2e:spectral`.
2. Evidence, review record (lenses deferred), handoff, ledger `PASS`.
3. Remove every Phase 08 worktree and its branch.
