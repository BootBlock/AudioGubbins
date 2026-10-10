//! The bits of a FLAC frame, written most significant first, and the two
//! checksums a frame carries (RFC 9639, section 9).

/// The CRC-8 of a frame header: polynomial x⁸ + x² + x + 1, from zero.
const CRC8: [u8; 256] = crc8_table();

/// The CRC-16 of a whole frame: polynomial x¹⁶ + x¹⁵ + x² + 1, from zero.
const CRC16: [u16; 256] = crc16_table();

const fn crc8_table() -> [u8; 256] {
    let mut table = [0u8; 256];
    let mut index = 0;
    while index < 256 {
        #[allow(clippy::cast_possible_truncation, reason = "an index below 256")]
        let mut crc = index as u8;
        let mut bit = 0;
        while bit < 8 {
            crc = if crc & 0x80 == 0 {
                crc << 1
            } else {
                (crc << 1) ^ 0x07
            };
            bit += 1;
        }
        table[index] = crc;
        index += 1;
    }
    table
}

const fn crc16_table() -> [u16; 256] {
    let mut table = [0u16; 256];
    let mut index = 0;
    while index < 256 {
        #[allow(clippy::cast_possible_truncation, reason = "an index below 256")]
        let mut crc = (index as u16) << 8;
        let mut bit = 0;
        while bit < 8 {
            crc = if crc & 0x8000 == 0 {
                crc << 1
            } else {
                (crc << 1) ^ 0x8005
            };
            bit += 1;
        }
        table[index] = crc;
        index += 1;
    }
    table
}

/// The CRC-8 of `bytes`.
#[must_use]
pub fn crc8(bytes: &[u8]) -> u8 {
    bytes
        .iter()
        .fold(0, |crc, &byte| CRC8[usize::from(crc ^ byte)])
}

/// The CRC-16 of `bytes`.
#[must_use]
pub fn crc16(bytes: &[u8]) -> u16 {
    bytes.iter().fold(0, |crc, &byte| {
        (crc << 8) ^ CRC16[usize::from(crc.to_be_bytes()[0] ^ byte)]
    })
}

/// Bits written most significant first into bytes, through a 64-bit
/// accumulator.
#[derive(Default)]
pub struct BitWriter {
    bytes: Vec<u8>,
    pending: u64,
    /// Bits waiting in `pending`, always fewer than 8 between calls.
    count: u32,
}

impl BitWriter {
    /// Empties the writer, keeping its allocation.
    pub fn clear(&mut self) {
        self.bytes.clear();
        self.pending = 0;
        self.count = 0;
    }

    /// The whole bytes written so far.
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Writes the low `bits` bits of `value`, up to 32 of them.
    pub fn put(&mut self, value: u64, bits: u32) {
        debug_assert!(bits <= 32, "at most 32 bits at a time");
        if bits == 0 {
            return;
        }
        let mask = (1u64 << bits) - 1;
        self.pending = (self.pending << bits) | (value & mask);
        self.count += bits;
        while self.count >= 8 {
            self.count -= 8;
            self.bytes
                .push((self.pending >> self.count).to_be_bytes()[7]);
        }
        self.pending &= (1u64 << self.count) - 1;
    }

    /// Writes `value` as a two's complement number of `bits` bits, which it
    /// fits.
    #[allow(
        clippy::cast_sign_loss,
        reason = "the two's complement bits are what is written"
    )]
    pub fn put_signed(&mut self, value: i64, bits: u32) {
        self.put(value as u64, bits);
    }

    /// Writes `count` zero bits.
    pub fn put_zeros(&mut self, mut count: u64) {
        while count > 0 {
            let run = u32::try_from(count.min(32)).unwrap_or(32);
            self.put(0, run);
            count -= u64::from(run);
        }
    }

    /// Writes `quotient` in unary: that many zeros, then a one.
    pub fn put_unary(&mut self, quotient: u64) {
        self.put_zeros(quotient);
        self.put(1, 1);
    }

    /// Pads with zeros to the next whole byte.
    pub fn align(&mut self) {
        if self.count > 0 {
            self.put(0, 8 - self.count);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{BitWriter, crc8, crc16};

    #[test]
    fn checksums_match_their_check_values() {
        // The check values of CRC-8/SMBUS and CRC-16/UMTS (also called
        // CRC-16/BUYPASS), which are FLAC's.
        assert_eq!(crc8(b"123456789"), 0xf4);
        assert_eq!(crc16(b"123456789"), 0xfee8);
    }

    #[test]
    fn writes_bits_most_significant_first() {
        let mut writer = BitWriter::default();
        writer.put(0b101, 3);
        writer.put_unary(2);
        writer.put_signed(-1, 4);
        writer.align();
        writer.put(0xdead_beef, 32);
        assert_eq!(
            writer.bytes(),
            &[0b1010_0111, 0b1100_0000, 0xde, 0xad, 0xbe, 0xef]
        );
    }
}
