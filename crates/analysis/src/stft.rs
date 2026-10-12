//! The short-time Fourier transform of a planar stream.
//!
//! Frame `k` of each channel is the `N` samples from sample `k · hop`, the
//! first frame at the stream's first sample, each multiplied by the
//! [`StftWindow`] it was made with and transformed by the canonical [`Fft`],
//! unscaled: through the Hann window a full-scale sine centred on bin `k` has
//! a magnitude of `N/4` there, the window's mean of one half times `N/2`. A
//! frame is ready once its last sample has been pushed, and is transformed
//! when it is pulled, so the object holds samples, never spectra. To reach
//! the last samples of a stream, push `N − hop` zeros after them.
//!
//! The spectral processors read it, and so do the hum and transient
//! detectors here (ADR-0061), through the Hann window; the spectrogram reads
//! it through either (ADR-0080).

use audiogubbins_dsp_core::{Fft, arctangent_turns, cosine_of_turns};

use crate::error::AnalysisError;
use crate::framing::Framing;

/// The window a frame is weighted by: `w[n]` for `n` from 0 to `N − 1`, each
/// cosine [`cosine_of_turns`] of `(k · n mod N) / N` turns, an exact argument
/// reduced to `[0, 1)`, and each sum taken left to right, so the reference
/// path computes the same bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StftWindow {
    /// The periodic Hann window, `0.5 − 0.5 · cos(2πn/N)`.
    Hann,
    /// The periodic four-term Blackman–Harris window,
    /// `a0 − a1 · cos(2πn/N) + a2 · cos(4πn/N) − a3 · cos(6πn/N)` with
    /// `a0 = 0.35875`, `a1 = 0.48829`, `a2 = 0.14128` and `a3 = 0.01168`,
    /// whose side lobes lie 92 dB down.
    BlackmanHarris,
}

/// The four terms of [`StftWindow::BlackmanHarris`], `a0` first.
const BLACKMAN_HARRIS: [f64; 4] = [0.358_75, 0.488_29, 0.141_28, 0.011_68];

impl StftWindow {
    /// The window an ABI code names, or `None`: 0 Hann, 1 Blackman–Harris.
    #[must_use]
    pub const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Hann),
            1 => Some(Self::BlackmanHarris),
            _ => None,
        }
    }

    /// `w[n]` of a window of `size` samples, `n` below `size`.
    fn weight(self, n: usize, size: usize) -> f64 {
        let cosine = |harmonic: usize| {
            cosine_of_turns(crate::exact((harmonic * n) % size) / crate::exact(size))
        };
        match self {
            Self::Hann => 0.5 - 0.5 * cosine(1),
            Self::BlackmanHarris => {
                let [a0, a1, a2, a3] = BLACKMAN_HARRIS;
                a0 - a1 * cosine(1) + a2 * cosine(2) - a3 * cosine(3)
            }
        }
    }
}

/// A short-time Fourier transform of `N` samples a hop apart, per channel.
#[derive(Debug, Clone)]
pub struct Stft {
    framing: Framing,
    fft: Fft,
    hop: usize,
    window: Vec<f64>,
    /// One channel's windowed frame.
    signal: Vec<f64>,
}

impl Stft {
    /// A transform of `channels` channels in frames of `size` samples, a
    /// power of two from 2 to 65 536, `hop` samples apart, from 1 to `size`,
    /// each weighted by `window`.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ChannelsRefused`] for no channels or more than
    /// [`crate::MOST_CHANNELS`]; [`AnalysisError::SettingRefused`] for a size
    /// or a hop out of range.
    pub fn new(
        channels: usize,
        size: usize,
        hop: usize,
        window: StftWindow,
    ) -> Result<Self, AnalysisError> {
        if channels == 0 || channels > crate::MOST_CHANNELS {
            return Err(AnalysisError::ChannelsRefused);
        }
        let fft = Fft::new(size).map_err(|_| AnalysisError::SettingRefused)?;
        if hop == 0 || hop > size {
            return Err(AnalysisError::SettingRefused);
        }
        let window = (0..size).map(|n| window.weight(n, size)).collect();
        Ok(Self {
            framing: Framing::new(channels, size, hop),
            fft,
            hop,
            window,
            signal: vec![0.0; size],
        })
    }

