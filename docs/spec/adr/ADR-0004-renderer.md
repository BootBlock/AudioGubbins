# ADR-0004 — Editor Rendering Layer

- **Status:** Accepted
- **Decision:** Use an AudioGubbins-owned renderer abstraction for waveform, timeline, spectrogram, meters and overlays. PixiJS 8.x may be the initial implementation foundation. WebGL2 is the robust baseline; WebGPU is capability-tested and used where beneficial; reduced fallbacks remain available.
- **Drivers:** large timelines, high-frequency updates, touch/pen hit testing, GPU acceleration, renderer independence from React.
- **Constraints:** authoritative domain/view state cannot live only in graphics objects; renderer/device loss must be recoverable.
- **Related requirements:** `REQ-ARCH-037`, `REQ-AUDIO-082`, `REQ-AUDIO-152`.
