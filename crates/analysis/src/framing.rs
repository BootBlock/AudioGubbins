//! Frames of a planar stream: samples pushed in any chunks, read back as
//! frames of one size that start a fixed hop apart.
//!
//! Frame `k` is the `size` samples from sample `k · hop` of the stream, the
//! first frame starting at the stream's first sample, and is ready once its
//! last sample has been pushed. Positions are whole sample counts, so no
//! frame's position is ever rounded, and a frame holds the same samples
//! however the stream arrived. The samples are kept until every frame that
//! reads them has been read: the memory held is what was pushed and not yet
//! framed, which a caller reading frames as it pushes keeps to a frame and a
//! chunk.

use crate::error::AnalysisError;

/// Frames of `size` samples a `hop` apart over a planar stream.
#[derive(Debug, Clone)]
pub(crate) struct Framing {
    size: usize,
    hop: usize,
    /// Each channel's samples from absolute sample `start` on.
    held: Vec<Vec<f32>>,
    start: u64,
    /// Where the next frame starts, at or after `start`.
    next: u64,
}

impl Framing {
    /// Frames of `size` samples `hop` apart over `channels` channels; the
    /// caller has checked `0 < hop ≤ size` and the channel count.
    pub(crate) fn new(channels: usize, size: usize, hop: usize) -> Self {
        Self {
            size,
            hop,
            held: (0..channels)
                .map(|_| Vec::with_capacity(2 * size))
                .collect(),
            start: 0,
            next: 0,
        }
    }

    pub(crate) fn channels(&self) -> usize {
        self.held.len()
    }

    pub(crate) const fn size(&self) -> usize {
        self.size
    }

    /// Appends `frames` frames of planar samples: channel `c` is
    /// `planar[c · frames .. (c + 1) · frames]`.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ShapeRefused`] unless `planar` is `channels · frames`
    /// long, having appended nothing.
    pub(crate) fn push(&mut self, planar: &[f32], frames: usize) -> Result<(), AnalysisError> {
        check_planar(planar, self.held.len(), frames)?;
        if frames == 0 {
            return Ok(());
        }
        for (kept, arriving) in self.held.iter_mut().zip(planar.chunks_exact(frames)) {
            kept.extend_from_slice(arriving);
        }
        Ok(())
    }

    /// Whether the next frame's last sample has been pushed.
    pub(crate) fn ready(&self) -> bool {
        let held = self.held.first().map_or(0, Vec::len) as u64;
        self.next + self.size as u64 <= self.start + held
    }

    /// The absolute position of the next frame's first sample.
    pub(crate) const fn position(&self) -> u64 {
        self.next
    }

    /// The next frame of `channel`, which [`Self::ready`] has said is ready.
    pub(crate) fn frame(&self, channel: usize) -> &[f32] {
        // At most a frame's size past `start`, so it fits in a usize.
        let from = usize::try_from(self.next - self.start).unwrap_or(usize::MAX);
        self.held
            .get(channel)
            .and_then(|samples| samples.get(from..from.saturating_add(self.size)))
            .unwrap_or(&[])
    }

    /// Moves to the frame after the next, and forgets the samples no frame
    /// will read once a frame's worth of them has gathered, so the copy that
    /// forgets them is paid once a frame at most.
    pub(crate) fn advance(&mut self) {
        self.next += self.hop as u64;
        let consumed = usize::try_from(self.next - self.start).unwrap_or(usize::MAX);
        if consumed >= self.size {
            for samples in &mut self.held {
                samples.drain(..consumed.min(samples.len()));
            }
            self.start = self.next;
        }
    }
}

/// [`AnalysisError::ShapeRefused`] unless `planar` holds exactly `frames`
/// samples of each of `channels` channels.
pub(crate) fn check_planar(
    planar: &[f32],
    channels: usize,
    frames: usize,
) -> Result<(), AnalysisError> {
    if channels.checked_mul(frames) == Some(planar.len()) {
        Ok(())
    } else {
        Err(AnalysisError::ShapeRefused)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "whole numbers, exact in an f32")]

    use super::Framing;
    use crate::error::AnalysisError;

    #[test]
    fn gives_frames_a_hop_apart_however_the_stream_arrives() {
        let samples: Vec<f32> = (0..40_u8).map(f32::from).collect();
        for chunk in [1, 3, 7, 40] {
            let mut framing = Framing::new(1, 8, 3);
            let mut starts = Vec::new();
            for piece in samples.chunks(chunk) {
                framing.push(piece, piece.len()).expect("one channel");
                while framing.ready() {
                    let frame = framing.frame(0);
                    assert_eq!(frame.len(), 8);
                    // Each sample is its own position, so a frame's first
                    // sample says where it starts.
                    assert_eq!(f64::from(frame[0]), crate::exact_u64(framing.position()));
                    starts.push(framing.position());
                    framing.advance();
                }
            }
            assert_eq!(starts, [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30], "{chunk}");
        }
    }

    #[test]
    fn refuses_planar_samples_of_the_wrong_length() {
        let mut framing = Framing::new(2, 4, 4);
        assert_eq!(framing.push(&[0.0; 5], 3), Err(AnalysisError::ShapeRefused));
        assert!(!framing.ready());
        assert_eq!(framing.push(&[0.0; 8], 4), Ok(()));
        assert!(framing.ready());
        assert_eq!(framing.push(&[], 0), Ok(()));
    }
}