    /// The channels it transforms.
    #[must_use]
    pub fn channels(&self) -> usize {
        self.framing.channels()
    }

    /// `N`, the samples of a frame.
    #[must_use]
    pub const fn size(&self) -> usize {
        self.fft.size()
    }

    /// The samples between the starts of two frames.
    #[must_use]
    pub const fn hop(&self) -> usize {
        self.hop
    }

    /// `N/2 + 1`, the bins of each channel's spectrum.
    #[must_use]
    pub const fn bins(&self) -> usize {
        self.fft.bins()
    }

    /// Appends `frames` frames of planar samples, channel `c` from
    /// `c · frames`.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ShapeRefused`] unless `planar` is `channels · frames`
    /// long, having appended nothing.
    pub fn push(&mut self, planar: &[f32], frames: usize) -> Result<(), AnalysisError> {
        self.framing.push(planar, frames)
    }

    /// Whether a frame can be pulled.
    #[must_use]
    pub fn ready(&self) -> bool {
        self.framing.ready()
    }

    /// The sample the next frame starts at.
    #[must_use]
    pub const fn position(&self) -> u64 {
        self.framing.position()
    }

    /// Writes the next frame's spectra, if one is ready, and answers whether
    /// it did: channel `c`'s `N/2 + 1` bins from `c · (N/2 + 1)` of `real`
    /// and of `imaginary`. Each sample, as an `f64`, times `w[n]`, rounded
    /// once, is the signal the FFT transforms.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ShapeRefused`] unless each output is
    /// `channels · (N/2 + 1)` long, having written nothing.
    pub fn pull_complex(
        &mut self,
        real: &mut [f64],
        imaginary: &mut [f64],
    ) -> Result<bool, AnalysisError> {
        let bins = self.bins();
        let length = self.channels() * bins;
        if real.len() != length || imaginary.len() != length {
            return Err(AnalysisError::ShapeRefused);
        }
        if !self.framing.ready() {
            return Ok(false);
        }
        let channels = real
            .chunks_exact_mut(bins)
            .zip(imaginary.chunks_exact_mut(bins));
        for (channel, (re, im)) in channels.enumerate() {
            let frame = self.framing.frame(channel);
            for ((into, sample), weight) in self.signal.iter_mut().zip(frame).zip(&self.window) {
                *into = f64::from(*sample) * weight;
            }
            // The lengths were made to agree, so the transform cannot refuse.
            self.fft
                .forward_real(&self.signal, re, im)
                .map_err(|_| AnalysisError::ShapeRefused)?;
        }
        self.framing.advance();
        Ok(true)
    }

