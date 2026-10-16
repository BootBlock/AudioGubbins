# Phase 10 — Game-Audio Tooling — Evidence Package

Written to satisfy `REQ-EXEC-183`. It is an index to evidence a reviewer must
verify, not a substitute for inspecting the implementation. Every number here
was read from a run over the phase branch at the commit the run names. The
in-depth review lenses and the adversarial review are deferred to the review
after the whole specification is implemented, by the maintainer's decision of
2026-10-16, as `reviews/phase-10-review.md` records. The plan is
`docs/todo/done/phase-10-game-audio-tooling.md`.

## Phase identifier and objective

- **Phase:** 10 — Game-Audio Tooling.
- **Objective:** AudioGubbins' game-audio authoring workflows: hierarchical
  asset groups whose policy each member resolves field by field with its
  owner named (`ADR-0101`); naming templates, game export profiles and
  destination paths resolved to Phase 09's export settings, many members
  planned as one itemised export (`ADR-0102`); loop analysis with ranked
  candidates and micro-crossfades, and a loop's crossfade heard in its
  region's plan (`ADR-0103`); a seeded game-preview simulation played as a
  plan the engine continues without a break (`ADR-0104`); guided workflows
  as planners of ordinary commands (`ADR-0105`); and the game-audio state as
  one member of the project document (`ADR-0106`), placed by `ADR-0100` and
  reconciled with the other phases by `CHG-0001`.
- **User-visible outcome:** the person organises sounds and regions into
  groups such as `Footsteps/Grass`, sees every member's effective processing,
  loudness, export profile, naming, destination, playback rules, bus and
  tags with where each came from, overrides and resets them; names and
  exports a group's members in one step; analyses a loop, auditions and
  applies a suggested candidate or crossfade; previews a group triggered as
  a game would, moving emitters about a listener; and runs guided workflows
  whose results are ordinary edits they can inspect and undo. The Asset
  groups panel, the Inspector's Game policy section, the Loop panel, the Game
  preview panel and the guided workflow dialogs show it, over the domain,
  engine, workers, persistence and commands beneath them.

## Checklist

Every box in the packet's **In Scope** list:

- Game-audio workspace and guided workflows: the planners of Cut Into
  Sounds, Prepare One-Shot, Create Seamless Loop, Normalise Game SFX, Clean
  Dialogue and Export for Godot, each a deterministic plan of ordinary
  project command invocations with one planned, skipped or refused item per
  target (`packages/guided-workflows/src/`, `workflow-plan.ts`,
  `plan-builder.ts`); their dialogs, analyses, planning and one-step
  dispatch (`apps/web/src/shell/workflows/`,
  `apps/web/src/commands/guided-workflow-commands.ts`, `workflow-planning.ts`,
  `apps/web/src/analysis/workflow-analysing.ts`); the report helpers a
  planner reads (`packages/detection-runtime/src/report-reading.ts`); the
  Game Audio workspace's panels (`apps/web/src/shell/game/`, `shell/loop/`,
  `shell/preview/`), their default keys scoped to each panel's focus
  (`47438def`); and the browser test (`tests/e2e/game-workflows.spec.ts`,
  the `chromium-game-workflows` project).
- Asset groups and inherited policy: `GameAssetGroup`, `GroupMember`,
  `GroupMembership` with its `processing` (`inherit` or `own`), the forest
  and its names (`packages/game-audio/src/groups/`); `InheritedPolicy`,
  `PolicyOverrides`, the nine `POLICY_FIELDS`, loudness targets, bus names
  and playback rules, `validateGameAudioState`, `resolvePolicy`,
  `resolveGroupPolicy` and `resolveAll` with provenance,
  `inheritedProcessing`, `inheritingRacks` and `projectChainUsers`
  (`packages/game-audio/src/policy/`); the game commands with inverses
  (`packages/project-commands/src/game/`); the state in the project document
  and the tree, and in the history's affected entities and differences
  (`packages/project-format/src/game-audio-json.ts`, `game-policy-json.ts`,
  `game-profile-json.ts`; `packages/history/src/game-entities.ts`,
  `game-fields.ts`). The Asset groups panel with its tree, members table,
  policy and export plan (`apps/web/src/shell/game/groups-panel.tsx`,
  `group-tree.tsx`, `group-members.tsx`, `group-policy.tsx`,
  `export-plan.tsx`), the Inspector's Game policy section
  (`member-policy.tsx`, `policy-facts.tsx`, `policy-editors.tsx`) and the
  shell's group commands (`apps/web/src/commands/game-group-commands.ts`,
  `game-member-commands.ts`, `game-policy-commands.ts`).
- One-shot preparation: Prepare One-Shot
  (`packages/guided-workflows/src/prepare-one-shot.ts`, `one-shot-edges.ts`,
  `silence-reading.ts`) and Cut Into Sounds (`cut-into-sounds.ts`), planned
  over the silence report's spans (`silenceRemovals`, `SILENCE_PARTS` in
  `report-reading.ts`) with the region, fade and slot commands, and loudness
  measured in the detection worker
  (`packages/detection-runtime/src/loudness-run.ts`,
  `apps/web/src/analysis/loudness-measuring.ts`).
- Named regions and game naming templates: one template grammar with
  modifiers (`packages/import-export/src/template-grammar.ts`), the game
  vocabulary, case modifiers and expansion
  (`packages/game-audio/src/export/naming-template.ts`,
  `naming-vocabulary.ts`, `case-modifiers.ts`, `member-naming.ts`), region
  names from a template (`member-names.ts`), the `game.name-members` shell
  command (`apps/web/src/commands/game-naming-commands.ts`).
- Seamless loop editor, analyser and candidate suggestions:
  `packages/loop-analysis` (metrics, verdicts, the one-pass candidate search
  with overlap-save correlation, micro-crossfade suggestion, audition plans);
  the zero-crossing boundary stated once
  (`packages/audio-engine/src/pcm/zero-crossing-boundary.ts`); loop analysis
  in the detection worker (`packages/detection-runtime/src/loop-run.ts`,
  `loop-message-reading.ts`); a loop's crossfade shape and its heard
  crossfade in the region's plan (`packages/domain/src/editing/loop-crossfade.ts`,
  `placement.ts`). The Loop panel (`apps/web/src/shell/loop/`), its
  analysis, candidate, crossfade and audition commands
  (`apps/web/src/commands/loop-analysis-commands.ts`,
  `loop-audition-commands.ts`), the analysis run
  (`apps/web/src/analysis/loop-analysing.ts`) and the audition's playback
  through the continued programme (`apps/web/src/audio/loop-audition.ts`);
  Create Seamless Loop (`packages/guided-workflows/src/create-seamless-loop.ts`).
- Game-context preview simulator: the counter draw moved into the domain
  (`packages/domain/src/integrity/counter-draw.ts`); the `spatial-panner`
  processor (`packages/processors/src/space/spatial-panner.ts`,
  `emitter-laws.ts`, `panner-kernel.ts`); plan-chain automation
  (`packages/effect-rack/src/chain-automation.ts`) and varispeed streams
  (`packages/domain/src/editing/plan.ts`,
  `packages/audio-engine/src/pcm/resampled-source.ts`); the continued
  programme (`packages/audio-engine/src/pcm/reader-continuation.ts`,
  `plan-divergence.ts`, `packages/audio-runtime/src/feeder/feeder-continuation.ts`,
  `playback/continued-request.ts`, `apps/web/src/audio/programme-continuation.ts`);
  the scenario, the simulation, the voice budget, the event log, the plan
  and its extension, and the reference vectors
  (`packages/game-audio/src/preview/`, `src/testing/preview-vectors.ts`);
  scenarios kept in the game-audio state and validated with it
  (`packages/game-audio/src/groups/state-validation.ts`), in the document
  (`packages/project-format/src/game-scenario-json.ts`) and changed by
  `game.add-scenario`, `game.set-scenario` and `game.remove-scenario`
  (`packages/project-commands/src/game/scenario-commands.ts`), a subject a
  scenario plays kept from removal (`scenario-players.ts`); what a preview
  has heard forgotten from its plan and log (`plan-forgetting.ts`,
  `forgetPreviewBefore`, `forgetPreviewPlanBefore`) and a plan stream's
  `forgottenBefore` (`packages/domain/src/editing/plan.ts`). The Game preview
  panel (`apps/web/src/shell/preview/`), its commands
  (`apps/web/src/commands/game-preview-commands.ts`,
  `preview-run-commands.ts`) and its run through the transport at the
  person's preview quality (`apps/web/src/audio/preview-run.ts`,
  `preview-runner.ts`, `preview-programme.ts`, `preview-renders.ts`).
- Game-oriented export policy and recipes: `GameExportProfile` and
  `profileFromPreset`, `memberExportSettings`, `DestinationPath`,
  `planGameExport` (`packages/game-audio/src/export/`); delivery into a
  relative folder (`packages/storage/src/export-delivery.ts`,
  `delivery-folders.ts`, `packages/browser-storage/src/delivery-destinations.ts`,
  `packages/storage-runtime/src/client/exports-client.ts`); an export
  record's folder (`packages/project-format/src/exported-file-json.ts`);
  `game.export-group`, `game.export-members` and `game.apply-preset-to-group`
  (`apps/web/src/commands/game-export-commands.ts`, `game-profiles.ts`), each
  planned file exported with its own settings (`ae0c68a9`); Export for Godot
  (`packages/guided-workflows/src/export-for-godot.ts`). Recipes as project
  objects are Phase 11's (`CHG-0001`).
