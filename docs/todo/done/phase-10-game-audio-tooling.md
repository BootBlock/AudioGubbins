> **Status:** Done. 2026-10-16: every work unit is built and merged, the
> build's findings are fixed and written into
> `docs/spec/reviews/phase-10-review.md`, with the review lenses and the
> adversarial review deferred by the maintainer's decision of 2026-10-16.
> The design below is amended where the build deviated from it (marked
> "Amended 2026-10-16"). Phase 10 is closed at `PASS` in the implementation
> ledger; Q7 is open for the maintainer.

# Phase 10 — Game-Audio Tooling

Resume note and design. It says what is decided, how the work is split and
what is left. The packet is
`docs/spec/phases/phase-10-game-audio-tooling.md`; the owned requirements are
`REQ-GAME-023`, `REQ-GAME-075`, `REQ-GAME-120`, `REQ-GAME-121` and
`REQ-GAME-122` (`docs/spec/requirements/game.md`). The decisions that shape
the work are `ADR-0100` to `ADR-0106`, drafted as `Proposed` because the
maintainer made the phase `READY` without a readiness review: each needs the
maintainer's acceptance before the unit that builds on it lands.

## STATUS LOG

| Date       | Entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-15 | Design and ADR drafts written on `phase/10-game-audio-tooling` over `main` at `43968c5b`. Conflicts C1–C14 recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-15 | Revised after two independent adversarial reviews (architecture, 14 findings; DSP, 24), each verified against the code and the specification. CHG-0001 records the packet and scope conflicts; C6 withdrawn; C12 rejected by the maintainer (lens reviews run); Q6 answered.                                                                                                                                                                                                                                                                                    |
| 2026-10-16 | Integrated on the phase branch: WU-10.0 (chain-users rule, game workflows run), WU-10.D1, WU-10.A1 (with the `game-audio` scaffold), WU-10.D2. Each new package lands its scaffold with its first unit. Running: D3, C1, A2, A6. Integration follow-ups owed before review: the effect rack's local automation types move to the domain plan (P), the library's built-in flag reaches the page, the 32-frame design interval gets one authority, `lowbias32` is exported when D4 uses it, and the "ahead of use" export entries are removed by their consumers. |
| 2026-10-16 | Merged: D3 (gate passed: bit-identical continuation), A2, A6, C1, A3, C2, P; `projectDocument` raised to 10. Running: A4 (persistence, history, export record sub-folder path) and D4 part 1 (simulation and plan; scenarios join the state, format and commands in part 2 after A5). Then A5, B, E1–E3, F, reviews, evidence. Integration follow-ups are tracked outside the repository and closed in the units named for them.                                                                                                                                |
| 2026-10-16 | The maintainer deferred this phase's lens reviews and adversarial review to the review after the whole specification is implemented, as Phase 09's were (section 16, Gates). Merged: A4, D4, A5, D4 part 2 (scenarios in the state, format and commands). The design and `ADR-0101` to `ADR-0104` and `ADR-0106` amended where the build deviated; the evidence and review record drafted (`docs/spec/reviews/phase-10-evidence.md`, `phase-10-review.md`).                                                                                                     |
| 2026-10-16 | Merged: E2, B, E1b, E3, E1a, F and the final integration fixes FX (the browser test's three defects, the preview's forgetting, owners named in refusals, quoting, default keys). Q1 settled. Evidence, review record and handoff completed; `ADR-0100` to `ADR-0106` and `CHG-0001` accepted; Phase 10 `PASS`; the plan moved to `docs/todo/done/`.                                                                                                                                                                                                             |

## Where the work is

|        |                               |
| ------ | ----------------------------- |
| Branch | `phase/10-game-audio-tooling` |
| Base   | `main` at `43968c5b`          |
| Head   | see `git log`, not pushed     |

`projectDocument` is 9 on `main` (`version.json`). This phase takes the next
free version when it merges (10 today); Phase 12 is also eligible for `READY`
and may take one first. `userPreferences` is unchanged.

## Gates

A unit runs the narrow gates of what it changes (the type checks, lint, the
dependency rules, the architecture and repository tests, and the Vitest
projects it touches); the integrator runs `pnpm run verify:commit` over the
phase branch once for each wave of merges; `pnpm run spec:verify` runs after
an edit under `docs/spec/`, and the packet's commands at the phase's end.
WU-10.D3's acceptance tests gate the audio-path units (section 6). The author
of a new test sees it fail once against the code it guards.

Amended 2026-10-16: the maintainer deferred this phase's independent lens
reviews and adversarial review to the review after the whole specification
is implemented, as Phase 09's were (section 16). This paragraph said they ran
before `PASS` and that every change ran `pnpm run verify:commit`.

## Contents

1. Scope and what it leaves to Phases 11 and 13
2. Package topology and dependency direction
3. Asset groups and inherited policy (WU-10.A)
4. Naming templates, export profiles, destinations, the game export plan
5. Loop definition and loop analysis (WU-10.C)
6. Game preview simulator (WU-10.D)
7. Guided workflows (WU-10.B)
8. Persisted format and state ownership
9. Commands
10. Workers and threads
11. Interface: the Game Audio workspace
12. Verification scripts
13. Test plan by requirement
14. Work units, file ownership and order
15. Conflicts and open questions
16. Reviews and evidence the phase owes

## 1. Scope and what it leaves to Phases 11 and 13

Phase 10 builds what its packet's In Scope list names, on Phase 05's edit
model, Phase 06's racks and assistants and Phase 09's export. Where its
requirements name something another phase owns, the line is drawn here by the
requirement text, and every crossing is recorded in section 15.

| Item (packet / requirement)                                                                                | Phase 10 builds                                                                                                                     | Left to                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Export recipes (`REQ-GAME-120`, `REQ-GODOT-119`)                                                           | `GameExportProfile`: one inherited profile per group or member, resolving to Phase 09's `ExportSettings`                            | Phase 11: recipes as first-class project objects, several per object, target project, live-export policy, rebuild-all (`REQ-GODOT-119`) |
| Destination paths (`REQ-GAME-120`)                                                                         | A literal relative folder path, inherited, honoured by folder delivery                                                              | Phase 11: folder templates with tokens (`REQ-GODOT-119`), Godot project targets (`REQ-GODOT-124`)                                       |
| Runtime variation policies (`REQ-GAME-120`), variation selection and repetition avoidance (`REQ-GAME-122`) | `EmitterRules` and `VoiceVariation` with `uniform` and `avoid-recent(depth)` over a group's members, on the shared seeded generator | Phase 13: variation sets, weights, sequential, ping-pong, shuffle bag, custom hooks (`REQ-GAME-112`, `REQ-GAME-113`)                    |
| "Same runtime-selection logic as the Godot addon" (`REQ-GAME-122`)                                         | The algorithms as the reference, with test vectors                                                                                  | Phase 11: the GDScript runtime held to the vectors in GUT                                                                               |
| Event parameter manipulation (`REQ-GAME-122`)                                                              | Built-in parameters: position and distance, volume and pitch offsets, bus levels                                                    | Phase 11: authored runtime parameters, curves, conditions, layered events (`REQ-GODOT-114`, `-128`, `-129`)                             |
| Batch export, batch conversion (`REQ-GAME-023`)                                                            | Many members exported as one itemised plan through Phase 09's batch                                                                 | Phase 13: `BatchJob` with bounded scheduling, retry and resume, import-edit-DSP-export pipelines                                        |
| Controlled random variation generation (`REQ-GAME-023`)                                                    | Randomised pitch, gain and start offset in preview only                                                                             | Phase 13: generating and exporting variants (`REQ-GAME-022`)                                                                            |
| Godot-aware export, Godot project integration (`REQ-GAME-023`, guided "Export for Godot")                  | Ordinary profiles, names and paths chosen for what Godot 4's importer reads                                                         | Phase 11: `.import` files, resources, manifests, project folders, live export (`REQ-GODOT-024`, `-116`, `-117`)                         |
| Sample-rate, bit-depth, mono/stereo conversion, export presets (`REQ-GAME-023`)                            | Already Phase 09's settings; reached through profiles and presets                                                                   | —                                                                                                                                       |
| Macros (`REQ-GAME-074`)                                                                                    | Workflows as plans of ordinary invocations                                                                                          | Phase 13: recorded and composed action sequences                                                                                        |

## 2. Package topology and dependency direction

`ADR-0100`. Three new packages; additions to existing ones only at seams they
own.

```
domain, audio-engine ◄── import-export ◄── game-audio ◄── project-format ◄── project-commands ◄── guided-workflows ◄── apps/web
domain, audio-engine ◄── loop-analysis ◄── detection-runtime, guided-workflows, apps/web
history ──► game-audio (its diff names groups)
```

| Package                     | Name                             | Portable | Depends on                                                                                                                                    |
| --------------------------- | -------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/game-audio`       | `@audiogubbins/game-audio`       | yes      | `domain`, `import-export`, `audio-engine` (the canonical `pow` for a pitch ratio)                                                             |
| `packages/loop-analysis`    | `@audiogubbins/loop-analysis`    | yes      | `domain`, `audio-engine`                                                                                                                      |
| `packages/guided-workflows` | `@audiogubbins/guided-workflows` | yes      | `domain`, `commands`, `game-audio`, `loop-analysis`, `processors`, `import-export`, `project-format`, `project-commands`, `detection-runtime` |

New edges on existing packages: `project-format` → `game-audio`;
`project-commands` → `game-audio`; `history` → `game-audio`;
`detection-runtime` → `loop-analysis`; `apps/web` → all three. Every new
package's tests may take `@audiogubbins/test-fixtures`
(`TESTS_TAKE_THE_FIXTURES`). The dependency cruise gains
`game-audio-owns-nothing-else`, `loop-analysis-owns-nothing-else`,
`guided-workflows-owns-nothing-else`, and `game-audio-knows-no-godot`
(nothing under the three packages reaches a path matching `godot`), which
guards the packet's forbidden shortcut now and Phase 11's packages later.

There is no `packages/export-recipes`: the packet's "export-recipes game
layer" is `packages/game-audio/src/export/` (conflict C2).

Source layout of the new packages (one responsibility per file; tests beside
their source; `src/index.ts` the public entry, `src/testing/index.ts` the
test-support entry):

```
packages/game-audio/src/
  groups/      group-ids.ts, game-asset-group.ts, group-names.ts, group-forest.ts,
               membership.ts, game-audio-state.ts, state-validation.ts
  policy/      policy-fields.ts, inherited-policy.ts, loudness-target.ts,
               bus-name.ts, playback-rules.ts, policy-validation.ts,
               policy-resolution.ts, processing-realisation.ts, chain-users.ts
  export/      naming-template.ts, naming-vocabulary.ts, case-modifiers.ts,
               member-naming.ts, destination-path.ts, game-export-profile.ts,
               member-export-settings.ts, game-export-plan.ts, member-names.ts
  preview/     preview-scenario.ts, preview-draws.ts, selection.ts, voice-allocation.ts,
               cooldown.ts, voice-budget.ts, motion.ts, preview-simulation.ts,
               preview-event-log.ts, preview-plan.ts, preview-chains.ts
  testing/     random-game-state.ts, preview-vectors.ts, index.ts
packages/loop-analysis/src/
  loop-request.ts, loop-windows.ts, seam-metrics.ts, spectral-mismatch.ts,
  phase-mismatch.ts, cycle-stability.ts, crossfade-suitability.ts, verdicts.ts,
  candidate-pairs.ts, candidate-search.ts, candidate-cost.ts, analyse-loop.ts,
  audition-plans.ts, testing/loop-fixtures.ts, testing/index.ts
packages/guided-workflows/src/
  guided-workflow.ts, workflow-plan.ts, workflow-subjects.ts,
  cut-into-sounds.ts, prepare-one-shot.ts, create-seamless-loop.ts,
  normalise-game-sfx.ts, clean-dialogue.ts, export-for-godot.ts,
  existing-operations.ts, testing/workflow-states.ts, testing/index.ts
```

## 3. Asset groups and inherited policy (WU-10.A)

`ADR-0101`. Contracts `GameAssetGroup` and `InheritedPolicy`.

```ts
// packages/game-audio/src/groups/group-ids.ts
export type GameAssetGroupId = Branded<'GameAssetGroupId'>;
export type GamePreviewScenarioId = Branded<'GamePreviewScenarioId'>;
export type PreviewEmitterId = Branded<'PreviewEmitterId'>;

// groups/game-asset-group.ts
export interface GameAssetGroup {
  readonly id: GameAssetGroupId;
  /** One path segment: 1–128 characters, NFC, no '/', no control character, no edge space. */
  readonly name: string;
  readonly parent?: GameAssetGroupId;
  /** The fields this group sets; an absent field is inherited from its parent. */
  readonly policy: InheritedPolicy;
}

// groups/membership.ts
export type GroupMember =
  | { readonly kind: 'region'; readonly region: RegionId }
  | { readonly kind: 'asset'; readonly asset: AssetId };

/** Whether the member's rack is its group's inherited chain, or its own: the one record of it. */
export type MemberProcessing = 'inherit' | 'own';

export interface GroupMembership {
  readonly member: GroupMember;
  readonly group: GameAssetGroupId;
  readonly processing: MemberProcessing;
  readonly overrides: PolicyOverrides;
}

// groups/game-audio-state.ts
export interface GameAudioState {
  readonly groups: ReadonlyMap<GameAssetGroupId, GameAssetGroup>;
  /** In assignment order; each member at most once. The order a pool is chosen in and `{number}` counts by. */
  readonly memberships: readonly GroupMembership[];
  readonly scenarios: ReadonlyMap<GamePreviewScenarioId, GamePreviewScenario>;
}
```

```ts
// policy/policy-fields.ts — the one statement of the fields, read by the
// commands, the resolver, the project format and the Inspector.
export const POLICY_FIELDS = [
  'processing',
  'loudness',
  'exportProfile',
  'naming',
  'destination',
  'emitter',
  'variation',
  'bus',
  'tags',
] as const;
export type PolicyField = (typeof POLICY_FIELDS)[number];

export interface PolicyValues {
  readonly processing: EffectChainId | 'none';
  readonly loudness: LoudnessTarget;
  readonly exportProfile: GameExportProfile;
  readonly naming: NamingTemplate;
  readonly destination: DestinationPath;
  readonly emitter: EmitterRules; // how a player of the group behaves (section 6)
  readonly variation: VoiceVariation; // how each voice of a member varies (section 6)
  readonly bus: BusName;
  readonly tags: readonly string[];
}

/** What a group sets. */
export type InheritedPolicy = { readonly [F in PolicyField]?: PolicyValues[F] };

/**
 * What a member sets over its group. `processing` is the membership's
 * `processing` and the member's rack; `tags` are the region's own; `emitter`
 * belongs to whoever plays the group, so a member cannot change it.
 */
export type OverridableField = Exclude<PolicyField, 'processing' | 'tags' | 'emitter'>;
export type PolicyOverrides = { readonly [F in OverridableField]?: PolicyValues[F] };

