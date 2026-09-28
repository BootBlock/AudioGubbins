# ADR-0013 — Command-First Shell Surfaces

- **Status:** Accepted
- **Decision:** Every meaningful shell action is a registered command with a label, a category, an availability answer and a reason when it is unavailable. Menus, the command palette and the keyboard bindings are views onto the same registry, and a surface that cannot offer an action as a command does not offer it at all. Closing a panel is a command rather than a control on the docking tab.
- **Drivers:** one definition per action; a palette and a menu that cannot disagree; an action reachable by pointer, keyboard and touch alike; rebindable shortcuts; an unavailable action that says why instead of vanishing.
- **Constraints:** the engine's own tab close control nests an interactive element inside the element carrying `role="tab"` and is not reachable from the keyboard, so the tab renders its title only. A refused command announces its reason, because a shortcut that appears to do nothing reads as an unreliable application.
- **Related requirements:** `REQ-EDIT-073`, `REQ-UX-005`, `REQ-UX-066`, `REQ-UX-067`.
