//! Streaming conversion: input pushed in any chunks, output pulled in any.

use crate::greatest_common_divisor;
use crate::kernel::Kernel;
use crate::quality::ResamplingQuality;

/// Why a resampler cannot be made or fed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResamplerError {
    /// A sample rate is zero.
    RateZero,
    /// There are no channels.
    NoChannels,
    /// Input was given after the stream was finished, or with the wrong
    /// number of channels or of different lengths.
    InputRefused,
}

/// A multichannel converter from one rate to another.
///
/// Every channel is converted with the same filter at the same positions, so
/// channels stay sample-aligned whatever the layout (REQ-ARCH-157).
///
/// Output sample `j` sits at input position `j · M / L`, held as a whole index
/// `i` and a phase `φ` in `[0, L)` that advance by exact integer steps, so no
/// position is ever rounded and nothing overflows on a long stream. The output
/// starts at input position zero, so the conversion adds no delay to an
/// offline render; to produce a sample it needs `K` input frames past it,
/// which is its latency when it runs in real time.
#[derive(Debug)]
pub struct StreamingResampler {
    kernel: Kernel,
    /// Input samples from absolute index `base` on, per channel.
    history: Vec<Vec<f32>>,
    base: u64,
    received: u64,
    finished: bool,
    index: u64,
    phase: u32,
    scratch: Vec<f64>,
}

impl StreamingResampler {
    /// A converter from `from` to `to` hertz for `channels` channels.
    ///
    /// # Errors
    ///
    /// Refuses a rate of zero or no channels.
    pub fn new(
        from: u32,
        to: u32,
        channels: usize,
        quality: ResamplingQuality,
    ) -> Result<Self, ResamplerError> {
        if from == 0 || to == 0 {
            return Err(ResamplerError::RateZero);
        }
        if channels == 0 {
            return Err(ResamplerError::NoChannels);
        }
        let divisor = greatest_common_divisor(from, to);
        let kernel = Kernel::new(to / divisor, from / divisor, quality);
        let scratch = vec![0.0; kernel.taps()];
        Ok(Self {
            kernel,
            history: vec![Vec::new(); channels],
            base: 0,
            received: 0,
            finished: false,
            index: 0,
            phase: 0,
            scratch,
        })
    }

    /// Input frames the converter needs past an output sample to produce it.
    #[must_use]
    pub fn lookahead(&self) -> u32 {
        self.kernel.half()
    }

    /// How many channels it converts.
    #[must_use]
    pub fn channels(&self) -> usize {
        self.history.len()
    }

    /// Appends one chunk of planar input, one slice per channel.
    ///
    /// # Errors
    ///
    /// Refuses input once the stream is finished, or input whose channel
    /// count or lengths do not agree.
    pub fn push(&mut self, input: &[&[f32]]) -> Result<(), ResamplerError> {
        let frames = input.first().map_or(0, |channel| channel.len());
        if self.finished
            || input.len() != self.history.len()
            || input.iter().any(|channel| channel.len() != frames)
        {
            return Err(ResamplerError::InputRefused);
        }
        for (kept, arriving) in self.history.iter_mut().zip(input) {
            kept.extend_from_slice(arriving);
        }
        self.received += frames as u64;
        Ok(())
    }

    /// Marks the end of the input, so the frames it needed past the last
    /// sample are taken as silence and the rest of the output can be pulled.
    pub fn finish(&mut self) {
        self.finished = true;
    }

    /// Whether every output sample has been pulled.
    #[must_use]
    pub fn is_drained(&self) -> bool {
        self.finished && self.index >= self.received
    }

    /// Writes as many output frames as are ready, up to the length of the
    /// output slices, and answers how many it wrote.
    pub fn pull(&mut self, output: &mut [&mut [f32]]) -> usize {
        let capacity = output.first().map_or(0, |channel| channel.len());
        let half = u64::from(self.kernel.half());
        let mut written = 0;
        while written < capacity && self.ready(half) {
            self.write_sample(output, written);
            self.advance();
            written += 1;
        }
        self.forget_consumed(half);
        written
    }

    /// Whether the next output sample can be produced.
    fn ready(&self, half: u64) -> bool {
        if self.finished {
            self.index < self.received
        } else {
            self.index + half < self.received
        }
    }

