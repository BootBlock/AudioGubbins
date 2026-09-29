//! The quality levels of the canonical resampler.

/// How much the resampler spends to keep the passband flat and the stopband
/// deep. `Maximum` is the default for a final render (ADR-0003).
///
/// Each level names a passband edge and a stopband floor, and the filter is
/// designed from them: its transition band runs from the passband edge to the
/// lower of the two Nyquist frequencies, so nothing above that frequency can
/// fold back as an alias or survive as an image louder than the floor.
///
/// - `Maximum`: flat within 0.00001 dB to 97 % of the lower Nyquist
///   frequency, and at least 140 dB down from it on.
/// - `High`: flat within 0.0001 dB to 95 %, at least 100 dB down.
/// - `Draft`: flat within 0.01 dB to 90 %, at least 60 dB down, for previews.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResamplingQuality {
    /// The default of a final render.
    Maximum,
    /// Near the maximum, for less work.
    High,
    /// For previews.
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

    /// Where the passband ends, as a share of the lower Nyquist frequency.
    #[must_use]
    pub fn passband_edge(self) -> f64 {
        match self {
            Self::Maximum => 0.97,
            Self::High => 0.95,
            Self::Draft => 0.9,
        }
    }

    /// The attenuation, in decibels, Kaiser's formulas are asked for.
    ///
    /// Above the floor each level promises, because the formulas are
    /// empirical fits that fall a few decibels short of what they are asked
    /// for, most of all above 120 dB. These margins put every level's
    /// measured floor past its promise, which the tests of both paths hold.
    #[must_use]
    pub fn design_attenuation(self) -> f64 {
        match self {
            Self::Maximum => 146.0,
            Self::High => 103.0,
            Self::Draft => 63.0,
        }
    }

    /// The Kaiser window's shape for [`Self::design_attenuation`]:
    /// `0.1102 · (A − 8.7)`, Kaiser's formula for an attenuation above 50 dB,
    /// which every level's is.
    #[must_use]
    pub fn beta(self) -> f64 {
        0.1102 * (self.design_attenuation() - 8.7)
    }
}
