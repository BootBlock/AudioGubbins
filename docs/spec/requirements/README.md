# Canonical Requirements Index

> **Authority:** Canonical normative requirements. The generated full specification is derived from these files and MUST NOT be edited directly.
>
> **Modality rule:** Within `CURRENT` and `PLANNED` requirement blocks, `must`/`shall` are mandatory. Legacy wording using `should` is interpreted as a mandatory design target unless the block explicitly states `DEFERRED`, `EXCLUDED`, `optional`, `where practical`, or invokes the formal deviation protocol. An implementation agent MUST NOT downgrade a requirement merely because the source prose used `should`.
>
> **Requirement groups:** Each `REQ-*` identifier owns the complete requirement block beneath it. Every bullet and invariant in the block is part of that requirement group unless explicitly marked otherwise.

Canonical requirement groups: **216**.

## Modules

- [Product and Scope Requirements](./product.md) — prefix `PROD` — 14 requirement groups
- [Architecture and Runtime Requirements](./architecture.md) — prefix `ARCH` — 20 requirement groups
- [Editing and Timeline Requirements](./editing.md) — prefix `EDIT` — 12 requirement groups
- [Audio Formats, DSP, ML, and Media Requirements](./audio.md) — prefix `AUDIO` — 17 requirement groups
- [Recording and Audio I/O Requirements](./recording.md) — prefix `REC` — 10 requirement groups
- [Project, Storage, History, and Recovery Requirements](./storage.md) — prefix `STOR` — 25 requirement groups
- [Game-Audio Authoring Requirements](./game.md) — prefix `GAME` — 9 requirement groups
- [Godot Editor and Runtime Integration Requirements](./godot.md) — prefix `GODOT` — 28 requirement groups
- [PWA, Browser, Platform, and Deployment Requirements](./pwa.md) — prefix `PWA` — 9 requirement groups
- [UX, Workspace, Touch, Theme, and Accessibility Requirements](./ux.md) — prefix `UX` — 13 requirement groups
- [Privacy, Diagnostics, and Provenance Requirements](./privacy.md) — prefix `PRIV` — 5 requirement groups
- [Repository, Tooling, Testing, and Release Engineering Requirements](./repository.md) — prefix `REPO` — 12 requirement groups
- [Agent and Specification Execution Requirements](./execution.md) — prefix `EXEC` — 42 requirement groups

## Scope Meanings

- `CURRENT`: required by the owning implementation phase.
- `PLANNED`: required by the owning later roadmap phase; earlier phases must preserve stated prerequisites.
- `DEFERRED`: user-facing implementation is intentionally deferred; only explicit architectural constraints apply now.
- `EXCLUDED`: capability must not be implemented without an approved specification change.

## Superseded Legacy Sections

- Legacy section 35 (generic front-end selection) is superseded by `REQ-ARCH-151`.
- Legacy section 42 (provisional phase list) is superseded by the hardened Phase Packets.
- Legacy section 43 (open decisions) was stale after subsequent decisions and is not canonical.
- Legacy section 45 (next interview topics) was process history and is not canonical.
