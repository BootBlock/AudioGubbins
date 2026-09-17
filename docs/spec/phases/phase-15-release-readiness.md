# Phase 15 — Release Readiness

## Status

`NOT_READY` — blocked by Phase(s) 14 reaching `PASS`.

## Objective

Establish a release-quality checkpoint for the continuously developed product: complete documentation/evidence, real-project validation, deterministic versioning/artifacts, resolved release-blocking findings, and an explicit project-owner decision on maturity/version label.

## User-Visible Outcome

AudioGubbins can be tagged/released from a known verified state, but the specification does not force the label `1.0.0`; alpha/beta/RC/stable naming remains the project owner's judgement.

## Hard Dependencies

- Phase 14 — Performance, Compatibility, and Accessibility Hardening

## Owned Requirements

- `REQ-PROD-001` — Purpose (`CURRENT`)
- `REQ-PROD-003` — Product Positioning (`CURRENT`)
- `REQ-PROD-007` — Primary Workflow Example (`CURRENT`)
- `REQ-PROD-147` — Release-Version Philosophy (`CURRENT`)
- `REQ-PROD-148` — Continuous Feature-Delivery Policy (`CURRENT`)
- `REQ-PROD-149` — Release Channel and Maturity Labels (`CURRENT`)
- `REQ-PROD-150` — Real-World Validation Before Stable Releases (`CURRENT`)

## Referenced Global Execution Requirements

- `REQ-EXEC-136`
- `REQ-EXEC-167`
- `REQ-EXEC-170`
- `REQ-EXEC-171`
- `REQ-EXEC-172`
- `REQ-EXEC-173`
- `REQ-EXEC-174`
- `REQ-EXEC-180`
- `REQ-EXEC-181`
- `REQ-EXEC-183`
- `REQ-EXEC-184`
- `REQ-EXEC-204`
- `REQ-EXEC-215`
- `REQ-EXEC-216`

## In Scope

- [ ] Release evidence aggregation
- [ ] Single AudioGubbins product version across components
- [ ] Real-world project validation
- [ ] Docs/help/licence/third-party notices
- [ ] Reproducible release build
- [ ] Schema/processor/project version records
- [ ] Known-issues/degraded-capability documentation
- [ ] Release-channel/maturity labelling
- [ ] CI/repository setup handoff requirements

## Explicitly Out of Scope

- Declaring 1.0 automatically
- Stopping feature development because a release checkpoint is reached
- Repository administration not required by product code

## Owned Modules / Packages

- `release metadata/tooling`
- `documentation`
- `generated notices`
- `tests/release`
- `all artefacts as verification inputs`

## Cross-Package Dependency Rules

- Release tooling consumes build/test metadata; production packages do not depend on release tooling.
- One product release version coordinates artefacts while internal schema/API versions remain explicit.

## Required Public Contracts

- ProductVersion
- ReleaseManifest
- Compatibility/known-issues report
- ThirdPartyNotice manifest

## Data / Schema Changes

- Introduces/locks release manifest, product-version metadata, compatibility/known-issues report and third-party notice manifest.
- Does not automatically trigger 1.0 migration semantics unless the project owner selects version 1.0.0.

## Browser / Platform Considerations

- Release evidence covers browser/PWA deployment, Godot addons and supported device/browser matrices.
- No release requires a native host/backend.

## Architectural Invariants

- Version labels do not define feature completeness.
- Pre-1.0 schema reset policy remains in force until the owner actually selects 1.0.0; post-1.0 migration obligations begin thereafter.
- No release hides known blocking data-integrity/security/correctness defects.

## Internal Work Units

### WU-15.A — Release manifest/versioning

- [ ] Produce one product version across web/Godot/DSP artefacts
- [ ] Record schema/processor/interchange versions and dependency notices

### WU-15.B — Real-world validation

- [ ] Exercise actual game-audio/recording/Godot workflows on representative projects/devices
- [ ] Exercise update/recovery/storage-pressure/browser-upgrade scenarios

### WU-15.C — Documentation/evidence

- [ ] Complete user/developer/help/diagnostics documentation
- [ ] Document capability degradation and known limitations

### WU-15.D — Release review

- [ ] Run complete required verification tiers
- [ ] Perform final adversarial review
- [ ] Obtain explicit project-owner maturity/version decision

## Failure and Recovery Behaviour

- Release build/version mismatch across components blocks release.
- Missing licence/notice obligations block distribution.
- Unreproduced data-loss or schema failure blocks release.

## Required Verification Commands / Suites

- `pnpm verify:release`
- `pnpm build`
- `cargo test --workspace`
- `pnpm test:full`
- GUT suite
- `python docs/spec/tools/spec_lint.py` or repository-equivalent

## Acceptance Criteria

- [ ] Complete verification suite is green or only explicitly accepted non-blocking debt remains.
- [ ] Representative real Godot projects complete import/edit/process/export/live-update/runtime-event workflows.
- [ ] Release artefacts identify one coherent AudioGubbins version and compatible schema/processor versions.
- [ ] Licence/third-party notices are complete.
- [ ] Project owner explicitly chooses the release maturity label; no automatic 1.0 promotion occurs.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No hard-coded rule that Phase 15 means 1.0.0.
- No hiding failures by downgrading tests or omitting unsupported/degraded capability documentation.

## Required Review Lenses

- Release / Integration
- Architecture
- Security / Privacy
- Data Integrity / Recovery
- Audio / DSP Correctness
- Godot Integration
- UX / Accessibility
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-15.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
