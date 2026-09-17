# ADR-0008 — Monorepo and Workspace Model

- **Status:** Accepted
- **Decision:** Keep the web app, TypeScript packages, Rust crates, Godot addons, fixtures, tests and specification in one coordinated monorepo using pnpm workspaces and Cargo workspaces.
- **Drivers:** shared schema/versioning, cross-component refactors, agent worktree coordination, unified release version.
- **Constraints:** package boundaries must reflect coherent ownership; no package proliferation for appearances; circular dependencies are prohibited.
- **Related requirements:** `REQ-REPO-154`, `REQ-REPO-185`, `REQ-REPO-186`, `REQ-REPO-187`.
