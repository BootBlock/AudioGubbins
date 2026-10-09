import { processorProperties } from '../testing/processor-properties.js';
import { AMBISONIC_LAYOUTS } from '../testing/space-measures.js';
import { AMBISONIC_DECODER } from './ambisonic-decode.js';

processorProperties(AMBISONIC_DECODER, {
  layouts: AMBISONIC_LAYOUTS,
  settings: [
    { speakers: 'quadraphonic' },
    { speakers: 'surround-5-1' },
    { speakers: 'surround-7-1' },
  ],
  // A speaker takes `Σ_c D[s][c]·x_c`, at most `‖D[s]‖·‖x‖` by Cauchy and
  // Schwarz: `‖D[s]‖² ≤ 7`, since `κ` makes `Σ_s Σ_c D[s][c]² / (2l + 1)` one
  // and `2l + 1 ≤ 7`; and `‖x‖² ≤ 17` over 16 channels at full scale moved
  // into SN3D, where FuMa's W, 3 dB down, is `√2`.
  bound: Math.sqrt(7 * 17),
});
