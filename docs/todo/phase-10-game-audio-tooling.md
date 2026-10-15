> **Status:** In progress. 2026-10-15: the design and the ADR drafts
> (`ADR-0100` to `ADR-0106`, `Proposed`) are written; no product code is
> built yet. Phase 10 is `READY` in the implementation ledger.

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

| Date       | Entry                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-10-15 | Design and ADR drafts written on `phase/10-game-audio-tooling` over `main` at `43968c5b`. Conflicts C1–C14 recorded. |

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

Light gates, as Phase 09 ran them (owner decision of 2026-10-07):
`pnpm run verify:commit` for every change, `pnpm run spec:verify` after an
edit under `docs/spec/`, and the packet's commands (restated below) at the
phase's end. The review lenses the packet names are deferred to the review
after the whole specification is built, recorded in
`docs/spec/reviews/phase-10-review.md` as Phase 09 recorded its own. The
author of a new test sees it fail once against the code it guards.

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
16. Evidence the phase owes

## 1. Scope and what it leaves to Phases 11 and 13

Phase 10 builds what its packet's In Scope list names, on Phase 05's edit
model, Phase 06's racks and assistants and Phase 09's export. Where its
requirements name something another phase owns, the line is drawn here by the
requirement text, and every crossing is recorded in section 15.

| Item (packet / requirement)                                                                                | Phase 10 builds                                                                                                 | Left to                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Export recipes (`REQ-GAME-120`, `REQ-GODOT-119`)                                                           | `GameExportProfile`: one inherited profile per group or member, resolving to Phase 09's `ExportSettings`        | Phase 11: recipes as first-class project objects, several per object, target project, live-export policy, rebuild-all (`REQ-GODOT-119`) |
| Destination paths (`REQ-GAME-120`)                                                                         | A literal relative folder path, inherited, honoured by folder delivery                                          | Phase 11: folder templates with tokens (`REQ-GODOT-119`), Godot project targets (`REQ-GODOT-124`)                                       |
| Runtime variation policies (`REQ-GAME-120`), variation selection and repetition avoidance (`REQ-GAME-122`) | `PlaybackRules` with `uniform` and `avoid-recent(depth)` over a group's members, on the shared seeded generator | Phase 13: variation sets, weights, sequential, ping-pong, shuffle bag, custom hooks (`REQ-GAME-112`, `REQ-GAME-113`)                    |
| "Same runtime-selection logic as the Godot addon" (`REQ-GAME-122`)                                         | The algorithms as the reference, with test vectors                                                              | Phase 11: the GDScript runtime held to the vectors in GUT                                                                               |
| Event parameter manipulation (`REQ-GAME-122`)                                                              | Built-in parameters: position and distance, volume and pitch offsets, bus levels                                | Phase 11: authored runtime parameters, curves, conditions, layered events (`REQ-GODOT-114`, `-128`, `-129`)                             |
| Batch export, batch conversion (`REQ-GAME-023`)                                                            | Many members exported as one itemised plan through Phase 09's batch                                             | Phase 13: `BatchJob` with bounded scheduling, retry and resume, import-edit-DSP-export pipelines                                        |
| Controlled random variation generation (`REQ-GAME-023`)                                                    | Randomised pitch, gain and start offset in preview only                                                         | Phase 13: generating and exporting variants (`REQ-GAME-022`)                                                                            |
| Godot-aware export, Godot project integration (`REQ-GAME-023`, guided "Export for Godot")                  | Ordinary profiles, names and paths chosen for what Godot 4's importer reads                                     | Phase 11: `.import` files, resources, manifests, project folders, live export (`REQ-GODOT-024`, `-116`, `-117`)                         |
| Sample-rate, bit-depth, mono/stereo conversion, export presets (`REQ-GAME-023`)                            | Already Phase 09's settings; reached through profiles and presets                                               | —                                                                                                                                       |
| Macros (`REQ-GAME-074`)                                                                                    | Workflows as plans of ordinary invocations                                                                      | Phase 13: recorded and composed action sequences                                                                                        |

## 2. Package topology and dependency direction

`ADR-0100`. Three new packages; additions to existing ones only at seams they
own.

```
domain ◄── import-export ◄── game-audio ◄── project-format ◄── project-commands ◄── guided-workflows ◄── apps/web
domain, audio-engine ◄── loop-analysis ◄── detection-runtime, guided-workflows, apps/web
history ──► game-audio (its diff names groups)
```

| Package                     | Name                             | Portable | Depends on                                                                                 |
| --------------------------- | -------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `packages/game-audio`       | `@audiogubbins/game-audio`       | yes      | `domain`, `import-export`                                                                  |
| `packages/loop-analysis`    | `@audiogubbins/loop-analysis`    | yes      | `domain`, `audio-engine`                                                                   |
| `packages/guided-workflows` | `@audiogubbins/guided-workflows` | yes      | `domain`, `game-audio`, `loop-analysis`, `processors`, `import-export`, `project-commands` |

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
               policy-resolution.ts, processing-realisation.ts
  export/      naming-template.ts, naming-vocabulary.ts, case-modifiers.ts,
               member-naming.ts, destination-path.ts, game-export-profile.ts,
               member-export-settings.ts, game-export-plan.ts, member-names.ts
  preview/     preview-scenario.ts, preview-draws.ts, selection.ts, voice-allocation.ts,
               cooldown.ts, attenuation.ts, panning.ts, motion.ts, preview-simulation.ts,
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

export interface GroupMembership {
  readonly member: GroupMember;
  readonly group: GameAssetGroupId;
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
  'playback',
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
  readonly playback: PlaybackRules;
  readonly bus: BusName;
  readonly tags: readonly string[];
}

/** What a group sets. */
export type InheritedPolicy = { readonly [F in PolicyField]?: PolicyValues[F] };

/** What a member sets over its group: processing is its rack, tags are its own. */
export type PolicyOverrides = {
  readonly [F in Exclude<PolicyField, 'processing' | 'tags'>]?: PolicyValues[F];
};

// policy/loudness-target.ts
export interface LoudnessTarget {
  readonly integratedLufs: number; // −70 to 0
  readonly toleranceLu: number; // 0.1 to 6
  readonly truePeakCeilingDbtp?: number; // −20 to 0
}

// export/destination-path.ts
export interface DestinationPath {
  readonly segments: readonly string[];
} // 0–16 segments
// policy/bus-name.ts
export type BusName = Branded<'BusName'>; // 1–64 characters, NFC, no control character
```

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

export type ProcessingStatus =
  | { readonly kind: 'inherited'; readonly chain: EffectChainId; readonly from: GameAssetGroupId }
  | {
      readonly kind: 'own';
      readonly rack: EffectChainId | undefined;
      readonly inherits?: EffectChainId | 'none';
    };

export interface ResolvedTag {
  readonly tag: string;
  readonly from: readonly (
    { readonly kind: 'group'; readonly group: GameAssetGroupId } | { readonly kind: 'member' }
  )[];
}

export interface EffectivePolicy {
  readonly member: GroupMember;
  readonly group: GameAssetGroupId | undefined;
  readonly processing: Resolved<EffectChainId | 'none'> & { readonly status: ProcessingStatus };
  readonly loudness: Resolved<LoudnessTarget>;
  readonly exportProfile: Resolved<GameExportProfile>;
  readonly naming: Resolved<NamingTemplate>;
  readonly destination: Resolved<DestinationPath>;
  readonly playback: Resolved<PlaybackRules>;
  readonly bus: Resolved<BusName>;
  readonly tags: readonly ResolvedTag[]; // sorted by tag
}

export function resolvePolicy(
  project: Project,
  state: GameAudioState,
  member: GroupMember,
): EffectivePolicy;
export function resolveAll(
  project: Project,
  state: GameAudioState,
): ReadonlyMap<string, EffectivePolicy>; // keyed by memberKey(member)
export function resolveGroupPolicy(
  state: GameAudioState,
  group: GameAssetGroupId,
): GroupEffectivePolicy; // what a new member would inherit
export function memberKey(member: GroupMember): string; // 'region:<id>' | 'asset:<id>'
```

Rules, each a test:

