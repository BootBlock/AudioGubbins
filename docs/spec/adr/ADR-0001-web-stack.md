# ADR-0001 — Web Application Stack

- **Status:** Accepted
- **Decision:** Use React 19.x + TypeScript + Vite 8.x for the web shell, Radix Primitives for accessible low-level controls, Dockview behind an AudioGubbins-owned workspace abstraction, and Motion for React for application-shell animation.
- **Drivers:** rich professional UI, accessibility, mature ecosystem, dockable workspaces, strong animation, static/PWA deployment.
- **Constraints:** React must not own high-frequency audio/render state or authoritative project state. Domain packages remain framework-agnostic.
- **Related requirements:** `REQ-ARCH-151`, `REQ-ARCH-153`, `REQ-UX-057`, `REQ-EDIT-073`.
- **Superseded in part:** the animation clause, by `ADR-0014`. Motion for React is not installed until a component imports it.
