# Phase Handoff Capsule — Phase 10

## Capability Delivered

AudioGubbins authors game audio. The person organises sounds and regions into
hierarchical asset groups such as `Footsteps/Grass`, and every member resolves
nine policy fields (processing, loudness, export profile, naming, destination,
playback rules, bus, voice variation and tags) field by field from its own
override or the nearest group that sets it, each answer naming its owner and
what it shadows (`ADR-0101`); a member's processing is heard through its own
rack, `inherit` or `own` the one record of where it comes from. Naming
templates in one grammar with modifiers, game export profiles and relative
destination paths resolve to Phase 09's export settings, and many members
export as one itemised plan, each item planned or refused with its owner,
into a relative folder made where absent (`ADR-0102`). Loop analysis measures
every seam check `REQ-GAME-121` lists against the region's own audio by a
stated reference, ranks candidates from one bounded streamed pass and
suggests micro-crossfades, and a loop's crossfade is heard in its region's
plan, so export writes what is heard (`ADR-0103`). A seeded game-preview
simulation triggers groups as a game would, with selection, variation, voice
limits, stealing, cooldowns, Godot 4's attenuation, panning and distance
filter by a canonical `spatial-panner`, and moving emitters, played as a plan
the engine continues without a break and forgets behind the listener
(`ADR-0104`). Six guided workflows (Cut Into Sounds, Prepare One-Shot, Create
Seamless Loop, Normalise Game SFX, Clean Dialogue, Export for Godot) plan
ordinary project commands, shown item by item before they run and applied as
one undoable step (`ADR-0105`). The game-audio state is one member of the
project document (`ADR-0106`). The Asset groups panel, the Inspector's Game
policy section, the Loop panel, the Game preview panel and the workflow
dialogs show it all in the Game Audio workspace.

## Requirements Satisfied

The owned requirements are mapped to their implementation and their evidence
in `reviews/phase-10-evidence.md`, under "Requirement-to-evidence mapping",
`REQ-GAME-023` item by item with the deliverer `CHG-0001` names for each.

- `REQ-GAME-023`
- `REQ-GAME-075`
- `REQ-GAME-120`
- `REQ-GAME-121`
- `REQ-GAME-122`

## Public Contracts Introduced or Changed

Every entry point's exported names and members are recorded in
`tests/architecture/public-contracts.txt`, which
`tests/architecture/public-contracts.test.ts` holds to the code. The evidence
maps the packet's contract names to them. By package:

- `@audiogubbins/game-audio` (new, portable): groups and membership
  (`GameAssetGroup`, `GameAssetGroupId`, `GroupMember`, `GroupMembership`,
  `MemberProcessing`, `GameAudioState` with its `scenarios`); policy
  (`InheritedPolicy`, `PolicyOverrides`, `OverridableField`, `POLICY_FIELDS`,
  `PolicyValues`, `EffectivePolicy`, `GroupEffectivePolicy`, `Resolved`,
  `PolicySource`, `resolvePolicy`, `resolveGroupPolicy`, `resolveAll`,
  `validateGameAudioState`, `inheritedProcessing`, `inheritingRacks`,
  `projectChainUsers`); export (`NamingTemplate`, `namingTemplate`,
  `memberNames`, `GameExportProfile`, `profileFromPreset`,
  `memberExportSettings`, `DestinationPath`, `GameExportPlan`,
  `GameExportItem`, `planGameExport`); the preview (`GamePreviewScenario`,
  `PreviewEmitter`, `Listener`, `Motion`, `TriggerPattern`, `EmitterRules`,
  `VoiceVariation`, `PreviewInput`, `PreviewSimulation`, `PreviewEventLog`,
  `simulatePreview`, `forgetPreviewBefore`, `previewPlan`,
  `extendPreviewPlan`, `forgetPreviewPlanBefore`, `previewVoiceBudget`); its
  `./testing` entry (`randomGameWorld`, `randomScenario`, `seededRandom`,
  `PREVIEW_TEST_CATALOGUE`).
