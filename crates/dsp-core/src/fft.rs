//! The discrete Fourier transform of real signals, by a fast transform whose
//! every operation is stated, so it gives the same bits on every platform.
//!
//! A real signal of `N` samples, `N` a power of two, is transformed as a
//! complex signal of `N/2` samples, the even samples its real parts and the
//! odd its imaginary, by an iterative radix-2 decimation-in-time transform,
//! and the spectrum of the real signal is then separated from it. The
//! transform is unscaled: the spectrum of a full-scale sine of `N` samples at
//! bin `k` has a magnitude of `N/2` there. The inverse takes the `N/2 + 1`
//! bins back to `N` samples and scales by `1/N`, so the inverse of the forward
//! transform is the signal again, to within a few units in the last place.
//!
//! The twiddle factors are made once, when the transform is: `cos(2πk/N)` and
//! `sin(2πk/N)` for `k` from 0 to `N/2`, both from
//! [`cosine_of_turns`](crate::cosine_of_turns), the sine as
//! `cosine_of_turns(1/4 − k/N)`. Both arguments are exact, so the tables are
//! symmetric to the bit: the cosine of `k/N` is the sine of `1/4 − k/N`, and
//! the factors at the quarter and half turns are exactly 0 and ±1. Its
//! scratch is made then too, so a transform allocates nothing.

use crate::trigonometry::cosine_of_turns;

/// The fewest samples a transform takes.
pub const SMALLEST_FFT_SIZE: usize = 2;

/// The most samples a transform takes: 2¹⁶, which bounds the tables a
/// transform holds to about two megabytes.
pub const LARGEST_FFT_SIZE: usize = 65_536;

/// Why a transform cannot be made or run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FftError {
    /// The size is not a power of two from [`SMALLEST_FFT_SIZE`] to
    /// [`LARGEST_FFT_SIZE`].
    SizeRefused,
    /// A signal is not the transform's size, or a spectrum is not `N/2 + 1` bins.
    LengthMismatch,
}

/// A transform of real signals of one size, with its tables and scratch.
#[derive(Debug, Clone)]
pub struct Fft {
    /// `N`, the samples of a signal.
    size: usize,
    /// `cos(2πk/N)` for `k` in `0..=N/2`.
    cosines: Vec<f64>,
    /// `sin(2πk/N)` for `k` in `0..=N/2`.
    sines: Vec<f64>,
    /// Where each of the `N/2` complex samples goes in the bit-reversed order.
    reversed: Vec<usize>,
    /// The complex signal of `N/2` samples, transformed in place.
    real: Vec<f64>,
    imaginary: Vec<f64>,
}

impl Fft {
    /// A transform of `size` real samples.
    ///
    /// # Errors
    ///
    /// [`FftError::SizeRefused`] unless `size` is a power of two from
    /// [`SMALLEST_FFT_SIZE`] to [`LARGEST_FFT_SIZE`].
    pub fn new(size: usize) -> Result<Self, FftError> {
        if !(SMALLEST_FFT_SIZE..=LARGEST_FFT_SIZE).contains(&size) || !size.is_power_of_two() {
            return Err(FftError::SizeRefused);
        }
        let half = size / 2;
        // At most 2¹⁶, so each k and the size are exact in an f64.
        #[allow(clippy::cast_precision_loss, reason = "at most 2^16")]
        let turns_of = |k: usize| k as f64 / size as f64;
        let cosines = (0..=half).map(|k| cosine_of_turns(turns_of(k))).collect();
        let sines = (0..=half)
            .map(|k| cosine_of_turns(0.25 - turns_of(k)))
            .collect();
        let bits = half.trailing_zeros();
        let reversed = (0..half)
            .map(|index| {
                if bits == 0 {
                    0
                } else {
                    index.reverse_bits() >> (usize::BITS - bits)
                }
            })
            .collect();
        Ok(Self {
            size,
            cosines,
            sines,
            reversed,
            real: vec![0.0; half],
            imaginary: vec![0.0; half],
        })
    }

    /// `N`, the samples of a signal.
    #[must_use]
    pub const fn size(&self) -> usize {
        self.size
    }

