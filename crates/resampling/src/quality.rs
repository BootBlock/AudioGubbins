//! The quality levels of the canonical resampler.

/// How much the resampler spends to keep the passband flat and the stopband
/// deep. `Maximum` is the default for a final render (ADR-0003).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResamplingQuality {
    /// 64 zero crossings each side, a window of shape 14: a stopband beyond
    /// 140 dB, flat to 97 % of the lower Nyquist frequency.
    Maximum,
    /// 32 zero crossings, shape 10: about 100 dB, flat to 95 %.
    High,
    /// 8 zero crossings, shape 6: about 60 dB, flat to 90 %, for previews.
    Draft,
}

impl ResamplingQuality {
    /// The level an ABI code names, or `None` for a code that names none.
    #[must_use]
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Maximum),
            1 => Some(Self::High),
            2 => Some(Self::Draft),
            _ => None,
        }
    }

    /// Zero crossings of the sinc on each side of its centre.
    #[must_use]
    pub fn zero_crossings(self) -> u32 {
        match self {
            Self::Maximum => 64,
            Self::High => 32,
            Self::Draft => 8,
        }
    }

    /// The Kaiser window's shape.
    #[must_use]
    pub fn beta(self) -> f64 {
        match self {
            Self::Maximum => 14.0,
            Self::High => 10.0,
            Self::Draft => 6.0,
        }
    }

    /// Where the passband ends, as a share of the lower Nyquist frequency.
    #[must_use]
    pub fn rolloff(self) -> f64 {
        match self {
            Self::Maximum => 0.97,
            Self::High => 0.95,
            Self::Draft => 0.9,
        }
    }
}
