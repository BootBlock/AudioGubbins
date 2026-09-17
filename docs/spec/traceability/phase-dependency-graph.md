# Phase Dependency Graph

The graph below is normative for readiness. Markdown file order is not execution order.

```mermaid
flowchart LR
  P00["00 Requirements and Architectural Baseline"]
  P01["01 Application Foundation"]
  P02["02 Project and Storage System"]
  P03["03 Audio Engine Foundation"]
  P04["04 Waveform and Timeline Foundation"]
  P05["05 Core Non-Destructive Editing"]
  P06["06 Effect Rack and Core DSP"]
  P07["07 Recording"]
  P08["08 Spectral Editing"]
  P09["09 Import, Export, and Codec System"]
  P10["10 Game-Audio Tooling"]
  P11["11 Godot Integration"]
  P12["12 PWA, Offline, and Installation Hardening"]
  P13["13 Advanced Batch and Variation Workflows"]
  P14["14 Performance, Compatibility, and Accessibility Hardening"]
  P15["15 Release Readiness"]
  P00 --> P01
  P01 --> P02
  P01 --> P03
  P01 --> P04
  P03 --> P04
  P02 --> P05
  P03 --> P05
  P04 --> P05
  P03 --> P06
  P05 --> P06
  P02 --> P07
  P03 --> P07
  P05 --> P07
  P06 --> P07
  P03 --> P08
  P04 --> P08
  P05 --> P08
  P06 --> P08
  P02 --> P09
  P03 --> P09
  P05 --> P09
  P06 --> P09
  P05 --> P10
  P06 --> P10
  P09 --> P10
  P02 --> P11
  P03 --> P11
  P06 --> P11
  P09 --> P11
  P10 --> P11
  P01 --> P12
  P02 --> P12
  P09 --> P12
  P05 --> P13
  P06 --> P13
  P09 --> P13
  P10 --> P13
  P11 --> P13
  P01 --> P14
  P02 --> P14
  P03 --> P14
  P04 --> P14
  P05 --> P14
  P06 --> P14
  P07 --> P14
  P08 --> P14
  P09 --> P14
  P10 --> P14
  P11 --> P14
  P12 --> P14
  P13 --> P14
  P14 --> P15
```

## Hard Dependencies

- Phase 00: none
- Phase 01: Phase 00
- Phase 02: Phase 01
- Phase 03: Phase 01
- Phase 04: Phase 01, Phase 03
- Phase 05: Phase 02, Phase 03, Phase 04
- Phase 06: Phase 03, Phase 05
- Phase 07: Phase 02, Phase 03, Phase 05, Phase 06
- Phase 08: Phase 03, Phase 04, Phase 05, Phase 06
- Phase 09: Phase 02, Phase 03, Phase 05, Phase 06
- Phase 10: Phase 05, Phase 06, Phase 09
- Phase 11: Phase 02, Phase 03, Phase 06, Phase 09, Phase 10
- Phase 12: Phase 01, Phase 02, Phase 09
- Phase 13: Phase 05, Phase 06, Phase 09, Phase 10, Phase 11
- Phase 14: Phase 01, Phase 02, Phase 03, Phase 04, Phase 05, Phase 06, Phase 07, Phase 08, Phase 09, Phase 10, Phase 11, Phase 12, Phase 13
- Phase 15: Phase 14