// policy/loudness-target.ts
export interface LoudnessTarget {
  readonly integratedLufs: number; // −70 to 0
  readonly toleranceLu: number; // 0.1 to 6
  readonly truePeakCeilingDbtp?: number; // −20 to 0
}
// policy/bus-name.ts
export type BusName = Branded<'BusName'>; // 1–64 characters, NFC, no control character
```

`DestinationPath`, `NamingTemplate` and `GameExportProfile` are WU-10.A1's
(section 4); `EmitterRules` and `VoiceVariation` are declared in
`policy/playback-rules.ts` (section 6).

**Processing: one authority.** A membership's `processing` is the record of
whether the member inherits. The state is valid only when every `inherit`
member's rack is exactly its inherited processing: the chain the nearest
setting group names, and no rack where that is `none` or no group sets it
(`game.member-processing-mismatch` otherwise). `own` members keep any rack
or none. So:

- a member can inherit `none` or `unset` (it has no rack while it inherits);
- assigning with `processing: 'inherit'` sets the rack to the inherited chain
  in the same command, so a group's chain reaches every existing member that
  inherits, and `keep` records `own` even when the rack happens to equal the
  group's chain;
- every command that can change what an `inherit` member inherits
  (`game.set-group-policy` on `processing`, `game.move-group`,
  `game.assign-member`) re-points all of them (`game.remove-group` is refused
  while a group has members), so a chain set to `none` and then to B takes
  every inheritor from A to no rack to B;
- `project.set-rack` on an `inherit` member sets it `own` in the same
  command (the person chose a rack), and its inverse restores `inherit`;
  editing the shared chain's slots changes the group's chain for every
  inheritor, which is what sharing is (`ADR-0060`);
- resetting processing to inherited is `game.set-member-processing` with
  `inherit`, which sets the rack.

```ts
// policy/processing-realisation.ts — pure; the game commands call it, never the interface
export function inheritedProcessing(
  state: GameAudioState,
  member: GroupMember,
): EffectChainId | undefined;
/** The rack each `inherit` member must have in `after`: the full set, not a difference. */
export function inheritingRacks(
  state: GameAudioState,
): readonly { readonly member: GroupMember; readonly rack: EffectChainId | undefined }[];
```

**Chain users: one function.** A group's `processing` names a chain, so the
users of a chain are the project's and the groups'. `projectChainUsers`
(`policy/chain-users.ts`) answers both, and every reader of chain users reads
it instead of the domain's `chainUsers(project, id)`, which only sees
`Project`:

```ts
export interface StateChainUsers extends ChainUsers {
  readonly groups: readonly GameAssetGroupId[];
}
export function projectChainUsers(
  project: Project,
  game: GameAudioState | undefined,
  chain: EffectChainId,
): StateChainUsers;
export function stateChainUseCount(users: StateChainUsers): number;
```

Its consumers, each changed by the unit that owns the file:
`packages/project-commands/src/processing/chain-naming.ts:62` (WU-10.A5),
`packages/history/src/difference-names.ts:36` (WU-10.A4, which names a
group as a chain's owner), `apps/web/src/commands/rack-target.ts:102`
(`otherUsers`) and `apps/web/src/commands/rack-building-commands.ts:211`
(WU-10.E1). An architecture test (WU-10.0's line) refuses a new import of
the domain's `chainUsers` outside `packages/game-audio`.

**Resolution with provenance.**

```ts
// policy/policy-resolution.ts
export type PolicySource =
  | { readonly kind: 'override'; readonly member: GroupMember }
  | { readonly kind: 'group'; readonly group: GameAssetGroupId; readonly path: readonly string[] }
  | { readonly kind: 'unset' };

export interface Resolved<T> {
  readonly value: T | undefined; // undefined exactly when source is 'unset'
  readonly source: PolicySource;
  /** Ancestors' values the source hides, nearest first: what a reset would reveal. */
  readonly shadowed: readonly { readonly group: GameAssetGroupId; readonly value: T }[];
}

export interface ResolvedTag {
  readonly tag: string;
  readonly from: readonly (
    { readonly kind: 'group'; readonly group: GameAssetGroupId } | { readonly kind: 'member' }
  )[];
}

/** What a group's members inherit, the group itself included. */
export interface GroupEffectivePolicy {
  readonly group: GameAssetGroupId;
  readonly fields: { readonly [F in Exclude<PolicyField, 'tags'>]: Resolved<PolicyValues[F]> };
  readonly tags: readonly ResolvedTag[];
}

export interface EffectivePolicy {
  readonly member: GroupMember;
  readonly group: GameAssetGroupId | undefined;
  readonly processing: Resolved<EffectChainId | 'none'> & {
    readonly membership: MemberProcessing | undefined; // undefined: in no group
    readonly rack: EffectChainId | undefined;
  };
  readonly loudness: Resolved<LoudnessTarget>;
  readonly exportProfile: Resolved<GameExportProfile>;
  readonly naming: Resolved<NamingTemplate>;
  readonly destination: Resolved<DestinationPath>;
  readonly emitter: Resolved<EmitterRules>;
  readonly variation: Resolved<VoiceVariation>;
  readonly bus: Resolved<BusName>;
  readonly tags: readonly ResolvedTag[]; // sorted by tag
}

export function resolvePolicy(
  project: Project,
  state: GameAudioState,
  member: GroupMember,
): EffectivePolicy;
export function resolveGroupPolicy(
  state: GameAudioState,
  group: GameAssetGroupId,
): GroupEffectivePolicy;
export function resolveAll(
  project: Project,
  state: GameAudioState,
): ReadonlyMap<string, EffectivePolicy>; // keyed by memberKey
export function memberKey(member: GroupMember): string; // 'region:<id>' | 'asset:<id>'
```

Rules, each a test:

1. A field resolves to the member's override where one is set, else to the
   nearest ancestor (the member's group first) that sets it, else `unset`.
2. `processing` resolves over groups only; `membership` and `rack` say how
   the member stands against it, and the validator holds `inherit` to it.
3. `tags`: the sorted union of every ancestor's `tags` and `Region.tags`,
   each with every source that gives it. No member override.
4. Resolution walks parent links from the member's group to its root once;
   the forest is validated acyclic, so it terminates, and the answer depends
   only on `(project, state, member)`. `resolveAll` equals `resolvePolicy`
   per member (property test) and runs in O(groups + members).
5. A member in no group resolves every field `unset`, `membership`
   undefined, and its tags its own.

**Validation.** `validateGameAudioState(project, state): DomainResult<GameAudioState>`
in `groups/state-validation.ts`, called by every game command on its result,
by `project.set-rack`, and by the project format's reader. Each failure's
`details` carries `{ field, owner: 'group' | 'member', group?, groupPath?,
member? }` and its summary names the group by path or the member by name, so
"invalid inherited settings identify the owning group/override" holds
wherever the failure is shown.

| Code                               | Refused                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `game.group-parent-unknown`        | A parent that is not a group                                                                  |
| `game.group-cycle`                 | A group that is its own ancestor                                                              |
| `game.group-name-invalid`          | A name breaking the segment rule                                                              |
| `game.group-name-taken`            | Two siblings (or two roots) equal in NFC lower case                                           |
| `game.member-unknown`              | A member naming no region or asset of the project                                             |
| `game.member-twice`                | A member in two memberships                                                                   |
| `game.member-group-unknown`        | A membership naming no group                                                                  |
| `game.member-processing-mismatch`  | An `inherit` member whose rack is not its inherited processing                                |
| `game.policy-chain-unknown`        | `processing` naming no chain of `project.effectChains`                                        |
| `game.policy-loudness-invalid`     | A target, tolerance or ceiling out of its range                                               |
| `game.policy-naming-invalid`       | A template the game vocabulary does not read (section 4)                                      |
| `game.policy-destination-invalid`  | A segment `safeFolderName` would change, `.`/`..`, or more than 16 segments                   |
| `game.policy-bus-invalid`          | A bus name out of its rule                                                                    |
| `game.policy-emitter-invalid`      | An emitter rule out of its range (section 6)                                                  |
| `game.policy-variation-invalid`    | A variation range out of its range (section 6)                                                |
| `game.policy-tag-invalid`          | A tag empty, over 64 characters or with a control character                                   |
| `game.scenario-invalid` and others | A scenario its own rules refuse, or one playing a group or member the state lacks (section 6) |

A profile valid in shape may still be one a member's audio cannot take; that
is found per member when its export is planned (section 4), with the same
owner details.

Amended 2026-10-16: `game.policy-profile-invalid` is not the validator's. A
profile's shape is held by its type and by the project format's reader, so
the validator has nothing to refuse; the code is raised per member when its
export is planned (section 4), with the owner of the profile. Scenarios are
validated with the state (WU-10.D4 part 2).

**Game processing presets.** `REQ-GAME-023` names game-oriented processing
presets and the packet "loudness matching and game presets". They are
built-in entries of the person's processing library (`ADR-0060`'s saved
chains, `LibraryEntry` in `packages/domain/src/processing/processing-library.ts`),
not a list of their own: `packages/processors/src/library/game-chains.ts`
states `BUILT_IN_LIBRARY: readonly LibraryEntry[]` with fixed identifiers,
built from the catalogue's keys and values:

| Entry                         | Chain                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Game SFX, −16 LUFS            | `dc-offset-removal`; `filter` high-pass 30 Hz; `loudness-normalisation` −16 LUFS, −1 dBTP                              |
| UI sound, −18 LUFS            | `dc-offset-removal`; `filter` high-pass 80 Hz; `loudness-normalisation` −18 LUFS, −1 dBTP                              |
| Dialogue, −23 LUFS            | `filter` high-pass 80 Hz; `de-esser` default; `compressor` 3:1 at −24 dBFS; `loudness-normalisation` −23 LUFS, −2 dBTP |
| Ambience loop, −24 LUFS       | `dc-offset-removal`; `loudness-normalisation` −24 LUFS, −2 dBTP                                                        |
| Footstep / impact, peak −1 dB | `dc-offset-removal`; `filter` high-pass 40 Hz; `peak-normalisation` −1 dBTP true peak                                  |

`ProcessingLibraryStore` (`packages/storage/src/processing-library-store.ts`)
is given them through `LibraryServices.builtIn` and lists them before the
person's own as built-in: usable, applicable, copyable into the person's
library, never renamed or removed (`library.built-in`). Applying one to a
group copies it into the project and sets the group's `processing` to it, one
step. The values above are this phase's decision and are pinned by test; a
change is a change of the entry, not of a stored library.

## 4. Naming templates, export profiles, destinations, the game export plan

`ADR-0102`. Contracts `NamingTemplate` and `GameExportProfile`.

**The grammar, once.** `packages/import-export/src/template-grammar.ts` takes
over the reading now in `file-name-template.ts`:

```ts
export interface TemplateVocabulary<Token extends string> {
  readonly tokens: ReadonlySet<Token>;
  /** The modifiers a token takes; a token absent here takes none. */
  readonly modifiers: ReadonlyMap<Token, ReadonlySet<string>>;
  readonly describe: string; // for refusals: "{project}, {region}, …"
}
export type TemplatePart<Token extends string> =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'token'; readonly token: Token; readonly modifier?: string };
export function readTemplate<Token extends string>(
  template: string,
  vocabulary: TemplateVocabulary<Token>,
): DomainResult<readonly TemplatePart<Token>[]>;
export function escapeTemplateText(text: string): string; // doubles each brace
```

`PARTS` becomes `/\{\{|\}\}|\{([^{}:]*)(?::([^{}]*))?\}|[{}]|[^{}]+/gu`.
`readFileNameTemplate` keeps its signature and refusals, now
`readTemplate(template, FILE_NAME_VOCABULARY)` with no modifiers, so every
Phase 09 test stands unchanged.

**The game vocabulary** (`export/naming-vocabulary.ts`):

| Token          | Value                                                                                    | Modifiers |
| -------------- | ---------------------------------------------------------------------------------------- | --------- |
| `{project}`    | The project's name                                                                       | case      |
| `{asset}`      | The member's asset's name                                                                | case      |
| `{region}`     | The region's name; refused in a template for an asset member at planning                 | case      |
| `{group}`      | The member's group's name                                                                | case      |
| `{group-path}` | The group's path, segments joined by `_`                                                 | case      |
| `{number}`     | The member's place in its group from 1; width the group's count's digits, or N from `:N` | `1`–`6`   |
| `{date}`       | `yyyy-mm-dd` from the caller's clock and offset (Phase 09's `dateOf`)                    | —         |
| `{format}`     | The target's extension                                                                   | —         |

Case modifiers: `lower`, `upper`, `snake`, `kebab`, `pascal`. A word is a
maximal run of `\p{L}\p{N}` after NFC; `snake` is words in lower case joined
by `_`, `kebab` by `-`, `pascal` each word's first code point upper-cased and
the rest lower-cased, joined. Case mapping uses `toLocaleLowerCase('und')`
semantics through `String.prototype.toLowerCase`, which is locale-free.

```ts
// export/naming-template.ts
export type NamingToken =
  'project' | 'asset' | 'region' | 'group' | 'group-path' | 'number' | 'date' | 'format';
export interface NamingTemplate {
  readonly source: string;
} // validated on construction
export function namingTemplate(source: string): DomainResult<NamingTemplate>;

// export/member-naming.ts
export interface NamingValues {
  readonly project: string;
  readonly asset: string;
  readonly region: string | undefined;
  readonly groupName: string;
  readonly groupPath: readonly string[];
  readonly number: number;
  readonly count: number;
  readonly clock: ExportClock;
  readonly extension: string;
}
export function expandNaming(template: NamingTemplate, values: NamingValues): DomainResult<string>; // a literal stem
```

Expansion is deterministic and reads nothing else. The stem goes into
`fileName` as `escapeTemplateText(stem)`, so `planExport` fills nothing and
`safeFileName` (unchanged) makes it safe.

**Collisions.** Within one game export plan, two planned items whose
`safeFileName(name)` are equal under NFC lower case and whose destination
paths are equal segment by segment under NFC lower case are a
`game.export-names-collide` failure on both items, naming both members and
the owner (group or override) of each one's `naming`. A name already at the
destination stays the collision policy's at delivery (`ADR-0092`).

**`GameExportProfile`** (`export/game-export-profile.ts`):

```ts
export type ProfileChoices<F extends ExportFormat> = Omit<PresetChoices<F>, 'range' | 'fileName'>;
export type GameExportProfile = {
  readonly [F in ExportFormat]: { readonly format: F; readonly choices: ProfileChoices<F> };
}[ExportFormat];

/** A preset's choices as a profile: what "apply preset to group" stores. */
export function profileFromPreset(preset: ExportPreset): GameExportProfile;

