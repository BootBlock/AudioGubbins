# Repository, Tooling, Testing, and Release Engineering Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-REPO-033` — Source Control and Licensing — owner Phase 01 — scope `CURRENT`
- `REQ-REPO-142` — Open-Source Licence — owner Phase 01 — scope `CURRENT`
- `REQ-REPO-154` — Repository and Package Topology — owner Phase 01 — scope `CURRENT`
- `REQ-REPO-182` — Source-Control Execution Model — owner Phase 00 — scope `CURRENT`
- `REQ-REPO-185` — Repository and Monorepo Structure — owner Phase 01 — scope `CURRENT`
- `REQ-REPO-186` — Package and Workspace Management — owner Phase 01 — scope `CURRENT`
- `REQ-REPO-187` — Product Versioning — owner Phase 01 — scope `CURRENT`
- `REQ-REPO-188` — Tiered Verification and CI Requirements — owner Phase 00 — scope `CURRENT`
- `REQ-REPO-189` — Performance Regression Philosophy — owner Phase 14 — scope `CURRENT`
- `REQ-REPO-190` — Godot Automated Testing with GUT — owner Phase 11 — scope `CURRENT`
- `REQ-REPO-191` — Reference Assets, Fixtures, and Example Projects — owner Phase 01 — scope `CURRENT`
- `REQ-REPO-192` — CI/Repository Setup Handoff Requirement — owner Phase 00 — scope `CURRENT`

---

## REQ-REPO-033 — Source Control and Licensing

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 33 of the pre-hardening baseline

The project will be:

- Open source
- Hosted on GitHub

Dependency selection must therefore consider:

- Licence compatibility
- Redistribution rights
- Codec licensing
- Patent implications where relevant
- Long-term maintainability
- Project health

---

## REQ-REPO-142 — Open-Source Licence

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 142 of the pre-hardening baseline

AudioGubbins shall use the **Apache License 2.0** as the default project licence unless a later explicit project decision changes it.

This choice is intended to preserve permissive commercial and non-commercial reuse while providing an explicit patent licence/grant suitable for a project expected to include DSP, codecs, WebAssembly, and external contributors.

Dependency selection must include explicit licence review.

The project must maintain machine-readable and human-readable third-party attribution/licence information where required.

Dependencies with reciprocal/copyleft obligations must be evaluated deliberately before adoption. No implementation agent may introduce a dependency whose licence materially changes redistribution obligations for AudioGubbins without documenting the implications and passing the relevant architecture/licensing review gate.

Codec patent/licensing status must be considered separately from source-code licence compatibility.

---

## REQ-REPO-154 — Repository and Package Topology

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 154 of the pre-hardening baseline

AudioGubbins should use a single coordinated monorepo while the web application, Rust/WASM DSP, shared schemas, Godot editor addon, and Godot runtime addon are evolving together.

The repository shall use **pnpm workspaces** or an equivalently capable workspace system, with exact dependency versions locked by the repository lockfile.

A representative topology is:

```text
/
├─ apps/
│  └─ web/                    # AudioGubbins PWA
├─ packages/
│  ├─ domain/                 # Framework-agnostic project/domain model
│  ├─ commands/               # Typed command contracts and execution
│  ├─ project-format/         # Schemas, serialisation, validation
│  ├─ storage/                # OPFS/external/project storage adapters
│  ├─ audio-engine/           # TS orchestration for playback/graph engine
│  ├─ renderer/               # Editor renderer contracts/backends
│  ├─ design-system/          # AudioGubbins React UI/design tokens
│  ├─ workspace/              # Docking/workspace integration
│  ├─ codecs/                 # Codec orchestration/contracts
│  ├─ godot-schema/           # Shared generated/runtime integration schemas
│  └─ test-fixtures/          # Reusable deterministic fixtures
├─ crates/
│  ├─ dsp-core/               # Rust DSP primitives
│  ├─ resampling/             # Canonical resampling implementation
│  ├─ analysis/               # FFT/analysis primitives as appropriate
│  └─ wasm-bindings/          # Narrow WASM boundary layer
├─ godot/
│  ├─ addons/audiogubbins/    # @tool editor addon
│  └─ runtime/                # Runtime addon/package sources
├─ tools/                     # Build/codegen/validation tooling
├─ docs/                      # Architecture/ADRs/spec-derived documentation
└─ tests/                     # Cross-package/system/golden fixtures as appropriate
```