- Loudness matching and game presets: the `loudness` policy field; loudness
  measurement in the detection worker; the five built-in game chains
  (`packages/processors/src/library/game-chains.ts`) listed by the
  processing library store as built-in
  (`packages/storage/src/processing-library-store.ts`) and listed apart in
  the Library (`465329d3`); Normalise Game SFX
  (`packages/guided-workflows/src/normalise-game-sfx.ts`) and the loudness
  conformance report (`apps/web/src/shell/game/loudness-conformance.ts`,
  `game.measure-loudness`).
- Batch-ready domain hooks: the game export plan's items, planned or refused
  each with its owner (`GameExportItem`); the workflow plan's items, each
  planned, skipped or refused with its target (`WorkflowItem`,
  `WorkflowPlan`, `workflowDispatch`).

Work units: WU-10.0, WU-10.A1 to WU-10.A6, WU-10.B, WU-10.C1, WU-10.C2,
WU-10.D1 to WU-10.D4 (both parts), WU-10.E1a, WU-10.E1b, WU-10.E2,
WU-10.E3, WU-10.F, WU-10.P and the final integration fixes WU-10.FX are
merged (section "Commits").

## Inherited debt

| Debt | Fix |
| --- | --- |
| Phase 05's loop crossfade was recorded and never heard (`CHG-0001`, C11) | WU-10.P (`acbb599d`): the region's plan realises the crossfade after its rack, with a tail join and a clamp that says the crossfade was shortened (`ADR-0103`, `ADR-0051` amended). |
| The dither's counter draw was module-private in `packages/import-export` | WU-10.D1 (`9061ca88`): `lowbias32` and `uniformDraw` move unchanged to `packages/domain`; Phase 09's byte pins hold the dither's bits. |
| The zero-crossing predicate was stated only in `packages/waveform` | WU-10.C1 (`a14a190f`): stated once in `packages/audio-engine`, with the edges a caller asks for. |
| The Blackman–Harris window's coefficients were restated outside the engine | WU-10.C2 (`f7ea8898`): one authority, the engine's weight function. |
| A checksum stale on the phase branch: WU-10.P edited `CHG-0001` without regenerating `CHECKSUMS.sha256` | The commit that adds this package regenerates it. |

## Files and packages materially changed

| Package | What it owns |
| --- | --- |
| `packages/game-audio` | New and portable. Groups, membership, policy, validation, resolution with provenance, processing realisation, chain users; naming templates, export profiles, destination paths, the game export plan and region names; the preview's scenario, draws, selection, cooldown, voices, budget, motion, simulation, event log, plan and extension; the reference vectors and random scenarios. |
| `packages/loop-analysis` | New and portable. Loop requests, windows and references, the seam metrics and verdicts, the one-pass capture, the candidate search and cost, micro-crossfades, audition plans, the loop fixtures. |
| `packages/guided-workflows` | New and portable. The six workflows as planners of ordinary project command invocations, each item planned, skipped or refused with its target and tried through the project's own commands as it is planned; the workflow plan and its dispatch as one step; the test states and reports. |
| `packages/domain` | The counter draw; a loop's crossfade shape and its heard crossfade with the clamp; the varispeed stream and plan-chain automation, refused in a persisted payload; a plan stream's `forgottenBefore`, held by a preview's plan alone. |
| `packages/audio-engine` | The zero-crossing boundary; plan divergence and reader continuation (live readers kept across a continued plan), comparing a stream only from its `forgottenBefore`; varispeed reading; the preview stream key over automation and ratio. |
| `packages/audio-runtime` | The continued programme: the feeder's continuation, the request's continuation and the session's `continueWith` and `readFrame`. |
| `packages/effect-rack` | Plan-chain automation, evaluated at the processor's design interval. |
| `packages/processors` | The `spatial-panner` processor with Godot 4's laws; the built-in game chains. |
| `packages/detection-runtime` | Loop analysis and loudness measurement in the detection worker, their messages and readers, the job records; the report helpers moved from the web app. |
| `packages/import-export` | The template grammar with modifiers and vocabularies; the folder-segment rule stated once, `folderSegmentProblem`, which delivery and destination paths both read; the dither reads the domain's draw. |
| `packages/project-format` | The game-audio member and tree file, its readers and writers, scenarios among them; the loop's crossfade shape; the export record's folder; the history's affected groups; random game-audio state; `projectDocument` 10. |
| `packages/project-commands` | The game commands, scenarios' among them, a refused policy value naming the group or member that owns it (`value-owners.ts`); region and asset removal taking membership with them, refused while a scenario plays the subject; `project.restore-region`; `project.set-rack` making an inheriting member own its processing; chain naming through `projectChainUsers`. |
| `packages/history` | Group, membership, override and scenario differences; the `game-group` entity kind; a chain's owner named through `projectChainUsers`. |
| `packages/storage`, `packages/storage-runtime`, `packages/browser-storage` | Delivery into a relative folder made where absent and taken back where abandoned; trusted records by relative path; the processing library's built-in entries. |
| `packages/waveform` | Snapping reads the engine's zero-crossing boundary. |
| `packages/commands` | A command's availability is given the invocation where it is known, the bus's and a control's alike. |
| `packages/workspace` | The Game Audio workspace's preset layout. |
| `apps/web` | The continued programme in `PlaybackControl`; the loop's crossfade shape in the region commands and the Inspector; group words in the History panel; the report helpers read from `detection-runtime`; the Asset groups panel, the Inspector's Game policy section, the game, naming, export and loudness commands (`shell/game/`, `commands/game-*.ts`); the Loop panel and its auditions (`shell/loop/`, `audio/loop-audition.ts`); the Game preview panel and its run (`shell/preview/`, `audio/preview-*.ts`); the guided workflow dialogs and dispatch (`shell/workflows/`, `commands/workflow-*.ts`); default keys scoped to a panel's focus; the panel context and parts out of `panels.tsx`. |
| `tests/`, root | The `chainUsers` import rule, the new packages' layering and exports, the `chromium-game-workflows` project and its spec `tests/e2e/game-workflows.spec.ts`, `test:game-audio`, `test:loop-golden` and `test:e2e:game-workflows`. |

## New or changed public contracts

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, held to the code by
`tests/architecture/public-contracts.test.ts`. The packet's required contracts
map to the code as follows:

| Packet's name | In the code |
| --- | --- |
| GameAssetGroup | `GameAssetGroup`, `GameAssetGroupId`, `GroupMember`, `GroupMembership`, `MemberProcessing`, `GameAudioState` in `@audiogubbins/game-audio`. |
| InheritedPolicy | `InheritedPolicy`, `PolicyOverrides`, `OverridableField`, `POLICY_FIELDS`, `PolicyValues`, `EffectivePolicy`, `GroupEffectivePolicy`, `Resolved`, `PolicySource`, `resolvePolicy`, `resolveGroupPolicy`, `resolveAll`, `validateGameAudioState` in `@audiogubbins/game-audio`. |
| LoopDefinition / LoopAnalysis | The domain's `LoopDefinition` and `AnchoredLoop`, gaining `crossfadeShape` and the placed `crossfadeClampedFrom` (`CHG-0001`); `LoopAnalysis`, `LoopMetrics`, `LoopMetric`, `LoopCandidate`, `LoopAnalysisRequest`, `analyseLoop`, `loopAuditionPlan`, `extendedAuditionPlan` in `@audiogubbins/loop-analysis`. |
| GamePreviewScenario | `GamePreviewScenario`, `PreviewEmitter`, `Listener`, `Motion`, `TriggerPattern`, `EmitterRules`, `VoiceVariation`, `simulatePreview`, `PreviewEventLog`, `previewPlan`, `extendPreviewPlan`, `forgetPreviewBefore`, `forgetPreviewPlanBefore`, `previewVoiceBudget` in `@audiogubbins/game-audio`; the reference vectors, `PREVIEW_VECTORS`, in its test support (`src/testing/preview-vectors.ts`); `GameAudioState.scenarios`; `game.add-scenario`, `game.set-scenario` and `game.remove-scenario` in `@audiogubbins/project-commands`. |
| NamingTemplate | `NamingTemplate`, `namingTemplate`, `memberNames` in `@audiogubbins/game-audio`; `readTemplate`, `escapeTemplateText`, `folderSegmentProblem` in `@audiogubbins/import-export`. |
| GameExportProfile | `GameExportProfile`, `profileFromPreset`, `DestinationPath`, `GameExportPlan`, `GameExportItem`, `planGameExport` in `@audiogubbins/game-audio`. |

