# Phase 12 — PWA, Offline, and Installation Hardening

## Status

`NOT_READY` — blocked by Phase(s) 01, 02, 09 reaching `PASS`.

## Objective

Harden AudioGubbins as a browser-hosted and installable offline PWA across supported browsers, with GitHub Pages-compatible standard runtime, enhanced capability tiers, safe updates, persistent-storage UX, and transparent degradation.

## User-Visible Outcome

The complete editor can launch/use existing projects offline, install as a PWA where supported, update safely, explain unavailable/degraded capabilities, and run from GitHub Pages without a mandatory backend.

## Hard Dependencies

- Phase 01 — Application Foundation
- Phase 02 — Project and Storage System
- Phase 09 — Import, Export, and Codec System

## Owned Requirements

- `REQ-PWA-028` — Platform Support (`CURRENT`)
- `REQ-PWA-030` — PWA Requirements (`CURRENT`)
- `REQ-PWA-032` — Deployment (`CURRENT`)
- `REQ-PWA-051` — Mobile Orientation Policy (`CURRENT`)
- `REQ-PWA-076` — Runtime Capability Tiers (`CURRENT`)
- `REQ-PWA-077` — Capability Degradation Transparency (`CURRENT`)
- `REQ-PWA-078` — Graceful Performance Degradation (`CURRENT`)

### Deferred / Exclusion Constraints Owned by This Phase

- `REQ-PWA-159` — Future Native Host or Local Bridge (`DEFERRED`)

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

- [ ] PWA manifest/installability
- [ ] Service worker/app-shell caching
- [ ] Offline startup
- [ ] Versioned update flow and stale-cache recovery
- [ ] GitHub Pages base-path/static deployment
- [ ] Storage persistence/quota status
- [ ] Standard vs Enhanced runtime capability tiers
- [ ] Degraded-feature explanations
- [ ] Cross-browser feature fallbacks
- [ ] Future optional native-host boundary only

## Explicitly Out of Scope

- Mandatory backend
- Mandatory native daemon/host
- Cloud sync
- Changing GitHub repository administration

## Owned Modules / Packages

- `apps/web PWA layer`
- `packages/capabilities`
- `packages/pwa-runtime`
- `deployment/static config`

## Cross-Package Dependency Rules

- PWA runtime wraps capabilities and deployment concerns; it does not become a domain-state owner.
- Service worker never directly mutates project/media storage.

## Required Public Contracts

- RuntimeTier
- CapabilityReport
- DegradedFeature
- UpdateState
- StorageHealth
- OfflineAssetPolicy

## Data / Schema Changes

- Introduces service-worker/cache version metadata, PWA update-state records, storage-health/capability-report representations. These are not project schemas.

## Browser / Platform Considerations

- GitHub Pages Standard runtime is mandatory.
- Cross-origin-isolated Enhanced runtime is optional.
- Installability, quota and persistence APIs vary by browser/platform.

## Architectural Invariants

- GitHub Pages/standard runtime cannot require cross-origin isolation.
- Enhanced runtime may use shared memory/threaded WASM only when headers/capabilities permit.
- Degradation normally affects performance or integration convenience, not core editing functionality.
- Install status is not treated as a universal storage-quota guarantee.

## Internal Work Units

### WU-12.A — Install/offline shell

- [ ] Implement manifest/icons/service worker and offline application shell
- [ ] Cache only safe/versioned assets and recover from stale/corrupt caches

### WU-12.B — Updates

- [ ] Implement explicit update state machine with safe save/reload behaviour
- [ ] Prevent service-worker update from invalidating active project transactions

### WU-12.C — Capability tiers

- [ ] Implement Standard/Enhanced runtime detection
- [ ] Expose feature degradation reasons and recommended hosting/browser improvements

### WU-12.D — Storage/deployment

- [ ] Implement persistence request/quota/status UX
- [ ] Validate GitHub Pages production build/base paths and installability

## Failure and Recovery Behaviour

- Offline startup with a valid cached app must not require network.
- Failed update/cache migration must roll back/recover rather than brick the PWA.
- Storage persistence denial must be explained and project export/backup options remain available.

## Required Verification Commands / Suites

- `pnpm build`
- `pnpm test:pwa`
- `pnpm test:offline`
- `pnpm test:update-flow`
- `pnpm test:github-pages-build`
- `pnpm test:browser-matrix:pwa`

## Acceptance Criteria

- [ ] Installed and ordinary browser modes open cached app/projects offline where platform allows.
- [ ] Standard GitHub Pages build never references a required COOP/COEP-only path.
- [ ] Enhanced runtime activates only after actual capability checks.
- [ ] Update tests preserve unsaved/transactional project safety.
- [ ] Capability/status UI names degraded features and their effect.

## Forbidden Shortcuts

- No stubs, placeholder behaviour, fake success paths, or silent scope deferral.
- No weakening or deleting tests/golden evidence to make the phase pass.
- No god object, catch-all manager/service, giant global store, or hidden mutable singleton.
- No UI bypass of typed command/domain ownership.
- No undocumented dependency or public-contract change.
- No assumption that PWA install grants extra quota.
- No network-required bootstrap after valid offline install.
- No hidden feature removal due to missing WebGPU/shared memory.
- No service worker caching user project/media content indiscriminately.

## Required Review Lenses

- PWA / Browser Compatibility
- Data Integrity / Recovery
- Security / Privacy
- UX / Accessibility
- Testing / Regression
- Performance
- Adversarial Agent-Quality

## Evidence Package

- Atomic commit list and final integration commit.
- Requirement-to-test/evidence mapping for every owned `CURRENT`/`PLANNED` requirement.
- Test, static-analysis, architecture, golden, benchmark, browser, or GUT reports applicable to this phase.
- ADRs created/changed and evidence that public contracts match them.
- Verified review findings, remediation commits, and re-review disposition.
- Screenshots/video/interaction evidence only where automated evidence cannot sufficiently demonstrate the UX behaviour.

## Handoff Capsule

Create `traceability/handoffs/phase-12.md` from `contracts/handoff-capsule-template.md` only after this phase reaches `PASS`.