    /// `N/2 + 1`, the bins of a spectrum.
    #[must_use]
    pub const fn bins(&self) -> usize {
        self.size / 2 + 1
    }

    /// The spectrum of `signal`, `N` samples, written to `real` and
    /// `imaginary`, each `N/2 + 1` bins: bin `k` is
    /// `Σ signal[n] · e^(−2πikn/N)`, unscaled. The imaginary parts of bins 0
    /// and `N/2` are exactly zero.
    ///
    /// After the complex transform of `z[j] = signal[2j] + i · signal[2j + 1]`,
    /// bin `k` is formed from `Z[k]` and `Z[N/2 − k]` (`Z[N/2]` being `Z[0]`)
    /// and `W = (cos, sin)` of `k/N`, in this order:
    /// `eᵣ = (Zᵣ[k] + Zᵣ[N/2−k]) · ½`, `eᵢ = (Zᵢ[k] − Zᵢ[N/2−k]) · ½`,
    /// `oᵣ = (Zᵢ[k] + Zᵢ[N/2−k]) · ½`, `oᵢ = (Zᵣ[N/2−k] − Zᵣ[k]) · ½`, then
    /// `real = eᵣ + (cos · oᵣ + sin · oᵢ)` and
    /// `imaginary = eᵢ + (cos · oᵢ − sin · oᵣ)`.
    ///
    /// # Errors
    ///
    /// [`FftError::LengthMismatch`] where a length is not the transform's,
    /// having written nothing.
    pub fn forward_real(
        &mut self,
        signal: &[f64],
        real: &mut [f64],
        imaginary: &mut [f64],
    ) -> Result<(), FftError> {
        let half = self.size / 2;
        if signal.len() != self.size || real.len() != half + 1 || imaginary.len() != half + 1 {
            return Err(FftError::LengthMismatch);
        }
        for (index, pair) in signal.chunks_exact(2).enumerate() {
            let at = self.reversed[index];
            self.real[at] = pair[0];
            self.imaginary[at] = pair[1];
        }
        self.butterflies(-1.0);
        // Halved by multiplying by ½, as stated: `f64::midpoint` takes another
        // route near overflow, which the reference path would not repeat.
        #[allow(clippy::manual_midpoint, reason = "the stated order of operations")]
        for k in 0..=half {
            let here = k % half;
            let there = (half - k) % half;
            let (zr, zi) = (self.real[here], self.imaginary[here]);
            let (cr, ci) = (self.real[there], self.imaginary[there]);
            let even_real = (zr + cr) * 0.5;
            let even_imaginary = (zi - ci) * 0.5;
            let odd_real = (zi + ci) * 0.5;
            let odd_imaginary = (cr - zr) * 0.5;
            let (cosine, sine) = (self.cosines[k], self.sines[k]);
            real[k] = even_real + (cosine * odd_real + sine * odd_imaginary);
            imaginary[k] = even_imaginary + (cosine * odd_imaginary - sine * odd_real);
        }
        Ok(())
    }