- `@audiogubbins/loop-analysis` (new, portable): `LoopAnalysisRequest`,
  `LoopAnalysis`, `LoopMetrics`, `LoopMetric` with its verdict and threshold,
  `LoopCandidate`, `analyseLoop`, `loopAuditionPlan`, `extendedAuditionPlan`,
  and the loop fixtures.
- `@audiogubbins/guided-workflows` (new, portable): `GuidedWorkflow`,
  `WorkflowInput`, `WorkflowOptions`, `WorkflowTarget`, `WorkflowPlan`,
  `WorkflowItem`, `WorkflowDispatch`, `workflowDispatch`, `itemKey`,
  `targetMembers`, and `CUT_INTO_SOUNDS`, `PREPARE_ONE_SHOT`,
  `CREATE_SEAMLESS_LOOP`, `NORMALISE_GAME_SFX`, `CLEAN_DIALOGUE`,
  `EXPORT_FOR_GODOT` with their options.
- `@audiogubbins/domain`: the counter draw (`lowbias32`, `uniformDraw`); a
  loop's `crossfadeShape` and the placed `crossfadeClampedFrom`; the plan's
  varispeed stream (`numerator / 4096`), plan-chain automation and a stream's
  `forgottenBefore`, each refused in a persisted payload
  (`editing.payload-varispeed`, `editing.payload-automation`).
- `@audiogubbins/audio-engine`: the zero-crossing boundary; plan divergence
  and reader continuation, comparing a stream only from its
  `forgottenBefore`; varispeed reading; the preview stream key.
- `@audiogubbins/audio-runtime`: the continued programme
  (`PlaybackSessionPort.continueWith`, `readFrame`, the feeder's
  continuation, `playback.continuation-too-late`).
- `@audiogubbins/processors`: the `spatial-panner` type with Godot 4's laws;
  `BUILT_IN_LIBRARY`, the five built-in game chains.
- `@audiogubbins/effect-rack`: plan-chain automation evaluated at the
  processor's design interval.
- `@audiogubbins/import-export`: the template grammar's modifiers and
  vocabularies (`readTemplate`, `escapeTemplateText`); `folderSegmentProblem`,
  the one folder-segment rule.
- `@audiogubbins/storage`, `@audiogubbins/storage-runtime`,
  `@audiogubbins/browser-storage`: delivery into a relative folder, trusted
  records by relative path, the processing library's built-in entries.
- `@audiogubbins/project-format`: the `gameAudio` member and
  `project/game-audio.json`, scenarios among it; a loop's crossfade shape; an
  export record's folder; a history node's `gameGroups`.
- `@audiogubbins/history`: group, membership, override and scenario
  differences; the `game-group` entity kind.
- `@audiogubbins/project-commands`: the `game.*` commands with inverses
  (groups, membership, policy, overrides, processing, scenarios);
  `project.restore-region`; region and asset removal taking membership with
  them, refused while a scenario plays the subject (`game.subject-played`);
  `project.set-rack` making an inheriting member own its processing.
- `@audiogubbins/detection-runtime`: the `analyse-loop` and
  `measure-loudness` requests and replies; the report helpers
  (`report-reading.ts`).
- `@audiogubbins/commands`: a command's availability given the invocation it
  would run with.
- `apps/web`: the `game.*`, `loop.*`, `preview.*` and `workflow.*` shell
  commands; the Game Audio workspace's panels; default keys scoped to a
  panel's focus (`data-ag-loop-panel`, `data-ag-preview-panel`).

## Persisted / Interchange Formats

- The project document, `projectDocument` version 10: the member `gameAudio`
  and the tree file `project/game-audio.json` (groups, memberships with
  their processing and overrides, scenarios, written sorted by identifier);
  a loop's `crossfadeShape`; an export record's file's folder; a history
  node's affected `gameGroups`, read as optional. `projectStorage` and
  `userPreferences` are unchanged.