1. A field resolves to the member's override where one is set, else to the
   nearest ancestor (the member's group first) that sets it, else `unset`.
   `processing` is never an override: its status compares the member's rack
   (`Region.rack` or `Asset.rack`) with the inherited chain (`ADR-0101`).
2. `tags`: the sorted union of every ancestor's `tags` and `Region.tags`,
   each with every source that gives it. No member override.
3. Resolution walks parent links from the member's group to its root once;
   the forest is validated acyclic, so it terminates, and the answer depends
   only on `(project, state, member)`. `resolveAll` equals `resolvePolicy`
   per member (property test) and runs in O(groups + members).
4. A member in no group resolves every field `unset` but `processing`
   (`own`) and `tags` (its own).

**Validation.** `validateGameAudioState(project, state): DomainResult<GameAudioState>`
in `groups/state-validation.ts`, called by every game command on its result
and by the project format's reader. Each failure's `details` carries
`{ field, owner: 'group' | 'member', group?: id, groupPath?: 'A/B', member?: key }`
and its summary names the group by path or the member by name, so "invalid
inherited settings identify the owning group/override" holds everywhere
the failure is shown.

| Code                              | Refused                                                                     |
| --------------------------------- | --------------------------------------------------------------------------- |
| `game.group-parent-unknown`       | A parent that is not a group                                                |
| `game.group-cycle`                | A group that is its own ancestor                                            |
| `game.group-name-invalid`         | A name breaking the segment rule                                            |
| `game.group-name-taken`           | Two siblings (or two roots) equal in NFC lower case                         |
| `game.member-unknown`             | A member naming no region or asset of the project                           |
| `game.member-twice`               | A member in two memberships                                                 |
| `game.member-group-unknown`       | A membership naming no group                                                |
| `game.policy-chain-unknown`       | `processing` naming no chain of `project.effectChains`                      |
| `game.policy-loudness-invalid`    | A target, tolerance or ceiling out of its range                             |
| `game.policy-naming-invalid`      | A template the game vocabulary does not read (section 4)                    |
| `game.policy-destination-invalid` | A segment `safeFolderName` would change, `.`/`..`, or more than 16 segments |
| `game.policy-bus-invalid`         | A bus name out of its rule                                                  |
| `game.policy-playback-invalid`    | A rule out of its range (section 6)                                         |
| `game.policy-profile-invalid`     | A profile whose choices do not read as its format's                         |
| `game.policy-tag-invalid`         | A tag empty, over 64 characters or with a control character                 |

A profile valid in shape may still be one a member's audio cannot take; that
is found per member when its export is planned (section 4), with the same
owner details.

**Processing realisation** (`policy/processing-realisation.ts`): a pure
function the game commands call, never the interface.

```ts
/** The racks to set so every member that inherited `before` inherits `after`: the members whose status was 'inherited'. */
export function realignedRacks(
  project: Project,
  before: GameAudioState,
  after: GameAudioState,
): readonly { readonly member: GroupMember; readonly rack: EffectChainId | undefined }[];
```

A member's status in `before` decides it: only members inheriting in
`before` are re-pointed, to their inherited chain in `after` (`none` sets no
rack). Assigning a member asks whether it takes the group's processing
(re-pointed) or keeps its own (left); the command records which.

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
  member: ExportMember,
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

**Region naming.** `memberNames(project, state, members, template, clock)`
answers each region member's new `displayName`; the shell's
`game.name-members` command runs one `project.set-region` per region as one
step.

## 5. Loop definition and loop analysis (WU-10.C)

`ADR-0103`. Contracts `LoopDefinition` (the domain's, unchanged:
`{ loopStart, loopEnd, crossfadeLength }` from the region's start, placed
from `Region.loop: AnchoredLoop`) and `LoopAnalysis`.

**The loop crossfade in the plan.** `packages/domain/src/editing/loop-crossfade.ts`
(new) and `placement.ts`'s `regionPlan`: after the region's rack stream, a
loop with `crossfadeLength` C > 0 adds a stream whose segments are the
region's audio `[0, E−C)`, then `C` frames of a `mix` of the region's
`[E−C, E)` with a fade-out stage and `[S−C, S)` with a fade-in stage, each
of the loop's shape, then `[E, length)`. `AnchoredLoop` and `LoopDefinition`
gain `crossfadeShape: FadeShape` (the domain's four shapes), so the shape
the analysis suggests is the one written and heard; Phase 05's readers,
writers and fixtures that make a loop give it `equal-power`.
`placement-validation.ts` refuses a loop whose `crossfadeLength` exceeds
`loop.start − region.start` (`region.loop-crossfade-without-lead`).
`regionPlan(…, { loopCrossfade: false })` gives the plan the candidate
search reads.

**Request and result.**

```ts
// loop-request.ts
export interface LoopSearch {
  readonly radiusFrames: number; // default 20 ms; at most 2 s
  readonly keepLength: boolean;
  readonly candidates: number; // 1–16, default 5
}
export interface LoopAnalysisRequest {
  readonly loop: { readonly start: number; readonly end: number; readonly crossfadeLength: number }; // region frames
  readonly search?: LoopSearch;
}

// analyse-loop.ts
export const LOOP_ANALYSIS_VERSION = 1;
export type Verdict = 'pass' | 'warn' | 'fail' | 'not-applicable';
export interface LoopMetric {
  readonly value: number; // in `unit`
  readonly unit: 'ratio' | 'dBFS' | 'dB' | 'degrees' | 'frames';
  readonly verdict: Verdict;
  readonly channel: number | undefined; // the worst channel
  readonly reason?: string; // why not applicable
}
export interface CrossfadeSuitability {
  readonly lengthFrames: number;
  readonly correlation: number;
  readonly shape: FadeShape; // 'linear' | 'equal-power'
  readonly levelChangeDb: number;
  readonly verdict: Verdict;
}
export interface LoopMetrics {
  readonly step: LoopMetric;
  readonly click: LoopMetric;
  readonly dcMismatch: LoopMetric;
  readonly netDc: LoopMetric;
  readonly levelMismatch: LoopMetric;
  readonly phaseMismatch: LoopMetric;
  readonly spectralMismatch: LoopMetric;
  readonly zeroCrossing: { readonly start: LoopMetric; readonly end: LoopMetric };
  readonly crossfade: CrossfadeSuitability | undefined; // when crossfadeLength > 0
  readonly cycleStability: LoopMetric;
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
export function analyseLoop(
  source: PcmSource,
  plain: PcmSource,
  request: LoopAnalysisRequest,
  tools: LoopTools,
): Promise<DomainResult<LoopAnalysis>>;
// source: the region with its loop crossfade; plain: without it (candidates). LoopTools: { dsp, signal, yieldToHost, onProgress }.
```

**Metrics.** Notation: x_c[n] the region's processed audio on channel c; S
loop start, E loop end (first frame after the loop), L = E − S; W the window
`clamp(round(0.05·fs), 256, 8192)` then `min(W, floor(L/4))`, refused below
64 (`loop.too-short`); tail T = x[E−W, E), head H = x[S, S+W). Every
logarithm, power, sine and arctangent is the canonical primitive of
`@audiogubbins/audio-engine` (`gainToDecibels`, `log10`, `pow`,
`sineOfTurns`, `cosineOfTurns`, `arctangentTurns`); sums are f64 in index
order. Each metric is computed per channel and the worst channel reported.

| Metric             | Formula                                                                                                                                                            | Unit    | Pass  | Warn      | Fail                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ----- | --------- | ---------------------------- |
| `step`             | \|x[S] − x[E−1]\| ÷ RMS of first differences inside T and H (seam pair excluded)                                                                                   | ratio   | ≤ 2   | ≤ 4       | > 4                          |
| `click`            | \|x[S] − 2x[E−1] + x[E−2]\| ÷ RMS of second differences inside T and H (seam excluded); also at x[S+1] − 2x[S] + x[E−1], the larger                                | ratio   | ≤ 3   | ≤ 6       | > 6                          |
| `dcMismatch`       | gainToDecibels(\|mean(T) − mean(H)\|)                                                                                                                              | dBFS    | ≤ −60 | ≤ −40     | > −40                        |
| `netDc`            | gainToDecibels(\|mean of x over [S, E)\|), one streamed pass                                                                                                       | dBFS    | ≤ −60 | ≤ −40     | > −40                        |
| `levelMismatch`    | \|gainToDecibels(RMS(T) ÷ RMS(H))\|; not applicable where both are below −90 dBFS                                                                                  | dB      | ≤ 1   | ≤ 3       | > 3                          |
| `phaseMismatch`    | At the dominant partial (section below): \|wrap(φ_H − (φ_T + f̂·W ÷ fs))\| in turns × 360; not applicable with no partial 20 dB over the median                     | degrees | ≤ 15  | ≤ 45      | > 45                         |
| `spectralMismatch` | √(mean over bands b of (10·log10(P_T,b ÷ P_H,b))²), third-octave bands from 25 Hz to min(20 kHz, fs/2), bands with both powers below −90 dBFS dropped              | dB      | ≤ 1.5 | ≤ 4       | > 4                          |
| `zeroCrossing`     | Frames from S and from E to the nearest zero-crossing boundary (the snapping definition), searched at most 1 ms                                                    | frames  | ≤ 1   | otherwise | never                        |
| `crossfade`        | ρ = correlation of x[E−C, E) with x[S−C, S); level change at the fade's middle, 10·log10((1+ρ)/2) linear, 10·log10(1+ρ) equal-power; shape: the smaller \|change\| | dB      | ≤ 1.5 | ≤ 3       | > 3, or C > S − region start |
| `cycleStability`   | z = \|e_seam − median(e)\| ÷ (1.4826·MAD(e)), e the 10 ms RMS envelope over [S, E), e_seam over [E−5 ms, E) ∪ [S, S+5 ms); MAD 0 gives 0 if equal, else fail       | ratio   | ≤ 3   | ≤ 6       | > 6                          |

The dominant partial: the canonical STFT (the four-term Blackman–Harris
window, `ADR-0080`) at N, the largest power of two ≤ W, over the frame ending
at E and the frame starting at S; the bin k of the largest summed magnitude
(below the median-relative 20 dB rule it is not applicable), refined by
quadratic interpolation of the log magnitudes to f̂. φ_T is the phase of
Σ_n T[n]·e^(−i·2π·f̂·n/fs), φ_H of the same over H, each by
`arctangentTurns`; wrap maps to (−0.5, 0.5] turns. The loop's verdict is the
worst metric verdict; `zeroCrossing` is never worse than warn, because a
noise loop needs no zero crossing.

**Zero-crossing boundary, once.** The predicate in
`packages/waveform/src/zero-crossings.ts` (every channel asked changes sign
or has an exact zero either side; the outside of the source is silence) moves
to `packages/audio-engine/src/pcm/zero-crossing-boundary.ts`
(`isZeroCrossingBoundary(blocks, frame, channels)`); `nearestZeroCrossing`
keeps its search over it; loop analysis uses the same predicate.

**Candidate search** (`candidate-pairs.ts`, `candidate-search.ts`,
`candidate-cost.ts`), on the region without its loop's crossfade:

1. Windows: starts S′ ∈ [S−R, S+R], ends E′ ∈ [E−R, E+R], clipped to the
   region with W of audio around each; E′ − S′ ≥ 4·64. With `keepLength`,
   E′ = S′ + L.
2. Start anchors: the 64 frames of the start window nearest S whose mix
   (channel sum) changes sign, both directions, ties to the earlier; with
   none, the 64 nearest frames.
3. For each anchor, the normalised cross-correlation of its neighbourhood
   (w = min(256, W) frames before and after, mix) over the end window, by the
   canonical FFT, comparing x[E′−w, E′+w) with x[S′−w, S′+w); context outside
   the region is not used, and a side with none is left out of the
   normalisation; the best 8 ends by correlation, ties to the nearer E then
   the earlier. With `keepLength`, every S′ in the window is scored the same
   way at E′ = S′ + L. At most 512 pairs.
4. Each pair is measured in full (the table) and given the cost
   J = click/3 + levelMismatch/1 + spectralMismatch/1.5 + phase/15 (where
   applicable) + 10^((dcMismatch+60)/20) + 0.25·(|S′−S| + |E′−E|)/R.
5. Order by J (exact f64 comparison), then |S′−S| + |E′−E|, then S′, then
   E′; the first `candidates` are returned with ranks from 1.
6. A candidate whose click, step or phase verdict is not pass is measured
   again with each crossfade of 2, 5, 10, 20 and 50 ms that fits before S′,
   at the shape the correlation chooses; the shortest whose crossfaded seam
   passes is suggested.

Bounds (G4): reads are the two search windows plus W each side, at most
2·(2 s + 2·8,192 frames) of audio, and one streamed pass of 32,768-frame
chunks over [S, E) for `netDc` and `cycleStability`; 512 pairs × O(W).

**Failure.** Every refusal (`loop.too-short`, `loop.outside-region`,
`loop.search-radius-invalid`, a read failure, cancellation) is the result;
nothing is applied, and the region's loop is unchanged because the analysis
never runs a command.

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
export function extendedAuditionPlan(plan: EditPlan, cycles: number): EditPlan; // more cycles, identical prefix
```

A candidate is auditioned from a plan whose loop is the candidate's,
without writing it to the region.

## 6. Game preview simulator (WU-10.D)

`ADR-0104`. Contract `GamePreviewScenario`.

```ts
// policy/playback-rules.ts (the `playback` policy field)
export type SelectionRule =
  { readonly kind: 'uniform' } | { readonly kind: 'avoid-recent'; readonly depth: number }; // 1–16
export type VoiceStealing = 'oldest' | 'quietest' | 'reject';
export type Attenuation =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'inverse' | 'inverse-square' | 'logarithmic';
      readonly unitSize: number; // > 0, metres or pixels per the space
      readonly maxDistance: number; // > unitSize; silent beyond
      readonly ceilingDecibels: number; // −80 to 24
      readonly lowPassAtMaxHertz?: number; // 20 to 20,000
    }
  | {
      readonly kind: 'exponent';
      readonly maxDistance: number;
      readonly exponent: number; // 0.01 to 16
      readonly lowPassAtMaxHertz?: number;
    };
export interface PlaybackRules {
  readonly selection: SelectionRule;
  readonly pitchCents: { readonly min: number; readonly max: number }; // −2400 to 2400, min ≤ max
  readonly gainDecibels: { readonly min: number; readonly max: number }; // −60 to 12
  readonly startOffsetMilliseconds: { readonly max: number }; // 0 to 10,000; capped by the member's length
  readonly voices: { readonly limit: number; readonly stealing: VoiceStealing }; // 1–64
  readonly cooldownMilliseconds: number; // 0 to 60,000
  readonly attenuation: Attenuation;
}
export const DEFAULT_PLAYBACK_RULES: PlaybackRules; // uniform, no randomisation, 8 voices, oldest, no cooldown, attenuation none
```

`DEFAULT_PLAYBACK_RULES` is what the preview uses for a member whose
`playback` resolves `unset`, and the preview says so beside the rules it
shows; it is never written into a group.

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
export interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
} // z is 0 in 2D
export type Motion =
  | { readonly kind: 'still'; readonly at: Position }
  | {
      readonly kind: 'waypoints';
      readonly points: readonly { readonly at: Position; readonly milliseconds: number }[];
      readonly repeat: 'once' | 'loop' | 'back-and-forth';
    };
// 2–64 points, times strictly increasing from 0; linear between them
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
} // facing about the vertical axis
export interface GamePreviewScenario {
  readonly id: GamePreviewScenarioId;
  readonly name: string;
  readonly space: '2d' | '3d';
  readonly panWidth: number; // 2D: the distance at which pan reaches full left or right
  readonly listener: Listener;
  readonly emitters: readonly PreviewEmitter[]; // 1–16
  readonly seed: number; // a whole number below 2³²
  readonly busLevels: readonly { readonly bus: BusName; readonly decibels: number }[];
}
```

**Draws.** `uniformDraw` and `lowbias32` move unchanged from
`packages/import-export/src/dither-noise.ts` to
`packages/domain/src/integrity/counter-draw.ts` as `counterDraw(key, stream,
index)`; the dither imports it, and the byte pins prove its bits unchanged.
The preview's key for emitter e is `lowbias32(seed ^ Math.imul(e + 1,
0x9e3779b9))`; the streams are `SELECTION = 1`, `PITCH = 2`, `GAIN = 3`,
`OFFSET = 4`, `JITTER = 5`; the index is the trigger's ordinal from 0.

**Decisions for trigger k of an emitter**, in this order:

1. Time: `repeat` triggers at round(k·interval + jitter) where jitter is
   `floor(u_JITTER·(2J+1)) − J` frames; `by-hand` at the frame the person's
   press is scheduled for (below).
2. Cooldown: suppressed when within `cooldown` of the last accepted trigger
   (logged `suppressed`), and the selection history is unchanged.
3. Selection: the pool is the subject's members in membership order (a
   member subject is a pool of one), each with its length and loop;
   `uniform` takes
   `floor(u·n)`; `avoid-recent(d)` removes the last `min(d, n−1)` chosen
   members (most recent first) and takes `floor(u·m)` of the rest in pool
   order.
4. Pitch: `round(min + u·(max − min))` cents; gain: `min + u·(max − min)` dB;
   offset: `floor(u·(maxFrames + 1))` frames, capped at the member's length
   − 1.
5. Voices: with fewer than `limit` voices sounding, a new voice; otherwise
   `oldest` steals the earliest started (ties: lowest voice number),
   `quietest` the lowest current gain including attenuation (ties: oldest),
   `reject` logs `rejected`. A stolen voice fades out over 5 ms from the
   trigger's frame.

Every rule an emitter plays by is its subject's, as a game engine's player
holds one set for all it plays: a group subject's effective `playback` and
`bus` (`resolveGroupPolicy`), a member subject's own (`resolvePolicy`).

```ts
// preview/preview-event-log.ts
export type PreviewEvent =
  | {
      readonly kind: 'started';
      readonly frame: number;
      readonly emitter: PreviewEmitterId;
      readonly trigger: number;
      readonly voice: number;
      readonly member: GroupMember;
      readonly pitchCents: number;
      readonly gainDecibels: number;
      readonly offsetFrames: number;
    }
  | {
      readonly kind: 'suppressed' | 'rejected';
      readonly frame: number;
      readonly emitter: PreviewEmitterId;
      readonly trigger: number;
    }
  | {
      readonly kind: 'stolen' | 'stopped' | 'ended';
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
  readonly rulesOf: (subject: PreviewSubject) => PlaybackRules; // from resolution, or the defaults
  readonly poolOf: (subject: PreviewSubject) => readonly PoolMember[]; // members with length, loop, rate
  readonly handTriggers: readonly { readonly emitter: PreviewEmitterId; readonly frame: number }[];
  readonly sampleRate: SampleRate; // the preview's frame rate: the project's
  readonly horizonFrame: number; // at most 30 s past the previous horizon
}
export function simulatePreview(input: PreviewInput, before?: PreviewEventLog): PreviewEventLog;
```

`simulatePreview(input, before)` equals the prefix `before` up to its
horizon and continues from it (property test): a continuation never changes
what was heard.

**Space** (`attenuation.ts`, `panning.ts`, `motion.ts`). d is the distance
from the listener; u = unitSize.

| Model            | Gain in dB at distance d (d ≥ maxDistance: silent)                                          |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `none`           | 0                                                                                           |
| `inverse`        | min(ceiling, gainToDecibels(1 ÷ (d/u + 10⁻⁶)))                                              |
| `inverse-square` | min(ceiling, gainToDecibels(1 ÷ ((d/u)² + 10⁻⁶)))                                           |
| `logarithmic`    | min(ceiling, −20·ln(d/u + 10⁻⁶)), the natural logarithm, as Godot 4's source writes it (Q3) |
| `exponent`       | gainToDecibels(pow(1 − d/maxDistance, exponent))                                            |

The low-pass cutoff where set falls log-linearly from 20 kHz at d ≤ u (or 0)
to `lowPassAtMaxHertz` at `maxDistance`, through the existing `filter`
processor's low-pass. Pan: in 3D, p = sin(azimuth) of the emitter relative
to the listener's facing, by `sineOfTurns(arctangentTurns(x′, y′))`; in 2D,
p = clamp(x′ ÷ panWidth, −1, 1); the `pan` processor's gains are
cos((p+1)/8 turn) and sin((p+1)/8 turn). Elevation is not heard on stereo
output in this phase (Q4). These formulas follow the attenuation models
Godot 4 documents for `AudioStreamPlayer3D` and `AudioStreamPlayer2D`; their
parity is Phase 11's to prove (Q3).

**The `pan` processor** (`packages/processors/src/space/pan.ts`): typeKey
`pan`, category `space`, one parameter `position` (−1 to 1, smoothed),
inputs mono or stereo, output stereo (a stereo input is balanced, each side's
gain as above), zero latency, real-time safe, deterministic, canonical, with
its golden and property tests like every catalogue type.

**The preview plan** (`preview/preview-plan.ts`, `preview-chains.ts`):

```ts
export interface PreviewPlan {
  readonly plan: EditPlan;
  readonly media: readonly AssetId[];
  /** Where each live parameter is, for running changes. */
  readonly controls: {
    readonly emitters: ReadonlyMap<
      PreviewEmitterId,
      {
        readonly stream: number;
        readonly gain: ProcessorId;
        readonly pan: ProcessorId;
        readonly filter?: ProcessorId;
      }
    >;
    readonly buses: ReadonlyMap<BusName, { readonly stream: number; readonly gain: ProcessorId }>;
  };
}
export function previewPlan(
  log: PreviewEventLog,
  members: ReadonlyMap<string, EditPlan>,
  catalogue: ProcessorCatalogue,
  ids: IdGenerator,
  layout: ChannelLayout,
): DomainResult<PreviewPlan>;
export function emitterParameters(
  scenario: GamePreviewScenario,
  rules: PlaybackRules,
  emitter: PreviewEmitterId,
  atMilliseconds: number,
): { readonly gainDecibels: number; readonly pan: number; readonly cutoffHertz?: number };
```

Streams: each member's plan (`regionPlan` or the asset's) once; for a voice
with pitch ≠ 0 a varispeed stream over it at round(fs·2^(cents/1200)) Hz;
one lane per voice slot, segments of silence and of voices, each voice with a
constant gain stage and, when it ends early, a 5 ms fade-out stage; a looping
member's voice is its intro then cycles to the horizon; each emitter a `mix`
of its lanes processed by a chain [gain, pan, filter where set]; each bus a
`mix` of its emitters' streams through a gain; the output a `mix` of buses.
Identifiers come from the `ids` given, so the plan is reproducible from the
same generator seed.

**The varispeed stream** (domain, `ADR-0104`): `StreamProcessing` gains
`{ kind: 'varispeed' }`: the stream has one segment reading one stream of
its layout, whose frames it takes one for one at its own declared rate; a
stream reading it at another rate converts with the canonical resampler, as
any stream source is converted. `plan-validation.ts`, `plan-decoding.ts`,
the plan readers in `packages/audio-engine/src/pcm/` and the project format's
plan writer and reader learn it; an insertion's payload holding one is
refused (`edit.payload-varispeed`).

**The continued programme.** `apps/web/src/audio/programme.ts`'s `Following`
gains `{ kind: 'continued'; from: SampleCount }`, chosen when the next
programme states `continues: { key, from }` naming the loaded one;
`PlaybackSessionPort` gains `continueWith(request, from)`, which the feeder
honours by replacing its source for frames ≥ `from` when `from` is at or
after the frame it reads next, and refuses with
`playback.continuation-too-late` otherwise; `PlaybackControl.continue` and
`readFrame()` (the frame the feeder reads next) are the port the preview and
the loop audition use. A hand trigger is scheduled at `readFrame()` plus one
chunk, so it is heard within the profile's feed-ahead time (50, 200 or
1,000 ms); the panel shows that latency.

**Bounds.** 16 emitters, 64 voices each, 50 triggers a second an emitter, a
30-second horizon per plan, extended when the playhead is within 5 s of it.
The simulation and plan building run on the page: at these bounds a horizon
is at most 24,000 events and a plan a few thousand segments, built in well
under a frame budget (measured, Q5).

## 7. Guided workflows (WU-10.B)

`ADR-0105`.

```ts
// guided-workflow.ts
export type WorkflowTarget = GroupMember;
export interface WorkflowInput<Options, Analyses> {
  readonly state: ProjectState;
  readonly targets: readonly WorkflowTarget[];
  readonly options: Options;
  readonly analyses: Analyses;
  readonly catalogue: ProcessorCatalogue;
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
      readonly target: WorkflowTarget;
      readonly assistants: readonly string[];
      readonly detectors: DetectorValues;
    }
  | {
      readonly kind: 'loop';
      readonly target: WorkflowTarget;
      readonly request: LoopAnalysisRequest;
    }
  | { readonly kind: 'loudness'; readonly target: WorkflowTarget };

