# Specification Change Record — CHG-0001

## Status
`Proposed`

## Summary
Phase 10's packet and owned requirements are reconciled with the requirements and packets of Phases 05, 09, 11 and 13, as `REQ-EXEC-168` requires instead of a silent choice. Seven conflicts and readings are recorded, each with its evidence and the resolution `ADR-0100` to `ADR-0106` propose:

1. **`REQ-GAME-023` names features other phases deliver (C1).** Its list includes "Godot-aware export" and "Godot project integration" (owned by Phase 11 under `REQ-GODOT-024`, whose list holds Godot-aware naming, presets, loop metadata handling and asset preparation), "Controlled random variation generation" (Phase 13, `REQ-GAME-022`), "Batch conversion" and "Batch export" (Phase 13's `BatchJob`, its packet's batch engine), and "Sample-rate conversion", "Bit-depth conversion", "Mono/stereo conversion" and "Export presets", which Phase 09 delivered in `ExportSettings` and `BUILT_IN_PRESETS` (`ADR-0092`). Resolution: Phase 10 delivers, of `REQ-GAME-023`, seamless-loop creation, loop-point editing, zero-crossing loop assistance, loop auditioning, one-shot preparation, silence trimming, loudness matching, naming templates, region naming, game-oriented processing presets, export presets and conversions reached through game export profiles, batch export of many members as one itemised Phase 09 batch, and controlled random variation as far as the preview; the evidence maps each item to its deliverer, and Phases 11 and 13 claim the rest, as the Phase 05 and 06 handoffs record parts of their requirements delivered later.
2. **Export recipes and the packet's "packages/export-recipes game layer" (C2).** `REQ-GAME-120` lists "Export recipes" among a group's inherited defaults; `REQ-GODOT-119` (Phase 11) makes export recipes "first-class persistent project objects", several per object, and the Phase 09 handoff defers them to Phase 11 on Phase 09's settings. Resolution: Phase 10 delivers one inherited `GameExportProfile` per group or member, resolving to Phase 09's `ExportSettings` (`ADR-0102`), and no `export-recipes` package; Phase 11 introduces recipe objects and changes the policy field to reference them, a document raise with no migration before 1.0.
3. **The Godot runtime's selection logic (C4).** `REQ-GAME-122` asks the preview to reuse "where feasible, equivalent runtime-selection logic as the Godot runtime addon", which Phase 11 builds after this phase. Resolution: Phase 10's generator, selection, voice, cooldown and attenuation rules are specified exactly and pinned by test vectors in `packages/game-audio` (`ADR-0104`); the Phase 11 packet consumes them and its GUT tests reproduce them.
4. **Packages beyond the packet's owned modules (C7).** The design adds `packages/guided-workflows` and changes `packages/domain` (the loop crossfade and its shape, the varispeed stream, plan-chain automation, the counter draw), `packages/audio-engine`, `packages/audio-runtime`, `packages/effect-rack`, `packages/processors` (the `spatial-panner` and the built-in game chains), `packages/detection-runtime`, `packages/storage`, `packages/storage-runtime`, `packages/browser-storage`, `packages/project-format`, `packages/history`, `packages/project-commands`, `packages/waveform` and `packages/workspace`. Resolution: the packet's owned modules and dependency rules are amended below, with `ADR-0100` as the record.
5. **Two phases own `packages/game-audio` (C8).** Phase 13's packet also lists it. Resolution: Phase 10 creates it; Phase 13's packet says it extends it.
6. **A loop's crossfade becomes audible (C11).** Phase 05's `AnchoredLoop` recorded `crossfadeLength`, validated against the loop's length, and nothing rendered it; `REQ-GAME-121` asks that export preserve "the intended loop semantics", and a file holds loop points only (`ADR-0093`). Resolution (`ADR-0103`, amending `ADR-0051`): a loop gains `crossfadeShape`; its region's plan realises the crossfade after the rack, at the loop's end and at the join after it; a crossfade longer than the audio before the loop's start is refused when a command makes it and clamped, with a notice, when a later edit moves the start.
7. **Loop-analysis results are not persisted (C15).** The packet's Data/Schema Changes says the phase "introduces … loop-analysis results". They are derived from audio and reproducible from the plan, and the global invariant keeps derived data disposable cache, never authoritative. Resolution: the phase introduces `LoopAnalysis` as a published type and a session cache keyed by the plan's fingerprint (`ADR-0106`); what persists is the loop the person chooses from it, in the region.
8. **Game processing presets have no stated home (C16).** `REQ-GAME-023` names "game-oriented processing presets" and the packet "Loudness matching and game presets". Resolution: built-in entries of the person's processing library (`ADR-0060`'s saved chains), stated in `packages/processors` and listed by the library store (`ADR-0101`), not a second preset list.