- Loop-analysis results are derived and never persisted (`CHG-0001`, C15).
- A plan's varispeed stream, plan-chain automation and `forgottenBefore` are
  plan values only: the project format never writes them.
- Trusted-folder records keyed by a relative path, in the browser's handle
  database.
- Before 1.0 nothing migrates (`REQ-STOR-052`): a document or tree of version
  9 is refused with the reason.

## Invariants Downstream Agents Must Preserve

- Inheritance is explicit: every resolved field carries its source and what
  it shadows; defaults are never written into a group; an invalid inherited
  setting is refused naming the group by its path or the member by its name.
- A membership's `processing` (`inherit` or `own`) is the one record of where
  a member's processing comes from, validated against its rack; every
  command that changes what an inheriting member inherits re-points its rack
  in the same step. `projectChainUsers` is the one reader of a chain's
  users, groups included (an architecture rule refuses a new import of the
  domain's `chainUsers`).
- The game layer adds no second settings model, preset list or name grammar:
  a profile resolves through Phase 09's `resolvePreset`, and a folder segment
  is held by `folderSegmentProblem` alone.
- Loop suggestions never move a loop: the analysis returns a value and runs
  no command; only `loop.apply-candidate` and `loop.apply-crossfade`, run by
  the person, change a loop.
- Guided workflows are planners of ordinary project command invocations: a
  plan runs only with no item refused, as one undoable step; exports and
  loudness checks follow the step and are never inside it.
- The preview is audition tooling and runs no command. `packages/game-audio`
  holds no clock, global or thread. The same seed gives the same event log; a
  continuation equals the whole; a hand trigger adds events from its frame
  only; selection is `⌊h·n / 2³²⌋` of the draw's 32-bit word and milliseconds
  become frames rounded half up.
- **The preview vectors are the reference Phase 11's Godot runtime must
  reproduce.** `PREVIEW_VECTORS` (`packages/game-audio/src/testing/preview-vectors.ts`,
  seven vectors at 48 kHz, each a scenario, its emitters' rules and pools,
  its hand actions and voice budget, and the event log it makes) are pinned
  by `preview-vectors.test.ts`. A GDScript runtime given a vector's input must
  give its log event for event; a change to a vector is a change to the
  contract both sides keep. The spatial panner's laws are Godot 4's as its
  source states them, with two differences recorded for Phase 11's parity
  tests: the ceiling caps the attenuation alone, where Godot caps it with the
  player's `volume_db`; and the panner filters before its gain, where Godot
  filters after.
- A continued programme keeps every live reader whose stream is unchanged up
  to the switch frame (WU-10.D3's gate, tests (a) to (c)); there is no
  fallback of restarting playback. A stream's `forgottenBefore` is stated
  only by a preview's plan, and a continuation never goes on from a frame it
  has forgotten.
- A subject a scenario plays is kept from removal (`game.subject-played`).

## ADRs

- `ADR-0100` — the game-audio package topology; accepted 2026-10-16.
- `ADR-0101` — asset groups and inherited policy; amended and accepted
  2026-10-16.
- `ADR-0102` — naming templates, export profiles and destinations; amended
  and accepted 2026-10-16 (the public `folderSegmentProblem`).
- `ADR-0103` — loop analysis, suggestions and loop crossfades; amended and
  accepted 2026-10-16.
- `ADR-0104` — the game preview simulator; amended three times and accepted
  2026-10-16 (Godot 4's laws; the draws, voice budget and hand trigger's
  cost; forgetting what was heard).
- `ADR-0105` — guided workflows as command plans; accepted 2026-10-16.
- `ADR-0106` — game-audio persistence and state ownership; amended and
  accepted 2026-10-16.
- `CHG-0001` — Phase 10's scope and ownership against Phases 05, 09, 11 and
  13; accepted 2026-10-16.
- `ADR-0051` and `ADR-0060` — amended by `ADR-0103` and `ADR-0104` (the heard
  crossfade, the varispeed stream, plan-chain automation).

## Verification Baselines

- `pnpm run test:game-audio`: the Vitest projects of `game-audio`,
  `loop-analysis` and `guided-workflows`; the packet's
  `pnpm test --filter game-audio --filter loop-analysis`.
- `pnpm run test:loop-golden`: every loop fixture's analysis pinned to the
  reference's bits, at its pinned version.
- The preview vectors (`preview-vectors.test.ts`) and the spatial panner's
  goldens (`spatial-panner.golden.test.ts`).
- The continued programme's bit-identity tests (`plan-continuation.test.ts`,
  `feeder-continuation.test.ts`), the forgetting's
  (`preview-forgetting.test.ts`) and the hand trigger's cost in processor time
  (`hand-trigger.performance.test.ts`).
- `pnpm run test:project-roundtrip` and `pnpm run test:architecture`.
- `pnpm run test:e2e:game-workflows` in Chromium: a recording cut into a
  group, the inherited profile, naming and folder, Prepare One-Shot as one
  step, a loop applied only by hand, a seeded preview run twice alike with
  the History unchanged, the group exported, everything found after a
  reload.
- The final counts are in the evidence.

## Intentionally Deferred Items

Only items explicitly authorised by the specification (`CHG-0001`):

- Phase 11: export recipes as first-class project objects (`REQ-GODOT-119`),
  folder templates, Godot import files, resources and project folders
  (`REQ-GODOT-024`), and the Godot runtime's selection, which reproduces
  this phase's preview vectors.
- Phase 13: variation sets and their export (`REQ-GAME-022`), weighted and
  sequential selection, and batch jobs with scheduling, retry and resume,
  extending `packages/game-audio` through the selection union, the member
  union and the game export plan's items.
- Elevation of a preview emitter on surround or binaural output (the plan's
  Q4), a later decision.

## Accepted Non-Blocking Debt

- `LOW`: the browser test does not apply the built-in "Game SFX, −16 LUFS"
  chain through the page; the chain and the conformance report are held by
  unit tests. Owner: the review after the whole specification.
- `LOW`: `packages/guided-workflows`' refusals quote names with straight
  quotes, where command text and `packages/game-audio`'s refusals use
  `@audiogubbins/text`'s `quoted`. Owner: the review after the whole
  specification.
- `LOW`: the preview's simulation and plan building run on the page, 2 to
  3 ms a hand trigger. Owner: Phase 14's performance hardening.
- `LOW`: tests that time out at 5 s under the whole suite's load and pass
  alone (`model-packs` `integrity.test.ts`'s hand-over test,
  `browser-floor.test.ts`, the architecture test "calls what the library
  declares above the floor only where it is guarded", `project-format`'s zip
  interoperability test, `storage`'s project-transfer round trip's seeds).
  Owner: Phase 14.
- `test:e2e:game-workflows` runs in Chromium only. Owed to Phase 14.
- Q7, open for the maintainer: a looping region with a stateful rack renders
  the loop's head after the intro; rendering it wrapped would change
  `ADR-0060`'s rule. The analysis measures and reports such a seam.
- The review lenses and the adversarial review the packet names are deferred
  to the review after the whole specification is implemented
  (`reviews/phase-10-review.md`).

## Downstream Readiness

- Phase 11 — Godot Integration becomes eligible for `READY`: its hard
  dependencies, Phases 02, 03, 06, 09 and 10, have passed; its readiness
  review decides it.
- Phase 12 — PWA, Offline, and Installation Hardening stays eligible for
  `READY` since Phase 09 passed; its readiness review decides it.
- Phase 13 still waits on Phase 11; Phase 14 on Phases 11 to 13; Phase 15 on
  Phase 14.
