//! Whether an AAC stream is HE-AAC: AAC-LC with spectral band replication
//! (SBR), and with parametric stereo (PS) in HE-AACv2.
//!
//! No decoder in the module decodes SBR, and Symphonia's AAC decoder decodes
//! an HE-AAC stream whose SBR is signalled implicitly as plain AAC-LC at half
//! the rate, so the module recognises HE-AAC itself and describes it as
//! `he-aac`, never decoding it (ADR-0091; the browser's decoder serves it).
//!
//! SBR is signalled in one of three ways (ISO/IEC 14496-3, section 1.6.5):
//! explicitly and hierarchically, by an audio object type of 5 or 29 in the
//! `AudioSpecificConfig`; explicitly and backward-compatibly, by the sync
//! extension `0x2b7` after an AAC-LC configuration; or implicitly, by SBR
//! data in a fill element of every raw data block, with nothing in any
//! header. The first two are read here from the configuration; the third
//! from the first packets, by [`block_carries_sbr`].

/// What an AAC stream's configuration and packets say it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AacForm {
    /// AAC-LC, decoded by Symphonia.
    LowComplexity,
    /// HE-AAC: the rate it decodes to, and whether parametric stereo makes
    /// two channels of one.
    HighEfficiency {
        /// The output rate, twice the core's where SBR doubles it.
        rate: u32,
        /// Whether parametric stereo is stated.
        parametric_stereo: bool,
    },
    /// Another audio object type, or a configuration that cannot be read.
    Other,
}

/// The audio object types the configuration names.
const AOT_LC: u32 = 2;
const AOT_SBR: u32 = 5;
const AOT_PS: u32 = 29;

/// The sync words of the backward-compatible extensions.
const SBR_SYNC: u32 = 0x2b7;
const PS_SYNC: u32 = 0x548;

/// The sampling frequency index's rates (Table 1.18).
const RATES: [u32; 13] = [
    96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000,
    7_350,
];

/// The highest core rate at which SBR doubles the output rate.
const MAX_DOUBLED_CORE_RATE: u32 = 24_000;

/// Bits read most significant first.
struct Bits<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Bits<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    const fn left(&self) -> usize {
        (self.bytes.len() * 8).saturating_sub(self.at)
    }

    /// The `count` bits at `at`, at most 32, or `None` past the end.
    fn peek_at(&self, at: usize, count: usize) -> Option<u32> {
        if count > 32 || at.checked_add(count)? > self.bytes.len() * 8 {
            return None;
        }
        let mut value = 0u32;
        for bit in at..at + count {
            let byte = self.bytes[bit / 8];
            value = (value << 1) | u32::from((byte >> (7 - bit % 8)) & 1);
        }
        Some(value)
    }

    fn read(&mut self, count: usize) -> Option<u32> {
        let value = self.peek_at(self.at, count)?;
        self.at += count;
        Some(value)
    }

    fn object_type(&mut self) -> Option<u32> {
        match self.read(5)? {
            31 => Some(32 + self.read(6)?),
            other => Some(other),
        }
    }

    fn rate(&mut self) -> Option<u32> {
        match self.read(4)? {
            15 => self.read(24),
            index => RATES.get(usize::try_from(index).ok()?).copied(),
        }
    }
}

/// The rate SBR decodes a core of `core` frames a second to.
const fn sbr_rate(core: u32) -> u32 {
    if core <= MAX_DOUBLED_CORE_RATE {
        core * 2
    } else {
        core
    }
}

/// What an `AudioSpecificConfig` states, from its bytes.
#[must_use]
pub fn form_of_config(config: &[u8]) -> AacForm {
    read_config(config).unwrap_or(AacForm::Other)
}

fn read_config(config: &[u8]) -> Option<AacForm> {
    let mut bits = Bits::new(config);
    let mut object_type = bits.object_type()?;
    // The core's rate; SBR's own follows where it is stated.
    bits.rate()?;
    let channel_configuration = bits.read(4)?;
    if object_type == AOT_SBR || object_type == AOT_PS {
        let rate = bits.rate()?;
        return Some(AacForm::HighEfficiency {
            rate,
            parametric_stereo: object_type == AOT_PS,
        });
    }
    if object_type != AOT_LC {
        return Some(AacForm::Other);
    }
    // GASpecificConfig: frame length, core coder dependency and extension
    // flags. A configuration of channel configuration 0 states its channels
    // in a program configuration element, which no decoder here reads, so
    // what follows it is never reached.
    if channel_configuration == 0 {
        return Some(AacForm::Other);
    }
    bits.read(1)?;
    if bits.read(1)? == 1 {
        bits.read(14)?;
    }
    bits.read(1)?;
    if bits.left() >= 16 && bits.read(11)? == SBR_SYNC {
        object_type = bits.object_type()?;
        if object_type == AOT_SBR && bits.read(1)? == 1 {
            let rate = bits.rate()?;
            let parametric_stereo =
                bits.left() >= 12 && bits.read(11)? == PS_SYNC && bits.read(1)? == 1;
            return Some(AacForm::HighEfficiency {
                rate,
                parametric_stereo,
            });
        }
    }
    Some(AacForm::LowComplexity)
}