// export/member-export-settings.ts
export function memberExportSettings(
  profile: GameExportProfile,
  member: GroupMember,
  context: ExportContext,
  fileName: string,
): ExportSettings;
// = { ...resolvePreset({ id: 'game-profile', name: '', format, settings: choices }, context),
//     range: member.kind === 'region' ? { kind: 'region', region } : { kind: 'project' }, fileName }
```

An asset member's `ExportContext.source` is that asset, as the Export
dialog's "project" range is the asset in the editor (Phase 09 handoff).

**`DestinationPath`.** `packages/import-export/src/file-name-safety.ts`
gains `safeFolderName(segment: string): string`, the stem rule of
`safeFileName` without an extension. A segment is valid exactly when
`safeFolderName(segment) === segment` and it is not `.` or `..`; the
destination is refused, never repaired.

**The game export plan** (`export/game-export-plan.ts`), the batch-ready
hook:

```ts
export interface GameExportRequest {
  readonly members: readonly GroupMember[];
  readonly clock: ExportClock;
}
export type GameExportItem =
  | {
      readonly kind: 'planned';
      readonly member: GroupMember;
      readonly settings: ExportSettings;
      readonly file: PlannedFile; // Phase 09's, one per item
      readonly destination: DestinationPath;
      readonly provenance: {
        readonly exportProfile: PolicySource;
        readonly naming: PolicySource;
        readonly destination: PolicySource;
      };
    }
  | {
      readonly kind: 'refused';
      readonly member: GroupMember;
      readonly failures: readonly [DomainFailure, ...DomainFailure[]];
    };
