//! Decoded frames waiting to be given out, after the trimming the container
//! states for the stream as a whole.
//!
//! A packet decodes to as many frames as its codec gives, which need not fit
//! the block a caller asks for, so what is left waits here. The trimming of a
//! container that states the encoder's priming and the stream's length
//! outside its packets (an MP4 edit list, or the pre-skip of Opus in
//! Matroska) is applied here, as frames arrive.

use crate::track_decoder::Decoded;

/// Frames a queue keeps before the ones given out are dropped from its front.
const COMPACT_AFTER: usize = 1 << 16;

/// Decoded planar frames in order.
pub struct PlanarQueue {
    planes: Vec<Vec<f32>>,
    /// Frames of each plane already given out.
    given: usize,
    /// Frames still to drop from the stream's start.
    skip: u64,
    /// Frames still to keep, where the container states the stream's length.
    remaining: Option<u64>,
}

impl PlanarQueue {
    /// A queue of `channels` planes, which drops the stream's first `skip`
    /// frames and keeps at most `length` after them.
    #[must_use]
    pub fn new(channels: usize, skip: u64, length: Option<u64>) -> Self {
        Self {
            planes: vec![Vec::new(); channels],
            given: 0,
            skip,
            remaining: length,
        }
    }

    /// Frames waiting to be given out.
    #[must_use]
    pub fn waiting(&self) -> usize {
        self.planes
            .first()
            .map_or(0, |plane| plane.len() - self.given)
    }

    /// Whether the stream's stated length has been reached, so nothing more
    /// it decodes will be kept.
    #[must_use]
    pub const fn complete(&self) -> bool {
        matches!(self.remaining, Some(0))
    }

    /// Appends what a packet decoded to, less the frames the stream's own
    /// trimming drops.
    pub fn push(&mut self, decoded: &Decoded<'_>) {
        let mut range = decoded.frames.clone();
        let dropped = usize::try_from(self.skip)
            .unwrap_or(usize::MAX)
            .min(range.len());
        range.start += dropped;
        self.skip -= dropped as u64;
        if let Some(remaining) = self.remaining.as_mut() {
            let kept = usize::try_from(*remaining)
                .unwrap_or(usize::MAX)
                .min(range.len());
            range.end = range.start + kept;
            *remaining -= kept as u64;
        }
        for (plane, source) in self.planes.iter_mut().zip(decoded.planes) {
            plane.extend_from_slice(&source[range.clone()]);
        }
    }

    /// Moves up to `capacity` frames into `planes`, one slice per channel of
    /// at least `capacity` samples, answering how many moved.
    pub fn take_into<'a>(
        &mut self,
        capacity: usize,
        planes: impl Iterator<Item = &'a mut [f32]>,
    ) -> usize {
        let frames = self.waiting().min(capacity);
        let range = self.given..self.given + frames;
        for (into, plane) in planes.zip(&self.planes) {
            into[..frames].copy_from_slice(&plane[range.clone()]);
        }
        self.given += frames;
        if self.given == self.planes.first().map_or(0, Vec::len) {
            self.planes.iter_mut().for_each(Vec::clear);
            self.given = 0;
        } else if self.given >= COMPACT_AFTER {
            let given = self.given;
            self.planes.iter_mut().for_each(|plane| {
                plane.drain(..given);
            });
            self.given = 0;
        }
        frames
    }
}

#[cfg(test)]
#[allow(
    clippy::cast_precision_loss,
    reason = "ramps of a few frames, exact in an f32"
)]
mod tests {
    use super::PlanarQueue;
    use crate::track_decoder::Decoded;

    fn ramp(from: f32, frames: usize) -> Vec<Vec<f32>> {
        let plane: Vec<f32> = (0..frames).map(|frame| from + frame as f32).collect();
        vec![plane.clone(), plane.iter().map(|sample| -sample).collect()]
    }

    fn take(queue: &mut PlanarQueue, capacity: usize) -> Vec<Vec<f32>> {
        let mut out = vec![vec![0.0; capacity]; 2];
        let frames = queue.take_into(capacity, out.iter_mut().map(Vec::as_mut_slice));
        for plane in &mut out {
            plane.truncate(frames);
        }
        out
    }

    #[test]
    fn drops_the_stated_priming_and_keeps_the_stated_length_across_packets() {
        let mut queue = PlanarQueue::new(2, 6, Some(7));
        for packet in 0..4 {
            let planes = ramp(packet as f32 * 4.0, 4);
            queue.push(&Decoded {
                planes: &planes,
                frames: 0..4,
            });
        }
        assert!(queue.complete());
        assert_eq!(queue.waiting(), 7);
        assert_eq!(take(&mut queue, 5)[0], vec![6.0, 7.0, 8.0, 9.0, 10.0]);
        let rest = take(&mut queue, 5);
        assert_eq!(rest[0], vec![11.0, 12.0]);
        assert_eq!(rest[1], vec![-11.0, -12.0]);
        assert_eq!(queue.waiting(), 0);
    }

    #[test]
    fn keeps_only_the_frames_a_packet_presents() {
        let mut queue = PlanarQueue::new(2, 0, None);
        let planes = ramp(0.0, 8);
        queue.push(&Decoded {
            planes: &planes,
            frames: 3..6,
        });
        assert_eq!(take(&mut queue, 8)[0], vec![3.0, 4.0, 5.0]);
    }
}