    /// The signal of `N` samples whose spectrum is `real` and `imaginary`,
    /// `N/2 + 1` bins each, written to `signal`: sample `n` is
    /// `(1/N) Σ X[k] · e^(2πikn/N)` over the whole spectrum the bins are half
    /// of. The imaginary parts of bins 0 and `N/2` are taken as zero, as a
    /// real signal's are.
    ///
    /// For `k` from 0 to `N/2 − 1`, with `X[k] = (xᵣ, xᵢ)`,
    /// `Y = conj X[N/2 − k] = (yᵣ, yᵢ)` and `W = (cos, sin)` of `k/N`:
    /// `eᵣ = xᵣ + yᵣ`, `eᵢ = xᵢ + yᵢ`, `dᵣ = xᵣ − yᵣ`, `dᵢ = xᵢ − yᵢ`,
    /// `oᵣ = dᵣ · cos − dᵢ · sin`, `oᵢ = dᵣ · sin + dᵢ · cos`, and the complex
    /// sample `Z[k] = (eᵣ − oᵢ, eᵢ + oᵣ)`, twice the transform of the signal's
    /// complex form. Its inverse complex transform, unscaled, is then
    /// multiplied by `1/N`, exactly, a power of two.
    ///
    /// # Errors
    ///
    /// [`FftError::LengthMismatch`] where a length is not the transform's,
    /// having written nothing.
    pub fn inverse_real(
        &mut self,
        real: &[f64],
        imaginary: &[f64],
        signal: &mut [f64],
    ) -> Result<(), FftError> {
        let half = self.size / 2;
        if signal.len() != self.size || real.len() != half + 1 || imaginary.len() != half + 1 {
            return Err(FftError::LengthMismatch);
        }
        for k in 0..half {
            let (xr, xi) = (real[k], if k == 0 { 0.0 } else { imaginary[k] });
            let (yr, yi) = (
                real[half - k],
                if k == 0 { 0.0 } else { -imaginary[half - k] },
            );
            let (er, ei) = (xr + yr, xi + yi);
            let (dr, di) = (xr - yr, xi - yi);
            let (cosine, sine) = (self.cosines[k], self.sines[k]);
            let odd_real = dr * cosine - di * sine;
            let odd_imaginary = dr * sine + di * cosine;
            let at = self.reversed[k];
            self.real[at] = er - odd_imaginary;
            self.imaginary[at] = ei + odd_real;
        }
        self.butterflies(1.0);
        // At most 2¹⁶, exact in an f64, so the scale is an exact power of two.
        #[allow(clippy::cast_precision_loss, reason = "at most 2^16")]
        let scale = 1.0 / self.size as f64;
        for (index, pair) in signal.chunks_exact_mut(2).enumerate() {
            pair[0] = self.real[index] * scale;
            pair[1] = self.imaginary[index] * scale;
        }
        Ok(())
    }