    /// Writes the next frame as magnitudes and phases, if one is ready, laid
    /// out as [`Self::pull_complex`] lays out its parts, and answers whether
    /// it did. Bin `k`'s magnitude is `√(re · re + im · im)` and its phase
    /// `arctangent_turns(im, re)`, in turns in `(−1/2, 1/2]`.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ShapeRefused`] unless each output is
    /// `channels · (N/2 + 1)` long, having written nothing.
    pub fn pull_polar(
        &mut self,
        magnitudes: &mut [f64],
        phases: &mut [f64],
    ) -> Result<bool, AnalysisError> {
        if !self.pull_complex(magnitudes, phases)? {
            return Ok(false);
        }
        for (magnitude, phase) in magnitudes.iter_mut().zip(phases.iter_mut()) {
            let (re, im) = (*magnitude, *phase);
            *magnitude = (re * re + im * im).sqrt();
            *phase = arctangent_turns(im, re);
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use audiogubbins_dsp_core::sine_of_turns;

    use super::{BLACKMAN_HARRIS, Stft, StftWindow};
    use crate::error::AnalysisError;
    use crate::fingerprint;
    use crate::signals::golden;

    #[test]
    fn refuses_settings_out_of_range() {
        assert_eq!(
            Stft::new(0, 64, 16, StftWindow::Hann).unwrap_err(),
            AnalysisError::ChannelsRefused
        );
        assert_eq!(
            Stft::new(257, 64, 16, StftWindow::Hann).unwrap_err(),
            AnalysisError::ChannelsRefused
        );
        for (size, hop) in [(48, 16), (1, 1), (131_072, 16), (64, 0), (64, 65)] {
            assert_eq!(
                Stft::new(1, size, hop, StftWindow::Hann).unwrap_err(),
                AnalysisError::SettingRefused,
                "{size}, {hop}"
            );
        }
    }

    #[test]
    fn finds_a_centred_sine_at_a_quarter_of_the_size() {
        // A full-scale sine on bin 8 of 64: the Hann window spreads it over
        // bins 7 to 9, at N/8, N/4 and N/8, and leaves nothing elsewhere.
        let size = 64;
        let samples: Vec<f32> = (0..size)
            .map(|n| {
                #[allow(clippy::cast_possible_truncation, reason = "a sample")]
                let value = sine_of_turns(f64::from(n) * 8.0 / 64.0) as f32;
                value
            })
            .collect();
        let mut stft = Stft::new(1, 64, 64, StftWindow::Hann).expect("valid");
        stft.push(&samples, 64).expect("one channel");
        let mut magnitudes = vec![0.0; stft.bins()];
        let mut phases = vec![0.0; stft.bins()];
        assert!(
            stft.pull_polar(&mut magnitudes, &mut phases)
                .expect("lengths agree")
        );
        assert!((magnitudes[8] - 16.0).abs() < 1.0e-5);
        assert!((magnitudes[7] - 8.0).abs() < 1.0e-5);
        assert!((magnitudes[9] - 8.0).abs() < 1.0e-5);
        // A sine is a cosine a quarter turn late: its phase is −1/4.
        assert!((phases[8] + 0.25).abs() < 1.0e-6);
        for (bin, magnitude) in magnitudes.iter().enumerate() {
            if !(7..=9).contains(&bin) {
                assert!(*magnitude < 1.0e-5, "bin {bin}: {magnitude}");
            }
        }
        assert!(
            !stft
                .pull_polar(&mut magnitudes, &mut phases)
                .expect("lengths agree")
        );
    }

    #[test]
    fn refuses_outputs_of_the_wrong_length_and_writes_nothing() {
        let mut stft = Stft::new(2, 8, 4, StftWindow::Hann).expect("valid");
        stft.push(&[0.5; 16], 8).expect("two channels");
        let mut real = [7.0; 9];
        let mut imaginary = [7.0; 10];
        assert_eq!(
            stft.pull_complex(&mut real, &mut imaginary),
            Err(AnalysisError::ShapeRefused)
        );
        assert_eq!(real, [7.0; 9]);
        assert!(stft.ready());
    }

    #[test]
    fn reads_window_codes() {
        assert_eq!(StftWindow::from_code(0), Some(StftWindow::Hann));
        assert_eq!(StftWindow::from_code(1), Some(StftWindow::BlackmanHarris));
        assert_eq!(StftWindow::from_code(2), None);
    }

    #[test]
    fn weights_by_the_four_term_blackman_harris_window() {
        let stft = Stft::new(1, 256, 64, StftWindow::BlackmanHarris).expect("valid");
        let window = &stft.window;
        let [a0, a1, a2, a3] = BLACKMAN_HARRIS;
        // At n = 0 every cosine is 1, and at N/2 they alternate from −1.
        assert_eq!(window[0], a0 - a1 + a2 - a3);
        assert_eq!(window[128], a0 + a1 + a2 + a3);
        // Periodic: symmetric about N/2, to the bit, with no repeated end.
        for n in 1..256 {
            assert_eq!(window[n], window[256 - n], "{n}");
        }
        assert!((window[64] - (a0 - a2)).abs() < 1.0e-15);
        assert_eq!(
            fingerprint::of(window),
            GOLDEN_BLACKMAN_HARRIS,
            "window bits changed: {:#x}",
            fingerprint::of(window)
        );
    }

    /// The window of 256 samples [`StftWindow::BlackmanHarris`] gives.
    const GOLDEN_BLACKMAN_HARRIS: u64 = 0xa506_c82f_f715_8ba1;

    #[test]
    fn keeps_a_sine_within_four_bins_through_blackman_harris() {
        // A full-scale sine on bin 8 of 64: the window's mean of a0 times N/2
        // at the bin, its neighbours a1 · N/4, a2 · N/4 and a3 · N/4 out to
        // bin 8 ± 3, and nothing further.
        let samples: Vec<f32> = (0..64)
            .map(|n| {
                #[allow(clippy::cast_possible_truncation, reason = "a sample")]
                let value = sine_of_turns(f64::from(n) * 8.0 / 64.0) as f32;
                value
            })
            .collect();
        let mut stft = Stft::new(1, 64, 64, StftWindow::BlackmanHarris).expect("valid");
        stft.push(&samples, 64).expect("one channel");
        let mut magnitudes = vec![0.0; stft.bins()];
        let mut phases = vec![0.0; stft.bins()];
        assert!(
            stft.pull_polar(&mut magnitudes, &mut phases)
                .expect("lengths agree")
        );
        let [a0, a1, a2, a3] = BLACKMAN_HARRIS;
        for (distance, expected) in [
            (0, a0 * 32.0),
            (1, a1 * 16.0),
            (2, a2 * 16.0),
            (3, a3 * 16.0),
        ] {
            assert!(
                (magnitudes[8 + distance] - expected).abs() < 1.0e-5,
                "+{distance}"
            );
            assert!(
                (magnitudes[8 - distance] - expected).abs() < 1.0e-5,
                "-{distance}"
            );
        }
        for (bin, magnitude) in magnitudes.iter().enumerate() {
            if !(5..=11).contains(&bin) {
                assert!(*magnitude < 1.0e-5, "bin {bin}: {magnitude}");
            }
        }
    }

    /// The golden run through `window`: two channels of [`golden`], 1 000
    /// frames, pushed in chunks of 97, framed by 256 samples 96 apart; every
    /// frame's polar and complex form alternately, folded into one
    /// fingerprint each.
    pub(crate) fn golden_run(window: StftWindow) -> [u64; 2] {
        let planar = golden(2, 1_000);
        let mut stft = Stft::new(2, 256, 96, window).expect("valid");
        let bins = stft.bins();
        let (mut first, mut second) = (vec![0.0; 2 * bins], vec![0.0; 2 * bins]);
        let (mut polar, mut complex) = (Vec::new(), Vec::new());
        let mut frame = 0;
        for start in (0..1_000).step_by(97) {
            let end = (start + 97).min(1_000);
            let mut chunk = planar[start..end].to_vec();
            chunk.extend_from_slice(&planar[1_000 + start..1_000 + end]);
            stft.push(&chunk, end - start).expect("two channels");
            loop {
                let pulled = if frame % 2 == 0 {
                    stft.pull_polar(&mut first, &mut second)
                } else {
                    stft.pull_complex(&mut first, &mut second)
                };
                if !pulled.expect("lengths agree") {
                    break;
                }
                let into = if frame % 2 == 0 {
                    &mut polar
                } else {
                    &mut complex
                };
                into.extend_from_slice(&first);
                into.extend_from_slice(&second);
                frame += 1;
            }
        }
        assert_eq!(frame, 8);
        [fingerprint::of(&polar), fingerprint::of(&complex)]
    }

    #[test]
    fn gives_the_golden_bits_the_reference_path_is_held_to() {
        let hashes = golden_run(StftWindow::Hann);
        assert_eq!(hashes, GOLDEN_STFT, "stft bits changed: {hashes:#x?}");
        let hashes = golden_run(StftWindow::BlackmanHarris);
        assert_eq!(
            hashes, GOLDEN_STFT_BLACKMAN_HARRIS,
            "stft bits changed: {hashes:#x?}"
        );
    }

    /// The polar frames and the complex frames of [`golden_run`] through the
    /// Hann window.
    const GOLDEN_STFT: [u64; 2] = [0x7ce2_8db8_1390_9753, 0xe3df_76af_e3a0_5176];

    /// As [`GOLDEN_STFT`], through the Blackman–Harris window.
    const GOLDEN_STFT_BLACKMAN_HARRIS: [u64; 2] = [0x9077_07fc_c42f_2c34, 0x992b_a50a_c971_3cc6];
}