The exact topology may evolve through ADR-reviewed changes, but package boundaries must reflect subsystem ownership rather than arbitrary file-count splitting.

Packages must not be introduced merely to make the repository look modular. Each package requires a coherent responsibility, explicit dependency direction, and independently testable contract.

Circular package dependencies are prohibited.

---

## REQ-REPO-182 — Source-Control Execution Model

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 182 of the pre-hardening baseline

The implementation agent has full repository filesystem access and Git access and is responsible for maintaining a reviewable source-control history while executing this specification.

Repository hosting, branch-protection configuration, GitHub Actions administration, and other GitHub-repository setup are intentionally outside the scope of this implementation specification and will be managed separately by the project owner.

#### 182.1 Worktree-First Concurrent Agent Model

When multiple implementation or review agents operate concurrently, they shall use isolated Git worktrees rather than sharing one mutable working directory.

The worktree model must provide:

- One isolated worktree per concurrent implementation/review stream.
- Explicit ownership of the files/subsystems currently being modified.
- No two agents editing the same files concurrently without deliberate coordination.
- Clean commits produced within the owning worktree.
- Review/remediation work performed against a known commit/state.
- Removal of stale worktrees after their work is integrated.

Agents must not use worktrees as an excuse to fragment architecture ownership or duplicate implementation across branches.

#### 182.2 Direct Integration into `main`

The project intentionally uses rapid direct integration rather than pull-request-driven workflow.

Agents shall not raise pull requests unless the project owner explicitly changes this policy.

After a worktree's implementation has:

- completed its phase/sub-phase contract,
- passed required automated verification,
- passed independent multi-lens/adversarial review,
- remediated verified blocking findings,
- and produced a clean evidence package,

its commits may be merged directly into `main`.

`main` must remain the authoritative integration branch.

The absence of pull requests does not weaken review requirements. Review occurs before direct integration and must be evidence-based.

#### 182.3 Commit Discipline

Git workflow must favour meaningful atomic commits.

Commits should:

- Represent one coherent implementation/refactor/test/documentation unit.
- Leave the repository in a buildable/testable state whenever practical.
- Use clear messages describing intent rather than implementation trivia.
- Keep mechanical/generated changes separate from semantic code changes when this materially improves reviewability.
- Avoid mixing unrelated cleanup with feature work.
- Include tests with the behaviour they validate when practical.
- Avoid drive-by formatting/reordering that obscures the semantic diff.

The agent must not use history rewriting, squashing, or rebasing in a way that obscures important implementation/review evidence unless repository policy explicitly permits it.

For each phase, the agent should maintain a traceable mapping between:

- Phase TODOs
- Relevant commits
- Tests
- ADRs
- Reviewer findings
- Finding-verification evidence
- Remediation commits
- Final gate result

No phase should be integrated/declared complete while its mandatory gate is failing.

---

## REQ-REPO-185 — Repository and Monorepo Structure

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 185 of the pre-hardening baseline

AudioGubbins shall use a single monorepo for the product codebase.

The monorepo should contain, as first-class components:

- The Vite/React/TypeScript PWA.
- Shared TypeScript contracts and schemas.
- Audio/domain/command packages.
- Rust/WASM DSP crates.
- Codec and media-processing packages/adapters.
- Rendering infrastructure.
- Storage/persistence infrastructure.
- Godot `@tool` editor addon.
- Godot runtime addon.
- Godot integration test project.
- GUT test suites for Godot-side behaviour.
- Cross-language/generated bindings where required.
- Test fixtures and deterministic reference assets.
- Documentation and architecture decision records.
- Build and developer tooling.

The repository structure must make dependency direction visible. It must not collapse unrelated concerns into one `src/` hierarchy merely for convenience.

Package boundaries should map to cohesive architectural responsibilities rather than framework conventions alone.

---

## REQ-REPO-186 — Package and Workspace Management

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 186 of the pre-hardening baseline

The TypeScript/JavaScript workspace shall use **pnpm workspaces**.