## Rationale
Each conflict is between the text of two requirements or of a requirement and a packet, and choosing silently would either take scope from a later phase or drop scope from this one (`REQ-EXEC-168`, `REQ-EXEC-173`). The resolutions keep every item delivered by exactly one phase, compose the existing contracts (`ADR-0051`, `ADR-0060`, `ADR-0092`, `ADR-0093`) and reduce no requirement.

## Affected Requirement IDs
- `REQ-GAME-023`
- `REQ-GAME-075`
- `REQ-GAME-120`
- `REQ-GAME-121`
- `REQ-GAME-122`
- `REQ-GAME-022`
- `REQ-GAME-112`
- `REQ-GAME-113`
- `REQ-GODOT-024`
- `REQ-GODOT-119`
- `REQ-EDIT-014`
- `REQ-ARCH-153`

## Affected Phases
- Phase 05 (passed): its loop's crossfade becomes audible.
- Phase 09 (passed): its template grammar gains modifiers and its delivery a relative folder (`ADR-0102`); no behaviour it shipped changes.
- Phase 10: its packet's owned modules, dependency rules and data changes, amended below.
- Phase 11: consumes the preview vectors and the game-audio contracts; replaces or references `GameExportProfile` with recipe objects.
- Phase 13: extends `packages/game-audio`, the selection union and the member union.

## Compatibility Impact
- Project/schema: `projectDocument` raised (game-audio state; a loop's `crossfadeShape`); before 1.0 nothing migrates and an older document is refused (`REQ-STOR-052`). `projectStorage` and `userPreferences` unchanged.
- Processor/render: a region with a loop crossfade renders it; new `spatial-panner` processor; plan-chain automation and the varispeed stream exist only in generated plans and are refused in persisted ones.
- Public API: the three new packages; additions listed in `ADR-0100` to `ADR-0106`.
- Godot interchange/runtime: the preview vectors become a contract Phase 11 consumes.
- PWA/browser: none.

## Already-Passed Phase Remediation
- Phase 05: its evidence (`reviews/phase-05-evidence.md`, the `REQ-EDIT-014` row) claims "loop with crossfade" by `region-split.test.ts`, `placement.test.ts`, `edit-property.test.ts`, `editing-commands.test.ts` and `edit-commands.test.ts`. Those tests stay and gain the loop's shape; none is weakened. Its claim held for a crossfade length that was recorded and never heard; from this change the length is heard and clamped, so the row's evidence is extended, not invalidated, by Phase 10's `loop-crossfade.test.ts` and `loop-crossfade-property.test.ts` against the domain's oracle and the render goldens. Phase 05 stays `PASS`; Phase 10's evidence records the amended row and the commits, and the Phase 05 handoff's invariant ("everything placed on an asset is anchored … and carried through every later edit") holds, with the clamp as the stated rule where the loop's start moves.
- Phase 09: none; its byte pins prove the dither's bits unchanged by the counter draw's move, and its naming and delivery tests stand unchanged.

## Verification Changes
- The packet's commands stand as written; `packages/game-audio` and `packages/loop-analysis` get a `test` script, so `pnpm test --filter game-audio --filter loop-analysis` runs their tests.
- `pnpm test:loop-golden` and `pnpm test:e2e:game-workflows` are added (plan section 12).
- The Phase 05 tests named above gain the loop's shape; the domain's crossfade property tests are added.
- The evidence maps every `REQ-GAME-023` item to its deliverer.

## Packet Amendments
Applied to `phases/phase-10-game-audio-tooling.md` under "Specification change CHG-0001"; to apply to the Phase 11 and Phase 13 packets on approval:

- Phase 11, Required Public Contracts: "Consumes Phase 10's preview vectors (`packages/game-audio`) and reproduces them in GUT"; Data / Schema Changes: "Export recipes replace or are referenced by Phase 10's `GameExportProfile` policy field".
- Phase 13, Owned Modules: "`packages/game-audio` (extends Phase 10's)".

## Decision
- Approved/rejected by: pending the maintainer.
- ADR/change references: `ADR-0100`, `ADR-0101`, `ADR-0102`, `ADR-0103`, `ADR-0104`, `ADR-0105`, `ADR-0106`; `ADR-0051`, `ADR-0060`, `ADR-0061`, `ADR-0092` amended by them.