// workflow-plan.ts
export type WorkflowItem =
  | {
      readonly kind: 'planned';
      readonly target: WorkflowTarget;
      readonly changes: readonly string[];
    }
  | { readonly kind: 'skipped'; readonly target: WorkflowTarget; readonly reason: string }
  | {
      readonly kind: 'refused';
      readonly target: WorkflowTarget;
      readonly failures: readonly [DomainFailure, ...DomainFailure[]];
    };
export interface WorkflowPlan {
  readonly description: string; // the history step's name
  readonly invocations: readonly CommandInvocation[]; // the planned items', in target order; may be empty
  readonly items: readonly WorkflowItem[];
}
```

The interface dispatches `session.runGroup(plan.description, invocations)`
only when no item is `refused` and `invocations` is not empty; with a
refused item the dialog lists it with its failures and offers "Leave these
out", which plans again over the rest. `executeGroup` is all-or-nothing.

| Workflow             | Analyses                                       | What it plans (existing commands only)                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cut Into Sounds      | Silence assistant over each asset              | `project.add-region` per span the silence leaves (threshold, shortest pause, lead-in and tail as options), `game.assign-member` to the chosen group, `project.set-region` names from the effective naming (section 4)                                                                                                                                                                                                                       |
| Prepare One-Shot     | Silence, and DC offset detector, per target    | Region: `project.set-region` boundaries trimmed to the sound plus lead-in and tail; asset: `trim` edits. Fades: `project.apply-region-edit` / `project.apply-edit` fade-in (default 2 ms linear) and fade-out (20 ms equal-power) at the new edges. DC: a `dc-offset-removal` slot where found. Level: a `loudness-normalisation` slot at the effective target, or `peak-normalisation` to a stated peak where none is set, placed as below |
| Create Seamless Loop | Loop analysis with search                      | Nothing until the person chooses a candidate; then `project.set-region` with the loop `{ basis, start, end, crossfadeLength }` and, where asked, the region's end at the loop's end                                                                                                                                                                                                                                                         |
| Normalise Game SFX   | Loudness measurement after, for conformance    | `game.set-group-policy` `loudness` where asked; a `loudness-normalisation` slot at the end of each group's chain (`project.add-slot` / `project.set-processor`) or of each own-rack member's rack                                                                                                                                                                                                                                           |
| Clean Dialogue       | Restoration and repair assistants, noise floor | A rack extended (as `analysis.apply` does, `extendedRackInvocation`) with the recommended steps, a high-pass `filter` at 80 Hz, a `de-esser`, `deepfilternet-3` where its pack is installed else `noise-reduction` learned from the noise floor, and loudness normalisation at the dialogue target                                                                                                                                          |
| Export for Godot     | none                                           | `game.set-group-policy` for `exportProfile` (looping members WAV integer 16-bit at the project rate, which carries `smpl` loops; one-shots WAV 16-bit or Ogg Vorbis as chosen), `naming` (default `{group:snake}_{number:2}`) and `destination` (default `audio/` then the group path in snake case); then the game export plan                                                                                                             |

Placement: trims, fades and loops are the region's (boundaries, its own
processing, its loop); level and treatment chains are racks, so normalising
runs last (`ADR-0060`'s order). For a member that inherits its group's chain
the dialog asks: "Add to the group's chain (affects N members)" or "Give this
member its own processing"; the default is the member's own, since a
one-shot's preparation should not change its siblings without asking.

Idempotence (`existing-operations.ts`): a fade already at an edge with the
same direction and a length within one frame, a slot of the same type and
values at the chain's end, a loop already at the chosen points, a region
already over a span: each is `skipped` with its reason, never added again.

## 8. Persisted format and state ownership

`ADR-0106`.

| State                                                           | Owner and lifetime                                                              | Where                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Groups, policies, memberships, overrides, scenarios             | Authoritative project state; game commands with inverses                        | `ProjectState.gameAudio` → document member `gameAudio`, tree `project/game-audio.json` |
| A region's loop and its crossfade; racks and chains             | Authoritative project state (Phases 05, 06)                                     | unchanged members                                                                      |
| History entries of game changes                                 | Persisted command journal                                                       | `AffectedEntities.gameGroups` (new), `EntityKind` `game-group`                         |
| Effective policy                                                | Derived, cached per `ProjectState` value                                        | `apps/web/src/state/game-policy-view.ts` (memo, no store of its own)                   |
| Loop analyses, loudness measurements, conformance               | Derived results, the session's, keyed by plan fingerprint + request + version   | `apps/web/src/state/loop-analysis-store.ts`, `loudness-store.ts`                       |
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
`GAME_AUDIO_PATH = 'project/game-audio.json'` (kind `game-audio`); whether
`projectStorage` must rise with a new tree file is checked against how
`EXPORT_SETTINGS_PATH` was added (Q6). `version.json`'s `projectDocument`
rises; the older-version refusal tests in `project-json.test.ts` and
`project-tree.test.ts` gain version 9. The random state generator
(`testing/random-states.ts`) makes random game-audio state, so the 30-seed
tree round trip and the document test cover it.

**History.** `packages/project-format/src/history-record.ts`'s
`AffectedEntities` gains `gameGroups: readonly GameAssetGroupId[]`;
`packages/history/src/state-diff.ts` and `entity-fields.ts` diff groups,
memberships and scenarios (a membership change affects its group and its
region or asset; a scenario change affects `project`); `history-rows.ts`
gains the entity kind `game-group`.

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
| `game.assign-member`         | `member`, `group`, `processing: 'inherit' \| 'keep'`, `overrides?`   | Joins (or moves between groups); `inherit` sets the rack to the inherited chain                             | `game.assign-member` back, or `game.unassign-member`, rack restored |
| `game.unassign-member`       | `member`                                                             | Leaves; its rack stays as it is, now its own                                                                | `game.assign-member` with its overrides and processing              |
| `game.set-member-override`   | `member`, `field`, `value`                                           | Sets an override (not `processing`, not `tags`)                                                             | set or reset to the old                                             |
| `game.reset-member-override` | `member`, `field`                                                    | Removes an override; for `processing` sets the rack to the inherited chain                                  | set the old value, or the old rack                                  |
| `game.add-scenario`          | `scenario`                                                           | Adds                                                                                                        | `game.remove-scenario`                                              |
| `game.set-scenario`          | `scenario`                                                           | Replaces whole                                                                                              | `game.set-scenario` old                                             |
| `game.remove-scenario`       | `scenario` id                                                        | Removes                                                                                                     | `game.add-scenario`                                                 |

Changes to existing commands: `project.remove-region` and
`project.remove-asset` refuse a member (`region.in-group`,
`asset.in-group`); `chain-naming.ts` counts a group's `processing` as naming
its chain, so a chain a group names is never removed and enters or leaves
with the group command; `region-commands.ts`'s split path is untouched (the
shell's split command joins the halves to the group).

Shell commands (`apps/web/src/commands/`), each with a label, category,
availability and reason (`ADR-0013`), in the palette and menus:

| Module                        | Commands                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game-group-commands.ts`      | `game.new-group`, `game.rename-group`, `game.move-group`, `game.delete-group`, `game.set-policy`, `game.unset-policy`, `game.apply-preset-to-group`                             |
| `game-member-commands.ts`     | `game.assign-selection`, `game.remove-from-group`, `game.set-override`, `game.reset-override`, `game.reset-all-overrides`, `game.name-members`                                  |
| `game-export-commands.ts`     | `game.export-group`, `game.export-members` (the game export plan, then a Phase 09 batch)                                                                                        |
| `loudness-commands.ts`        | `game.measure-loudness` (conformance)                                                                                                                                           |
| `loop-analysis-commands.ts`   | `loop.analyse`, `loop.find-candidates`, `loop.apply-candidate`, `loop.apply-crossfade`, `loop.cancel-analysis`                                                                  |
| `loop-audition-commands.ts`   | `loop.audition-cycles`, `loop.audition-seam`, `loop.audition-candidate`, `loop.stop-audition`                                                                                   |
| `game-preview-commands.ts`    | `preview.run`, `preview.stop`, `preview.trigger` (per emitter), `preview.new-seed`, `preview.keep-scenario`, `preview.new-scenario`, `preview.delete-scenario`                  |
| `guided-workflow-commands.ts` | `workflow.cut-into-sounds`, `workflow.prepare-one-shot`, `workflow.create-seamless-loop`, `workflow.normalise-game-sfx`, `workflow.clean-dialogue`, `workflow.export-for-godot` |