Rust components shall use Cargo workspaces/crates as appropriate.

The build architecture should support coordinated tasks across both ecosystems without hiding their native toolchains behind opaque wrapper scripts.

Requirements include:

- Strict declaration of package dependencies.
- No accidental reliance on undeclared transitive dependencies.
- Workspace-local package imports through documented public entry points.
- Lockfiles committed to source control.
- Reproducible dependency installation.
- CI validation that lockfiles and generated dependency metadata are current.
- Clear separation between application dependencies, development tooling, and test-only dependencies.

---

## REQ-REPO-187 — Product Versioning

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 187 of the pre-hardening baseline

AudioGubbins shall expose one primary product release version shared across the web application and first-party Godot integration packages.

A release should therefore be understandable to users as, for example:

`AudioGubbins 0.x.y`

rather than requiring users to reason about unrelated public versions for the PWA, editor addon, and runtime addon.

Independent internal compatibility/version identifiers are still required where technically necessary, including:

- Project schema version.
- Persistence schema version.
- Processor implementation version.
- DSP graph contract version.
- Godot generated-resource schema version.
- Runtime event schema/API version.
- Model-pack version.
- Cache-format version.

Internal compatibility identifiers must not be conflated with the product marketing/release version.

Pre-1.0 schema-breaking policy and post-1.0 migration policy remain as defined elsewhere in this specification.

---

## REQ-REPO-188 — Tiered Verification and CI Requirements

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 188 of the pre-hardening baseline

AudioGubbins shall define verification tiers suitable for later implementation in the project's CI environment.

Repository-hosting/CI-provider administration is outside this document's scope, but the codebase must contain the scripts/configuration/contracts required to execute these tiers.

#### 188.1 Fast Commit Tier

Expected on normal implementation checkpoints:

- Formatting validation.
- Static analysis/linting.
- Type checking.
- Architecture/dependency-rule validation.
- Fast unit tests.
- Rust checks/tests appropriate to changed crates.
- Schema/contract validation.
- Generated-file freshness checks.

#### 188.2 Integration Tier

Expected before direct integration into `main` when relevant:

- Browser integration tests.
- Persistence/storage integration tests.
- PWA/service-worker tests.
- Worker/AudioWorklet integration tests.
- DSP reference tests.
- Import/export tests.
- Godot GUT tests.
- Headless Godot runtime/integration tests.
- Accessibility checks.
- Visual/UI regression checks where applicable.

#### 188.3 Phase-Gate / Heavyweight Tier

Expected at phase gates and major release checkpoints as applicable:

- Full supported-browser matrix.
- Desktop/touch/tablet interaction coverage.
- Offline/PWA lifecycle coverage.
- Storage corruption/interruption/recovery scenarios.
- Large-file/resource-pressure tests.
- Deterministic render/golden tests.
- Cross-browser render verification.
- Performance/benchmark suites.
- Memory/regression profiling.
- Godot editor-addon/runtime integration scenarios.
- End-to-end export-to-Godot scenarios.
- Accessibility/manual-interaction evidence required by the phase.

A required verification failure blocks the corresponding integration/gate unless the specification explicitly permits that failure mode.

---

## REQ-REPO-189 — Performance Regression Philosophy

- **Owner:** Phase 14 — Performance, Compatibility, and Accessibility Hardening
- **Scope:** `CURRENT`
- **Legacy source:** section 189 of the pre-hardening baseline

Performance is a first-class quality attribute, but AudioGubbins must not remove valuable capability merely to satisfy arbitrary timing targets.

Performance tests exist to:

- Detect regressions.
- Expose poor algorithms or accidental complexity.
- Identify memory growth.
- Catch UI-thread blocking.
- Catch audio-thread instability.
- Track render/import/export throughput.
- Track startup and interaction responsiveness.
- Provide engineering evidence for optimisation work.

Performance tests must **not** become simplistic feature-kill switches.

Rules:

- No feature may be dropped solely because it is inherently computationally expensive.
- No quality mode may be reduced solely to meet an arbitrary benchmark number.
- Highest-quality final rendering may legitimately take longer than preview/draft rendering.
- A slower but correct high-quality operation is acceptable when its computational cost is inherent and clearly surfaced to the user.
- Performance regressions caused by poor implementation must still be investigated and corrected.
- Performance thresholds should distinguish interactive-latency requirements from offline-throughput observations.
- Statistical/tolerance-based comparison should be used where CI hardware variability makes exact thresholds unreliable.
- Where an operation is expensive, prefer better scheduling, chunking, workers, GPU/WASM acceleration, progressive results, caching, and user-selectable quality/performance profiles over scope reduction.

Interactive audio stability and UI responsiveness may have hard correctness-style limits where missing them causes drop-outs, data loss, unusable interaction, or other functional failure. These are not arbitrary performance gates; they are behavioural requirements.

---

## REQ-REPO-190 — Godot Automated Testing with GUT

- **Owner:** Phase 11 — Godot Integration
- **Scope:** `CURRENT`
- **Legacy source:** section 190 of the pre-hardening baseline

Godot-side unit/integration tests should use **GUT (Godot Unit Test)** as the preferred GDScript-first testing framework where compatible with the targeted Godot 4.x version.

GUT 9.x supports Godot 4.x and includes CLI execution, making it suitable for headless automated verification. The exact pinned GUT version must match the minimum/current Godot versions supported by AudioGubbins and must be reviewed when Godot support changes.

The repository shall include a dedicated Godot integration/test project containing representative AudioGubbins-generated content and runtime/editor-addon scenarios.

Godot test coverage should include, as applicable:

- Resource serialisation/deserialisation.
- Generated `.tres` resources.
- Event definitions.
- Variation selection.
- Shuffle-bag/repetition-avoidance behaviour.
- Deterministic random seeds.
- Runtime parameters and conditions.
- Layered events.
- Cooldowns.
- Concurrency limits.
- Voice-stealing policies.
- Bus-routing configuration.
- 2D/3D playback helpers.
- Failure behaviour for missing/invalid assets.
- Schema/version compatibility contracts.
- Editor-addon generated-data contracts where testable headlessly.

Headless Godot verification should complement GUT where behaviours require launching Godot rather than isolated GDScript assertions.

---

## REQ-REPO-191 — Reference Assets, Fixtures, and Example Projects

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 191 of the pre-hardening baseline

The public repository shall contain a deliberately small, legally clean set of reference assets and examples sufficient for contributors, agents, and automated tests to exercise AudioGubbins without external setup.

This should include, as appropriate:

- Synthetic deterministic test signals.
- Small openly licensed audio clips.
- Mono and stereo examples.
- Representative multichannel examples.
- Loopable examples.
- Deliberately damaged/noisy reference samples for restoration tests.
- Known transient/click/DC-offset test signals.
- Small reference video clips for sound-to-picture tests where licensing permits.
- Example AudioGubbins projects.
- Example Godot integration project.
- Example event/variation resources.

Rules:

- Licensing/provenance must be documented for non-generated fixtures.
- Test fixtures must remain stable once they are used for golden/reference tests unless a deliberate reviewed change is required.
- Large corpora and heavyweight ML/audio datasets must not bloat normal Git history; they should be generated or fetched on demand with integrity/version metadata.
- Deterministic synthetic signals are preferred wherever they adequately test the required behaviour.

---

## REQ-REPO-192 — CI/Repository Setup Handoff Requirement

- **Owner:** Phase 00 — Requirements and Architectural Baseline
- **Scope:** `CURRENT`
- **Legacy source:** section 192 of the pre-hardening baseline

Although GitHub repository setup is intentionally managed separately, AudioGubbins implementation work must leave behind an explicit machine-readable and human-readable description of required verification commands and CI tiers so that repository automation can be configured without reverse-engineering the codebase.

The implementation shall therefore provide, at minimum:

- Canonical root-level commands for each verification tier.
- Documented environment/toolchain prerequisites.
- Deterministic test entry points.
- Headless Godot/GUT invocation commands.
- Browser-matrix test entry points.
- Benchmark entry points.
- Required artefact/report outputs.
- Clear failure exit codes.
- No interactive prompts in CI-targeted commands.

CI scripts/configuration must call the same underlying commands developers/agents can run locally rather than maintaining a separate hidden validation path.

---