/// The form an implicitly signalled stream of core rate `core_rate` takes
/// once its packets are found to carry SBR.
#[must_use]
pub const fn implicit_form(core_rate: u32) -> AacForm {
    AacForm::HighEfficiency {
        rate: sbr_rate(core_rate),
        parametric_stereo: false,
    }
}

/// The syntactic element of a fill element (Table 4.85, `ID_FIL`).
const ID_FIL: u32 = 6;
/// The syntactic element that ends a raw data block (`ID_END`).
const ID_END: u32 = 7;
/// The extension payloads that carry SBR data (Table 4.121).
const EXT_SBR_DATA: u32 = 0xd;
const EXT_SBR_DATA_CRC: u32 = 0xe;

/// Fill elements that may follow the SBR one, before the block's end.
const MAX_TRAILING_FILLS: usize = 3;

/// Whether a raw data block carries SBR data: whether it ends, before its
/// byte alignment, with a fill element of SBR data followed by at most a few
/// other fill elements and `ID_END`.
///
/// Reaching the fill elements from the start means parsing every channel
/// element's spectral data, so they are found from the end instead: a fill
/// element states its length, so each candidate is checked to end exactly
/// where the next element begins. A block of AAC-LC passes this check by
/// chance about once in seventy, so [`ImplicitSbrSearch`] asks it of several
/// packets.
#[must_use]
pub fn block_carries_sbr(block: &[u8]) -> bool {
    let bits = Bits::new(block);
    let total = block.len() * 8;
    // `ID_END`, then fewer than eight bits of alignment.
    (total.saturating_sub(10)..=total.saturating_sub(3))
        .filter(|&end| {
            end + 3 <= total && total - end - 3 < 8 && bits.peek_at(end, 3) == Some(ID_END)
        })
        .any(|end| fill_ends_at(&bits, end, MAX_TRAILING_FILLS))
}

/// Whether a chain of fill elements, the first of SBR data, ends at `next`.
fn fill_ends_at(bits: &Bits<'_>, next: usize, others: usize) -> bool {
    // A fill element: `ID_FIL`, a 4-bit count, and where the count is 15, an
    // 8-bit escape adding to it less one; then that many bytes.
    let short = (0..15u32).filter_map(|count| {
        let start = next.checked_sub(7 + 8 * count as usize)?;
        (bits.peek_at(start + 3, 4)? == count).then_some((start, 7, count))
    });
    let long = (0..256u32).filter_map(|escape| {
        let count = 15 + escape - 1;
        let start = next.checked_sub(15 + 8 * count as usize)?;
        (bits.peek_at(start + 3, 4)? == 15 && bits.peek_at(start + 7, 8)? == escape)
            .then_some((start, 15, count))
    });
    short.chain(long).any(|(start, header, count)| {
        if bits.peek_at(start, 3) != Some(ID_FIL) {
            return false;
        }
        let payload = bits.peek_at(start + header, 4);
        let sbr = count > 0 && matches!(payload, Some(EXT_SBR_DATA | EXT_SBR_DATA_CRC));
        sbr || (others > 0 && fill_ends_at(bits, start, others - 1))
    })
}

/// Packets examined for implicit SBR before a stream is taken as AAC-LC.
pub const SEARCHED_PACKETS: usize = 8;

/// Of [`SEARCHED_PACKETS`], how many must carry SBR: every frame of an
/// HE-AAC stream does, and allowing two that do not leaves room for an
/// encoder's first frame of other data, while AAC-LC passes this by chance
/// fewer than once in a billion streams.
const NEEDED_PACKETS: usize = 6;

/// The search of a stream's first packets for implicit SBR.
#[derive(Default)]
pub struct ImplicitSbrSearch {
    examined: usize,
    found: usize,
}

impl ImplicitSbrSearch {
    /// Examines one more packet.
    pub fn examine(&mut self, block: &[u8]) {
        self.examined += 1;
        if block_carries_sbr(block) {
            self.found += 1;
        }
    }

    /// Whether enough packets have been examined to decide.
    #[must_use]
    pub const fn decided(&self) -> bool {
        self.examined >= SEARCHED_PACKETS
    }