The existing region delete and split shell commands compose
`game.unassign-member` and `game.assign-member` in the same step for a
member region.

## 10. Workers and threads

| Work                                       | Thread                         | How                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loop analysis                              | Detection worker               | New request `analyse-loop`: `{ job, description (the region's plan with and without the loop crossfade), request, quality }`; `REFERENCE_DSP`; progress; cancellation; yields between chunks |
| Loudness measurement                       | Detection worker               | New request `measure-loudness`: integrated LUFS, range and true peak of a target, by `CanonicalDsp.createLoudnessMeter` and `createPeakMeter` in 32,768-frame chunks                         |
| Assistants for workflows                   | Detection worker               | The existing `detect` request                                                                                                                                                                |
| Policy resolution, naming, export planning | Page                           | Pure and O(groups + members); memoised per state                                                                                                                                             |
| Preview simulation and plan                | Page                           | Pure, bounded (section 6)                                                                                                                                                                    |
| Preview and loop audition audio            | Feeder worker and worklet      | The existing programme path, continued programmes                                                                                                                                            |
| Export renders, encodes, delivery          | Render, codec, storage workers | Phase 09's, unchanged but for the relative folder                                                                                                                                            |

`packages/detection-runtime/src/detection-messages.ts` gains the two
request and reply kinds; `detection-host.ts` gains `analyseLoop` and
`measureLoudness`; `loop-run.ts` and `loudness-run.ts` are new beside
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