    /// Computes the next output sample of every channel into `output[..][at]`.
    ///
    /// For each channel, `Σ x[i − n] · h[n]` for `n` from `−K` to `K` in that
    /// order, in `f64`, rounded once to `f32`; an index before the start or
    /// past the end of a finished stream reads silence.
    fn write_sample(&mut self, output: &mut [&mut [f32]], at: usize) {
        let taps = self.kernel.phase_taps(self.phase, &mut self.scratch);
        let half = i64::from(self.kernel.half());
        #[allow(
            clippy::cast_possible_wrap,
            reason = "stream positions stay far below 2^63"
        )]
        let (centre, base, received) = (self.index as i64, self.base as i64, self.received as i64);
        for (channel, target) in self.history.iter().zip(output.iter_mut()) {
            let mut sum = 0.0_f64;
            for (tap, n) in taps.iter().zip(-half..=half) {
                let source = centre - n;
                if source >= 0 && source < received {
                    #[allow(
                        clippy::cast_sign_loss,
                        clippy::cast_possible_truncation,
                        reason = "source is at or after base and inside the history"
                    )]
                    let sample = channel[(source - base) as usize];
                    sum += f64::from(sample) * tap;
                }
            }
            #[allow(
                clippy::cast_possible_truncation,
                reason = "rounding to the working precision is the intent"
            )]
            let rounded = sum as f32;
            target[at] = rounded;
        }
    }

    /// Moves to the next output position: `φ += M`, carrying whole inputs into `i`.
    fn advance(&mut self) {
        let step = self.kernel.output_step();
        let next = self.phase + self.kernel.input_step();
        self.index += u64::from(next / step);
        self.phase = next % step;
    }

    /// Drops the input no later output sample can read: everything before
    /// `i − K`.
    fn forget_consumed(&mut self, half: u64) {
        let keep_from = self.index.saturating_sub(half);
        if keep_from <= self.base {
            return;
        }
        #[allow(
            clippy::cast_possible_truncation,
            reason = "bounded by the history's length"
        )]
        let drop = (keep_from - self.base).min(self.received - self.base) as usize;
        for channel in &mut self.history {
            channel.drain(..drop);
        }
        self.base += drop as u64;
    }
}

#[cfg(test)]
mod tests {
    // Each exact comparison here is the point: the canonical rule promises
    // these bits, not values near them.
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use audiogubbins_dsp_core::SineOscillator;

    use super::{ResamplerError, StreamingResampler};
    use crate::quality::ResamplingQuality;

    /// Converts `input` in chunks of `input_chunk`, pulling in `output_chunk`.
    fn convert(
        input: &[f32],
        from: u32,
        to: u32,
        quality: ResamplingQuality,
        input_chunk: usize,
        output_chunk: usize,
    ) -> Vec<f32> {
        let mut resampler = StreamingResampler::new(from, to, 1, quality).expect("valid");
        let mut output = Vec::new();
        let mut buffer = vec![0.0_f32; output_chunk];
        let mut drain = |resampler: &mut StreamingResampler, output: &mut Vec<f32>| loop {
            let written = resampler.pull(&mut [&mut buffer[..]]);
            output.extend_from_slice(&buffer[..written]);
            if written < output_chunk {
                break;
            }
        };
        for chunk in input.chunks(input_chunk) {
            resampler.push(&[chunk]).expect("accepted");
            drain(&mut resampler, &mut output);
        }
        resampler.finish();
        drain(&mut resampler, &mut output);
        assert!(resampler.is_drained());
        output
    }