    /// Whether the packets examined carry SBR. A stream of fewer packets
    /// than the search needs is held to the same share of them.
    #[must_use]
    pub const fn carries_sbr(&self) -> bool {
        self.examined > 0 && self.found * SEARCHED_PACKETS >= NEEDED_PACKETS * self.examined
    }
}

#[cfg(test)]
mod tests {
    use super::{AacForm, ImplicitSbrSearch, block_carries_sbr, form_of_config};

    /// Bits written most significant first.
    #[derive(Default)]
    struct Writer {
        bits: Vec<bool>,
    }

    impl Writer {
        fn put(&mut self, value: u32, count: usize) -> &mut Self {
            for bit in (0..count).rev() {
                self.bits.push((value >> bit) & 1 == 1);
            }
            self
        }

        fn bytes(&self) -> Vec<u8> {
            self.bits
                .chunks(8)
                .map(|chunk| {
                    chunk.iter().enumerate().fold(0u8, |byte, (index, &bit)| {
                        byte | (u8::from(bit) << (7 - index))
                    })
                })
                .collect()
        }
    }

    /// A configuration of AAC-LC at 24 kHz in stereo, and what follows it.
    fn lc_config() -> Writer {
        let mut writer = Writer::default();
        writer.put(2, 5).put(6, 4).put(2, 4).put(0, 3);
        writer
    }

    #[test]
    fn reads_each_way_a_configuration_states_its_form() {
        assert_eq!(form_of_config(&lc_config().bytes()), AacForm::LowComplexity);

        // Hierarchical: object type 5, core 24 kHz, extension 48 kHz, then AAC-LC.
        let mut hierarchical = Writer::default();
        hierarchical
            .put(5, 5)
            .put(6, 4)
            .put(1, 4)
            .put(3, 4)
            .put(2, 5)
            .put(0, 3);
        assert_eq!(
            form_of_config(&hierarchical.bytes()),
            AacForm::HighEfficiency {
                rate: 48_000,
                parametric_stereo: false
            }
        );

        // Backward compatible: the sync extension with SBR and then PS.
        let mut compatible = lc_config();
        compatible
            .put(0x2b7, 11)
            .put(5, 5)
            .put(1, 1)
            .put(3, 4)
            .put(0x548, 11)
            .put(1, 1);
        assert_eq!(
            form_of_config(&compatible.bytes()),
            AacForm::HighEfficiency {
                rate: 48_000,
                parametric_stereo: true
            }
        );

        let mut main = Writer::default();
        main.put(1, 5).put(3, 4).put(2, 4).put(0, 3);
        assert_eq!(form_of_config(&main.bytes()), AacForm::Other);
        assert_eq!(form_of_config(&[]), AacForm::Other);
    }

    /// A raw data block: `prefix` bits standing for the channel elements,
    /// then the fill elements given as (count, first payload nibble), then
    /// `ID_END` and alignment.
    fn block(prefix: usize, fills: &[(u32, u32)]) -> Vec<u8> {
        let mut writer = Writer::default();
        for bit in 0..prefix {
            writer.put(u32::from(bit % 3 == 0), 1);
        }
        for &(count, nibble) in fills {
            writer.put(6, 3);
            if count >= 15 {
                writer.put(15, 4).put(count - 14, 8);
            } else {
                writer.put(count, 4);
            }
            if count > 0 {
                writer.put(nibble, 4).put(0xa, 4);
                for _ in 1..count {
                    writer.put(0x5a, 8);
                }
            }
        }
        writer.put(7, 3);
        writer.bytes()
    }

    #[test]
    fn finds_sbr_data_in_a_fill_element_at_the_end_of_a_block() {
        assert!(block_carries_sbr(&block(301, &[(9, 0xd)])));
        assert!(block_carries_sbr(&block(77, &[(40, 0xe)])));
        assert!(block_carries_sbr(&block(
            130,
            &[(12, 0xd), (3, 0x0), (0, 0)]
        )));
        assert!(!block_carries_sbr(&block(301, &[(9, 0x1)])));
        assert!(!block_carries_sbr(&block(301, &[])));
        assert!(!block_carries_sbr(&[]));
    }

    #[test]
    fn decides_from_most_of_the_first_packets() {
        let sbr = block(200, &[(10, 0xd)]);
        let plain = block(200, &[(10, 0x1)]);
        let mut search = ImplicitSbrSearch::default();
        for index in 0..8 {
            search.examine(if index < 2 { &plain } else { &sbr });
        }
        assert!(search.decided());
        assert!(search.carries_sbr());
        // Half the packets is chance, not SBR.
        let mut lc = ImplicitSbrSearch::default();
        for index in 0..8 {
            lc.examine(if index < 4 { &plain } else { &sbr });
        }
        assert!(!lc.carries_sbr());
    }
}
