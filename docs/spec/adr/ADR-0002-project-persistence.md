# ADR-0002 — Local-First Project Persistence

- **Status:** Accepted
- **Decision:** Use an application-owned versioned project model with browser-managed persistent storage (OPFS where available), content-addressed media storage, external-source adapters, a command journal, immutable snapshots, portable bundles, and deterministic unpacked/Git-friendly projects.
- **Drivers:** local-first operation, recoverability, unlimited/branching history, large media, project portability, developer workflows.
- **Constraints:** caches are disposable; one project has one writer per storage context; external changes are detected; encryption is out of scope.
- **Related requirements:** `REQ-STOR-025`, `REQ-STOR-026`, `REQ-STOR-098` through `REQ-STOR-106`, `REQ-STOR-193` through `REQ-STOR-200`.
