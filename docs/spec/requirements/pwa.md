# PWA, Browser, Platform, and Deployment Requirements

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

## Requirement Index

- `REQ-PWA-028` — Platform Support — owner Phase 12 — scope `CURRENT`
- `REQ-PWA-030` — PWA Requirements — owner Phase 12 — scope `CURRENT`
- `REQ-PWA-031` — Local Development — owner Phase 01 — scope `CURRENT`
- `REQ-PWA-032` — Deployment — owner Phase 12 — scope `CURRENT`
- `REQ-PWA-051` — Mobile Orientation Policy — owner Phase 12 — scope `CURRENT`
- `REQ-PWA-076` — Runtime Capability Tiers — owner Phase 12 — scope `CURRENT`
- `REQ-PWA-077` — Capability Degradation Transparency — owner Phase 12 — scope `CURRENT`
- `REQ-PWA-078` — Graceful Performance Degradation — owner Phase 12 — scope `CURRENT`
- `REQ-PWA-159` — Future Native Host or Local Bridge — owner Phase 12 — scope `DEFERRED`

---

## REQ-PWA-028 — Platform Support

- **Owner:** Phase 12 — PWA, Offline, and Installation Hardening
- **Scope:** `CURRENT`
- **Legacy source:** section 28 of the pre-hardening baseline

First-class desktop operating systems:

- Windows
- macOS
- Linux

Browser targets:

- Chrome
- Edge
- Firefox
- Safari

The application should use progressive enhancement.

Core editing functionality should remain portable across modern browsers.

Enhanced browser APIs should be capability-gated rather than assumed.

---

## REQ-PWA-030 — PWA Requirements

- **Owner:** Phase 12 — PWA, Offline, and Installation Hardening
- **Scope:** `CURRENT`
- **Legacy source:** section 30 of the pre-hardening baseline

The application must be usable:

- Directly in a browser
- As an installed PWA
- Offline where supported after required assets are available

PWA functionality should include:

- Installability
- Service-worker-based application shell caching
- Offline startup
- Versioned application updates
- Safe update prompts
- Recovery from stale caches
- Persistent-storage requests where appropriate
- Storage health/status display
- Capability detection

The specification must not assume that installing the PWA automatically guarantees increased storage quotas on every browser/platform.

---

## REQ-PWA-031 — Local Development

- **Owner:** Phase 01 — Application Foundation
- **Scope:** `CURRENT`
- **Legacy source:** section 31 of the pre-hardening baseline

Vite is mandatory for local development and testing.

The project must support:

- Local development server
- Hot reload
- Production builds
- Static deployment
- PWA development/testing
- GitHub Pages deployment

---

## REQ-PWA-032 — Deployment

- **Owner:** Phase 12 — PWA, Offline, and Installation Hardening
- **Scope:** `CURRENT`
- **Legacy source:** section 32 of the pre-hardening baseline

The application must be deployable as a static site to GitHub Pages.

Deployment must support:

- Direct browser use
- PWA installation where supported
- Correct routing/base-path configuration
- Asset versioning
- Cache-busting
- Update-safe service-worker behaviour

No mandatory backend should be required for core functionality.

---

## REQ-PWA-051 — Mobile Orientation Policy

- **Owner:** Phase 12 — PWA, Offline, and Installation Hardening
- **Scope:** `CURRENT`
- **Legacy source:** section 51 of the pre-hardening baseline

Phones should strongly prefer landscape orientation for workstation-heavy editing workflows.

The application should remain robust in portrait where practical, but detailed waveform, spectral, multichannel, and other dense editing modes may recommend or require landscape on very small screens.

Tablets, Surface-class devices, and larger touch devices should retain fully adaptive layouts.

---

## REQ-PWA-076 — Runtime Capability Tiers

- **Owner:** Phase 12 — PWA, Offline, and Installation Hardening
- **Scope:** `CURRENT`
- **Legacy source:** section 76 of the pre-hardening baseline

AudioGubbins shall use a single codebase with capability-based runtime enhancement.

#### Standard Web Runtime

The Standard Web Runtime must remain fully functional on static hosting environments such as GitHub Pages and must not require cross-origin isolation.

It must support all core editing workflows, even when high-performance shared-memory or threaded WebAssembly features are unavailable.

#### Enhanced Web Runtime

Where hosting and browser capabilities permit additional security headers and APIs, AudioGubbins may enable enhanced execution features such as:

- Shared-memory WebAssembly
- Threaded WebAssembly
- SharedArrayBuffer-based pipelines
- Higher parallel processing throughput
- Other capability-gated optimisations

Enhanced runtime capabilities should primarily improve performance, scalability, responsiveness, or throughput rather than create incompatible project formats or separate feature sets.

---

## REQ-PWA-077 — Capability Degradation Transparency

- **Owner:** Phase 12 — PWA, Offline, and Installation Hardening
- **Scope:** `CURRENT`
- **Legacy source:** section 77 of the pre-hardening baseline

Where a browser, device, hosting environment, or permission state causes a capability to be reduced, AudioGubbins must communicate that clearly.

The application shall provide an accessible capability/status surface that can explain:

- Which capabilities are fully available
- Which are degraded
- Which are unavailable
- Why the limitation exists
- Whether the limitation is browser-, device-, permission-, hosting-, or configuration-related
- What practical effect the limitation has
- Whether the user can improve the situation through configuration, installation, alternate hosting, or another supported browser/device

Capability degradation must not be hidden or presented as unexplained poor performance.

---

## REQ-PWA-078 — Graceful Performance Degradation

- **Owner:** Phase 12 — PWA, Offline, and Installation Hardening
- **Scope:** `CURRENT`
- **Legacy source:** section 78 of the pre-hardening baseline

When an optimisation is unavailable, AudioGubbins should preserve functionality wherever technically practical.

Examples include falling back from:

- Threaded WASM to single-threaded WASM
- Shared-memory processing to message-passing workers
- WebGPU to WebGL2 or CPU processing
- Real-time processing to cached preview rendering
- Cached preview rendering to offline processing

Capability differences should normally affect performance rather than feature availability.

---

## REQ-PWA-159 — Future Native Host or Local Bridge

- **Owner:** Phase 12 — PWA, Offline, and Installation Hardening
- **Scope:** `DEFERRED`
- **Legacy source:** section 159 of the pre-hardening baseline

> **Execution rule:** Do not implement the deferred user-facing capability in the current roadmap phase. Preserve the architectural extension point only to the extent explicitly required below.

AudioGubbins remains a browser-first, installable PWA and must not require a native executable, daemon, local server, or companion process for its core functionality.

A future optional native host or local bridge may be considered if it unlocks material capabilities that browsers cannot expose reliably, such as:

- Deeper filesystem integration
- Lower-latency or more controllable audio I/O
- System/loopback audio capture
- Native codec or DSP acceleration
- OS-level file associations
- Native drag/drop or shell integration
- Richer communication with running game/editor processes
- Expanded local-device discovery

A future native host should preferentially reuse the same AudioGubbins web UI, domain contracts, project formats, DSP contracts, and test fixtures rather than creating a divergent second application. Technologies such as Tauri may be evaluated at that time, but no native-host framework is selected by this specification.

Native enhancements must remain optional unless a future requirement explicitly changes the browser-first product model.

---