Root `package.json` gains (the packet's command names restated where its form
does not run, conflict C6):

```json
"test:game-audio": "vitest run --project game-audio --project loop-analysis --project guided-workflows",
"test:loop-golden": "vitest run loop-golden",
"test:e2e:game-workflows": "playwright test --project=chromium-game-workflows"
```

`pnpm --filter @audiogubbins/game-audio --filter @audiogubbins/loop-analysis test`
also runs (each package's `test` script, generated). `test:loop-golden`
selects `*.loop-golden.test.ts` by file name across projects, as
`test:spectral-golden` does, so `test:audio-golden` (`vitest run golden`)
runs them too. `playwright.config.ts` gains
`{ name: 'chromium-game-workflows', use: { ...devices['Desktop Chrome'] }, testMatch: /game-workflows\.spec\.ts/ }`.
The existing `test:project-roundtrip`, `test:editing-property`,
`test:dsp-property`, `test:audio-golden`, `test:architecture` and
`test:roundtrip-audio` run unchanged and cover the extended surfaces.

## 13. Test plan by requirement

| Requirement                 | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-GAME-120`              | `policy-resolution.test.ts` (each rule of section 3, by fixture forest); `policy-resolution.properties.test.ts` (random forests: `resolveAll` equals `resolvePolicy`, permuting maps and memberships never changes an answer, an override's reset reveals `shadowed[0]`); `state-validation.test.ts` (every code, each failure naming its owner); `processing-realisation.test.ts`; `game/*-commands.test.ts` (each command and its inverse, rack realignment, chain entering and leaving); the random command walk extended with game commands; `game-audio-json.test.ts` and the tree round trip                                                                  |
| `REQ-GAME-121`              | `*.loop-golden.test.ts` over `testing/loop-fixtures.ts` (below) pinning metrics (`doublesFingerprint`) and the ranked candidates' frames; `seam-metrics.test.ts` per metric against hand-computed values; `candidate-search.test.ts` (tie-breaking, keep-length, radius clipping); `loop-crossfade.test.ts` and `loop-crossfade-property.test.ts` in the domain against its oracle; `loop-run.test.ts` (cancelled and failed runs return no result and change nothing); `audition-plans.test.ts` rendered offline against expected samples                                                                                                                          |
| `REQ-GAME-122`              | `selection.test.ts`, `voice-allocation.test.ts`, `cooldown.test.ts`, `attenuation.test.ts`, `panning.test.ts`, `motion.test.ts`; `preview-simulation.properties.test.ts` (same seed same log; continuation equals the whole; never more than `limit` voices; `avoid-recent(d)` never repeats within d when n > d; suppressed triggers change no later choice); `preview-vectors.test.ts` (the reference vectors Phase 11 consumes); `preview-plan.test.ts` (rendered offline: a voice's samples at its frame, gain and pitch); `pan.golden.test.ts` and properties; continuation tests in `playback-session.test.ts`, `feeder` tests and `playback-control.test.ts` |
| `REQ-GAME-075`              | Each planner's test over `testing/workflow-states.ts` (plans, skips, refusals); `workflow-dispatch.test.ts` in the web app (a refused item dispatches nothing; one undo reverses a run); dialog tests; the browser test                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `REQ-GAME-023`              | Naming: `naming-template.test.ts`, `member-naming.test.ts` (every token and modifier), `template-grammar.test.ts` in import-export with Phase 09's tests unchanged; export: `game-export-plan.test.ts` (resolution equals `resolvePreset`, collisions, per-item refusal with owner), `export-delivery.test.ts` (relative folders, trusted records by path); loudness: `loudness-run.test.ts`; the remaining items as section 1 maps them                                                                                                                                                                                                                            |
| Acceptance: long recordings | The browser test cuts a long signal asset into regions with Cut Into Sounds, names them, gives the group a profile and exports them; `cut-into-sounds.test.ts` asserts no new source or media is made (only regions)                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Loop fixtures (generated by `@audiogubbins/test-fixtures` signals and
`loop-analysis/src/testing/loop-fixtures.ts`, at 48 kHz, mono and stereo):
a 480 Hz sine looped at a whole number of periods (all pass); the same loop
cut a quarter period short (phase ≈ 90°, click fail); a sine with a 0.05
DC step at the seam (DC mismatch fail); a 6 dB level step (level fail); a
seeded noise loop cut at random frames (spectral and click warn, candidates
found within the radius); a two-tone loop; a stereo loop with only the right
channel discontinuous (worst channel 1); a click inserted at E−1; a loop with
2 ms of pre-roll only (a 5 ms crossfade refused, 2 ms suggested). Each golden
pins the analysis result and the candidate list; the suggested points of the
sine fixtures are asserted exactly (whole periods).

The browser test (`tests/e2e/game-workflows.spec.ts`, Chromium): open the
deterministic test asset, Cut Into Sounds into a new group
`Footsteps/Grass`, apply the built-in game WAV preset to `Footsteps` and see
`Grass` inherit it in the Inspector with its source, override it on one
region and reset it; Prepare One-Shot on the group and find the step in
History and the fades and slot in the Inspector, then undo it in one step;
Create Seamless Loop on a looped region: analyse, audition a candidate,
apply it and find the loop in the Inspector; run a preview scenario that
triggers the group 20 times and a loop emitter, check the event log's
counts and that the History panel has no new step; export the group as
downloads and check the names; reload and find the groups.

## 14. Work units, file ownership and order

Every unit is a branch from the phase branch, merged back by the integrator.
No two units edit one file. A unit that needs a line in a shared file lists it
in its brief, and the integrator commits it on the phase branch before the
unit branches (Phase 09 edited shared lists line by line per slice; here one
owner does it, so no two branches touch them). `tests/architecture/public-contracts.txt`
is regenerated by the integrator after each merge (`pnpm contracts:update`).

| Unit     | Work                                                                   | Owns (exclusively)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Needs                                                   |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| WU-10.0  | Integration and shared files                                           | `package.json`; `tools/sync-workspace-graph.mjs` and what it generates (`vitest.projects.json`, `tsconfig.build.json`, `packages/*/package.json`, `packages/*/tsconfig.json`, `packages/*/scopes/**`); `tests/architecture/dependency-rules.test.ts`; `.dependency-cruiser.cjs`; `tests/architecture/public-contracts.txt`; `playwright.config.ts`; `eslint.config.js`; `version.json`, `packages/version/src/index.ts`, `crates/audiogubbins-version/src/generated.rs`; `apps/web/src/application.ts`, `apps/web/src/panel-descriptors.ts`, `apps/web/src/panel-kinds.ts`, `apps/web/src/shell/panels.tsx` and its test, `apps/web/src/commands/shell-commands.ts`, `apps/web/src/commands/shell-context.ts`, `apps/web/src/shell/menus.ts` and its test; `packages/workspace/src/presets.ts` and its test; `packages/*/src/index.ts` of the three new packages (exports added per unit's list); this plan; everything under `docs/spec/` | —                                                       |
| WU-10.A1 | Template grammar, naming templates, destination paths, export profiles | `packages/import-export/src/template-grammar.ts` (new), `file-name-template.ts`, `file-name-safety.ts` and their tests; `packages/game-audio/src/export/naming-template.ts`, `naming-vocabulary.ts`, `case-modifiers.ts`, `member-naming.ts`, `destination-path.ts`, `game-export-profile.ts`, `member-export-settings.ts` and their tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 0                                                       |
| WU-10.A2 | Groups, membership, policy types, validation, resolution, realisation  | `packages/game-audio/src/groups/**`, `src/policy/**` (including `playback-rules.ts`'s types and validation), `src/testing/random-game-state.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | A1                                                      |
| WU-10.A3 | Game export plan and member naming                                     | `packages/game-audio/src/export/game-export-plan.ts`, `member-names.ts` and their tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A2                                                      |
| WU-10.A4 | Persistence and history                                                | `packages/project-format/src/game-audio-json.ts` (new), `project-state.ts`, `project-json.ts`, `project-tree-layout.ts`, `project-tree-reading.ts`, `project-tree-writing.ts`, `history-record.ts`, `testing/random-states.ts`, `testing/random-values.ts`, `testing/project-states.ts` and their tests; `packages/history/src/state-diff.ts`, `entity-fields.ts` (with the loop's `crossfadeShape`), `history-rows.ts` and their tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A2, P                                                   |
| WU-10.A5 | Game project commands                                                  | `packages/project-commands/src/game/**` (new), `project-command.ts`, `project-commands.ts`, `processing/chain-naming.ts`, `editing/region-commands.ts`, `asset-commands.ts`, `testing/**` and their tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | A2, A4                                                  |
| WU-10.A6 | Delivery into a relative folder                                        | `packages/storage/src/export-delivery.ts`, `export-collision.ts`, the trusted-folder record modules; `packages/storage-runtime/src/protocol/` export messages and `src/client/exports-client.ts`, `src/host/` export handler; `packages/browser-storage/src/` folder destination adapter; their tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A1                                                      |
| WU-10.P  | Plan extensions: loop crossfade and varispeed                          | `packages/domain/src/project/timeline.ts` (the loop's shape), `src/editing/plan.ts`, `plan-building.ts`, `placement.ts`, `placement-validation.ts`, `plan-validation.ts`, `plan-decoding.ts`, `processed-streams.ts`, `loop-crossfade.ts` (new), `operation-validation.ts` (payload refusal) and tests; `packages/audio-engine/src/pcm/plan-readers.ts`, `edited-source.ts`, `plan-content.ts` and tests; `packages/project-format/src/plan-writing.ts`, `plan-reading.ts`, `placement-reading.ts`, `placement-writing.ts`, `testing/random-edits.ts` and tests; the loops made in `packages/storage/src/import-placements.ts` and `packages/test-fixtures/src/projects.ts`                                                                                                                                                                                                                                                                | 0                                                       |
| WU-10.C1 | Loop analysis core and the shared zero-crossing boundary               | `packages/loop-analysis/**`; `packages/audio-engine/src/pcm/zero-crossing-boundary.ts` (new) and test; `packages/waveform/src/zero-crossings.ts` and test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 0 (P for audition plans' tests over crossfaded regions) |
| WU-10.C2 | Analysis and measurement in the detection worker                       | `packages/detection-runtime/src/**` (`loop-run.ts`, `loudness-run.ts` new; messages, message reading, core, host, threads)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | C1                                                      |
| WU-10.D1 | Shared counter draw                                                    | `packages/domain/src/integrity/counter-draw.ts` (new) and test; `packages/import-export/src/dither-noise.ts` and its users' imports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 0                                                       |
| WU-10.D2 | `pan` processor                                                        | `packages/processors/src/space/pan.ts` (new) with golden and property tests; `packages/processors/src/catalogue.ts` and `catalogue.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 0                                                       |
| WU-10.D3 | Continued programme                                                    | `packages/audio-runtime/src/playback/**`, `src/feeder/**`, `src/protocol/feeder-messages.ts`, `feed-messages.ts`; `packages/audio-engine/src/transport/**` where a continuation is a transport event; `apps/web/src/audio/programme.ts`, `playback-control.ts`, `playback-parts.ts`, `browser-engine.ts` and tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 0                                                       |
| WU-10.D4 | Preview simulation and plan                                            | `packages/game-audio/src/preview/**`, `src/testing/preview-vectors.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | A2, P, D1, D2                                           |
| WU-10.B  | Guided workflow planners                                               | `packages/guided-workflows/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A3, A5, C1                                              |
| WU-10.E1 | Interface: groups, policy, Inspector section, export, workflows        | `apps/web/src/shell/game/**`, `apps/web/src/shell/workflows/**`, `apps/web/src/shell/inspector/**`, `apps/web/src/commands/game-group-commands.ts`, `game-member-commands.ts`, `game-export-commands.ts`, `loudness-commands.ts`, `guided-workflow-commands.ts`, `export-starting.ts`, `split-commands.ts`, the region delete command's module; `apps/web/src/state/workflow-draft-store.ts`, `loudness-store.ts`, `game-policy-view.ts`; `apps/web/src/analysis/` additions for the new requests; tests                                                                                                                                                                                                                                                                                                                                                                                                                                   | A3, A5, A6, B, C2                                       |
| WU-10.E2 | Interface: loop panel and auditions                                    | `apps/web/src/shell/loop/**`, `apps/web/src/commands/loop-analysis-commands.ts`, `loop-audition-commands.ts`, `region-property-commands.ts` (the loop's shape), `apps/web/src/state/loop-analysis-store.ts`, `apps/web/src/audio/loop-audition.ts`; tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | C2, P, D3                                               |
| WU-10.E3 | Interface: preview panel                                               | `apps/web/src/shell/preview/**`, `apps/web/src/commands/game-preview-commands.ts`, `apps/web/src/state/game-preview-store.ts`, `apps/web/src/audio/preview-programme.ts`; tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | D3, D4, A5                                              |
| WU-10.F  | Browser test                                                           | `tests/e2e/game-workflows.spec.ts` and its fixtures under `tests/e2e/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | E1, E2, E3                                              |
| WU-10.Z  | Evidence, review record, ledger, handoff                               | (integrator, WU-10.0's files under `docs/spec/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | all                                                     |

Order:

1. WU-10.0 lands the three packages' scaffolds (an `index.ts` exporting the
   first unit's names), their graph entries, layering and cruise rules, and
   the scripts; then for each unit, before it branches, the lines it lists.
2. Wave 1, in parallel: A1, P, C1, D1, D2, D3.
3. Wave 2: A2 (after A1); A6 (after A1); C2 (after C1).
4. Wave 3: A3 (after A2); A4 (after A2, P); D4 (after A2, P, D1, D2).
5. Wave 4: A5 (after A2, A4).
6. Wave 5: B (after A3, A5, C1).
7. Wave 6, in parallel: E1 (after A3, A5, A6, B, C2); E2 (after C2, P,
   D3); E3 (after D3, D4, A5). Each gives WU-10.0 its panel, command and
   context lines.
8. WU-10.F, then the packet's commands over the integrated branch, then
   WU-10.Z.

The version raise is WU-10.0's line, committed when A4 branches; A4's
refusal test names the version it takes.

## 15. Conflicts and open questions

Conflicts, each with evidence and the recommended resolution (`REQ-EXEC-168`
asks for a record, not a silent choice). None blocks the phase if the
maintainer accepts the recommendations.

- **C1. `REQ-GAME-023` names features other phases own.** Its list includes
  "Godot-aware export", "Godot project integration" (owned by Phase 11 under
  `REQ-GODOT-024`), "Controlled random variation generation" (Phase 13,
  `REQ-GAME-022`), "Batch conversion" and "Batch export" (Phase 13's
  `BatchJob`), and items Phase 09 delivered (rate, depth and channel
  conversion, export presets). Recommended: a specification change marking
  the parts of `REQ-GAME-023` later phases deliver, as the Phase 05 and 06
  handoffs record for their requirements; this phase's evidence maps each
  item to section 1's line.
- **C2. Export recipes and the packet's "packages/export-recipes game
  layer".** `REQ-GAME-120` lists "Export recipes" as an inherited default;
  `REQ-GODOT-119` (Phase 11) makes export recipes "first-class persistent
  project objects", several per object; the Phase 09 handoff defers them to
  Phase 11. Recommended: Phase 10's `GameExportProfile` is one inherited
  profile; Phase 11 introduces recipe objects and changes the policy field to
  reference them (a document raise, no migration before 1.0); the packet's
  owned module is amended to `packages/game-audio` (export layer) and
  `packages/guided-workflows` added (`ADR-0100`).
- **C3. Variation selection.** `REQ-GAME-122` asks for "variation-set
  selection" and "repetition-avoidance simulation", and `REQ-GAME-120` for
  inherited "runtime variation policies"; variation sets (`REQ-GAME-112`) and
  the selection strategies (`REQ-GAME-113`, including "random with
  configurable recent-history exclusion" and "deterministic seeded
  selection") are Phase 13's. Recommended: Phase 10 delivers groups as pools,
  `uniform` and `avoid-recent(depth)` on the shared generator as the
  selection core; Phase 13 extends the same union and pool kinds and records
  that it builds on them.
- **C4. "The same … runtime-selection logic as the Godot runtime addon"
  (`REQ-GAME-122`).** The addon is Phase 11's, and Phase 11 depends on this
  phase. Recommended: this phase's algorithms and vectors are normative; the
  Phase 11 packet names `packages/game-audio`'s preview vectors as a consumed
  contract its GUT tests reproduce.
- **C5. Event parameters.** `REQ-GAME-122`'s "event parameter manipulation"
  meets `REQ-GODOT-114` and `REQ-GODOT-128` (Phase 11's runtime parameter
  model). Recommended: built-in parameters only in Phase 10 (section 6).
- **C6. The packet's `pnpm test --filter game-audio --filter loop-analysis`.**
  pnpm passes flags after a script name to the script, so the root `test`
  script's Vitest receives `--filter`, which it does not take (to confirm by
  running it once at the phase's end, Q7). Recommended: amend the packet to
  `pnpm test:game-audio` (section 12), as Phase 06's packet uses the
  `pnpm --filter … test` form.
- **C7. Packages beyond the packet's owned modules.** The design changes
  `packages/domain` (loop crossfade, varispeed, counter draw),
  `packages/audio-engine`, `packages/audio-runtime`, `packages/processors`,
  `packages/detection-runtime`, `packages/storage*`, `packages/browser-storage`,
  `packages/project-format`, `packages/history`, `packages/project-commands`,
  `packages/waveform` and `packages/workspace`. Recommended: the packet's
  owned modules and dependency rules are amended to list them, with
  `ADR-0100` as the record.
- **C8. Two phases own `packages/game-audio`.** Phase 13's packet also lists
  it. Recommended: Phase 10 creates it; Phase 13 extends it.
- **C9. "Export for Godot" against `REQ-GODOT-024`.** `REQ-GAME-075` names an
  Export for Godot workflow; `REQ-GODOT-024` (Phase 11) owns "Godot-aware
  naming", "Godot-aware audio presets", "Loop metadata handling" and "Asset
  preparation workflows". Recommended: Phase 10's workflow sets ordinary
  profiles, names and paths only; Phase 11 extends it with import files and
  resources.
- **C10. Destination paths against folder templates.** `REQ-GAME-120`
  (Phase 10) lists "destination paths"; `REQ-GODOT-119` (Phase 11) lists a
  "folder template". Recommended: literal relative paths now, tokens in
  Phase 11.
- **C11. A loop's crossfade becomes audible.** Phase 05's `AnchoredLoop`
  recorded `crossfadeLength` and nothing rendered it; `REQ-GAME-121` asks
  that export preserve loop semantics, and a file holds loop points only.
  Recommended: `ADR-0103`'s realisation in the plan, amending `ADR-0051`,
  with the tighter validation inside this phase's document raise.
- **C12. Review lenses.** The packet requires six lenses; the owner's
  decision of 2026-10-07 defers every lens to the post-specification review.
  Recommended: record the deferral in `phase-10-review.md`, as Phase 09 did.
- **C13. The document version.** Phase 12 may raise `projectDocument`
  first. Recommended: take the next free version at merge.
- **C14. `docs/spec/adr/README.md` has no index.** The ADR list the
  specification compiles is `docs/spec/tools/spec_manifest.json`; the drafts
  are registered there, and the compiled specification, phase contexts and
  checksums regenerated, as Phase 09's readiness commit did.

Open questions, to settle in the unit named:

- **Q1 (E1, Export for Godot).** Godot 4's WAV importer's loop detection
  from `smpl`, and whether its Ogg Vorbis importer reads `LOOPSTART`
  comments or only its import settings, are to be confirmed against the
  Godot 4 documentation before the workflow's text says what Godot will do.
- **Q2 (D3).** Whether the feeder can swap its source at its next read frame
  without disturbing the worklet's queue in every profile; the 1,000 ms
  feed-ahead profile makes a hand trigger late by up to a second, which the
  panel states.
- **Q3 (D4, Phase 11).** The attenuation formulas' parity with Godot 4's
  `AudioStreamPlayer2D` and `AudioStreamPlayer3D`, including its
  `CMP_EPSILON` and its logarithmic model's base.
- **Q4 (D4).** Elevation and surround output: the preview pans to stereo;
  `ambisonic-encode` and `ambisonic-decode` could place a 3D emitter on a
  surround or binaural output, which is a later decision.
- **Q5 (D4).** The measured cost of building a 30-second preview plan at the
  bounds, and of the canonical resampler at varispeed rates, at preview
  quality.
- **Q6 (A4).** Whether a new tree file raises `projectStorage` as well as
  `projectDocument`.
- **Q7 (WU-10.0).** The literal packet command's behaviour (C6).

## 16. Evidence the phase owes

`docs/spec/reviews/phase-10-evidence.md` in Phase 09's sections (objective,
checklist, inherited debt, files, contracts, ADRs, decisions beyond the ADRs,
tests, commands, results, browser results, acceptance criteria, limitations,
dependencies, schema impact, requirement-to-evidence mapping, commits,
findings); `docs/spec/reviews/phase-10-review.md` with the lens deferral;
the ledger's Phase 10 entry with its evidence files, status `PASS` when the
packet's criteria hold; `docs/spec/traceability/handoffs/phase-10.md` after
`PASS`, stating the preview vectors and the game-audio contracts Phase 11
consumes and the extension points Phase 13 takes (the selection union, the
member union, the game export plan's items).