export interface GameExportPlan {
  readonly items: readonly GameExportItem[];
} // in the request's order
export function planGameExport(
  project: Project,
  state: GameAudioState,
  request: GameExportRequest,
  contextOf: (member: GroupMember) => DomainResult<ExportContext>,
): GameExportPlan;
```

Refusals: `game.export-profile-unset` (no profile anywhere up the tree),
`game.export-naming-unset`, the `validateExportSettings` failures re-stated
with `details.owner`/`group`/`member` of the `exportProfile` field,
`game.export-names-collide`, `game.export-region-token-for-asset`. The
interface runs the planned items as one Phase 09 `ExportBatch`, one job each
(`apps/web/src/commands/export-starting.ts` is generalised to start a batch
from planned files with their own settings, keeping the dialog's path as the
one-settings case). Each delivered file is an `ExportRecord` with its own
settings, as today. The project's `exportSettings` (last dialog settings) is
not changed by a group export.

**Delivery into a relative folder.** `packages/storage/src/export-delivery.ts`'s
`DeliveryFolder` gains `folder(name: string): Promise<DeliveryFolder>`
(made where absent, through `folderAt` in
`packages/browser-storage/src/folder-paths.ts`); `deliverStaged` takes the
destination path and walks it before deciding the collision in the last
folder's listing. `TrustedFolders` records are keyed by the relative path
`a/b/name.ext`. A `file` or `download` destination ignores the path and the
plan's item says so before the export starts.

Amended 2026-10-16 (WU-10.A3, A4, A6): a folder the path names is made only
when a file is created in it, and those made are taken back where the file is
abandoned, refused or cancelled, keeping a folder something else was put in;
an `ExportRecord`'s file keeps the folder it went to (`projectDocument` 10),
so the history names where each file went; a member asked for twice in one
request is planned once and refused at its repeats
(`game.export-member-repeated`).

**Region naming.** `memberNames(project, state, members, template, clock)`
answers each region member's new `displayName`; the shell's
`game.name-members` command runs one `project.set-region` per region as one
step. Amended 2026-10-16: it refuses a template naming `{format}`, a file's
extension, which no region's name has (`game.region-name-format-token`).

## 5. Loop definition and loop analysis (WU-10.C)

`ADR-0103`. Contracts `LoopDefinition` (the domain's: `{ loopStart,
loopEnd, crossfadeLength, crossfadeShape }` from the region's start, placed
from `Region.loop: AnchoredLoop`) and `LoopAnalysis`.

**The loop crossfade in the plan** (WU-10.P). `packages/domain/src/editing/loop-crossfade.ts`
(new) and `placement.ts`'s `regionPlan`: after the region's rack stream, a
loop with `crossfadeLength` C > 0 adds a stream whose segments are the
region's audio `[0, E−C)`; then C frames of a `mix` of `[E−C, E)` faded out
and `[S−C, S)` faded in; then, where the region continues past E, C' =
min(C, region end − E) frames of a `mix` of `[S, S+C')` faded out and
`[E, E+C')` faded in, so a playthrough that does not loop also leaves E
without a jump; then `[E+C', length)`. Both joins use the loop's
`crossfadeShape` (`AnchoredLoop` and `LoopDefinition` gain it: the domain's
four `FadeShape`s, so the shape the analysis suggests is the one written and
heard). The gains are the domain's fade function, which the analysis also
uses. `placement-validation.ts` refuses a loop whose `crossfadeLength`
exceeds `loop.start − region.start` when a command makes it
(`editing.loop-crossfade-without-lead`, amended 2026-10-16 from
`region.loop-crossfade-without-lead`: the domain's placement validation names
its failures `editing.`); because the loop's start is anchored
and a later edit can move it, `placeRegion` also clamps the placed
crossfade to min(C, loopStart, loopEnd − loopStart) and the placed value
says it was shortened (`crossfadeClampedFrom`), which the Inspector and the
Loop panel show. `regionPlan(…, { loopCrossfade: false })` gives the plan
the candidate search reads (`plain`). Every existing site that makes or
reads a loop gains the shape in WU-10.P (section 14).

**Request and result.**

```ts
// loop-request.ts
export interface LoopSearch {
  readonly radiusFrames: number; // default 20 ms; at most 2 s
  readonly keepLength: boolean;
  readonly candidates: number; // 1–16, default 5
}
export interface LoopAnalysisRequest {
  readonly loop: {
    readonly start: number;
    readonly end: number; // region frames
    readonly crossfadeLength: number;
    readonly crossfadeShape: FadeShape;
  };
  readonly search?: LoopSearch;
}

// analyse-loop.ts
export const LOOP_ANALYSIS_VERSION = 1;
export type Verdict = 'pass' | 'warn' | 'fail' | 'not-applicable';
/** What a seam metric compared: the audio that follows E or precedes S where the region has it, else the loop's own tail and head. */
export type SeamReference = 'post-end' | 'pre-start' | 'adjacent';
export interface LoopMetric {
  readonly value: number; // in `unit`; 0 where not applicable
  readonly unit: 'deviations' | 'dBFS' | 'dB' | 'degrees' | 'frames' | 'ratio';
  readonly verdict: Verdict;
  readonly channel: number | undefined; // the worst channel
  readonly reference?: SeamReference;
  readonly reason?: string; // why not applicable
}
export interface CrossfadeSuitability {
  readonly lengthFrames: number;
  readonly correlation: number; // energy-weighted over channels, from `plain`
  readonly shape: FadeShape;
  readonly levelChangeDb: number; // the largest over the fade, for that shape
  readonly verdict: Verdict;
}
export interface LoopMetrics {
  readonly discontinuity: LoopMetric; // Burg residual at the seam, in deviations
  readonly dcMismatch: LoopMetric;
  readonly netDc: LoopMetric;
  readonly levelMismatch: LoopMetric;
  readonly phaseMismatch: LoopMetric;
  readonly spectralMismatch: LoopMetric;
  readonly zeroCrossing: {
    readonly start: LoopMetric;
    readonly end: LoopMetric;
    readonly signs: LoopMetric;
  };
  readonly crossfade: CrossfadeSuitability | undefined; // where crossfadeLength > 0
  readonly cycleStability: { readonly seam: LoopMetric; readonly drift: LoopMetric };
}
export interface LoopCandidate {
  readonly rank: number;
  readonly start: number;
  readonly end: number; // region frames
  readonly moved: { readonly start: number; readonly end: number };
  readonly cost: number;
  readonly metrics: LoopMetrics;
  readonly crossfade: { readonly lengthFrames: number; readonly shape: FadeShape } | undefined;
}
export interface LoopAnalysis {
  readonly version: number;
  readonly sampleRate: SampleRate;
  readonly channels: number;
  readonly windowFrames: number;
  readonly current: LoopMetrics;
  readonly verdict: Exclude<Verdict, 'not-applicable'>; // worst of the current metrics
  readonly candidates: readonly LoopCandidate[]; // empty unless searched
  readonly seam: { readonly tail: readonly Float32Array[]; readonly head: readonly Float32Array[] }; // W frames each, for the seam view
}
export interface LoopTools {
  readonly dsp: CanonicalDsp;
  readonly signal: CancellationSignal;
  readonly yieldToHost: () => Promise<void>;
  readonly onProgress: (done: number, total: number) => void;
}
export function analyseLoop(
  heard: PcmSource,
  plain: PcmSource,
  request: LoopAnalysisRequest,
  tools: LoopTools,
): Promise<DomainResult<LoopAnalysis>>;
// heard: the region with its loop crossfade (the current loop's metrics);
// plain: without it (the crossfade's correlation and every candidate).
```

**Windows and references.** S loop start, E loop end (first frame after the
loop), L = E − S, region [0, N). W = clamp(round(0.05·fs), 256, 32,768),
then min(W, ⌊L/4⌋) where L ≥ 256 (above 655 kHz the 50 ms window is shortened
to 32,768 frames). A loop shorter than 256 frames is analysed on cyclic
windows (the loop read around itself), and its spectral and phase metrics are
not applicable ("a loop shorter than 256 frames has too few frames for a
spectrum"); shorter than 16 frames is refused (`loop.too-short`). A seam
metric compares what the engine plays after E with what should follow, and
uses, in this order where the region has the audio: `post-end`, the head
H = x[S, S+W) against x[E, E+W); `pre-start`, the tail T = x[E−W, E) against
x[S−W, S); `adjacent`, T against H, the only reference a whole-sound loop has.
The reference is reported with each metric. Input with a sample that is not
finite is refused (`loop.non-finite-audio`).

**Metrics.** Every logarithm, power, sine and arctangent is the canonical
primitive of `@audiogubbins/audio-engine` (`gainToDecibels`, `log10`, `pow`,
`sineOfTurns`, `cosineOfTurns`, `arctangentTurns(y, x)`); sums are f64 in
index order; a denominator is max(value, 2⁻²⁴), the floor `clicks.ts` uses
(`LEAST_DEVIATION`), and where both compared values are under it the metric is
0 and passes. Per channel; the worst channel is reported.

| Metric                       | Formula                                                                                                                                                                                                                                                                                                                         | Unit       | Pass  | Warn  | Fail  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----- | ----- | ----- |
| `discontinuity`              | The click detector's residual (`packages/audio-engine/src/dsp/reference/analysis/clicks.ts`: order-16 Burg prediction, median and MAD) run over the virtual stream T‖H; the seam frames' residual in MADs of the stream's residual                                                                                              | deviations | ≤ 4   | ≤ 8   | > 8   |
| `dcMismatch`                 | Blackman–Harris-weighted means over D = max(W, 200 ms) on each side of the seam (by the reference), gainToDecibels(\|μ_a − μ_b\|)                                                                                                                                                                                               | dBFS       | ≤ −60 | ≤ −40 | > −40 |
| `netDc`                      | gainToDecibels(\|mean of x over [S, E)\|), from prefix sums                                                                                                                                                                                                                                                                     | dBFS       | ≤ −60 | ≤ −40 | > −40 |
| `levelMismatch`              | \|gainToDecibels(RMS_a ÷ RMS_b)\| over the reference's windows                                                                                                                                                                                                                                                                  | dB         | ≤ 1   | ≤ 3   | > 3   |
| `phaseMismatch`              | At the dominant partial: \|wrap(φ_b − φ_a)\| × 360, each phase a Blackman–Harris-weighted projection (below); not applicable without a partial 20 dB above the median                                                                                                                                                           | degrees    | ≤ 15  | ≤ 45  | > 45  |
| `spectralMismatch`           | √(mean over bands b of (10·log10(P_a,b ÷ P_b,b))²) from Welch averages (below)                                                                                                                                                                                                                                                  | dB         | ≤ 1.5 | ≤ 4   | > 4   |
| `zeroCrossing.start`, `.end` | Frames from S and E to the nearest zero-crossing boundary inside the region (the boundary predicate with the region's outside _not_ counted as silence), at most 1 ms                                                                                                                                                           | frames     | ≤ 1   | > 1   | —     |
| `zeroCrossing.signs`         | Channels where sign(x[E−1]) ≠ sign(x[S]) and neither is 0, of all channels                                                                                                                                                                                                                                                      | ratio      | 0     | > 0   | —     |
| `crossfade`                  | From `plain`: ρ = Σ_c Σ_t a_c b_c ÷ √(Σ a² · Σ b²) over the fade's two spans (energy-weighted over channels); for each domain `FadeShape` with gains g_o(t), g_i(t): change(t) = 10·log10((g_o²A + g_i²B + 2ρ g_o g_i √(AB)) ÷ ((1−t)A + tB)), A and B the spans' powers; the shape with the smallest max\|change\| is reported | dB         | ≤ 1.5 | ≤ 3   | > 3   |
| `cycleStability.seam`        | On the 10 ms dB envelope e (RMS, floored at −120 dBFS) over [S, E): z = \|e_seam − median(e)\| ÷ max(1.4826·MAD(e), 0.05 dB), e_seam over [E−5 ms, E) ∪ [S, S+5 ms)                                                                                                                                                             | deviations | ≤ 3   | ≤ 6   | > 6   |
| `cycleStability.drift`       | \|mean dB of e over the first q − over the last q\|, q = max(L/8, 100 ms)                                                                                                                                                                                                                                                       | dB         | ≤ 1   | ≤ 3   | > 3   |

The dominant partial: Welch power spectra (canonical STFT, four-term
Blackman–Harris window, `ADR-0080`, N the largest power of two ≤ W, hop N/2,
at least one frame) of both reference windows, summed; bin k of the largest
power where it stands 20 dB above the median bin, refined by quadratic
interpolation of the log powers to f̂. φ = arctangentTurns of the
Blackman–Harris-weighted projection Σ w[n]·x[n]·e^(−i2πf̂n/fs) of each window,
the earlier window's phase advanced by f̂·(distance between the windows)/fs
turns; wrap maps to (−0.5, 0.5]. Spectral bands: third octaves with centres
f_c = 1000·2^(k/3) Hz and edges f_c·2^(±1/6), from the band whose upper edge
holds 4 bins up to min(20 kHz, 0.45·fs); bands below that are merged into one
band from the lowest bin; each band's power is floored at 10⁻⁹·N before the
logarithm. The loop's verdict is the worst metric verdict.

Amended 2026-10-16 (WU-10.C1): every seam metric compares what the engine
plays with what the region's own audio does there, beyond the formulas
above, since a drum loop's hit after its decay and a pure tone's rounding
noise failed under them:

- `discontinuity` is the played stream's residual at the seam's frames (the
  16 from the first after it) less the smaller residual of the region's
  natural joins there, the tail then the audio after E and the audio before
  S then the head, where the region has them; a whole-sound loop is measured
  on the played stream alone. The MAD is floored also at the stream's RMS
  60 dB down, under which a residual is below what is heard.
- `spectralMismatch` floors each band's power also at the louder window's
  total power 60 dB down.
- `cycleStability.drift` compares the mean level of the loop's first q with
  the q after E (`post-end`), or the q before S with the loop's last q
  (`pre-start`), and the loop's first q with its last only where the region
  has neither (`adjacent`); q is at most half the loop.
- `zeroCrossing.signs` compares the sign the engine plays across the seam
  with the region's own there: x[S] against x[E] (`post-end`), x[E−1]
  against x[S−1] (`pre-start`), x[E−1] against x[S] (`adjacent`).

The DC means and the 10 ms envelope are spans of time at every rate (`8d042c1c`),
and the Blackman–Harris weights are the engine's one function (`f7ea8898`).

**Zero-crossing boundary, once.** The predicate in
`packages/waveform/src/zero-crossings.ts` (every channel asked changes sign
or has an exact zero either side) moves to
`packages/audio-engine/src/pcm/zero-crossing-boundary.ts` as
`isZeroCrossingBoundary(blocks, frame, channels, edges: 'silence' | 'interior')`;
snapping keeps `silence` (the start and end of a source are crossings) and
loop analysis uses `interior`, so a loop at the start or end of a region is
measured, not passed by definition.

**Candidate search** on `plain` (`candidate-pairs.ts`, `candidate-search.ts`,
`candidate-cost.ts`):

1. Windows: starts S′ ∈ [S−R, S+R], ends E′ ∈ [E−R, E+R], clipped to the
   region; E′ − S′ ≥ 256. With `keepLength`, E′ = S′ + L.
2. One streamed pass over [S−R−W, E+R+W) ∩ region in 32,768-frame chunks
   reads everything the search needs: the two search windows with W around
   each (kept, at most 2·(2 s + 2·32,768) frames a channel); prefix sums of x
   for every pair's `netDc`; and the 10 ms dB envelope on an absolute 10 ms
   grid from S−R, kept as a fixed-resolution histogram per channel (0.1 dB
   bins from −120 to +12 dBFS) plus the grid values within R + q of each
   boundary, from which each pair's median, MAD, seam and drift are read. No
   pair reads audio again.
3. Start anchors: per channel, the frames of the start window where that
   channel changes sign; the 64 nearest S over all channels, ties to the
   earlier; with none, the 64 nearest frames.
4. For each anchor, the multichannel normalised cross-correlation
   Σ_c Σ_n a_c b_c ÷ √(Σ_c Σ a² · Σ_c Σ b²) of its neighbourhood (w =
   min(256, W) frames either side, every channel; context outside the region
   is left out of both sums) over the end window, by the canonical FFT in
   overlap-save blocks of 65,536 (the largest canonical size), hop 65,536 −
   (2w − 1), with the window energy from prefix sums of squares, blocks in
   ascending order; the best 8 ends, ties to the nearer E then the earlier.
   With `keepLength` every S′ is scored at E′ = S′ + L and the best 512
   kept, ties to the smaller |S′ − S| then the earlier. At most 512 pairs.
5. Each pair is measured (the table) and costed:
   J = discontinuity/4 + levelMismatch/1 + spectralMismatch/1.5 +
   phaseMismatch/15 + 10^((dcMismatch+60)/20) + cycleStability.seam/3 +
   0.25·(|S′−S| + |E′−E|)/R; a metric not applicable adds 0.
6. Order by J (exact f64 comparison), then |S′−S| + |E′−E|, then S′, then
   E′; the first `candidates` are returned with ranks from 1.
7. Micro-crossfades: for a candidate whose discontinuity or phase verdict is
   not pass, each length C of 2, 5, 10, 20 and 50 ms with C ≥ 2/f̂ where a
   dominant partial stands (two periods), and every domain shape, is scored
   over [E−C−W, E) ∪ [S, S+W) of the crossfaded audio: the discontinuity
   residual including the fade's start, the crossfade level change verdict,
   and the spectral mismatch of the faded span against `pre-start` audio.
   The shortest C, then the shape with the smallest level change, whose
   three verdicts pass is suggested.
8. Whole-sound loops: where S − region start < C for every C that step 7
   would take (a loop over the whole sound, or one imported from a file's
   `smpl` loop), the search also offers the candidate that moves S forward
   by C with that crossfade, so the region keeps [0, S+C) as its intro and
   the crossfade has its lead; it is ranked by the same cost and marked
   "moves the start to make room for a crossfade".

**Failure.** Every refusal (`loop.too-short`, `loop.outside-region`,
`loop.search-radius-invalid`, `loop.non-finite-audio`, a read failure,
cancellation) is the result; nothing is applied, and the region's loop is
unchanged because the analysis never runs a command.

**Audition plans** (`audition-plans.ts`):

```ts
export type LoopAuditionMode =
  | { readonly kind: 'cycles'; readonly leadInFrames: number } // up to 1 s before S, then cycles
  | { readonly kind: 'seam'; readonly sideFrames: number }; // default 0.5 s each side of the seam
export function loopAuditionPlan(
  regionPlan: EditPlan,
  loop: LoopDefinition,
  mode: LoopAuditionMode,
  cycles: number,
): DomainResult<EditPlan>;
export function extendedAuditionPlan(plan: EditPlan, cycles: number): EditPlan; // more cycles; streams and segments before the old end unchanged
```

A candidate is auditioned from a plan whose loop is the candidate's,
without writing it to the region.

**Stateful racks.** A region's rack runs from the region's start
(`ADR-0060`), so a reverb's tail at the loop's head is the intro's, not the
loop's own end's. The `cycleStability` and seam metrics measure what is
rendered, so such a seam shows as a warning or failure with the rack named in
the panel's explanation; rendering the loop wrapped is Q7.

## 6. Game preview simulator (WU-10.D)

`ADR-0104`. Contract `GamePreviewScenario`.

**Rules, split by who holds them.** A game engine's player holds one set of
rules for everything it plays (selection, voices, cooldown, attenuation),
while each sound it chooses may vary on its own (pitch, gain, offset, bus).
So the authored rules are two policy fields: `emitter`, which a member cannot
override, and `variation` and `bus`, which a member can.

```ts
// policy/playback-rules.ts
export type SelectionRule =
  { readonly kind: 'uniform' } | { readonly kind: 'avoid-recent'; readonly depth: number }; // 1–16
export type VoiceStealing = 'oldest' | 'quietest' | 'reject';
export type Attenuation =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'inverse' | 'inverse-square' | 'logarithmic';
      readonly unitSize: number; // > 0, metres in 3D, pixels in 2D
      readonly maxDistance: number; // > unitSize; silent beyond
      readonly ceilingDecibels: number; // −80 to 24
    }
  | { readonly kind: 'exponent'; readonly maxDistance: number; readonly exponent: number }; // 0.01 to 16
export interface DistanceFilter {
  // Godot 4's attenuation filter
  readonly cutoffHertz: number; // 20 to 20,000, at most 0.45·fs when realised
  readonly decibels: number; // −80 to 0, the shelf's gain at full attenuation
}
export interface EmitterRules {
  readonly selection: SelectionRule;
  readonly voices: { readonly limit: number; readonly stealing: VoiceStealing }; // 1–64
  readonly cooldownMilliseconds: number; // 0 to 60,000
  readonly attenuation: Attenuation;
  readonly filter?: DistanceFilter;
}
export interface VoiceVariation {
  readonly pitchCents: { readonly min: number; readonly max: number }; // whole cents, −2400 to 2400, min ≤ max
  readonly gainDecibels: { readonly min: number; readonly max: number }; // −60 to 12
  readonly startOffsetMilliseconds: { readonly max: number }; // 0 to 10,000
}
export const DEFAULT_EMITTER_RULES: EmitterRules; // uniform, 8 voices, oldest, no cooldown, no attenuation, no filter
export const DEFAULT_VOICE_VARIATION: VoiceVariation; // no variation
```

The defaults are what the preview uses where a field resolves `unset`, and
the panel says so beside the rules it shows; they are never written into a
group.

Amended 2026-10-16 (WU-10.D4 part 2): a `maxDistance` of 0 is no limit, as
Godot and the panner read it, and every distance keeps to the panner's
ranges (a `unitSize` from 0.01, every distance at most 1,000,000), so a
validated scenario always becomes a plan. A scenario also states a
`panningStrength` from 0 to 1, Godot's project and player panning strengths
multiplied (below).

```ts
// preview/preview-scenario.ts
export type PreviewSubject =
  | { readonly kind: 'group'; readonly group: GameAssetGroupId }
  | { readonly kind: 'member'; readonly member: GroupMember };
export type TriggerPattern =
  | { readonly kind: 'by-hand' }
  | {
      readonly kind: 'repeat';
      readonly intervalMilliseconds: number;
      readonly jitterMilliseconds: number;
      readonly count: number;
    };
// interval 20–60,000; jitter 0 to interval/2; count 1–10,000
/**
 * Godot's conventions, so Phase 11 maps nothing: 3D is right-handed, +y up,
 * the listener facing −z, +x to its right; 2D has +x right and +y down, and
 * the listener faces up the screen (−y). z is 0 in 2D.
 */
export interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export type Motion =
  | { readonly kind: 'still'; readonly at: Position }
  | {
      readonly kind: 'waypoints';
      readonly points: readonly { readonly at: Position; readonly milliseconds: number }[]; // 2–64, times rising from 0
      readonly repeat: 'once' | 'loop' | 'back-and-forth';
    };
export interface PreviewEmitter {
  readonly id: PreviewEmitterId;
  readonly name: string;
  readonly subject: PreviewSubject;
  readonly trigger: TriggerPattern;
  readonly motion: Motion;
}
export interface Listener {
  readonly at: Position;
  readonly facingTurns: number;
} // about the vertical axis; 0 faces −z (3D) or −y (2D)
export interface GamePreviewScenario {
  readonly id: GamePreviewScenarioId;
  readonly name: string;
  readonly space: '2d' | '3d';
  readonly panWidth: number; // 2D: the distance to the side at which pan is full
  readonly listener: Listener;
  readonly emitters: readonly PreviewEmitter[]; // 1–16
  readonly seed: number; // a whole number below 2³²
  readonly busLevels: readonly { readonly bus: BusName; readonly decibels: number }[];
}
```

**Draws.** `lowbias32` and `uniformDraw` move unchanged from
`packages/import-export/src/dither-noise.ts` to
`packages/domain/src/integrity/counter-draw.ts`, both exported (today
`lowbias32` is module-private); the dither imports them and Phase 09's byte
pins prove its bits unchanged. An emitter's key is
`lowbias32(seed ^ crc32(utf8(emitter.id)))` with the domain's CRC-32, so
reordering emitters changes no emitter's draws. Streams: `SELECTION = 1`,
`PITCH = 2`, `GAIN = 3`, `OFFSET = 4`, `JITTER = 5`; index: the trigger's
ordinal k from 0. u is `uniformDraw(key, stream, k)` in [0, 1).

Amended 2026-10-16 (WU-10.D4): a whole choice among n is ⌊h·n / 2³²⌋ of the
draw's 32-bit word h, exactly, where the double product ⌊u·n⌋ of step 3 can
round across a boundary a runtime would not reproduce; milliseconds become
frames as ⌊ms·fs/1000 + 0.5⌋; a hand trigger's ordinal is the repeat's count
(or 0) plus the emitter's hand triggers before it. The reference vectors
(`packages/game-audio/src/testing/preview-vectors.ts`) state every rule a
runtime reproduces.

**Decisions for trigger k of an emitter**, frames at the preview's rate fs
(the project's), in this order:

1. Time: `repeat` triggers at
   t_k = round(k·interval·fs/1000) + floor(u_JITTER·(2J+1)) − J, with
   J = round(jitter·fs/1000), clamped to ≥ 0; `by-hand` at the frame the
   press is scheduled for (below).
2. Cooldown: with c = round(cooldown·fs/1000), a trigger with
   t_k − t_last < c is `suppressed`, where t_last is the last _started_
   trigger; a suppressed or rejected trigger leaves t_last and the selection
   history unchanged.
3. Selection: the pool is the subject's members in membership order (a member
   subject is a pool of one), each with its length, loop and its own
   effective `variation` and `bus`. `uniform` takes floor(u·n);
   `avoid-recent(d)` removes the last min(d, n−1) chosen (most recent first)
   and takes floor(u·m) of the m left, in pool order.
4. Variation, from the _chosen member's_ effective `variation`: pitch
   min + floor(u_PITCH·(max − min + 1)) cents; gain min + u_GAIN·(max − min)
   dB; offset floor(u_OFFSET·(min(maxFrames, length − 1) + 1)) frames.
5. Voices, by the emitter's rules: with fewer than `limit` voices sounding, a
   new voice; otherwise `oldest` steals the earliest started (ties: the
   lowest lane), `quietest` the lowest voice gain in dB (ties: oldest),
   `reject` logs `rejected`. A stolen voice fades out over 5 ms from the new
   trigger's frame. Voices take lanes: `limit + 1` lanes an emitter, a new
   voice the lowest lane free at its frame, so a fading voice and its
   replacement never share a lane.
6. Budget: the preview sounds at most `PREVIEW_VOICE_BUDGET` voices across
   all emitters, the number of resampled voices measured to run in real time
   at preview quality on the reference machine (WU-10.D4, Q5, a test pins
   it); past it the triggering emitter's stealing rule is applied across all
   emitters and the log records `budget-stolen` or `budget-rejected`, which
   the panel shows, as a game engine's virtual voices do. Amended
   2026-10-16 (WU-10.D4, Q5): the budget is `previewVoiceBudget(grade,
variations)`, not one constant. A voice at its member's own pitch costs
   little; a varispeed voice costs taps in proportion to its faster step and
   tables of up to about 35 MB at High, so the budget is 2 to 7 voices at
   High and 8 to 26 at Draft where pitch varies, and every voice the
   scenario can sound where none does. The preview plays at the person's
   preview quality (`ADR-0061`), not the render's; WU-10.E3 gives it the
   grade.

```ts
// preview/preview-event-log.ts
export type PreviewEvent =
  | {
      readonly kind: 'started';
      readonly frame: number;
      readonly emitter: PreviewEmitterId;
      readonly trigger: number;
      readonly voice: number;
      readonly lane: number;
      readonly member: GroupMember;
      readonly pitchCents: number;
      readonly gainDecibels: number;
      readonly offsetFrames: number;
      readonly bus: BusName | undefined;
    }
  | {
      readonly kind: 'suppressed' | 'rejected' | 'budget-rejected';
      readonly frame: number;
      readonly emitter: PreviewEmitterId;
      readonly trigger: number;
    }
  | {
      readonly kind: 'stolen' | 'budget-stolen' | 'stopped' | 'ended';
      readonly frame: number;
      readonly emitter: PreviewEmitterId;
      readonly voice: number;
    };
export interface PreviewEventLog {
  readonly events: readonly PreviewEvent[];
  readonly horizonFrame: number;
}

// preview/preview-simulation.ts
export interface PreviewInput {
  readonly scenario: GamePreviewScenario;
  readonly emitterRules: (subject: PreviewSubject) => EmitterRules; // resolved, or the default
  readonly poolOf: (subject: PreviewSubject) => readonly PoolMember[]; // each with its variation, bus, length, loop
  readonly handTriggers: readonly { readonly emitter: PreviewEmitterId; readonly frame: number }[];
  readonly sampleRate: SampleRate;
  readonly horizonFrame: number;
}
/** The simulation as a value it continues from, so a hand trigger costs its own events, not a new run. */
export interface PreviewSimulation {
  readonly log: PreviewEventLog;
  readonly state: SimulationState;
}
export function simulatePreview(input: PreviewInput, from?: PreviewSimulation): PreviewSimulation;
```

`simulatePreview(input, from)` equals `from.log` up to its horizon and
continues from `from.state` (property test): a continuation never changes
what was heard. A hand trigger at frame F adds events from F only.

**Space.** The `spatial-panner` processor (`packages/processors/src/space/spatial-panner.ts`,
new, canonical, golden and property tests like every catalogue type) is one
emitter heard by one listener: parameters x, y, z (the emitter in the
listener's frame, so a still listener's waypoints are linear in them), the
space, the attenuation model and its values, the pan width and the distance
filter. Mono or stereo in, stereo out; zero latency; real-time safe. It
designs its gains and filter every 32 frames from its first frame (as
`ambisonic-encode`'s `DESIGN_INTERVAL`), linearly interpolating its position
parameters between automation points, so a moving emitter renders the same
offline as live. With r = √(x² + y² + z²) (2D: z = 0) and d = r:

| Model            | Gain in dB at distance d (d ≥ maxDistance: silent) |
| ---------------- | -------------------------------------------------- |
| `none`           | 0                                                  |
| `inverse`        | min(ceiling, gainToDecibels(1 ÷ (d/u + 10⁻⁵)))     |
| `inverse-square` | min(ceiling, gainToDecibels(1 ÷ ((d/u)² + 10⁻⁵)))  |
| `logarithmic`    | min(ceiling, −20·ln(d/u + 10⁻⁵))                   |
| `exponent`       | gainToDecibels(pow(1 − d/maxDistance, exponent))   |

10⁻⁵ is Godot 4's `CMP_EPSILON`, and the natural logarithm is its
logarithmic model's (Q3 confirms the source). The distance filter, where
set, is Godot 4's: a high shelf at `cutoffHertz` (at most 0.45·fs) whose gain
is (1 − min(1, linear attenuation))·`decibels`. Pan p: 0 where r = 0; in 3D
p = x/r (the sine of the azimuth); in 2D p = clamp(x ÷ panWidth, −1, 1). A
mono input's gains are cos((p+1)/8 turn) and sin((p+1)/8 turn); a stereo
input is balanced, g_L = min(1, √2·cos((p+1)/8 turn)),
g_R = min(1, √2·sin((p+1)/8 turn)). A member of any other layout is not
panned: its voices reach the emitter's mix through the domain's layout
conversion and the panel says "not panned: 5.1 source". The output follows
the project's layout: each bus's stereo mix is converted to it by the
domain's fold where it is not stereo.

Amended 2026-10-16 (WU-10.D2, Q3 answered against Godot 4's
`audio_stream_player_3d.cpp`, `audio_stream_player_2d.cpp` and
`audio_filter_sw.cpp`; `packages/processors/src/space/emitter-laws.ts`):

- The ceiling caps the model's decibels; then, where `maxDistance` is above
  0, the inverse models' gain is faded by 1 − d/maxDistance to silence at
  it, and 0 is no maximum. The exponent model is 1 with no maximum.
- 3D pan: p is the cosine of the emitter's angle from the listener's right
  in the horizontal plane, x/√(x² + z²) (0 straight above, below or at the
  listener), scaled by (1 − g)/(1 + g) with g = (1 − strength)², and spread
  by the equal-power law √((1 ∓ p)/2). 2D pan: clamp(x ÷ panWidth, −1, 1),
  scaled by half the strength and moved to 0 to 1, spread by the linear law
  1 − p, p. `panning-strength` is a parameter the table above lacked.
- A stereo source has each channel scaled by its own side's gain, with no
  cross-feed, as Godot's mixer scales a stereo stream; no √2 balance.
- The distance filter is Godot's high shelf with Q = 1 and the cookbook's A
  taken as the linear gain itself, so it cuts by its gain at the cutoff and
  twice that above, floored at −60 dB.
- Two differences remain, for the post-specification review and Phase 11's
  parity tests: Godot caps attenuation and `volume_db` together where the
  panner caps attenuation alone (a voice's gain is its own stage), and the
  panner filters each channel before its gain where Godot filters after,
  which differ only while the gain moves.

**The preview plan** (`preview/preview-plan.ts`, `preview-chains.ts`):

```ts
export interface PreviewPlan {
  readonly plan: EditPlan;
  readonly media: readonly AssetId[];
  /** Where each live parameter is, for running changes. */
  readonly controls: {
    readonly emitters: ReadonlyMap<
      PreviewEmitterId,
      { readonly stream: number; readonly panner: ProcessorId }
    >;
    readonly buses: ReadonlyMap<BusName, { readonly stream: number; readonly gain: ProcessorId }>;
  };
  /** Each lane's stream, kept at its index by every extension, so the engine keeps its reader. */
  readonly lanes: ReadonlyMap<string, number>; // '<emitter>:<lane>'
}
export function previewPlan(
  simulation: PreviewSimulation,
  scenario: GamePreviewScenario,
  members: ReadonlyMap<string, EditPlan>,
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
  layout: ChannelLayout,
): DomainResult<PreviewPlan>;
/** `previous` with the events after `from` added: every stream and every segment ending at or before `from` unchanged, at the same index. */
export function extendPreviewPlan(
  previous: PreviewPlan,
  simulation: PreviewSimulation,
  from: number,
): DomainResult<PreviewPlan>;
```

Streams: each member's plan (`regionPlan` or the asset's) once; for a voice
with pitch ≠ 0 a varispeed stream over it; per emitter `limit + 1` lane
streams of silence and voice segments, each voice with a constant gain stage
and, when it ends early, a 5 ms fade-out stage; a looping member's voice is
its intro then cycles to the horizon; each emitter a `mix` of its lanes
through a chain of `spatial-panner`, whose x, y, z carry the motion as
automation; each bus a `mix` of its voices' emitter streams through a `gain`
(a voice's bus is its member's, so an emitter feeds every bus its members
name, one emitter stream per bus it uses); the output a `mix` of buses.
Identifiers come from `ids`, so a plan is reproducible from the same
generator seed.

**Members with whole-pass processing.** A member whose plan holds a
whole-pass processor (a `loudness-normalisation` slot the Normalise workflow
added) is heard through the engine's cached render of that stream
(`ADR-0061` amended): before Run, the panel asks the preview producer for
every member's render and shows their progress; Run is available when they
are ready, so no voice waits on a measurement mid-run.

**Plan additions** (WU-10.P, `ADR-0104`):

- _Varispeed by a ratio._ `StreamProcessing` gains
  `{ kind: 'varispeed'; numerator: number; denominator: 4096 }`: the stream
  has one segment reading one stream of its layout and rate, played at
  numerator ÷ 4,096 of its speed by the canonical resampler run with integer
  steps (output step 4,096, input step `numerator`, reduced), so pitch and
  speed change together as an engine's pitch scale does. The ratio is
  2^(cents/1200) rounded to the nearest 1/4,096 (0.42 cents at unison), 1,024
  to 16,384 over ±2,400 cents; its frame count is the existing
  `convertedFrameCount` rule over those steps. Because the denominator is
  fixed, the resampler's phase table has at most 4,096 phases and is built
  within its budget at preview quality (`ResamplingQuality` of the preview's
  `QualityMode`, its taps stated in `resampling-grade.ts`); no declared rate
  is involved, so a low-rate project's −2,400 cents never needs a rate below
  8 kHz. An insertion's payload holding one is refused
  (`editing.payload-varispeed`, and `editing.payload-automation` for plan
  automation; amended 2026-10-16 from `edit.payload-varispeed`, the domain's
  operation validation naming its failures `editing.`).
- _Parameter automation in a plan's chain._ The chain processing of a plan
  stream gains `automation?: readonly { processor: ProcessorId; parameter:
ParameterId; points: readonly { frame: number; value: number }[] }[]`,
  linear between points and held after the last, evaluated by the chain
  runner (`packages/effect-rack`) at the processor's design interval. It is
  a plan value only: a project's chains hold none, and the project format
  refuses one in a persisted plan.

**The continued programme** (WU-10.D3, gated). The engine has no way to
change what is playing without reloading: `PlaybackSession.load` pauses the
transport and replaces every source (`playback-session.ts:136-139`), and
`PlaybackControl.#reload` restarts (`playback-control.ts:338`), which resets
every processor, filter and resampler and would click at the change. The
design keeps live readers:

1. `Programme` gains `continues?: { key: string; from: SampleCount }`, and
   `Following` gains `{ kind: 'continued'; from: SampleCount }`, chosen
   where the next programme continues the loaded one.
2. `PlaybackSessionPort.continueWith(request, from)` sends the new plan to
   the feeder without pausing the transport. The feeder answers with the
   frame F it will switch at: the first frame it has not yet read, refused
   (`playback.continuation-too-late`) when that is after `from`.
3. The feeder's plan readers (`packages/audio-engine/src/pcm/plan-readers.ts`
   and its processed and resampled sources) are matched by stream index: a
   stream of the new plan whose definition (source, rate, layout, processing
   with every processor's identifier and value, and automation and segments
   up to F) equals the old stream's keeps its live reader, with its
   processor, filter and resampler state, and only takes the new segments
   after F; any other stream gets a new reader sought to F. The preview plan
   builder guarantees that the streams of sounding voices, lanes, emitters
   and buses are kept at their indices with nothing changed before F.
4. `PlaybackControl.continue(programme)` and `readFrame()` are the port the
   preview and the loop audition use; a refused continuation is retried at
   the new F.

**Gate.** WU-10.D3 is the first unit to land in the audio path, and E2 and
E3 do not branch until its acceptance tests pass in the reference renderer
and the feeder: (a) a continuation whose new plan differs from the old only
at or after the old horizon gives output bit-identical, on [F, old horizon),
to the old plan played without it; (b) a continuation adding a voice at frame
T ≥ F gives output bit-identical to the old plan on [F, T); (c) every
sounding voice keeps its processor and resampler state across F (asserted
on the readers). If the feeder cannot meet (a)–(c), the phase stops at
`BLOCKED` with the evidence; there is no fallback of restarting playback.

**Latency of a hand trigger**: the feed-ahead time of the profile (50, 200
or 1,000 ms) plus one feeder chunk, plus building the continuation and one
message. Building is incremental: `simulatePreview` from its state and
`extendPreviewPlan` touch only the events after F (one voice's lane segment
and, where pitched, its varispeed stream), at most O(events after F); a
performance test holds a hand trigger's simulation and extension under 1 ms
at the bounds, so they stay on the page beside the playback control that
sends them. The panel states the profile's latency.

Amended 2026-10-16 (WU-10.D4): measured on the reference machine, the
simulation takes 0.5 to 0.7 ms and the extension 1.3 to 2.5 ms, most of it
laying again every lane sounding across the trigger. The test holds the
simulation to 1 ms and the two together to 5 ms, a tenth of the shortest
feed-ahead (50 ms). The test reads the wall clock and has exceeded 1 ms on a
shared machine; it measures the thread's processor time since `2d7f613f`.
As the Game preview panel runs them, a hand trigger's simulation and plan
building cost 2 to 3 ms in all on the page, accepted.

**Bounds.** 16 emitters, 64 voices an emitter, `PREVIEW_VOICE_BUDGET`
voices in all (`previewVoiceBudget`, amended above), 50 triggers a second an emitter, a 30-second horizon, extended
when the playhead is within 5 s of it.

**Forgetting what was heard.** Amended 2026-10-16 (WU-10.FX): a run that
plays for long, a loop never stopped or triggers overlapping without a
break, has no silent moment at which its plan could be laid afresh, and
laying it afresh would make every reader again, a break in the sound. So a
preview forgets what it has heard instead:

- A plan stream may state `forgottenBefore`, the first frame it still
  describes (`packages/domain/src/editing/plan.ts`). A continuation compares
  its segments and its chain's automation only from there
  (`plan-divergence.ts`), so the readers that played the past keep their
  state; a stream forgotten whole may hold its place unread, so the streams
  after it keep theirs. Only a preview's plan holds it: an insertion's
  payload is refused with it and the project format never writes it.
- `forgetPreviewBefore(simulation, frame)` keeps the log's events from
  `frame`, counting those dropped, and the state's run at that frame with the
  snapshots and hand actions after it; it goes on from `frame` or later
  alone.
- `forgetPreviewPlanBefore(plan, frame)` drops every voice whose sound ended
  by `frame`, letting its places hold a stream forgotten whole until a later
  voice takes them; makes each lane's past, and the cycles a loop's readers
  have read past, one silence; lays each emitter's motion from `frame`; and
  states `forgottenBefore` on each stream so changed. A voice's streams take
  places the plan gives rather than the end of the list.
- The run (`apps/web/src/audio/preview-run.ts`) forgets every 5 s of
  playback what was heard more than 1 s behind the listener and already
  listed, going on into the plan that forgets it as into any other
  continuation; the panel's list counts events from the run's first.

This replaces laying the plan afresh at a silent moment past 256 voices,
which is removed.

## 7. Guided workflows (WU-10.B)

`ADR-0105`.

```ts
// guided-workflow.ts
export type WorkflowTarget =
  | GroupMember
  | { readonly kind: 'group'; readonly group: GameAssetGroupId; readonly subgroups: boolean };
/** A target list expanded to members: a group's members in membership order, then its subgroups' depth first in name order where asked; each member once, at its first place. */
export function targetMembers(
  state: GameAudioState,
  targets: readonly WorkflowTarget[],
): readonly GroupMember[];
export interface WorkflowInput<Options, Analyses> {
  readonly state: ProjectState; // @audiogubbins/project-format
  readonly targets: readonly WorkflowTarget[];
  readonly options: Options;
  readonly analyses: Analyses;
  readonly catalogue: ProcessorCatalogue;
  readonly library: readonly LibraryEntry[]; // the built-in game chains among them
  readonly ids: IdGenerator;
  readonly clock: ExportClock; // naming's {date}
}
export interface GuidedWorkflow<Options, Analyses> {
  readonly key: WorkflowKey;
  readonly label: string;
  /** The options with their defaults for these targets, each with where its default came from. */
  defaults(state: ProjectState, targets: readonly WorkflowTarget[]): WorkflowOptions<Options>;
  /** The analyses to run first, in the detection worker. */
  analysesFor(
    state: ProjectState,
    targets: readonly WorkflowTarget[],
    options: Options,
  ): readonly AnalysisNeed[];
  plan(input: WorkflowInput<Options, Analyses>): DomainResult<WorkflowPlan>;
}
export type WorkflowKey =
  | 'cut-into-sounds'
  | 'prepare-one-shot'
  | 'create-seamless-loop'
  | 'normalise-game-sfx'
  | 'clean-dialogue'
  | 'export-for-godot';
export type AnalysisNeed =
  | {
      readonly kind: 'assistants';
      readonly target: GroupMember;
      readonly assistants: readonly string[];
      readonly detectors: DetectorValues;
    }
  | { readonly kind: 'loop'; readonly target: GroupMember; readonly request: LoopAnalysisRequest }
  | { readonly kind: 'loudness'; readonly target: GroupMember };

// workflow-plan.ts
export type WorkflowItem =
  | {
      readonly kind: 'planned';
      readonly target: GroupMember | GameAssetGroupId;
      readonly changes: readonly string[];
    }
  | {
      readonly kind: 'skipped';
      readonly target: GroupMember | GameAssetGroupId;
      readonly reason: string;
    }
  | {
      readonly kind: 'refused';
      readonly target: GroupMember | GameAssetGroupId;
      readonly failures: readonly [DomainFailure, ...DomainFailure[]];
    };
export interface WorkflowPlan {
  readonly description: string; // the history step's name
  readonly invocations: readonly CommandInvocation[]; // @audiogubbins/commands; the planned items', in order
  readonly items: readonly WorkflowItem[];
  /** Members whose export follows the step, as its own non-undoable action (Export for Godot). */
  readonly exportAfter?: readonly GroupMember[];
}
```

Dependencies (`ADR-0100`): `domain`, `commands`, `game-audio`,
`loop-analysis`, `processors`, `import-export`, `project-format`,
`project-commands` and `detection-runtime`. What a planner needs from an
assistant's report moves out of the web app to the package that defines the
report, `packages/detection-runtime/src/report-reading.ts` (WU-10.C2):
`silenceRemovals(report, scope, part)` and `SILENCE_PARTS` (now
`apps/web/src/analysis/detection-control.ts:47-72`), `treatmentPlacement`
with `DetectionScope`, and `learnedStates(report)` (now
`apps/web/src/commands/analysis-commands.ts:205`). The web app imports them
from there (WU-10.E1), so the panel, the command and the planner follow one
rule.

The interface dispatches `session.runGroup(plan.description, invocations)`
only when no item is `refused` and `invocations` is not empty; with a refused
item the dialog lists it with its failures and offers "Leave these out",
which plans again over the rest. `executeGroup` is all-or-nothing. An export
is never inside that step: it is an external side effect and is never undone
(`ADR-0092`, the global invariant), so `exportAfter` is offered once the
step has applied, as a separate action the person confirms, through the game
export plan (section 4).

| Workflow             | Analyses                                        | What it plans (existing commands only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cut Into Sounds      | Silence assistant over each asset               | `project.add-region` per span the silence leaves (threshold, shortest pause, lead-in and tail as options), `game.assign-member` to the chosen group with `processing: 'inherit'`, `project.set-region` names from the effective naming (section 4)                                                                                                                                                                                                                                                                                               |
| Prepare One-Shot     | Silence, and the DC offset detector, per member | Region: `project.set-region` boundaries trimmed to the sound plus lead-in and tail; asset: `trim` edits. Fades: `project.apply-region-edit` / `project.apply-edit` fade-in (default 2 ms linear) and fade-out (20 ms equal-power) at the new edges. DC: a `dc-offset-removal` slot where found. Level: a `loudness-normalisation` slot at the effective target, or `peak-normalisation` to a stated peak where none is set, placed as below                                                                                                      |
| Create Seamless Loop | Loop analysis with search, per region           | Nothing until the person chooses a candidate; then `project.set-region` with the loop `{ basis, start, end, crossfadeLength, crossfadeShape }` and, where asked, the region's end at the loop's end                                                                                                                                                                                                                                                                                                                                              |
| Normalise Game SFX   | Loudness measurement after, for conformance     | Per group target: `game.set-group-policy` `loudness` where asked, and a `loudness-normalisation` slot at the end of the group's chain (`project.add-slot` / `project.set-processor`), or, where the group has no chain, the group's `processing` set to a copy of the matching built-in game chain; per `own` member: the slot at the end of its rack                                                                                                                                                                                            |
| Clean Dialogue       | Restoration and repair assistants, noise floor  | A rack extended (as `analysis.apply` does, `extendedRackInvocation`) with the recommended steps, the built-in Dialogue chain's high-pass, de-esser and compressor, `deepfilternet-3` where its pack is installed else `noise-reduction` learned from the noise floor, and loudness normalisation at the effective target or the built-in −23 LUFS                                                                                                                                                                                                |
| Export for Godot     | none                                            | Per group target: `game.set-group-policy` `exportProfile` (one-shots: WAV integer 16-bit at the project rate, or Ogg Vorbis as chosen), `naming` (default `{group:snake}_{number:2}`) and `destination` (default `audio/` then the group path in snake case); per looping member of a group whose profile is not WAV: `game.set-member-override` `exportProfile` to WAV integer 16-bit, which carries `smpl` loops (Q1), visible as an override; `exportAfter` every member. A member in no group is refused ("not in a group: assign it first") |

Placement: trims, fades and loops are the region's (boundaries, its own
processing, its loop); level and treatment chains are racks, so normalising
runs last (`ADR-0060`'s order). For an `inherit` member the dialog asks:
"Add to the group's chain (affects N members)" or "Give this member its own
processing" (which sets it `own`); the default is its own for Prepare
One-Shot and Clean Dialogue, which treat one sound, and the group's for
Normalise Game SFX, whose subject is the group.

Idempotence (`existing-operations.ts`): a fade already at an edge with the
same direction and a length within one frame, a slot of the same type and
values at the chain's end, a loop already at the chosen points, a region
already over a span, a policy field already at the value: each is `skipped`
with its reason, never added again.

## 8. Persisted format and state ownership

`ADR-0106`.

| State                                                           | Owner and lifetime                                                              | Where                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Groups, policies, memberships, overrides, scenarios             | Authoritative project state; game commands with inverses                        | `ProjectState.gameAudio` → document member `gameAudio`, tree `project/game-audio.json` |
| A region's loop and its crossfade; racks and chains             | Authoritative project state (Phases 05, 06)                                     | unchanged members                                                                      |
| History entries of game changes                                 | Persisted command journal                                                       | `AffectedEntities.gameGroups` (new), `EntityKind` `game-group`                         |
| Effective policy                                                | Derived, cached per `ProjectState` value                                        | `apps/web/src/state/game-policy-view.ts` (memo, no store of its own)                   |
| Loop analyses, loudness measurements, conformance (C15)         | Derived results, the session's, keyed by plan fingerprint + request + version   | `apps/web/src/state/loop-analysis-store.ts`, `loudness-store.ts`                       |
| Analysis and measurement runs                                   | Background jobs with explicit states (queued, running, done, failed, cancelled) | the detection host's job records                                                       |
| Preview programme, loop audition programme                      | Audio runtime state                                                             | `PlaybackControl`                                                                      |
| Live preview parameters, hand triggers, event log, voice counts | Ephemeral interaction state                                                     | `apps/web/src/state/game-preview-store.ts`                                             |
| Workflow option drafts, chosen candidate, dialog step           | Ephemeral interaction state                                                     | `apps/web/src/state/workflow-draft-store.ts`                                           |
| Panel placement                                                 | Workspace state                                                                 | the Game Audio preset; the person's layout                                             |
| Preferences                                                     | none added                                                                      | —                                                                                      |

**Document.** `packages/project-format/src/game-audio-json.ts`:
`readGameAudio: Converter<GameAudioState>` and `writeGameAudio(state):
JsonObject`, with `readGameAssetGroup`, `readPolicyField(field)`,
`readGroupMember`, `readPolicyOverrides`, `readPreviewScenario` for command
arguments; a profile's choices are read and written by the encodings
`export-settings-json.ts` already has. `DOCUMENT_MEMBERS` gains `gameAudio`;
`writeProjectDocument` and `readProjectDocument` read it with `optional`; the
reader runs `validateGameAudioState` after the project is read, so a chain,
region or asset it names is checked. The tree layout gains
`GAME_AUDIO_PATH = 'project/game-audio.json'` (kind `game-audio`);
`projectStorage` does not rise, as it did not when `EXPORT_SETTINGS_PATH` was
added (`21694890` raised only `projectDocument`). `version.json`'s
`projectDocument` rises; the older-version refusal tests in `project-json.test.ts` and
`project-tree.test.ts` gain version 9. The random state generator
(`testing/random-states.ts`) makes random game-audio state, so the 30-seed
tree round trip and the document test cover it.

**History.** `packages/project-format/src/history-record.ts`'s
`AffectedEntities` gains `gameGroups: readonly GameAssetGroupId[]`, written
by `history-node-json.ts` and read there with `optional`, as `takeStacks` is;
`packages/history/src/state-diff.ts` and `entity-fields.ts` diff groups,
memberships and scenarios (a membership change affects its group and its
region or asset; a scenario change affects `project`); `history-rows.ts`
gains the entity kind `game-group`; `difference-names.ts` names a chain's
owner through `projectChainUsers`, so a group can be it.

Amended 2026-10-16: scenarios joined `GameAudioState`, the document member
(written sorted by identifier) and the history's differences in WU-10.D4
part 2, after WU-10.A4 and WU-10.A5 merged, rather than with A4; whether a
state holds anything is one test in `packages/game-audio`, which counts
scenarios, read by the format and the commands. An `ExportRecord`'s file
gains its folder in the same version (section 4).

## 9. Commands

Project commands, `packages/project-commands/src/game/`, ids in
`ProjectCommandId`, registered by `projectCommands(catalogue)`. Arguments are
canonical JSON read by the project format's readers; ids are minted by the
caller; every result passes `validateGameAudioState`.

| Id                           | Arguments                                                            | Does                                                                                                        | Inverse                                                             |
| ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `game.add-group`             | `group` (with policy, optional parent; any chain given whole enters) | Adds a group                                                                                                | `game.remove-group`                                                 |
| `game.remove-group`          | `group` id                                                           | Refuses with children (`game.group-has-children`) or members (`game.group-has-members`)                     | `game.add-group` with its policy and chain                          |
| `game.rename-group`          | `group`, `name`                                                      | Renames                                                                                                     | `game.rename-group` old name                                        |
| `game.move-group`            | `group`, `parent?`                                                   | Re-parents; realigns inheriting members' racks                                                              | `game.move-group` back, racks restored                              |
| `game.set-group-policy`      | `group`, `field`, `value?` (absent: unset)                           | Sets or unsets one field; for `processing` realigns inheriting members' racks and moves the chain in or out | `game.set-group-policy` old value                                   |
| `game.assign-member`         | `member`, `group`, `processing: 'inherit' \| 'own'`, `overrides?`    | Joins (or moves between groups); `inherit` sets the rack to the inherited processing, `own` keeps it        | `game.assign-member` back, or `game.unassign-member`, rack restored |
| `game.unassign-member`       | `member`                                                             | Leaves; its rack stays as it is                                                                             | `game.assign-member` with its overrides and processing              |
| `game.set-member-override`   | `member`, `field` (an `OverridableField`), `value`                   | Sets an override                                                                                            | set or reset to the old                                             |
| `game.reset-member-override` | `member`, `field` (an `OverridableField`)                            | Removes an override                                                                                         | `game.set-member-override` old value                                |
| `game.set-member-processing` | `member`, `processing: 'inherit' \| 'own'`                           | `inherit` sets the rack to the inherited processing (reset to inherited); `own` keeps the rack              | the old processing and rack                                         |
| `game.add-scenario`          | `scenario`                                                           | Adds                                                                                                        | `game.remove-scenario`                                              |
| `game.set-scenario`          | `scenario`                                                           | Replaces whole                                                                                              | `game.set-scenario` old                                             |
| `game.remove-scenario`       | `scenario` id                                                        | Removes                                                                                                     | `game.add-scenario`                                                 |

Every command that changes what an `inherit` member inherits
(`game.set-group-policy` on `processing`, `game.move-group`,
`game.assign-member`) sets the rack of every `inherit` member to
`inheritingRacks(after)` in the same command. Changes to existing commands:
`project.remove-region` and `project.remove-asset` refuse a member
(`region.in-group`, `asset.in-group`) (amended 2026-10-16, below);
`project.set-rack` on an `inherit`
member sets it `own` in the same command, its inverse restoring both;
`chain-naming.ts` counts a group's `processing` through `projectChainUsers`,
so a chain a group names is never removed and enters or leaves with the
group command; `region-commands.ts`'s split path is untouched (the
shell's split command joins the halves to the group).

Amended 2026-10-16 (WU-10.A5, WU-10.D4 part 2):

- `project.remove-region` and `project.remove-asset` take a member's
  membership with it instead of refusing it, and their inverses add it back
  at its place in the assignment order with its processing and overrides,
  so one undo restores the member and how it belonged; the remove is one
  step, and the shell's delete composes no `game.unassign-member`.
- `project.restore-region` (new) is `project.set-region`'s inverse: it sets
  a region back without asking its loop for the frames its crossfade reads,
  so undo restores a loop read back, or left by an earlier edit, with less
  audio before its start than its crossfade. `project.set-region` asks only
  when the loop or the region's start changed, and refuses only a start
  moved into frames the loop had.
- Removing a group, taking a member out of its group, or removing its
  region or asset is refused while a scenario plays it, naming the scenario
  (`game.subject-played`): the preview would fall silent, and a step never
  edits a scenario the person did not touch.
- The overridable fields are one list in `packages/game-audio`, read by the
  commands.

Shell commands (`apps/web/src/commands/`), each with a label, category,
availability and reason (`ADR-0013`), in the palette and menus:

| Module                        | Commands                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `game-group-commands.ts`      | `game.new-group`, `game.rename-group`, `game.move-group`, `game.delete-group`, `game.set-policy`, `game.unset-policy`, `game.apply-preset-to-group`                                              |
| `game-member-commands.ts`     | `game.assign-selection`, `game.remove-from-group`, `game.set-override`, `game.reset-override`, `game.inherit-processing`, `game.own-processing`, `game.reset-all-overrides`, `game.name-members` |
| `game-export-commands.ts`     | `game.export-group`, `game.export-members` (the game export plan, then a Phase 09 batch; never inside an undoable step)                                                                          |
| `loudness-commands.ts`        | `game.measure-loudness` (conformance)                                                                                                                                                            |
| `loop-analysis-commands.ts`   | `loop.analyse`, `loop.find-candidates`, `loop.apply-candidate`, `loop.apply-crossfade`, `loop.cancel-analysis`                                                                                   |
| `loop-audition-commands.ts`   | `loop.audition-cycles`, `loop.audition-seam`, `loop.audition-candidate`, `loop.stop-audition`                                                                                                    |
| `game-preview-commands.ts`    | `preview.run`, `preview.stop`, `preview.trigger` (per emitter), `preview.new-seed`, `preview.keep-scenario`, `preview.new-scenario`, `preview.delete-scenario`                                   |
| `guided-workflow-commands.ts` | `workflow.cut-into-sounds`, `workflow.prepare-one-shot`, `workflow.create-seamless-loop`, `workflow.normalise-game-sfx`, `workflow.clean-dialogue`, `workflow.export-for-godot`                  |

The existing region delete and split shell commands compose
`game.unassign-member` and `game.assign-member` in the same step for a
member region.

## 10. Workers and threads

| Work                                       | Thread                         | How                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loop analysis                              | Detection worker               | New request `analyse-loop`: `{ job, description (the region's plan with and without the loop crossfade), request, quality }`; `REFERENCE_DSP`; progress; cancellation; yields between chunks  |
| Loudness measurement                       | Detection worker               | New request `measure-loudness`: integrated LUFS, range and true peak of a target, by `CanonicalDsp.createLoudnessMeter` and `createPeakMeter` in 32,768-frame chunks                          |
| Assistants for workflows                   | Detection worker               | The existing `detect` request                                                                                                                                                                 |
| Policy resolution, naming, export planning | Page                           | Pure and O(groups + members); memoised per state                                                                                                                                              |
| Preview simulation and plan                | Page                           | Incremental from the last state; a hand trigger's simulation under 1 ms and its simulation and extension under 5 ms at the bounds, held by a performance test (section 6, amended 2026-10-16) |
| Preview and loop audition audio            | Feeder worker and worklet      | The existing programme path, continued programmes                                                                                                                                             |
| Export renders, encodes, delivery          | Render, codec, storage workers | Phase 09's, unchanged but for the relative folder                                                                                                                                             |

`packages/detection-runtime/src/detection-messages.ts` gains the two
request and reply kinds; `detection-host.ts` gains `analyseLoop` and
`measureLoudness`; `loop-run.ts`, `loudness-run.ts` and `report-reading.ts`
(the report helpers moved from the web app, section 7) are new beside
`detection-run.ts`. Readers of every new message validate it as the existing
ones do.

## 11. Interface: the Game Audio workspace

Panels (kinds in `packages/workspace/src/presets.ts`'s `PanelKinds`, since
the Game Audio preset places them, as Phase 08 did for Spectral):

| Kind           | Title        | Preset place                       | Contents                                                                                                                                                                                                                                                    |
| -------------- | ------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game-groups`  | Asset groups | Left, tab beside the Asset Browser | The group tree, each group's members, assign and remove, the group's policy with each field's source, the loudness conformance column                                                                                                                       |
| `loop-editor`  | Loop         | Bottom, tab beside Transport       | The region's loop, its metrics with verdicts in words, the seam view (tail over head), candidates with their metrics, audition and apply                                                                                                                    |
| `game-preview` | Game preview | Bottom, tab                        | Scenario picker and editor, the listener-and-emitter pad, run, stop and trigger, the rules each emitter plays by and where they come from, live parameters, bus levels, seed, the event log, voices sounding against the limit and the hand-trigger latency |

The Inspector (`apps/web/src/shell/inspector/`) gains a Game policy section
for a member or a group: every field's effective value, its source in words
("Set on Footsteps", "Inherited from Footsteps/Grass", "Overridden on this
region", "Not set"), what an override hides, and Reset per field. Workflows
are dialogs (`apps/web/src/shell/workflows/`), opened by their commands from
the Tools menu, the palette, a group's or region's context menu and the
Asset groups panel: options with their defaults and sources, the analyses'
progress with Cancel, every item with what will change, then Apply.

Accessibility and input (`REQ-UX`, the shell's existing rules):

- The group tree is an ARIA `tree` with roving focus: arrows move and
  expand, Home and End, F2 renames, Delete runs `game.delete-group` with its
  refusal announced, Enter shows the group's members; every drag has a
  command equivalent (`game.assign-selection`, `game.move-group`).
- Verdicts and sources are words and icons with text, never colour alone;
  colours come from the design system's tokens.
- The pad's listener and emitters are focusable: arrows move by 0.1 unit
  (Shift by 1), with numeric fields beside them; a moving emitter's drawing
  honours reduced motion; the pad has a text alternative stating each
  emitter's distance and direction.
- Analysis completion, a workflow's result, a refused command and a
  continued programme refused are announced once in the polite live region;
  the event log is a table, announced at most once a second as a count.
- Every command is reachable from the keyboard and the palette, with a
  default binding only for `preview.trigger` (the first emitter) and the
  loop auditions, scoped to the panel's focus as the clipboard keys are.

Words live beside their surfaces (`apps/web/src/shell/game/game-words.ts`,
`shell/loop/loop-words.ts`, `shell/preview/preview-words.ts`,
`shell/workflows/workflow-words.ts`), British English.

## 12. Verification scripts

The packet's commands run as written:

- `pnpm test --filter game-audio --filter loop-analysis`: pnpm consumes the
  filters and runs each matched package's own `test` script, which WU-10.0
  gives both packages (and `guided-workflows`) as the graph generates every
  package's: `vitest run --root ../../ --project <name>`.
- `pnpm test:loop-golden`: root script `"vitest run loop-golden"`, selecting
  `*.loop-golden.test.ts` by file name across projects, as
  `test:spectral-golden` does; `test:audio-golden` (`vitest run golden`)
  runs them too.
- `pnpm test:e2e:game-workflows`: root script
  `"playwright test --project=chromium-game-workflows"`, with
  `{ name: 'chromium-game-workflows', use: { ...devices['Desktop Chrome'] }, testMatch: /game-workflows\.spec\.ts/ }`
  in `playwright.config.ts`.

Root `package.json` also gains `"test:game-audio": "vitest run --project
game-audio --project loop-analysis --project guided-workflows"`, the three
packages in one run. The existing `test:project-roundtrip`,
`test:editing-property`, `test:dsp-property`, `test:audio-golden`,
`test:architecture` and `test:roundtrip-audio` run unchanged and cover the
extended surfaces.

## 13. Test plan by requirement

| Requirement                 | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-GAME-120`              | `policy-resolution.test.ts` (each rule of section 3, by fixture forest); `policy-resolution.properties.test.ts` (random forests: `resolveAll` equals `resolvePolicy`, permuting maps and memberships never changes an answer, a reset reveals `shadowed[0]`); `state-validation.test.ts` (every code, each failure naming its owner; `inherit` with a mismatched rack refused); `processing-realisation.test.ts` (inheriting `none` and unset; A → none → B keeps every inheritor; `own` with an equal rack stays `own`); `chain-users.test.ts` and an architecture rule that no other package imports the domain's `chainUsers`; `game/*-commands.test.ts` (each command and its inverse, rack re-pointing, chain entering and leaving, `set-rack` turning a member `own`); the random command walk extended with game commands; `game-audio-json.test.ts`, `history-node-json.test.ts` (a node without `gameGroups` still reads) and the tree round trip; `game-chains.test.ts` (each built-in entry valid against the catalogue, values pinned) and `processing-library-store.test.ts` (built-ins listed, never renamed or removed)                                                                                                                                                                                                                                                                     |
| `REQ-GAME-121`              | `*.loop-golden.test.ts` over `testing/loop-fixtures.ts` (below) pinning metrics (`doublesFingerprint`) and the ranked candidates' frames; `seam-metrics.test.ts` per metric against hand-computed values, including zero RMS, a steady sine's zero MAD, non-finite input and each reference; `candidate-search.test.ts` (overlap-save NCC against a direct sum, tie-breaking, keep-length, radius clipping, multichannel and anti-phase stereo); `search-bounds.test.ts` (one pass, the reads counted); `crossfade-suggestion.test.ts` (a sine needs at least two periods; a whole-sound loop gets the moved-start candidate); `loop-crossfade.test.ts` and `loop-crossfade-property.test.ts` in the domain against its oracle (both joins, every shape, the clamp after a later edit); `loop-run.test.ts` (cancelled and failed runs return no result and change nothing); `audition-plans.test.ts` rendered offline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `REQ-GAME-122`              | `selection.test.ts`, `voice-allocation.test.ts` (limit + 1 lanes, a stolen voice's fade never shares a lane), `cooldown.test.ts` (strict, rejected and suppressed leave it), `voice-budget.test.ts`, `motion.test.ts`, `preview-draws.test.ts` (every formula of section 6; reordering emitters changes no draw); `preview-simulation.properties.test.ts` (same seed same log; continuation equals the whole; never more than `limit` voices; `avoid-recent(d)` never repeats within d when n > d; suppressed triggers change no later choice; a member's `variation` and `bus` override reach its voices); `preview-vectors.test.ts` (the reference vectors Phase 11 consumes); `preview-plan.test.ts` and `extend-preview-plan.test.ts` (rendered offline: a voice's samples at its frame, gain and pitch; streams before F unchanged at their indices); `spatial-panner.golden.test.ts` and properties (each model, the filter, the pan laws, automation rendered offline equal to running changes at the same frames); the varispeed property tests against the domain's oracle; `chain-automation.test.ts` in the effect rack; the D3 gate tests (a)–(c) in `plan-readers.test.ts`, the feeder tests and `playback-session.test.ts`, and `playback-control.test.ts`; `hand-trigger.performance.test.ts` (the simulation under 1 ms, with the extension under 5 ms, at the bounds; amended 2026-10-16) |
| `REQ-GAME-075`              | Each planner's test over `testing/workflow-states.ts` (plans, skips, refusals); `workflow-dispatch.test.ts` in the web app (a refused item dispatches nothing; one undo reverses a run); dialog tests; the browser test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `REQ-GAME-023`              | Naming: `naming-template.test.ts`, `member-naming.test.ts` (every token and modifier), `template-grammar.test.ts` in import-export with Phase 09's tests unchanged; export: `game-export-plan.test.ts` (resolution equals `resolvePreset`, collisions, per-item refusal with owner), `export-delivery.test.ts` (relative folders, trusted records by path); loudness: `loudness-run.test.ts`; the remaining items as section 1 maps them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Acceptance: long recordings | The browser test cuts a long signal asset into regions with Cut Into Sounds, names them, gives the group a profile and exports them; `cut-into-sounds.test.ts` asserts no new source or media is made (only regions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Loop fixtures (generated by `@audiogubbins/test-fixtures` signals and
`loop-analysis/src/testing/loop-fixtures.ts`, at 48 kHz, mono and stereo):
a 480 Hz sine looped at a whole number of periods inside a longer region
(all pass, reference `post-end`); the same as a whole-sound loop (reference
`adjacent`, all pass, the moved-start crossfade offered only where asked); the
loop cut a quarter period short (phase ≈ 90°, discontinuity fail); a sine
with a 0.05 DC step at the seam (DC mismatch fail); a 6 dB level step (level
fail); a bass drone with a steady DC (no false DC mismatch); a drum loop whose
head is a hit and whose tail is decay (no false level or spectral failure on
`post-end`); a seeded noise loop cut at random frames (candidates found within
the radius); a stereo loop with only the right channel discontinuous (worst
channel 1); an anti-phase stereo loop (anchors and correlation still found);
a click inserted at E−1; a single-cycle loop of 100 frames (cyclic windows,
spectral and phase not applicable); a loop with 2 ms of pre-roll only (a 5 ms
crossfade not offered, 2 ms suggested where it passes). Each golden
pins the analysis result and the candidate list; the suggested points of the
sine fixtures are asserted exactly (whole periods).

The browser test (`tests/e2e/game-workflows.spec.ts`, Chromium): open the
deterministic test asset, Cut Into Sounds into a new group
`Footsteps/Grass`, apply the built-in game WAV preset to `Footsteps` and see
`Grass` inherit it in the Inspector with its source, override it on one
region and reset it; Prepare One-Shot on the group and find the step in
History and the fades and slot in the Inspector, then undo it in one step;
apply the built-in "Game SFX, −16 LUFS" chain to the group from the Library
and find it inherited by every member;
Create Seamless Loop on a looped region: analyse, audition a candidate,
apply it and find the loop in the Inspector; run a preview scenario that
triggers the group 20 times and a loop emitter, check the event log's
counts and that the History panel has no new step; export the group as
downloads and check the names; reload and find the groups.

## 14. Work units, file ownership and order

Every unit is a branch from the phase branch, merged back by the integrator.
No two units edit one file at the same time. A unit that needs a line in a
shared file lists it in its brief, and the integrator commits it on the phase
branch before the unit branches. Where one file must change in two units, it
is _handed over_: the first unit owns it until it merges, the second branches
after that merge, and the table says so (→). `tests/architecture/public-contracts.txt`
is regenerated by the integrator after each merge (`pnpm contracts:update`).

| Unit     | Work                                                                   | Owns (exclusively)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Needs                                   |
| -------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| WU-10.0  | Integration and shared files                                           | `package.json`; `tools/sync-workspace-graph.mjs` and what it generates (`vitest.projects.json`, `tsconfig.build.json`, `packages/*/package.json` with each new package's `test` script `vitest run --root ../../ --project <name>`, `packages/*/tsconfig.json`, `packages/*/scopes/**`); `tests/architecture/dependency-rules.test.ts` (with the `chainUsers` import rule); `.dependency-cruiser.cjs`; `tests/architecture/public-contracts.txt`; `playwright.config.ts`; `eslint.config.js`; `version.json`, `packages/version/src/index.ts`, `crates/audiogubbins-version/src/generated.rs`; `apps/web/src/application.ts`, `apps/web/src/panel-descriptors.ts`, `apps/web/src/panel-kinds.ts`, `apps/web/src/shell/panels.tsx` and its test, `apps/web/src/commands/shell-commands.ts`, `apps/web/src/commands/shell-context.ts`, `apps/web/src/shell/menus.ts` and its test; `packages/workspace/src/presets.ts` and its test; the new packages' `src/index.ts`; this plan; everything under `docs/spec/`                                                                                                        | —                                       |
| WU-10.D3 | **Gate.** Continued programme with live readers                        | `packages/audio-runtime/src/playback/**`, `src/feeder/**`, `src/feed/**`, `src/protocol/feeder-messages.ts`, `feed-messages.ts`; `packages/audio-engine/src/pcm/plan-readers.ts`, `edited-source.ts`, `processed-content.ts`, `resampled-source.ts`, `plan-content.ts` and tests (→ P after D3 merges); `packages/audio-engine/src/transport/**`; `apps/web/src/audio/programme.ts`, `playback-control.ts`, `playback-parts.ts`, `browser-engine.ts` and tests. Acceptance: section 6's tests (a)–(c)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 0                                       |
| WU-10.A1 | Template grammar, naming templates, destination paths, export profiles | `packages/import-export/src/template-grammar.ts` (new), `file-name-template.ts`, `file-name-safety.ts` and tests; `packages/game-audio/src/export/naming-template.ts`, `naming-vocabulary.ts`, `case-modifiers.ts`, `member-naming.ts`, `destination-path.ts`, `game-export-profile.ts`, `member-export-settings.ts` and tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 0                                       |
| WU-10.D1 | Shared counter draw                                                    | `packages/domain/src/integrity/counter-draw.ts` (new) and test; `packages/import-export/src/dither-noise.ts` and its users' imports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 0                                       |
| WU-10.C1 | Loop analysis core, shared zero-crossing boundary                      | `packages/loop-analysis/**`; `packages/audio-engine/src/pcm/zero-crossing-boundary.ts` (new) and test; `packages/waveform/src/zero-crossings.ts` and test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0 (P for the crossfaded-audition tests) |
| WU-10.D2 | Processors, chain automation, built-in game chains                     | `packages/processors/src/space/spatial-panner.ts` (new) with golden and property tests; `packages/processors/src/library/game-chains.ts` (new) and test; `catalogue.ts`, `catalogue.test.ts`; `packages/effect-rack/src/chain-run.ts`, `chain-graph.ts` (automation) and tests; `packages/storage/src/processing-library-store.ts` (built-in entries) and test; `packages/storage-runtime/src/host/host-services.ts`, `processing-library-area.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 0                                       |
| WU-10.P  | Plan additions: loop crossfade and shape, varispeed, chain automation  | `packages/domain/src/project/timeline.ts`, `src/editing/plan.ts`, `plan-building.ts`, `placement.ts`, `placement-validation.ts`, `plan-validation.ts`, `plan-decoding.ts`, `processed-streams.ts`, `loop-crossfade.ts` (new), `operation-validation.ts`, and every domain test naming `crossfadeLength`; the plan readers after D3 merges (varispeed and automation reading); `packages/project-format/src/plan-writing.ts`, `plan-reading.ts`, `placement-reading.ts`, `placement-writing.ts`, `testing/random-edits.ts`, `edit-json.test.ts`, `project-json.test.ts` (→ A4); `packages/history/src/entity-fields.ts` (→ A4); `apps/web/src/commands/region-property-commands.ts` (→ E2), `apps/web/src/shell/inspector/region-properties.tsx` and `inspector-panel.test.tsx` (→ E1), `apps/web/src/commands/edit-commands.test.ts`, `apps/web/src/export/file-metadata.test.ts`; `packages/storage/src/import-placements.ts`, `decoded-import.test.ts`; `packages/test-fixtures/src/projects.ts`; `packages/editor-view/src/view.test.ts`; `packages/project-commands/src/editing/editing-commands.test.ts` (→ A5) | D3                                      |
| WU-10.A2 | Groups, membership, policy, validation, resolution, chain users        | `packages/game-audio/src/groups/**`, `src/policy/**` (with `playback-rules.ts` and `chain-users.ts`), `src/testing/random-game-state.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A1                                      |
| WU-10.A6 | Delivery into a relative folder                                        | `packages/storage/src/export-delivery.ts`, `export-collision.ts`, the trusted-folder record modules; `packages/storage-runtime/src/protocol/` export messages, `src/client/exports-client.ts`, the host's export handler; `packages/browser-storage/src/` folder destination adapter; tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | A1                                      |
| WU-10.C2 | Analysis in the detection worker; report reading                       | `packages/detection-runtime/src/**` (`loop-run.ts`, `loudness-run.ts`, `report-reading.ts` new; messages, message reading, core, host, threads)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | C1                                      |
| WU-10.A3 | Game export plan and member naming                                     | `packages/game-audio/src/export/game-export-plan.ts`, `member-names.ts` and tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A2                                      |
| WU-10.A4 | Persistence and history                                                | `packages/project-format/src/game-audio-json.ts` (new), `project-state.ts`, `project-json.ts` (with the version-9 refusal), `project-tree-layout.ts`, `project-tree-reading.ts`, `project-tree-writing.ts`, `history-record.ts`, `history-node-json.ts` (`gameGroups` read with `optional`, as `takeStacks`), `testing/random-states.ts`, `testing/random-values.ts`, `testing/project-states.ts` and tests; `packages/history/src/state-diff.ts`, `entity-fields.ts`, `history-rows.ts`, `difference-names.ts` and tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | A2, P                                   |
| WU-10.D4 | Preview simulation and plan                                            | `packages/game-audio/src/preview/**`, `src/testing/preview-vectors.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A2, P, D1, D2, D3                       |
| WU-10.A5 | Game project commands                                                  | `packages/project-commands/src/game/**` (new), `project-command.ts`, `project-commands.ts`, `processing/chain-naming.ts`, `processing/rack-commands.ts` (`set-rack` sets an `inherit` member `own`), `editing/region-commands.ts`, `editing/editing-commands.test.ts`, `asset-commands.ts`, `testing/**` and tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A2, A4, P                               |
| WU-10.B  | Guided workflow planners                                               | `packages/guided-workflows/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A3, A5, C1, C2, D2                      |
| WU-10.E1 | Interface: groups, policy, Inspector, library, export, workflows       | `apps/web/src/shell/game/**`, `apps/web/src/shell/workflows/**`, `apps/web/src/shell/inspector/**`, `apps/web/src/shell/library/**`; `apps/web/src/commands/game-group-commands.ts`, `game-member-commands.ts`, `game-export-commands.ts`, `loudness-commands.ts`, `guided-workflow-commands.ts`, `export-starting.ts`, `split-commands.ts`, the region delete command's module, `rack-target.ts`, `rack-building-commands.ts`, `analysis-commands.ts`, `silence-commands.ts`; `apps/web/src/analysis/detection-control.ts`, `loudness-measuring.ts` (new); `apps/web/src/state/workflow-draft-store.ts`, `loudness-store.ts`, `game-policy-view.ts`; tests                                                                                                                                                                                                                                                                                                                                                                                                                                                          | A3, A5, A6, B, C2, D2                   |
| WU-10.E2 | Interface: loop panel and auditions                                    | `apps/web/src/shell/loop/**`; `apps/web/src/commands/loop-analysis-commands.ts`, `loop-audition-commands.ts`, `region-property-commands.ts`; `apps/web/src/analysis/loop-analysing.ts` (new); `apps/web/src/state/loop-analysis-store.ts`; `apps/web/src/audio/loop-audition.ts`; tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | C2, P, D3 (gate passed)                 |
| WU-10.E3 | Interface: preview panel                                               | `apps/web/src/shell/preview/**`; `apps/web/src/commands/game-preview-commands.ts`; `apps/web/src/state/game-preview-store.ts`; `apps/web/src/audio/preview-programme.ts`; tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | D3 (gate passed), D4, A5                |
| WU-10.F  | Browser test                                                           | `tests/e2e/game-workflows.spec.ts` and its fixtures under `tests/e2e/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | E1, E2, E3                              |
| WU-10.R  | Lens and adversarial reviews, remediation                              | review records under `docs/spec/reviews/` (through WU-10.0); fixes go to the unit that owns the file, re-opened                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | F                                       |
| WU-10.Z  | Evidence, ledger, handoff                                              | (WU-10.0's files under `docs/spec/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | R                                       |

Order:

1. WU-10.0 lands the three packages' scaffolds with their `test` scripts,
   graph entries, layering and cruise rules and the root scripts; then for
   each unit, before it branches, the lines it lists.
2. Wave 1, in parallel: **D3 (the gate)**, A1, D1, C1, D2.
3. Wave 2: P (after D3 merges, since it takes the plan readers over);
   A2 and A6 (after A1); C2 (after C1).
4. Wave 3: A3 (after A2); A4 (after A2 and P); D4 (after A2, P, D1, D2, D3).
5. Wave 4: A5 (after A2, A4, P).
6. Wave 5: B (after A3, A5, C1, C2, D2).
7. Wave 6, in parallel: E1 (after A3, A5, A6, B, C2, D2); E2 (after C2, P
   and the passed D3 gate); E3 (after the passed D3 gate, D4, A5). Each gives
   WU-10.0 its panel, command and context lines.
8. WU-10.F; the packet's commands over the integrated branch; WU-10.R (the
   lens reviews, the adversarial review, verification of findings,
   remediation and re-review, section 16); WU-10.Z. Amended 2026-10-16:
   WU-10.R is the scope checks and their fixes; the lens reviews and the
   adversarial review are deferred (section 16).

The version raise is WU-10.0's line, committed when A4 branches; A4's
refusal test names the version it takes.

## 15. Conflicts and open questions

The packet and scope conflicts are recorded formally in
`docs/spec/traceability/changes/CHG-0001-phase-10-scope-and-ownership.md`
(`Proposed`, `REQ-EXEC-168`), with the packet amendments it carries applied
to `docs/spec/phases/phase-10-game-audio-tooling.md` under "Specification
change CHG-0001". Summary:

- **C1. `REQ-GAME-023` names features other phases own** (Godot-aware
  export and project integration: Phase 11, `REQ-GODOT-024`; variation
  generation: Phase 13, `REQ-GAME-022`; batch conversion and export at scale:
  Phase 13's `BatchJob`; rate, depth and channel conversion and export
  presets: Phase 09). CHG-0001 maps each item to its deliverer.
- **C2. Export recipes and "packages/export-recipes game layer".** Phase 10
  delivers one inherited `GameExportProfile`; recipe objects are Phase 11's
  (`REQ-GODOT-119`, the Phase 09 handoff); the owned module is
  `packages/game-audio`'s export layer.
- **C3. Variation selection** (`REQ-GAME-122`, `REQ-GAME-120` against
  `REQ-GAME-112`/`-113`): Phase 10 delivers the selection core Phase 13
  extends. Within the packet; recorded in section 1 and `ADR-0104`.
- **C4. The Godot runtime's selection logic** (`REQ-GAME-122`): Phase 10's
  algorithms and vectors are the reference Phase 11's GUT tests reproduce;
  CHG-0001 names them as a contract the Phase 11 packet consumes.
- **C5. Event parameters** (`REQ-GAME-122` against `REQ-GODOT-114`/`-128`):
  built-in parameters only. Within the packet; recorded in section 1.
- **C7. Packages beyond the packet's owned modules**: amended by CHG-0001.
- **C8. Two phases own `packages/game-audio`**: CHG-0001 amends the Phase 13
  packet to "extends".
- **C9. Export for Godot against `REQ-GODOT-024`**: ordinary profiles, names
  and paths only; recorded in section 1 and `ADR-0105`.
- **C10. Destination paths against folder templates**: literal paths now,
  tokens in Phase 11; recorded in `ADR-0102`.
- **C11. A loop's crossfade becomes audible**, with a shape, a tail join and
  a clamp: amends `ADR-0051` and Phase 05's passed behaviour; CHG-0001 states
  the effect on Phase 05's evidence.
- **C13. The document version**: the next free one at merge.
- **C14. `docs/spec/adr/README.md` has no index**; the drafts are registered
  in `tools/spec_manifest.json`.
- **C15. Loop-analysis results are not persisted.** The packet's Data/Schema
  says the phase introduces "loop-analysis results"; they are derived from
  audio, which the global invariant keeps as disposable cache, and the
  analysis is reproducible from the plan, so they are a published type and a
  session cache, while the loop the person chooses is persisted. CHG-0001
  records the reading and amends the packet's line.
- **C16. Game processing presets.** The packet's "Loudness matching and game
  presets" and `REQ-GAME-023`'s "game-oriented processing presets" are
  delivered as built-in entries of the processing library (section 3); the
  packet names no home, and CHG-0001 records it.

Withdrawn after review: C6 (the packet's `pnpm test --filter game-audio
--filter loop-analysis`: pnpm consumes `--filter` itself and runs each
matched package's own `test` script, as observed in this worktree, "Scope: 0
of 38 workspace projects" before the packages exist; WU-10.0 gives both
packages that script) and C12 (the maintainer requires this phase's lens
reviews; section 16). Amended 2026-10-16: the maintainer has since deferred
this phase's lens reviews to the review after the whole specification is
implemented, which C12 had recommended (section 16).

Open questions, to settle in the unit named:

- **Q1 (E1, Export for Godot).** Godot 4's WAV importer's loop detection
  from `smpl`, and whether its Ogg Vorbis importer reads `LOOPSTART`
  comments or only its import settings, to be confirmed against the Godot 4
  documentation before the workflow's text says what Godot will do.
  Settled 2026-10-16 (WU-10.E1b) from Godot 4's documentation: Godot reads a
  WAV file's loop when its import loop mode is "Detect From WAV"; an Ogg
  file loops only from its import settings.
- **Q2 (D3, the gate).** Whether the feeder can switch at its next read frame
  in every profile; this is what the gate's tests decide, and a failure
  blocks the phase rather than degrading it. Answered 2026-10-16: the
  gate's tests (a)–(c) pass in the reference renderer and the feeder
  (`plan-continuation.test.ts`, `feeder-continuation.test.ts`; `c6677d89`).
- **Q3 (D2, D4; Phase 11).** The attenuation formulas', `CMP_EPSILON`'s and
  the distance filter's parity with Godot 4's `AudioStreamPlayer2D` and
  `AudioStreamPlayer3D` source, confirmed before the vectors are pinned.
  Answered 2026-10-16 (WU-10.D2) against Godot 4's source, with the
  differences section 6 records ("Space", amended).
- **Q4 (D4).** Elevation on surround or binaural output: the preview pans to
  stereo and folds to the project's layout; `ambisonic-encode`/`-decode`
  could place an emitter in height, a later decision.
- **Q5 (D4).** `PREVIEW_VOICE_BUDGET`: the measured number of varispeed
  voices at preview quality in real time on the reference machine, and the
  cost of `extendPreviewPlan`, each pinned by a test. Answered 2026-10-16
  (WU-10.D4): a budget by grade and pitch range, not one number, and a hand
  trigger's cost of 5 ms at most (section 6, amended).
- **Q6 — answered.** A new tree file does not raise `projectStorage`: the
  commit that added `project/export-settings.json` (`21694890`) raised only
  `projectDocument` (7 to 8 in `version.json`).
- **Q7 (P, maintainer).** A stateful rack renders the loop's head after the
  intro, not after the loop's own end. Rendering a looping region's rack
  "wrapped" (the loop processed twice, the second cycle kept) would make the
  seam exact; it changes `ADR-0060`'s rule that a rack runs from its target's
  start, so it is the maintainer's to decide. Until then the analysis
  measures and reports such a seam. Still open for the maintainer at the
  phase's close (2026-10-16).

## 16. Reviews and evidence the phase owes

**Reviews (WU-10.R), before `PASS`.** Amended 2026-10-16: the maintainer
deferred this phase's independent lens reviews and adversarial review, with
their verification, remediation and re-review, to the review after the whole
specification is implemented, as Phase 09's were; this section required the
pipeline of `contracts/review-gates.md` before `PASS`. In its place, after
the packet's commands pass over the integrated branch:

1. Evidence assembly (`docs/spec/reviews/phase-10-evidence.md`, drafted
   while the units land).
2. Read-only scope checks, as Phase 09 ran, each by an agent that built none
   of the work, reading the integrated branch against every In Scope item,
   acceptance criterion, invariant, cross-package rule, failure behaviour,
   forbidden shortcut and required contract of the packet, `ADR-0100` to
   `ADR-0106` and `CHG-0001`, editing nothing.
3. Each finding confirmed by reading the code again or reproduced by a
   failing test, and fixed by the unit that owns the file with a regression
   test that fails without the fix.
4. The gate: `PASS` only with no open `BLOCKER`, `CRITICAL` or `HIGH`, and
   every `MEDIUM` fixed or accepted as recorded debt; the ledger notes the
   deferred lenses.

`docs/spec/reviews/phase-10-review.md` records the decision, each deferred
lens, the design-stage adversarial reviews (architecture, 14 findings; DSP,
24; disposed of by `61bd8f1a`), and every finding of the scope checks and of
the build with its severity, status, disposition and proof.

**Evidence.** `phase-10-evidence.md` in Phase 09's sections (objective,
checklist, inherited debt, files, contracts, ADRs, decisions beyond the
ADRs, tests, commands, results, browser results, acceptance criteria,
limitations, dependencies, schema impact, requirement-to-evidence mapping,
commits, findings), with CHG-0001's decision; the ledger's Phase 10 entry
with its evidence files, status `PASS` when the gate holds;
`docs/spec/traceability/handoffs/phase-10.md` after `PASS`, stating the
preview vectors and the game-audio contracts Phase 11 consumes and the
extension points Phase 13 takes (the selection union, the member union, the
game export plan's items).