    fn ramp(frames: usize) -> Vec<f32> {
        #[allow(
            clippy::cast_precision_loss,
            reason = "a test signal of small integers"
        )]
        (0..frames)
            .map(|index| ((index % 97) as f32 - 48.0) / 64.0)
            .collect()
    }

    #[test]
    fn writes_the_same_bits_whatever_the_chunks() {
        let input = ramp(5_000);
        let whole = convert(
            &input,
            44_100,
            48_000,
            ResamplingQuality::High,
            5_000,
            8_192,
        );
        let pieces = convert(&input, 44_100, 48_000, ResamplingQuality::High, 37, 13);
        assert_eq!(whole, pieces);
    }

    #[test]
    fn writes_the_input_length_times_the_ratio_rounded_up() {
        let input = ramp(1_000);
        assert_eq!(
            convert(&input, 44_100, 48_000, ResamplingQuality::Draft, 64, 64).len(),
            1_089
        );
        assert_eq!(
            convert(&input, 48_000, 44_100, ResamplingQuality::Draft, 64, 64).len(),
            919
        );
        assert_eq!(
            convert(&input, 48_000, 48_000, ResamplingQuality::Draft, 64, 64).len(),
            1_000
        );
    }

    #[test]
    fn passes_a_constant_at_unity_away_from_the_ends() {
        let input = vec![0.25_f32; 4_000];
        let output = convert(&input, 32_000, 48_000, ResamplingQuality::Maximum, 512, 512);
        for sample in &output[500..5_000] {
            assert!((sample - 0.25).abs() < 1.0e-6, "{sample}");
        }
    }

    #[test]
    fn copies_audio_exactly_between_equal_rates() {
        let input = ramp(600);
        let output = convert(&input, 48_000, 48_000, ResamplingQuality::Maximum, 100, 100);
        assert_eq!(input, output);
    }

    /// The peak of `output` away from its first and last `margin` frames.
    fn inner_peak(output: &[f32], margin: usize) -> f32 {
        output[margin..output.len() - margin]
            .iter()
            .fold(0.0, |peak, sample| peak.max(sample.abs()))
    }

    fn tone(frequency: f64, rate: u32, frames: usize) -> Vec<f32> {
        let mut samples = vec![0.0_f32; frames];
        SineOscillator::new(frequency, rate, 0.0, 1.0)
            .expect("valid")
            .render(&mut samples);
        samples
    }

    #[test]
    fn passes_a_tone_in_the_passband_at_its_level() {
        let input = tone(1_000.0, 44_100, 22_050);
        let output = convert(
            &input,
            44_100,
            48_000,
            ResamplingQuality::Maximum,
            1_024,
            1_024,
        );
        let peak = inner_peak(&output, 2_000);
        assert!((peak - 1.0).abs() < 1.0e-4, "{peak}");
    }

    #[test]
    fn stops_a_tone_above_the_new_nyquist_frequency() {
        // 20 kHz cannot exist at 24 kHz; at maximum quality it must be gone
        // to below -120 dB rather than folded back as an alias.
        let input = tone(20_000.0, 48_000, 24_000);
        let output = convert(
            &input,
            48_000,
            24_000,
            ResamplingQuality::Maximum,
            1_024,
            1_024,
        );
        let peak = inner_peak(&output, 2_000);
        assert!(peak < 1.0e-6, "{peak}");
    }

    #[test]
    fn keeps_channels_aligned_and_separate() {
        let mut resampler =
            StreamingResampler::new(44_100, 48_000, 3, ResamplingQuality::Draft).expect("valid");
        let left = ramp(300);
        let silence = vec![0.0_f32; 300];
        let negated: Vec<f32> = left.iter().map(|sample| -sample).collect();
        resampler
            .push(&[&left, &silence, &negated])
            .expect("accepted");
        resampler.finish();
        let (mut a, mut b, mut c) = (vec![0.0; 400], vec![0.0; 400], vec![0.0; 400]);
        let written = resampler.pull(&mut [&mut a, &mut b, &mut c]);
        assert_eq!(written, 327);
        assert!(b[..written].iter().all(|sample| *sample == 0.0));
        assert!(a[..written].iter().zip(&c).all(|(x, y)| *x == -*y));
    }

    #[test]
    fn refuses_what_it_cannot_convert() {
        assert_eq!(
            StreamingResampler::new(0, 48_000, 1, ResamplingQuality::Draft).unwrap_err(),
            ResamplerError::RateZero
        );
        assert_eq!(
            StreamingResampler::new(48_000, 44_100, 0, ResamplingQuality::Draft).unwrap_err(),
            ResamplerError::NoChannels
        );
        let mut resampler =
            StreamingResampler::new(48_000, 44_100, 2, ResamplingQuality::Draft).expect("valid");
        assert_eq!(
            resampler.push(&[&[0.0]]).unwrap_err(),
            ResamplerError::InputRefused
        );
        assert_eq!(
            resampler.push(&[&[0.0], &[0.0, 0.0]]).unwrap_err(),
            ResamplerError::InputRefused
        );
        resampler.finish();
        assert_eq!(
            resampler.push(&[&[0.0], &[0.0]]).unwrap_err(),
            ResamplerError::InputRefused
        );
    }

    #[test]
    fn gives_the_golden_conversion_the_reference_path_is_held_to() {
        let input = ramp(2_000);
        let output = convert(&input, 44_100, 48_000, ResamplingQuality::Maximum, 300, 256);
        let hash = fingerprint(&output);
        assert_eq!(hash, GOLDEN_CONVERSION, "{hash:#x}");
    }

    /// FNV-1a over each sample's bits, little-endian, as the TypeScript tests
    /// compute it.
    fn fingerprint(samples: &[f32]) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for sample in samples {
            for byte in sample.to_bits().to_le_bytes() {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        hash
    }

    /// The ramp of 2 000 frames, 44.1 kHz to 48 kHz at maximum quality.
    const GOLDEN_CONVERSION: u64 = 0x07bc_2c6d_5a22_da3f;
}
