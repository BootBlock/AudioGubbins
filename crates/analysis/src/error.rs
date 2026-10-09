//! Why an analysis object cannot be made or fed.

/// Why an analysis object cannot be made or fed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalysisError {
    /// There are no channels, or more than [`crate::MOST_CHANNELS`].
    ChannelsRefused,
    /// The sample rate is outside what the object measures.
    RateRefused,
    /// A setting is outside its stated range: a size, a hop, a window or a
    /// threshold.
    SettingRefused,
    /// Input or output is not the shape the object reads or writes: planar
    /// samples not `channels · frames` long, or an output of the wrong length.
    ShapeRefused,
}
