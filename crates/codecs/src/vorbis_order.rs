//! The Vorbis channel order, which Opus's mapping family 1 shares, and the
//! speaker mask order the module answers channels in (ADR-0090: a rendition's
//! channel order is the codec's channel order made the asset's layout).

/// A layout of the Vorbis order: the speakers it places, as a speaker mask,
/// and for each channel in the mask's bit order, the Vorbis channel it is.
pub struct VorbisLayout {
    /// The speakers, as `WAVE_FORMAT_EXTENSIBLE` names them.
    pub mask: u32,
    /// For each channel in mask order, its index in the Vorbis order.
    pub vorbis_index: &'static [usize],
}

const FL: u32 = 1 << 0;
const FR: u32 = 1 << 1;
const FC: u32 = 1 << 2;
const LFE: u32 = 1 << 3;
const BL: u32 = 1 << 4;
const BR: u32 = 1 << 5;
const BC: u32 = 1 << 8;
const SL: u32 = 1 << 9;
const SR: u32 = 1 << 10;

/// The Vorbis I specification's layouts for one to eight channels (section
/// 4.3.9), by channel count less one.
const LAYOUTS: [VorbisLayout; 8] = [
    // Mono.
    VorbisLayout {
        mask: FC,
        vorbis_index: &[0],
    },
    // Left, right.
    VorbisLayout {
        mask: FL | FR,
        vorbis_index: &[0, 1],
    },
    // Left, centre, right.
    VorbisLayout {
        mask: FL | FR | FC,
        vorbis_index: &[0, 2, 1],
    },
    // Front left, front right, rear left, rear right.
    VorbisLayout {
        mask: FL | FR | BL | BR,
        vorbis_index: &[0, 1, 2, 3],
    },
    // Front left, centre, front right, rear left, rear right.
    VorbisLayout {
        mask: FL | FR | FC | BL | BR,
        vorbis_index: &[0, 2, 1, 3, 4],
    },
    // 5.1: front left, centre, front right, rear left, rear right, LFE.
    VorbisLayout {
        mask: FL | FR | FC | LFE | BL | BR,
        vorbis_index: &[0, 2, 1, 5, 3, 4],
    },
    // 6.1: front left, centre, front right, side left, side right, rear
    // centre, LFE.
    VorbisLayout {
        mask: FL | FR | FC | LFE | BC | SL | SR,
        vorbis_index: &[0, 2, 1, 6, 5, 3, 4],
    },
    // 7.1: front left, centre, front right, side left, side right, rear left,
    // rear right, LFE.
    VorbisLayout {
        mask: FL | FR | FC | LFE | BL | BR | SL | SR,
        vorbis_index: &[0, 2, 1, 7, 5, 6, 3, 4],
    },
];

/// The Vorbis layout of `channels` channels, for one to eight.
#[must_use]
pub fn vorbis_layout(channels: usize) -> Option<&'static VorbisLayout> {
    LAYOUTS.get(channels.checked_sub(1)?)
}

#[cfg(test)]
mod tests {
    use super::{LAYOUTS, vorbis_layout};

    #[test]
    fn each_layout_places_one_channel_per_speaker_and_names_each_vorbis_channel_once() {
        for (count, layout) in (1..).zip(&LAYOUTS) {
            assert_eq!(layout.mask.count_ones() as usize, count);
            let mut seen = layout.vorbis_index.to_vec();
            seen.sort_unstable();
            assert_eq!(seen, (0..count).collect::<Vec<_>>());
        }
        assert!(vorbis_layout(0).is_none());
        assert!(vorbis_layout(9).is_none());
    }
}
