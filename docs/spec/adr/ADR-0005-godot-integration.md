# ADR-0005 — Godot Editor and Runtime Integration

- **Status:** Accepted
- **Decision:** Provide two optional Godot 4+ components: an `@tool` EditorPlugin for authoring/editor integration and a runtime addon for AudioGubbins event/variation playback. Generated content uses Godot-native resources and ordinary audio files.
- **Drivers:** seamless game-audio iteration, rich variation/event support, native Godot workflow, open asset principle.
- **Constraints:** no Godot 3 compatibility; do not replace Godot AudioServer/mixer; no opaque project rewrites; audio remains usable without runtime addon.
- **Related requirements:** `REQ-GODOT-107` through `REQ-GODOT-135`.