Beside them: `GuidedWorkflow`, `WorkflowPlan`, `WorkflowItem`,
`workflowDispatch` and the six workflows (`CUT_INTO_SOUNDS`,
`PREPARE_ONE_SHOT`, `CREATE_SEAMLESS_LOOP`, `NORMALISE_GAME_SFX`,
`CLEAN_DIALOGUE`, `EXPORT_FOR_GODOT`) in `@audiogubbins/guided-workflows`;
the counter draw in `@audiogubbins/domain`; the varispeed stream, plan-chain
automation and a stream's `forgottenBefore` in the domain's plan; the zero-crossing boundary,
plan divergence and reader continuation in `@audiogubbins/audio-engine`; the
continued programme in `@audiogubbins/audio-runtime`; the `spatial-panner`
type and `BUILT_IN_LIBRARY` in `@audiogubbins/processors`; the loop and
loudness requests in `@audiogubbins/detection-runtime`; the game commands'
identifiers and `project.restore-region` in `@audiogubbins/project-commands`;
a command's availability given its invocation in `@audiogubbins/commands`;
the raised `SCHEMA_VERSIONS` in `@audiogubbins/version`.

## ADRs created and changed

`ADR-0100` to `ADR-0106` were drafted by the plan's first commit
(`c8164dbd`) and revised after the design-stage adversarial reviews
(`61bd8f1a`), all `Proposed`; `CHG-0001` records the packet and scope
conflicts. The build amended these records, each by a dated line, in the
commit that drafted this package (`084294ad`) and the one that completes it;
the maintainer accepted `ADR-0100` to `ADR-0106` and `CHG-0001` on
2026-10-16, as Phase 10 closed:

- `ADR-0101` — 2026-10-16: removing a member region or asset takes its
  membership with it, restored by undo; the profile refusal is raised per
  member at planning.
- `ADR-0102` — 2026-10-16: an export record's folder; a member asked for
  twice; delivery's folders made with the file and taken back with it; the
  public folder-segment rule is `folderSegmentProblem`, not `safeFolderName`
  (`6e17a4b6`).
- `ADR-0103` — 2026-10-16: every seam metric compares with the region's own
  audio by its reference; the floors at 60 dB under the level; the refusal
  codes; `project.restore-region`.
- `ADR-0104` — 2026-10-16: Godot 4's laws as its source states them (Q3);
  the integer selection and the draws' rounding; the voice budget by grade;
  the hand trigger's cost; a maximum distance of 0; a subject a scenario
  plays kept from removal; a preview forgets what it has heard, its plan's
  streams stating `forgottenBefore` (`121a40f3`, `e80d3951`, `ff40b06a`).
- `ADR-0106` — 2026-10-16: scenarios in the state and the document, the
  member's one emptiness test, and the export record's folder.
- `ADR-0100` and `ADR-0105`: unchanged.

## Decisions taken beyond the ADRs

1. A membership removed with its region or asset is restored by undo at its
   place in the assignment order, with its processing and overrides.
2. `project.restore-region` is the inverse of `project.set-region`: it sets
   the region back without asking its loop for its crossfade's lead, so undo
   restores a loop read back without it.
3. The hand trigger's simulation is held to 1 ms and the simulation and
   extension together to 5 ms, a tenth of the shortest feed-ahead.
4. The voice budget is computed from the preview's resampling grade and the
   pitches a scenario's members may draw, not one constant.
5. Removing a group, taking a member out of its group, or removing its region
   or asset is refused while a scenario plays it, naming the scenario
   (`game.subject-played`): the preview would otherwise fall silent, and a
   step never edits a scenario the person did not touch.
6. `projectDocument` 10.
7. A preview forgets, every 5 s of playback, what was heard more than 1 s
   behind the listener, in its simulation (`forgetPreviewBefore`) and its
   plan (`forgetPreviewPlanBefore`), each changed stream stating
   `forgottenBefore` so a continuation keeps every reader of what still
   sounds; the laying afresh at a silent moment it replaces is removed.
8. A command's availability is given the invocation it would run with, so a
   group command runs on the group it names with none chosen (`a14f67ee`).
9. Default keys: T triggers the Game preview's hand trigger and the loop
   auditions have their keys, each run only where its panel has the
   keyboard, scoped by the panel's own attribute (`data-ag-preview-panel`,
   `data-ag-loop-panel`).

## Tests

Test declarations added per package, counted from the diff of every
`*.test.ts`, `*.test.tsx` and `*.spec.ts` file from `main` at `43968c5b` to
`39a4885e`, the last merge of the phase branch (an `it.each` counts once; a
declaration renamed or generalised counts as one removed and one added):

| Package | New test files | Changed test files | Declarations added | Removed |
| --- | --- | --- | --- | --- |
| `packages/game-audio` | 34 | 0 | 212 | 0 |
| `apps/web` | 23 | 18 | 114 | 0 |
| `packages/loop-analysis` | 14 | 0 | 81 | 0 |
| `packages/project-commands` | 4 | 4 | 51 | 0 |
| `packages/audio-engine` | 6 | 2 | 45 | 0 |
| `packages/guided-workflows` | 9 | 0 | 42 | 0 |
| `packages/detection-runtime` | 5 | 1 | 35 | 0 |
| `packages/domain` | 4 | 3 | 26 | 0 |
| `packages/processors` | 4 | 1 | 22 | 0 |
| `packages/project-format` | 1 | 7 | 21 | 1 |
| `packages/audio-runtime` | 3 | 2 | 17 | 0 |
| `packages/import-export` | 2 | 0 | 16 | 0 |
| `packages/history` | 2 | 4 | 14 | 0 |
| `packages/effect-rack` | 1 | 1 | 13 | 0 |
| `packages/storage` | 0 | 8 | 11 | 0 |
| `packages/browser-storage` | 0 | 1 | 9 | 0 |
| `packages/storage-runtime` | 0 | 2 | 4 | 0 |
| `packages/waveform` | 1 | 0 | 3 | 0 |
| `packages/workspace` | 0 | 1 | 2 | 0 |
| `tests/architecture` | 0 | 5 | 2 | 0 |
| `packages/commands` | 0 | 1 | 1 | 0 |
| `tests/e2e` | 1 | 0 | 1 | 0 |
| `packages/editor-view` | 0 | 1 | 0 | 0 |
| **Total** | **114** | **62** | **742** | **1** |