    /// The complex transform, in place, of the `N/2` samples already in
    /// bit-reversed order: forward with `direction` −1, the exponent's sign,
    /// and inverse with +1, unscaled.
    ///
    /// Stage by stage, spans of 2, 4, … `N/2`; within a span of `s`, the
    /// butterfly of `a = start + j` and `b = a + s/2` takes the factor
    /// `W = (cos, direction · sin)` of `j/s = j·(N/s)/N` and computes
    /// `tᵣ = cos · bᵣ − w · bᵢ`, `tᵢ = cos · bᵢ + w · bᵣ` (`w` the signed sine),
    /// then `b = a − t` and `a = a + t`.
    fn butterflies(&mut self, direction: f64) {
        let half = self.size / 2;
        let mut span = 2;
        while span <= half {
            let stride = self.size / span;
            for start in (0..half).step_by(span) {
                for j in 0..span / 2 {
                    let cosine = self.cosines[j * stride];
                    let sine = direction * self.sines[j * stride];
                    let a = start + j;
                    let b = a + span / 2;
                    let (br, bi) = (self.real[b], self.imaginary[b]);
                    let tr = cosine * br - sine * bi;
                    let ti = cosine * bi + sine * br;
                    let (ar, ai) = (self.real[a], self.imaginary[a]);
                    self.real[b] = ar - tr;
                    self.imaginary[b] = ai - ti;
                    self.real[a] = ar + tr;
                    self.imaginary[a] = ai + ti;
                }
            }
            span *= 2;
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]
    #![allow(
        clippy::cast_precision_loss,
        reason = "sizes and indices far below 2^52"
    )]

    use super::{Fft, FftError};
    use crate::turns::sine_of_turns;

    /// A fixed signal of `size` samples: two tones and a ramp, nothing random,
    /// so the golden values are reproducible.
    fn signal(size: usize) -> Vec<f64> {
        (0..size)
            .map(|n| {
                let at = f64::from(u32::try_from(n).expect("small"));
                0.5 * sine_of_turns(at * 0.013) + 0.25 * sine_of_turns(at * 0.31 + 0.1) + at / 1.0e4
            })
            .collect()
    }

    /// The transform by its definition, summed in f64 with the platform's own
    /// trigonometry: slow, and the oracle only.
    fn naive(signal: &[f64]) -> (Vec<f64>, Vec<f64>) {
        let size = signal.len();
        let bins = size / 2 + 1;
        let mut real = vec![0.0; bins];
        let mut imaginary = vec![0.0; bins];
        for k in 0..bins {
            for (n, sample) in signal.iter().enumerate() {
                let turns = ((k * n) % size) as f64 / size as f64;
                let angle = turns * std::f64::consts::TAU;
                real[k] += sample * angle.cos();
                imaginary[k] -= sample * angle.sin();
            }
        }
        (real, imaginary)
    }

    #[test]
    fn refuses_a_size_that_is_not_a_power_of_two_in_range() {
        for size in [0, 1, 3, 12, 131_072, usize::MAX] {
            assert_eq!(Fft::new(size).unwrap_err(), FftError::SizeRefused, "{size}");
        }
        for size in [2, 4, 1_024, 65_536] {
            assert!(Fft::new(size).is_ok(), "{size}");
        }
    }

    #[test]
    fn refuses_buffers_of_the_wrong_length_and_writes_nothing() {
        let mut fft = Fft::new(8).expect("valid");
        let mut real = [7.0; 5];
        let mut imaginary = [7.0; 5];
        assert_eq!(
            fft.forward_real(&[0.0; 7], &mut real, &mut imaginary),
            Err(FftError::LengthMismatch)
        );
        assert_eq!(
            fft.forward_real(&[0.0; 8], &mut real[..4], &mut imaginary),
            Err(FftError::LengthMismatch)
        );
        assert_eq!(real, [7.0; 5]);
        let mut out = [7.0; 9];
        assert_eq!(
            fft.inverse_real(&real, &imaginary, &mut out),
            Err(FftError::LengthMismatch)
        );
        assert_eq!(out, [7.0; 9]);
    }

    #[test]
    fn has_tables_exact_at_the_quarter_and_half_turns() {
        let fft = Fft::new(16).expect("valid");
        assert_eq!(fft.cosines[0], 1.0);
        assert_eq!(fft.sines[0], 0.0);
        assert_eq!(fft.cosines[4], 0.0);
        assert_eq!(fft.sines[4], 1.0);
        assert_eq!(fft.cosines[8], -1.0);
        assert_eq!(fft.sines[8], 0.0);
        assert_eq!(fft.cosines[2], fft.sines[2]);
        assert_eq!(fft.cosines[1], fft.sines[3]);
    }

    #[test]
    fn transforms_the_two_sample_signal_by_its_definition() {
        let mut fft = Fft::new(2).expect("valid");
        let (mut real, mut imaginary) = ([0.0; 2], [9.0; 2]);
        fft.forward_real(&[3.0, 5.0], &mut real, &mut imaginary)
            .expect("lengths agree");
        assert_eq!(real, [8.0, -2.0]);
        assert_eq!(imaginary, [0.0, 0.0]);
        let mut back = [0.0; 2];
        fft.inverse_real(&real, &imaginary, &mut back)
            .expect("lengths agree");
        assert_eq!(back, [3.0, 5.0]);
    }

    #[test]
    fn agrees_with_the_transform_by_its_definition() {
        for size in [2, 4, 8, 16, 64, 256, 1_024] {
            let input = signal(size);
            let mut fft = Fft::new(size).expect("valid");
            let mut real = vec![0.0; fft.bins()];
            let mut imaginary = vec![0.0; fft.bins()];
            fft.forward_real(&input, &mut real, &mut imaginary)
                .expect("lengths agree");
            let (expected_real, expected_imaginary) = naive(&input);
            let scale = size as f64;
            for k in 0..fft.bins() {
                assert!(
                    (real[k] - expected_real[k]).abs() <= 1.0e-12 * scale,
                    "{size}: {k}"
                );
                assert!(
                    (imaginary[k] - expected_imaginary[k]).abs() <= 1.0e-12 * scale,
                    "{size}: {k}"
                );
            }
            assert_eq!(imaginary[0].to_bits(), 0.0_f64.to_bits());
            assert_eq!(imaginary[size / 2].abs(), 0.0);
        }
    }

    #[test]
    fn inverts_its_forward_transform_and_keeps_the_energy() {
        for size in [4, 512, 65_536] {
            let input = signal(size);
            let mut fft = Fft::new(size).expect("valid");
            let mut real = vec![0.0; fft.bins()];
            let mut imaginary = vec![0.0; fft.bins()];
            fft.forward_real(&input, &mut real, &mut imaginary)
                .expect("lengths agree");
            let mut back = vec![0.0; size];
            fft.inverse_real(&real, &imaginary, &mut back)
                .expect("lengths agree");
            let worst = input
                .iter()
                .zip(&back)
                .map(|(a, b)| (a - b).abs())
                .fold(0.0, f64::max);
            assert!(worst < 1.0e-13, "{size}: round trip out by {worst}");

            // Parseval: Σ x² = (1/N) Σ |X|² over the whole spectrum, each bin
            // but the first and last standing for itself and its mirror.
            let energy: f64 = input.iter().map(|x| x * x).sum();
            let half = size / 2;
            let spectral: f64 = (0..=half)
                .map(|k| {
                    let weight = if k == 0 || k == half { 1.0 } else { 2.0 };
                    weight * (real[k] * real[k] + imaginary[k] * imaginary[k])
                })
                .sum::<f64>()
                / size as f64;
            assert!((energy - spectral).abs() <= 1.0e-12 * energy, "{size}");
        }
    }

    #[test]
    fn finds_a_tone_in_its_bin_at_half_the_size() {
        let size = 256;
        let input: Vec<f64> = (0..size)
            .map(|n| sine_of_turns(f64::from(n) * 10.0 / f64::from(size)))
            .collect();
        let mut fft = Fft::new(256).expect("valid");
        let mut real = vec![0.0; fft.bins()];
        let mut imaginary = vec![0.0; fft.bins()];
        fft.forward_real(&input, &mut real, &mut imaginary)
            .expect("lengths agree");
        assert!((imaginary[10] + 128.0).abs() < 1.0e-12);
        for k in (0..fft.bins()).filter(|k| *k != 10) {
            assert!(real[k].hypot(imaginary[k]) < 1.0e-12, "bin {k}");
        }
    }

    #[test]
    fn gives_the_golden_bits_the_reference_path_is_held_to() {
        let mut fft = Fft::new(64).expect("valid");
        let input = signal(64);
        let mut real = vec![0.0; fft.bins()];
        let mut imaginary = vec![0.0; fft.bins()];
        fft.forward_real(&input, &mut real, &mut imaginary)
            .expect("lengths agree");
        let mut back = vec![0.0; 64];
        fft.inverse_real(&real, &imaginary, &mut back)
            .expect("lengths agree");
        let hashes = [
            fingerprint(&real),
            fingerprint(&imaginary),
            fingerprint(&back),
        ];
        assert_eq!(hashes, GOLDEN_FFT, "fft bits changed: {hashes:#x?}");
        let picked = [real[3].to_bits(), imaginary[3].to_bits(), back[5].to_bits()];
        assert_eq!(picked, GOLDEN_FFT_SAMPLES, "{picked:#x?}");
    }

    /// FNV-1a over the little-endian bits of each `f64`, as the TypeScript
    /// tests compute it over a `Float64Array`.
    fn fingerprint(values: &[f64]) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for value in values {
            for byte in value.to_bits().to_le_bytes() {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        hash
    }

    /// The real and imaginary parts of the spectrum of `signal(64)`, and its
    /// inverse, each as one fingerprint.
    const GOLDEN_FFT: [u64; 3] = [
        0x1ff5_64c8_d530_0d41,
        0x5d69_2022_7ef6_096d,
        0xc6b6_fa66_276f_359a,
    ];

    /// Bin 3's real and imaginary parts, and sample 5 of the inverse.
    const GOLDEN_FFT_SAMPLES: [u64; 3] = [
        0x3fb0_1221_7f45_fec6,
        0xbff8_abac_599a_e776,
        0xbf6a_0d94_5206_5060,
    ];
}