The one removed is generalised: an export record's file now keeps its folder
("keep an exported file’s settings, size, hash and codec below full, and drop
its name and folder", `export-record-json.test.ts`).

| Area | Where |
| --- | --- |
| Groups, policy, resolution | `packages/game-audio/src/groups/*.test.ts`, `src/policy/*.test.ts`; `apps/web/src/shell/game/groups-panel.test.tsx`, `inspector-policy.test.tsx`; `apps/web/src/commands/game-commands.test.ts`, `rack-target.test.ts`; `apps/web/src/state/group-focus.test.ts` |
| Naming, profiles, the game export plan | `packages/game-audio/src/export/*.test.ts`; `packages/import-export/src/template-grammar.test.ts`, `file-name-safety.test.ts`; `apps/web/src/export/planned-export.test.ts` |
| Delivery into a relative folder | `packages/storage/src/export-delivery.test.ts`; `packages/browser-storage/src/delivery-destinations.test.ts`; `packages/storage-runtime/src/client/exports-client.test.ts` |
| Persistence and history | `packages/project-format/src/game-audio-json.test.ts`, `project-json.test.ts`, `project-tree.test.ts`, `history-json.test.ts`, `export-record-json.test.ts`, `edit-json.test.ts`; `packages/history/src/game-differences.test.ts`, `history-rows.test.ts`, `loop-difference.test.ts` |
| Game commands | `packages/project-commands/src/game/*.test.ts`, `processing/rack-commands.test.ts`, `editing/editing-commands.test.ts`, `asset-commands.test.ts`, `project-commands.test.ts` |
| Loop analysis | `apps/web/src/shell/loop/loop-panel.test.tsx`, `apps/web/src/commands/loop-analysis-commands.test.ts`, `loop-audition-commands.test.ts`, `apps/web/src/analysis/loop-analysing.test.ts`, `apps/web/src/audio/loop-audition.test.ts`; `packages/loop-analysis/src/*.test.ts`, the goldens in `analyse-loop.loop-golden.test.ts`; `packages/audio-engine/src/pcm/zero-crossing-boundary.test.ts`; `packages/waveform/src/zero-crossings.test.ts` |
| Loop analysis and loudness in the worker | `packages/detection-runtime/src/detection-worker-core.loop.test.ts`, `detection-host.jobs.test.ts`, `loop-message-reading.test.ts`, `loudness-run.test.ts`, `report-reading.test.ts` |
| The loop's crossfade in the plan | `packages/domain/src/editing/loop-crossfade.test.ts`, `loop-crossfade-property.test.ts`, `placement.test.ts`; `apps/web/src/commands/edit-commands.test.ts`, `shell/inspector/inspector-panel.test.tsx` |
| Varispeed and automation | `packages/domain/src/editing/preview-streams.test.ts`; `packages/audio-engine/src/pcm/varispeed.test.ts`, `resampled-source.test.ts`; `packages/effect-rack/src/chain-automation.test.ts`; `packages/audio-engine/src/preview/preview-stream-key.test.ts` |
| The continued programme (the D3 gate) | `packages/audio-engine/src/pcm/plan-continuation.test.ts`, `plan-divergence.test.ts`, `processed-content.test.ts`; `packages/audio-runtime/src/feeder/feeder-continuation.test.ts`, `playback/continued-programme.test.ts`, `continued-request.test.ts`; `apps/web/src/audio/playback-control.test.ts` |
| Spatial panner and game chains | `packages/processors/src/space/spatial-panner*.test.ts`, `library/game-chains.test.ts`; `packages/storage/src/processing-library-store.test.ts`; `packages/storage-runtime/src/client/processing-library-client.test.ts` |
| The preview | `packages/game-audio/src/preview/*.test.ts`, the vectors in `preview-vectors.test.ts`, the cost in `hand-trigger.performance.test.ts`, the forgetting in `preview-forgetting.test.ts`; `apps/web/src/audio/preview-run.test.ts`, `preview-runner.test.ts`, `preview-rebase.test.ts`, `preview-renders.test.ts`, `preview-catalogue.test.ts` (the real catalogue); `apps/web/src/commands/game-preview-commands.test.ts`; `apps/web/src/shell/preview/preview-panel.test.tsx` |
| Scenarios in the project | `packages/game-audio/src/groups/state-validation.test.ts`; `packages/project-format/src/game-audio-json.test.ts`; `packages/project-commands/src/game/scenario-commands.test.ts`; `packages/history/src/game-differences.test.ts`; `apps/web/src/shell/history/difference-words.test.ts` |
| The counter draw | `packages/domain/src/integrity/counter-draw.test.ts` |
| Layering, exports and the `chainUsers` rule | `tests/architecture/dependency-rules.test.ts`, `package-exports.test.ts`, `module-exports.test.ts`, `scope-projects.test.ts` |
| Guided workflows | `packages/guided-workflows/src/*.test.ts`; `apps/web/src/commands/workflow-dispatch.test.ts`, `guided-workflow-commands.test.ts`; `apps/web/src/shell/workflows/workflow-dialog.test.tsx`; `apps/web/src/analysis/workflow-analysing.test.ts`; `apps/web/src/state/workflow-draft-store.test.ts` |
| Loudness and conformance | `apps/web/src/shell/game/loudness-conformance.test.ts`; `packages/detection-runtime/src/loudness-run.test.ts` |
| Availability given the invocation | `packages/commands/src/registry.test.ts` |
| The browser | `tests/e2e/game-workflows.spec.ts` |

## Commands used for verification

```
pnpm run verify:commit               # pnpm run lint, pnpm run typecheck:full, pnpm run test, pnpm run record:check, pnpm run test:dependencies
pnpm run test:game-audio             # vitest run --project game-audio --project loop-analysis --project guided-workflows
pnpm run test:loop-golden            # vitest run loop-golden
pnpm run test:audio-golden           # vitest run golden
pnpm run test:project-roundtrip      # vitest run --project project-format --project history --project storage roundtrip round-trip project-json history-json history-conversion
pnpm run test:editing-property       # vitest run --project domain --project project-commands edit-property project-commands.test
pnpm run test:dsp-property           # vitest run --project processors --project domain properties.test rack-edit-property
pnpm run test:roundtrip-audio        # vitest run --project codec-runtime export-roundtrip
pnpm run test:architecture           # pnpm run test:dependencies, vitest run --project architecture
pnpm run build                       # pnpm --filter @audiogubbins/web build, pnpm run build:check
pnpm run test:e2e:game-workflows     # playwright test --project=chromium-game-workflows
pnpm run spec:verify                 # python docs/spec/tools/verify_hardening.py
```

The packet's own three commands are `pnpm test --filter game-audio --filter
loop-analysis` (pnpm runs each filtered package's `test` script),
`pnpm test:loop-golden` and `pnpm test:e2e:game-workflows`; the root script
`pnpm run test:game-audio` runs the three game packages' Vitest projects in
one run.

## Results

| Check | Result |
| --- | --- |
| `pnpm run verify:commit`, at `4e6ba6cd` | Failed in the test step alone. Lint passed (the version, graph and notices checks, ESLint and Prettier) and both type checks passed; the tests ran 916 files and 13,663 tests, of which 13,660 passed and three failed, all in `tests/comment-width.test.ts` (comments wrapped past the width comments are written at, a line short of the next line's first word, and a line broken inside a code span). `5a7e0693` rewrapped the comments they named. |
| `pnpm run verify:commit`, one per wave of merges | Run by the integrator over the phase branch after each wave, by the maintainer's decision of 2026-10-16 (the units ran the narrow gates of what they changed); the closing run is under "Final counts". |
| `pnpm run spec:verify` | PASS, all four checks, on the commit that completes this package. |

### Final counts

Over the integrated phase branch at `39a4885e`, with this package's commit
on it:

| Check | Result |
| --- | --- |
| `pnpm run verify:commit` | Passed over the phase branch with every unit merged (its steps run in order, Vitest at four workers): lint, `typecheck:full`, 951 test files and 13,941 tests, `record:check`, and no dependency violations in 3,253 modules. |
| `pnpm test:e2e:game-workflows` | Passed in Chromium: 1 test, 46.9 s, against the production build (`pnpm run build`: 43 files, free of local paths and analytics hosts). |
| The packet's commands: `pnpm test --filter game-audio --filter loop-analysis`, `pnpm test:loop-golden`, beside `pnpm run test:game-audio` | Passed. `pnpm test --filter game-audio --filter loop-analysis` ran 2 of 41 workspace projects: game-audio 34 files, 415 tests; loop-analysis 14 files, 130 tests. `pnpm test:loop-golden`: 1 file, 23 tests. `pnpm run test:game-audio`: 57 files, 587 tests. |

Tests known to fail now and then under the whole suite's load, each at its
time limit, and to pass when run again alone (accepted as `LOW`, below):

- `packages/model-packs`, `integrity.test.ts`: the hand-over test (5 s).
- `tests/architecture/browser-floor.test.ts` (5 s).
- `tests/architecture`: "calls what the library declares above the floor
  only where it is guarded" (about 5.9 s under load).
- `packages/project-format`: the zip interoperability test through Python.
- `packages/storage`: the project-transfer round trip's seeds.

`packages/game-audio`'s `hand-trigger.performance.test.ts` read the wall
clock, and on a shared machine its 1 ms bound on the simulation read 1.28 to
1.60 ms even alone; `2d7f613f` measures the thread's processor time instead.

## Browser and device results

`tests/e2e/game-workflows.spec.ts` in Chromium (`chromium-game-workflows`),
through Playwright against a production build the preview server serves,
drives section 13 of the plan in one test, "cuts a recording into a group,
prepares and loops its sounds, previews them, exports the group and finds it
all after a reload": a long recording cut into a named group with no new
source or media; the group's inherited export profile, naming and folder,
with a member's override set and reset; the export plan's names and owners;
Prepare One-Shot over the group as one step of the History, its fades in the
Inspector, reversed by one undo; a loop analysed, with nothing applied by
being found, and a candidate applied only by hand; the Game preview
triggering the group twenty times beside the looped hum, twice alike under
its seed, with the History unchanged; the group exported into a folder; and
everything found again after a reload. Its run's counts are under "Final
counts" (1 test passed in Chromium, 46.9 s).

Running it found three defects, each fixed on the phase branch before the
close (B-01 to B-03 in `reviews/phase-10-review.md`):

- **A group command's availability** asked only for a chosen group: with
  groups made and none chosen, as straight after Cut Into Sounds, pressing a
  group in the tree, F2 or Delete was refused. `a14f67ee` gives a command's
  availability the invocation it would run with ("chooses the group an
  invocation names while none is chosen", "renames the group an invocation
  names while none is chosen, and refuses one naming none", "deletes the
  group an invocation names while none is chosen",
  `apps/web/src/commands/game-commands.test.ts`; "hands a command the
  invocation it would run with, asked and run alike",
  `packages/commands/src/registry.test.ts`).
- **A looping voice read past its stream's end**: a voice started just before
  the plan's end and cut after the end moved on read its run past its end, a
  plan the engine refuses, which ended a preview of overlapping loops within
  a minute. `08beafbd` lays every looping voice as far as it sounds ("lays a
  looping voice cut past the plan’s old end as far as it sounds",
  `extend-preview-plan.test.ts`).
- **The preview's plan grew without end**: a never-stopped loop or
  overlapping triggers grew the plan, the log and the motion for as long as
  they played, past the 4,096 streams a message carries in minutes, because
  the plan was laid afresh only at a silent moment. `121a40f3`, `e80d3951`
  and `ff40b06a` make a preview forget what it has heard ("holds a plan and
  a simulation no larger after eight minutes than after two", "sounds the
  same from the frame forgotten, and goes on into a hand trigger after it
  alike", `preview-forgetting.test.ts`; "keeps every reader and sounds on
  bit for bit where the forgetting is stated", `plan-continuation.test.ts`;
  "keeps its plan from growing without end where a loop and its triggers
  never fall silent", `apps/web/src/audio/preview-run.test.ts`).

No game-audio browser test runs in Firefox or WebKit (Known limitations).

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Long recordings can be segmented, named, processed and export-configured as many regions without source duplication. | `game-export-plan.test.ts` ("plans as many exports, each reading its span of the one recording, run as one batch", "counts {number} within the group, so a member is named the same whatever else is exported"), `member-names.test.ts` ("gives each region its name in the order asked, numbered by its place in its group, not in the list"), `export-delivery.test.ts` ("makes the folders the path names, writes into the last, and records the file by its name"). Cut Into Sounds (`cut-into-sounds.test.ts`: "reaches the state an expert reaches adding, naming and grouping each region by hand", "cuts no sound a region already lies over, and nothing when every sound has one"; `workflow-dispatch.test.ts`: "cuts a recording into sounds in a new group, the group and the regions one step"); the browser test cuts a recording into a named group with the Assets panel still holding one asset (`tests/e2e/game-workflows.spec.ts`). |
| The loop analyser identifies known discontinuity fixtures and suggested points are reproducible. | `analyse-loop.loop-golden.test.ts` ("pins ${golden.name}" over every fixture of the plan's list, "suggests whole periods for the sine loops, the current points where they are already seamless", "gives the reference's bits for ${GOLDEN[index]?.name ?? ''}", "is the version these values were pinned at"); `candidate-search.test.ts` ("are the same list for the same audio and settings", "is by cost, then the smaller move, then the earlier start, then the earlier end", "compares costs exactly, so a difference in the last bit decides"); `analyse-loop.test.ts` ("is the same value analysed twice"). |
| Guided workflows produce ordinary edit, effect and export objects visible in the Inspector and history. | Each workflow reaches the state an expert reaches by hand, undone whole by its one history step, and plans the same from the same input (`cut-into-sounds.test.ts`; `prepare-one-shot.test.ts`: "reaches the state an expert reaches trimming, fading and normalising each by hand", "is undone whole by its one history step, and plans the same from the same input"; `create-seamless-loop.test.ts`, `normalise-game-sfx.test.ts`, `clean-dialogue.test.ts`, `export-for-godot.test.ts`); `workflow-dispatch.test.ts` ("runs Prepare One-Shot on a group as one step, which one undo reverses"); `workflow-dialog.test.tsx` ("shows what it runs on, each option’s source, and every item before anything runs"); the browser test's Prepare One-Shot step, its fades in the Inspector. Game changes are named in the history (`game-differences.test.ts`, "says which of a group’s fields changed: its name, its place and each field of its policy"; `difference-words.test.ts`, "says a group by its path and each setting of it, a member’s group and overrides, and a group’s processing"). |
| Asset-group inheritance and override resolution is deterministic and directly tested. | `policy-resolution.test.ts` (every rule of the plan's section 3: "takes the override where the member sets one, hiding every group that sets the field, nearest first", "takes the nearest group that sets a field, naming it with its path", "answers unset, with no value, where neither the member nor any group sets a field", "adds every ancestor’s tags to the region’s own, sorted, each with every source that gives it", "gives a member in no group every field unset and only its own tags"); `policy-resolution.properties.test.ts` ("resolves every member at once as it resolves each alone", "gives the same answers whatever order the groups and the memberships are held in", "reveals the nearest hidden value when an override is reset, and is restored when it is set again"); `processing-realisation.test.ts` ("takes every inheritor from A to no rack to B, each step a state the validator passes"). |
| Game preview can repeatedly trigger representative one-shot and loop scenarios without changing authoritative edits. | Merged: `preview-simulation.properties.test.ts` (the same seed gives the same log; a continuation equals the whole; never more voices than the limit; "are its own draws: a trigger suppressed before it changes none of them"; "take each chosen member’s own variation and bus"); `preview-plan.test.ts` ("sounds each voice at its frame, from its offset, at its gain, on both sides", "cycles a loop from its end back to its start for as long as the plan runs"); `extend-preview-plan.test.ts`; `preview-vectors.test.ts` ("hold every kind of event, refusal and steal"); the simulation and the plan are pure values and run no command. The D3 gate's continuation tests (`plan-continuation.test.ts`, `feeder-continuation.test.ts`). Scenarios kept in the project by their own commands (`scenario-commands.test.ts`: "adds a scenario whole, undone in one step"; `preview-chains.test.ts`: "is made for every emitter rule the policy takes, at every distance", so a validated scenario always becomes a plan). The panel's run (`game-preview-commands.test.ts`: "plays the scenario set up and changes nothing of the project"; `preview-run.test.ts`: "chooses the same members, pitches and gains on every run of a seeded pattern", "keeps its plan from growing without end where a loop and its triggers never fall silent"); the browser test triggers the group twenty times beside a looped hum, twice alike under its seed, the History unchanged. |

Failure and recovery behaviour:

| Behaviour | Evidence |
| --- | --- |
| Invalid inherited settings identify the owning group or override. | `state-validation.test.ts` ("refuses a parent that is no group, naming the group", "refuses a naming template the game vocabulary does not read, with the template’s refusal as its cause", "reports every problem at once, groups before members"); `game-export-plan.test.ts` ("is refused for its own audio, naming the group whose profile it cannot take, and refuses no other", "names the member as the owner of a profile it overrides", "refuses every item whose file would be another one, naming both and whose templates named them"); `game-audio-json.test.ts` ("a state the project cannot hold, naming the owner and the field it set"); `group-commands.test.ts` ("resets a field to inherited, and refuses a value out of range naming the group"); `member-setting-commands.test.ts` ("refuses a field only the group sets, naming the group, and a value out of range naming the member"). |
| Loop analysis failure must not alter saved loop points. | `detection-host.jobs.test.ts` ("answers a refused analysis as failed, keeping nothing and leaving the loop asked about as it was", "answers a cancelled analysis as cancelled, keeping nothing and leaving the loop as it was"); `analyse-loop.test.ts` ("is cancelled before it reads", "fails with the source's reason where a read fails, and where it ends early"); `detection-worker-core.loop.test.ts`. The analysis runs no command. The Loop panel's commands (`loop-analysis-commands.test.ts`: "keeps a refused analysis as failed, saying why, and leaves the loop as it was", "stops an analysis, keeping what the region had before and its loop as it was"). |
| Batch and guided operations fail atomically or record per-item failure explicitly. | The game export plan's items (`game-export-plan.test.ts`: "names every policy it lacks at once", "refuses a member asked for again where it is repeated, planning it once and the rest as asked", "never collides a refused member with a planned one"); every game command is one step with its inverse (`group-commands.test.ts`: "adds a group with its new chain, both undone in one step"). Workflow plans with per-item refusals and one-step dispatch (`workflow-plan.test.ts`: "leaves the project as it was where a command fails part of the way through", "has nothing to run where every item is skipped"; `workflow-dispatch.test.ts`: "dispatches nothing while an item is refused, and nothing once every item is left out"). |

Architectural invariants:

| Invariant | Evidence |
| --- | --- |
| Guided workflows create the same inspectable operations an expert could create manually. | Each planner's test that it "reaches the state an expert reaches" by hand compares its dispatched state with the same commands run one by one (`packages/guided-workflows/src/*.test.ts`); a plan holds only project command invocations (`WorkflowItem`), tried through the project's own commands as it is planned. |
| Inheritance is explicit and overridable; no hidden magic settings. | Every resolved field carries its source and what it shadows (`policy-resolution.test.ts`); the defaults of the playback rules are never written into a group (`playback-rules.test.ts`, "default to rules the policy takes"); an inheriting member's rack is held to its inherited processing by the validator (`state-validation.test.ts`, "is the chain the nearest group that sets processing names", "is any rack, or none, where the member owns its processing, one equal to its group’s included"); `project.set-rack` makes an inheriting member own its processing in the same step (`rack-commands.test.ts`). |
| Loop suggestions never silently replace user loop points. | The analysis returns a value and runs no command (`analyse-loop.ts`); the worker keeps the loop as it was on failure and cancellation (`detection-host.jobs.test.ts`). `loop.apply-candidate` and `loop.apply-crossfade` are the paths that move a loop, each run only by the person (`loop-panel.test.tsx`: "lists candidates, applies one only when asked, and shows the analysis stale once the loop moved"; `loop-analysis-commands.test.ts`: "loops at a candidate’s points alone, as its checks were measured"); the browser test finds nothing applied by being found. |
| Game preview is audition tooling, not the authoritative game runtime. | The simulation and plan are pure (`packages/game-audio` holds no clock, global or thread; `tests/architecture/dependency-rules.test.ts`); the History unchanged after a preview run in the browser (`tests/e2e/game-workflows.spec.ts`) and in the commands ("plays the scenario set up and changes nothing of the project"). |

## Known limitations

- The game preview pans to stereo and folds to the project's layout;
  elevation on surround or binaural output is a later decision (the plan's
  Q4).
- A looping region with a stateful rack is rendered from the region's start,
  so a reverb's tail at the loop's head is the intro's; the analysis reports
  such a seam. Rendering it wrapped changes `ADR-0060`'s rule and is the
  maintainer's decision (the plan's Q7), open for the maintainer.
- The game-audio browser test runs in Chromium only. Owed to Phase 14.
- Recipes as project objects, folder templates, Godot import files and
  resources, variation sets, weighted and sequential selection and batch
  jobs with retry are Phases 11 and 13's (`CHG-0001`).
- The review lenses and the adversarial review the packet names are deferred
  to the review after the whole specification is implemented
  (`reviews/phase-10-review.md`).

## Dependencies added, and their review

None from outside the repository: `pnpm-lock.yaml` gains only workspace
links for the new packages and edges.

## Migration and schema impact

`version.json` raises `projectDocument` to version 10 (`563c8ae8`): a loop
persists its crossfade's shape, the document gains the member `gameAudio`
and the tree the file `project/game-audio.json`, a history node's affected
entities gain `gameGroups` (read as optional, so a node written before reads
as affecting none), and an export record's file gains its folder.
`projectStorage` and `userPreferences` are unchanged. Before 1.0 nothing
migrates (`REQ-STOR-052`): a document or tree of version 9 is refused with the
reason ("a document of version 9, from before asset groups, as version 10
reads", `project-json.test.ts`; "refuses a tree of version 9, from before
asset groups, as version 10 reads", `project-tree.test.ts`). Scenarios
joined the member within the same version (`0c5d60e5`), written sorted by
identifier.

## Screenshots and recordings

None kept in the tree. The game-audio flows are checked through the page by
`tests/e2e/game-workflows.spec.ts`, whose run is recorded above.

## Requirement-to-evidence mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| `REQ-GAME-120` Asset Groups and Inherited Game-Audio Policy | Groups in one forest, members in assignment order, nine policy fields with overrides, resolution with source and shadowed values, processing heard through the member's rack with `inherit` or `own` as the one record, chain users counting groups, validation naming the owner, game commands with inverses, persistence and history; the built-in game chains. The Asset groups panel, the Inspector's Game policy section and the shell's group, naming, export and loudness commands. | `policy-resolution.test.ts`, `policy-resolution.properties.test.ts`, `state-validation.test.ts`, `processing-realisation.test.ts`, `chain-users.test.ts`, `inherited-policy.test.ts`, `playback-rules.test.ts`, `group-commands.test.ts`, `membership-commands.test.ts`, `member-setting-commands.test.ts`, `rack-commands.test.ts`, `game-audio-json.test.ts`, `project-tree.test.ts`, `history-json.test.ts`, `game-differences.test.ts`, `game-chains.test.ts`, `processing-library-store.test.ts`; the `chainUsers` rule in `dependency-rules.test.ts`. |
| `REQ-GAME-121` Seamless Loop Analysis and Validation | Every check the requirement lists (discontinuity, DC, level, phase, click, zero-crossing, spectral, crossfade, cycle stability) with verdicts and references; candidates and micro-crossfades under the person's control; cycle and seam audition plans; the loop's crossfade heard in the region's plan, so export writes the crossfaded audio under unchanged loop points (Phase 09's loop metadata). The Loop panel, its commands and its auditions. | `analyse-loop.loop-golden.test.ts`, `seam-metrics.test.ts`, `verdicts.test.ts`, `candidate-search.test.ts`, `search-bounds.test.ts`, `crossfade-suggestion.test.ts`, `crossfade-suitability.test.ts`, `audition-plans.test.ts`, `analyse-loop.properties.test.ts`, `loop-crossfade.test.ts`, `loop-crossfade-property.test.ts`, `detection-worker-core.loop.test.ts`, `detection-host.jobs.test.ts`; `pnpm run test:loop-golden`. |
| `REQ-GAME-122` Game-Context Preview Simulator | Rapid and hand triggering, selection with repetition avoidance, pitch, gain and offset variation, voice limits, stealing and cooldowns, 2D and 3D attenuation with Godot 4's laws and distance filter, panning and movement as automation, buses, seeded determinism, built-in event parameters; the continued programme; the reference vectors Phase 11 consumes; scenarios kept in the project with their commands. The Game preview panel and its run through the transport, forgetting what it has heard. | `selection.test.ts`, `cooldown.test.ts`, `voice-stealing.test.ts`, `voice-budget.test.ts`, `motion.test.ts`, `preview-draws.test.ts`, `preview-scenario.test.ts`, `preview-subjects.test.ts`, `preview-simulation.properties.test.ts`, `preview-vectors.test.ts`, `preview-plan.test.ts`, `extend-preview-plan.test.ts`, `preview-chains.test.ts`, `hand-trigger.performance.test.ts`, `scenario-commands.test.ts`; `spatial-panner.golden.test.ts`, `spatial-panner.test.ts`, `spatial-panner.properties.test.ts`; `chain-automation.test.ts`, `varispeed.test.ts`, `preview-streams.test.ts`; `plan-continuation.test.ts`, `feeder-continuation.test.ts`, `continued-programme.test.ts`, `playback-control.test.ts`; `counter-draw.test.ts`. |
| `REQ-GAME-075` Guided Task Workflows | Six planners of ordinary project command invocations, each item planned, skipped or refused with its target (`packages/guided-workflows`); their dialogs, analyses and one-step dispatch (`apps/web/src/shell/workflows/`, `commands/workflow-*.ts`); the report helpers a planner reads (`report-reading.ts`) and loudness measurement. | `cut-into-sounds.test.ts`, `prepare-one-shot.test.ts`, `create-seamless-loop.test.ts`, `normalise-game-sfx.test.ts`, `clean-dialogue.test.ts`, `export-for-godot.test.ts`, `workflow-plan.test.ts`, `silence-reading.test.ts`, `chain-ending.test.ts`; `workflow-dispatch.test.ts`, `guided-workflow-commands.test.ts`, `workflow-dialog.test.tsx`, `workflow-analysing.test.ts`, `workflow-draft-store.test.ts`; `report-reading.test.ts`, `loudness-run.test.ts`; `tests/e2e/game-workflows.spec.ts`. |
| `REQ-GAME-023` Game-Audio Features | Item by item below. | Below. |

`REQ-GAME-023`, item by item (the deliverer of each is `CHG-0001`'s):

| Item | Phase 10's evidence, or its deliverer |
| --- | --- |
| Seamless-loop creation, loop-point editing, zero-crossing loop assistance, loop auditioning | Loop analysis and candidates (`packages/loop-analysis`), the shared zero-crossing boundary (`zero-crossing-boundary.test.ts`, `seam-metrics.test.ts`: "are the frames from each boundary to the nearest crossing inside the region"), the crossfade shape (`edit-commands.test.ts`: "gives a loop’s crossfade the shape named, equal power where none is, and refuses one no fade has"), audition plans (`audition-plans.test.ts`) and the continued programme. Create Seamless Loop (`create-seamless-loop.test.ts`), the Loop panel and audition commands (`loop-panel.test.tsx`, `loop-audition-commands.test.ts`, `loop-audition.test.ts`). |
| One-shot preparation, silence trimming | Prepare One-Shot and Cut Into Sounds (`prepare-one-shot.test.ts`, `cut-into-sounds.test.ts`, `silence-reading.test.ts`, `workflow-dispatch.test.ts`), over `report-reading.test.ts`. |
| Batch conversion, batch export | Many members as one itemised plan run as one Phase 09 batch (`game-export-plan.test.ts`), into relative folders (`export-delivery.test.ts`, `exports-client.test.ts`). `game.export-group` and `game.export-members` (`game-commands.test.ts`: "exports each member by its profile and name into the destination folder, leaving the project’s last settings", "exports the members named by their keys, each by its own policy"; `planned-export.test.ts`). Batch jobs with scheduling, retry and resume: Phase 13. |
| Controlled random variation generation | Pitch, gain and start-offset variation in the preview (`preview-simulation.properties.test.ts`). Generating and exporting variants: Phase 13 (`REQ-GAME-022`). |
| Sample-rate, bit-depth and mono/stereo conversion; export presets | Phase 09's settings, reached through a profile (`member-export-settings.test.ts`: "are the settings the preset it came from resolves to, with the range and name of the member"; `game-export-profile.test.ts`: "keeps every built-in preset's format and choices"). `game.apply-preset-to-group` (`apps/web/src/commands/game-profiles.ts`). |
| Loudness matching | The `loudness` field (`loudness-target.test.ts`), measurement (`loudness-run.test.ts`: "reads what loudness normalisation measures: the same integrated loudness and true peak"), the game chains. Normalise Game SFX (`normalise-game-sfx.test.ts`) and the conformance report (`loudness-conformance.test.ts`: "conforms within the tolerance, and says by how much it is off outside it", "holds the true peak to the ceiling before the loudness"). |
| Naming templates, region naming | `naming-template.test.ts`, `member-naming.test.ts`, `case-modifiers.test.ts`, `template-grammar.test.ts`, `member-names.test.ts`. `game.name-members` (`apps/web/src/commands/game-naming-commands.ts`). |
| Godot-aware export, Godot project integration | Export for Godot's profiles, names, paths and loop override (`export-for-godot.test.ts`: "reaches the state an expert reaches setting each policy and the loop override by hand", "gives no override where the group exports WAV, which holds the loop already"). Godot's import files, resources and project folders: Phase 11 (`REQ-GODOT-024`). |
| Game-oriented processing presets | `game-chains.test.ts` ("holds the chains this phase decided, by name, in the order the library lists them", "is valid against the catalogue, each chain running on mono and stereo"); `processing-library-store.test.ts` ("lists them first, in their order and marked built-in, before the person’s own", "never replaces, renames or removes one, and keeps nothing of it in storage"). |

## Commits

Oldest first, on `phase/10-game-audio-tooling`, from `main` at `43968c5b`; a
merge lists its unit's commits beneath it:

- `c8164dbd` Plan Phase 10 game-audio tooling
- `61bd8f1a` Revise the Phase 10 design after review
- `10e519bf` Guard chain users and add the game workflows run
- `790c1059` Merge WU-10.D1: the counter draw moves into the domain
  - `9061ca88` Move the counter draw into the domain
- `7d95a79f` Merge WU-10.A1: naming templates and game export profiles
  - `91a6182e` Add naming templates and game export profiles
- `e65f264f` Merge WU-10.D2: spatial panner, chain automation and game chains
  - `ebb2d4f0` Add the Godot spatial panner processor
  - `993dbd8c` Add the built-in game processing chains
  - `4b2e3870` Move the panner's kernel into its own module
  - `7fd11514` Run plan automation of a chain's parameters
  - `dab6bcc7` List the game chains in every processing library
  - `5939f2dc` Hold the library tests to the person's own entries
  - `73cee298` Wrap the new comments at the written width
- `a8dd756d` Record Phase 10 integration progress
- `37461b2d` Merge WU-10.A2: asset groups and inherited policy
  - `00bb4fd9` Add asset groups and inherited policy
- `26d1dfec` Merge WU-10.A6: delivery into a relative folder
  - `cf95926a` Deliver exports into a relative folder
  - `52e967f3` Pin that cancelling makes no more folders
  - `6b3273bb` Rewrap the comments the delivery change touched
- `c6677d89` Merge WU-10.D3: continue a playing programme into a new plan
  - `bf2860b5` Continue an edited source into a new plan
  - `6c87c742` Export the edited source from the audio engine
  - `647b66f6` Continue the playing programme through the feeder
  - `dc1a7346` Export the continuation outcome from the runtime
  - `1842e281` Continue a programme from the playback control
  - `44d25800` Wrap the continuation comments at 80 columns
  - `b50d9937` Record the public contracts
- `2b71bdcf` Merge WU-10.C1: loop analysis core
  - `a14a190f` State the zero-crossing boundary once
  - `3dcf5488` Publish the domain's fade gain
  - `9b9f60e6` Analyse loop seams and suggest better loops
  - `c10e8603` Wrap the loop analysis comments to their width
- `3fa1ca5e` Merge WU-10.A3: the game export plan
  - `8d1fcb46` Plan a group's export and name its regions
  - `9d64a99e` Refuse a member asked for twice in an export
- `fab28094` Merge WU-10.C2: loop analysis and loudness in the detection worker
  - `f7ea8898` Give the Blackman-Harris window one authority
  - `8d042c1c` Pin the loop envelope and DC spans to time
  - `0981aefc` Read assistant reports in detection-runtime
  - `d115845c` Let detection-runtime depend on loop-analysis
  - `1c6ff73a` Analyse loops and measure loudness in the worker
  - `bddb9c30` Rewrap the new comments to the comment width
- `3ed20b6a` Merge WU-10.P: loop crossfades, varispeed streams and chain automation in the plan
  - `acbb599d` Hear a loop's crossfade in its region's plan
  - `b807a5ed` Add varispeed streams and chain automation
  - `918789ef` Rewrap the new comments at the written width
- `563c8ae8` Raise the project document to version 10
- `d7b07571` Record Phase 10 progress after wave 3 began
- `155e9e39` Merge WU-10.A4: asset groups in the project document and history
  - `aed90bc7` Let the project format and history read groups
  - `55f7a45d` Keep asset groups in the project document
  - `c35d648e` Record the folder an exported file went to
  - `3fab0535` Tell asset group changes apart in the history
  - `7d0ef994` Say asset group differences in the History panel
- `593091fa` Merge WU-10.D4: the game preview simulation and its plan
  - `28f40215` Give the game preview the engine and the hash
  - `9a6c6d39` Simulate the game preview and play it as a plan
- `4e6ba6cd` Merge WU-10.A5: the game project commands
  - `f1e3a1e8` Count a group's chain as one of its users
  - `6f2257b6` Add the asset group commands
  - `33eb51f6` Ask a changed loop for its crossfade's lead
  - `99139ef0` Hold a moved start of a short loop to its rule
- `5a7e0693` Rewrap game-audio comments to the comment width
- `61fe7563` Merge WU-10.D4 part 2: preview scenarios in the project
  - `0c5d60e5` Keep preview scenarios in the game-audio state

- `e989e3cc` Merge the Phase 10 evidence draft
  - `084294ad` Draft the Phase 10 evidence and review record
- `48f8c071` Merge WU-10.E2: the Loop panel and loop auditions
  - `cc40d2ca` Show a loop metric's threshold to its reader
  - `4cc866dd` Add the Loop panel and loop auditions
- `720d4c95` Merge WU-10.B: the guided workflow planners
  - `7756f753` Offer the case a naming token is written in
  - `9a2026f7` Add the guided workflow planners
- `3c12e1a9` Merge WU-10.E1b: the guided workflow dialogs
  - `5ce8d76f` Add the guided workflow dialogs
  - `87f1698e` Style the Loop panel and the workflow dialogs
- `9cea6fc2` Merge WU-10.E3: the game preview panel
  - `2d7f613f` Time a hand trigger by its thread's processor time
  - `0ecedebc` Hold the preview plan to the real processors
  - `e9b82631` Play a game preview run through the transport
  - `db378af6` Add the Game preview panel and its commands
  - `45f54f66` Answer the emitter a trigger names apart from refusals
  - `7e314d78` Prepare members' renders before a preview runs
  - `aaa9341b` Rewrap the preview's comments to the comment width
- `c089f3c2` Merge WU-10.E1a: groups, inherited policy and game export in the interface
  - `6e17a4b6` State the folder-segment rule once
  - `78df746a` Count a group's chain among a rack's users
  - `465329d3` List the built-in chains apart in the Library
  - `ae0c68a9` Export planned files each with their own settings
  - `01ce56d6` Add the asset group commands to the shell
  - `579cc959` Add the Asset groups panel and the game policy
  - `f2c2e0d1` Split the game modules and list their exports
  - `0a03cff4` Say when a recommendation makes a member own its rack
  - `6bf033f4` Style the asset group tree and members table
  - `ff0bcb5a` Format the recording views test
  - `387d040c` Merge the phase branch: E1b's workflow dialogs
  - `ec705a5d` Measure and export the members a workflow names
- `8b793cb1` Merge WU-10.F: the game workflows browser test
  - `bea37035` Add the game-audio workflows browser test
- `39a4885e` Merge WU-10.FX: the final integration fixes
  - `291d875b` Quote names in game-audio refusals with quoted
  - `00a727eb` Name the owner of a game policy value refused
  - `7773da56` Record the game export plan's review in the band
  - `55ba4279` Move the panel context and parts out of panels
  - `47438def` Bind T to the Game preview's hand trigger
  - `1c2ed9ea` Analyse an unlooped region whole for Create Seamless Loop
  - `5b5e524a` Record the review of the default bindings table
  - `a14f67ee` Let a group command run on the group it names
  - `121a40f3` Let a plan stream state the frames it has forgotten
  - `f6984b87` Name the unread context of a test availability
  - `e80d3951` Forget what a preview has heard, in plan and log
  - `ff40b06a` Forget behind the listener in a preview's run
  - `08beafbd` Lay a cut looping voice's run as far as it sounds
  - `9cc42ae3` Read a refusal by its reasons in a group test
  - `968843d7` Wrap the new comments at the comment width

The commit that completes this package, the review record and the handoff
follows on `p10/wu-10-z2`, and the integration commit is the merge into
`main`.

## The maintainer's decisions of 2026-10-16

1. **Reviews.** The packet's lens reviews and its adversarial review, with
   their verification, remediation and re-review, are deferred to the review
   after the whole specification is implemented, as Phase 09's were
   (`reviews/phase-10-review.md`).
2. **Gates.** The work units ran the narrow gates of what they changed (the
   type checks, lint, the dependency rules, the architecture and repository
   tests and the Vitest projects they touched); the integrator ran one full
   `pnpm run verify:commit` over the phase branch for each wave of merges.
3. **Mutation proofs.** A test written after the code it guards no longer
   needs a per-test proof by mutating that code, for this phase's units.

## Open questions settled

- **Q1 (Export for Godot).** Settled from Godot 4's documentation: Godot reads
  a WAV file's loop (its `smpl` chunk) when the file's import loop mode is
  "Detect From WAV"; an Ogg Vorbis file loops only from its import settings,
  never from `LOOPSTART` comments. Export for Godot says so, and gives a
  loop override only where the group exports a format that does not hold the
  loop (`export-for-godot.test.ts`: "gives no override where the group exports
  WAV, which holds the loop already").
- **Q2, Q3, Q5** were answered by WU-10.D3, WU-10.D2 and WU-10.D4 (the
  plan's section 15). **Q4** stays a later decision (Known limitations).
- **Q7** (a looping region's rack rendered wrapped) is open for the
  maintainer: it changes `ADR-0060`'s rule that a rack runs from its
  target's start.

## Accepted deviations from the design

Each was taken by the unit that built it, against the plan and the ADRs, and
is recorded in the plan and the ADR it changes (amended 2026-10-16):

| Deviation | Why, and its evidence |
| --- | --- |
| Removing a region or an asset in a group takes its membership with it, restored by undo at its place with its processing and overrides; the plan had the remove commands refuse a member (`region.in-group`, `asset.in-group`). | A refusal made the person take the member out first, in another step, and the interface compose it; the membership is part of the region's state, so the remove carries it and its inverse restores it. "leaves its group as it is removed, and rejoins at its place as it is added back" (`asset-commands.test.ts`, `editing-commands.test.ts`); "refuses a membership it is added with that names no processing". |
| `project.restore-region`, the inverse of `project.set-region`, sets a region back without asking its loop for its crossfade's lead. | A loop may be read back, or left by an earlier edit, with less audio before its start than its crossfade reads (the clamp hears it shortened); undo must restore it as it was. "keeps a loop read back without its lead while the change leaves it alone, and undo restores one", "refuses a start moved into the frames the crossfade reads" (`editing-commands.test.ts`). |
| Every seam metric compares with the region's own audio by its reference, beyond the plan's formulas: the discontinuity subtracts the smaller deviation of the region's natural joins; the residual's MAD and the spectral bands are floored also at 60 dB under the level of what plays; the drift and the zero-crossing signs compare with the audio after E or before S where the region has it. | A drum loop's hit after its decay, or a pure tone's rounding noise, read as failures under the plan's formulas. "finds a click at the head, which only the audio before S also has", "count the channels whose sign after the seam differs from the region's own after E", "is the audio before S where the region ends at E", "finds a loop taken from a fade, whose start is louder than what follows its end" (`seam-metrics.test.ts`); the goldens. |
| Refusal codes: `editing.loop-crossfade-without-lead` for the plan's `region.loop-crossfade-without-lead`; `editing.payload-varispeed` and `editing.payload-automation` for the plan's `edit.payload-varispeed`; `game.policy-profile-invalid` raised per member at planning, not by the state validator. | The domain's placement and operation validation name their failures `editing.`; a profile's shape is held by its type and its reader, and whether a member's audio takes it is known only at planning. `preview-streams.test.ts` ("is refused, as a project keeps neither"), `loop-crossfade.test.ts`, `game-export-plan.test.ts`. |
| The spatial panner's laws are Godot 4's as its source states them (the plan's Q3): the ceiling caps the attenuation alone; the inverse models fade by `1 − d/max` to the maximum distance, and 0 is no maximum; the 3D pan is the horizontal angle's cosine and the 2D pan linear, each scaled by a panning strength, a parameter the plan lacked; a stereo source has each channel scaled by its own side; the distance filter is Godot's high shelf, its linear gain the cookbook's `A`, floored at −60 dB. | `emitter-laws.ts` cites `audio_stream_player_3d.cpp`, `audio_stream_player_2d.cpp` and `audio_filter_sw.cpp`. `spatial-panner.golden.test.ts` ("caps a near emitter at the ceiling, however close it is", "filters an attenuated emitter by Godot's high shelf, cut by its gain at the cutoff and twice that above"), `spatial-panner.test.ts` ("scales each channel of a stereo source by its own side, with no cross-feed"). Two differences from Godot remain, recorded for the post-specification review and Phase 11's parity tests: Godot caps the attenuation and the player's `volume_db` together where the panner caps the attenuation alone (a voice's gain is its own stage), and the panner filters each channel before it applies its gain, where Godot filters after, which differ only while the gain moves (`panner-kernel.ts`). |
| The emitter rules' attenuation takes a maximum distance of 0 for no limit, as Godot and the panner do, and every distance keeps to the panner's ranges (a unit size from 0.01, every distance at most 1,000,000), so a validated scenario always becomes a plan. | "take a maximum distance of 0 as no limit, as Godot and the spatial panner do", "hold a distance to the spatial panner's range: a unit size from 0.01, every distance at most 1,000,000" (`playback-rules.test.ts`); "is made at the ends of each distance the policy takes, no limit among them" (`preview-chains.test.ts`). |
| A hand trigger's simulation is held to 1 ms and its simulation and plan extension together to 5 ms; the plan asked 1 ms of both. | Measured on the reference machine: the simulation 0.5 to 0.7 ms, the extension 1.3 to 2.5 ms, most of it laying again every lane sounding across the trigger; 5 ms is a tenth of the shortest feed-ahead (50 ms). "is simulated within 1 ms and planned within 5 ms in all" (`hand-trigger.performance.test.ts`), which measures the thread's processor time (`2d7f613f`), not the wall clock. |
| The preview's simulation and plan building run on the page, beside the playback control that sends them, as the plan's section 10 places them, and cost 2 to 3 ms a hand trigger in all as the panel runs them, where the design first asked 1 ms. | A twentieth of the shortest feed-ahead (50 ms); a worker would add a message each way to every trigger's latency. "starts a hand trigger at the frame the feeder reads next" (`apps/web/src/audio/preview-run.test.ts`). |
| A preview forgets what it has heard, every 5 s of playback, 1 s behind the listener, in its simulation and its plan (`forgetPreviewBefore`, `forgetPreviewPlanBefore`), each changed stream stating `forgottenBefore`; the plan laid its plan afresh at a silent moment. | A never-stopped loop or overlapping triggers have no silent moment, so the plan and log grew without end (B-03 in the review record). "holds a plan and a simulation no larger after eight minutes than after two" (`preview-forgetting.test.ts`); "keeps every reader and sounds on bit for bit where the forgetting is stated" (`plan-continuation.test.ts`). |
| Create Seamless Loop analyses a region that does not loop over its whole length, joined hard, the candidate loop its request names; the Loop panel and the auditions read only a loop the region has. | The workflow could otherwise never ask its analysis (`1c2ed9ea`). "analyses the whole of a region that does not loop as the loop Create Seamless Loop asks for" (`workflow-dialog.test.tsx`). |
| The voice budget is `previewVoiceBudget(grade, variations)`, not one constant: a voice's varispeed costs taps in proportion to its faster step, and its tables up to about 35 MB at High; so 2 to 7 voices at High and 8 to 26 at Draft where pitch varies, and every voice the scenario can sound where none does. The preview plays at the person's preview quality (`ADR-0061`), not the render's. | `voice-budget.ts`'s measured table; "is every voice a preview can sound where no voice varies its pitch", "falls as the costliest pitch any member may draw rises" (`voice-budget.test.ts`). The preview run plays at the person's preview quality, as the transport plays everything (`apps/web/src/audio/preview-run.ts`). |
| A selection takes `⌊h·n / 2³²⌋` of the draw's integer word, not `⌊u·n⌋` of its double; milliseconds become frames rounded half up. | The double product can round across a boundary, which a GDScript runtime would not reproduce. "chooses ⌊h·n / 2³²⌋ exactly, where the double product ⌊u·n⌋ may not", "is rounded half up from milliseconds at the rate" (`preview-draws.test.ts`); the vectors. |
| Scenarios joined `GameAudioState`, the document and the commands in a second part of WU-10.D4, after WU-10.A4 and WU-10.A5 merged, rather than with the simulation; removing a group, taking a member out of its group, or removing its region or asset is refused while a scenario plays it (`game.subject-played`), which the plan did not state. | The persistence and commands were handed over to keep one owner a file. "keeps its group: removing it is refused naming the scenario", "keeps its member in its group, refusing to take it out", "keeps its member in the project, refusing to remove its region" (`scenario-commands.test.ts`); "refuses an emitter playing a group the state lacks, naming the scenario and the emitter" (`state-validation.test.ts`). |
| The packet's lens reviews and adversarial review are deferred to the review after the whole specification is implemented, replacing section 16's pipeline; the units ran narrow gates with one full suite per wave of merges; per-test mutation proofs were not required. | The maintainer's decisions of 2026-10-16 (above; `reviews/phase-10-review.md`). |

## Accepted non-blocking debt

Each is `LOW`, tracked here and in the handoff, and owed to the review after
the whole specification is implemented unless named otherwise:

| Debt | Why it does not block |
| --- | --- |
| The browser test does not apply the built-in "Game SFX, −16 LUFS" library chain (the plan's section 13 names it). | The chain's validity and its listing are held by `game-chains.test.ts` and `processing-library-store.test.ts`, and the conformance report by `loudness-conformance.test.ts`; only its application through the page is unexercised. |
| `packages/guided-workflows`' refusals quote names with straight quotes, where every command's text and, since `291d875b`, `packages/game-audio`'s refusals quote with `@audiogubbins/text`'s `quoted`. | Wording only: the refusal is raised and shown the same. |
| The preview's simulation and plan building run on the page, 2 to 3 ms a hand trigger. | A twentieth of the shortest feed-ahead (Accepted deviations). |
| Tests that time out at 5 s under the whole suite's load and pass alone: `model-packs` `integrity.test.ts`'s hand-over test, `tests/architecture/browser-floor.test.ts`, the architecture test "calls what the library declares above the floor only where it is guarded", `project-format`'s zip interoperability test through Python and `storage`'s project-transfer round trip's seeds. | Load-dependent time limits outside this phase's logic; each passes run alone (Results). |

## Reviewer findings and remediation

`reviews/phase-10-review.md` records the maintainer's decision that defers
every lens and the adversarial review to the review after the whole
specification is implemented, and the two design-stage adversarial reviews
that ran before any code: an architecture review of 14 findings and a DSP
review of 24, each verified and disposed of by the plan's revision
(`61bd8f1a`), and the defects the build found, B-01 to B-09, each fixed on
the phase branch with the commit that fixes it and the tests that hold it.
None is open.
