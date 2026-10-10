//! A subframe's residual, coded in partitions of Rice codes (RFC 9639,
//! section 9.2.7).
//!
//! The planner gathers each partition's sum and width once, at the finest
//! partition order the block allows, and merges neighbours for every coarser
//! order. Each partition takes the Rice parameter its sum makes cheapest, or
//! the escape code, which writes its residuals in binary where that is
//! smaller. The 5-bit parameters of `RICE2` are used where a parameter past
//! 14 makes the whole residual smaller. A residual is at most 32 bits, as
//! RFC 9639 requires of an encoder, so its folded form fits a `u32` and an
//! escaped partition needs at most 31 bits a sample or is coded by Rice.

use super::bits::BitWriter;

/// The finest partition order any compression level searches.
pub const MAX_PARTITION_ORDER: u32 = 6;

/// The partitions of the finest order.
const MAX_PARTITIONS: usize = 1 << MAX_PARTITION_ORDER;

/// The largest Rice parameter of each method; one more is the escape code.
const RICE_LIMIT: u32 = 14;
const RICE2_LIMIT: u32 = 30;

/// The widest escaped residual the 5-bit width field names.
const ESCAPE_LIMIT: u32 = 31;

/// How one partition is coded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Coding {
    /// Rice codes of this parameter.
    Rice(u32),
    /// Binary, in this many bits a residual; 0 where every one is zero.
    Escaped(u32),
}

/// How a residual is coded, and its size.
#[derive(Clone, Copy, Debug)]
pub struct ResidualPlan {
    order: u32,
    /// Whether the parameters are 5 bits (`RICE2`) rather than 4.
    wide: bool,
    codings: [Coding; MAX_PARTITIONS],
    /// The bits the residual takes, method and order included, at most.
    pub bits: u64,
}

/// One partition's residuals, as the planner sees them.
#[derive(Clone, Copy, Default)]
struct Partition {
    count: u64,
    /// The sum of the folded residuals.
    sum: u64,
    /// The bits of every residual's magnitude, OR-ed, and whether any is
    /// not zero, from which the escaped width follows.
    magnitude: u64,
    nonzero: bool,
}

impl Partition {
    fn merged(self, other: Self) -> Self {
        Self {
            count: self.count + other.count,
            sum: self.sum + other.sum,
            magnitude: self.magnitude | other.magnitude,
            nonzero: self.nonzero || other.nonzero,
        }
    }

    /// The bits a residual takes escaped: its two's complement width.
    fn escaped_width(self) -> u32 {
        if self.nonzero {
            65 - self.magnitude.leading_zeros()
        } else {
            0
        }
    }

    /// The bits the partition's data takes as Rice codes of `parameter`, at
    /// most: each code is a unary quotient, its stop bit and the remainder,
    /// and the quotients sum to no more than the sum shifted.
    fn rice_bits(self, parameter: u32) -> u64 {
        self.count * u64::from(parameter + 1) + (self.sum >> parameter)
    }

    /// The cheapest coding with parameters of `limit` at most, and its bits,
    /// parameter field included.
    fn cheapest(self, limit: u32, field: u32) -> (Coding, u64) {
        let mut best = (Coding::Rice(0), self.rice_bits(0));
        for parameter in 1..=limit {
            let bits = self.rice_bits(parameter);
            if bits < best.1 {
                best = (Coding::Rice(parameter), bits);
            }
        }
        let width = self.escaped_width();
        if width <= ESCAPE_LIMIT {
            let bits = 5 + self.count * u64::from(width);
            if bits < best.1 {
                best = (Coding::Escaped(width), bits);
            }
        }
        (best.0, best.1 + u64::from(field))
    }
}

/// A residual folded to an unsigned number: 0, -1, 1, -2, 2 … to 0, 1, 2, 3, 4 ….
#[allow(
    clippy::cast_sign_loss,
    reason = "the fold is never negative: a negative residual's sign bits are flipped"
)]
const fn folded(residual: i64) -> u64 {
    ((residual << 1) ^ (residual >> 63)) as u64
}

/// A residual's magnitude in the bits a two's complement number of it
/// needs, less its sign: the residual itself, or its complement where
/// negative.
#[allow(clippy::cast_sign_loss, reason = "never negative, as `folded`")]
const fn magnitude(residual: i64) -> u64 {
    (residual ^ (residual >> 63)) as u64
}

/// The finest partition order a block of `block` frames allows a predictor
/// of order `predictor`, to `limit`: each partition holds the same frames,
/// and the first more than the predictor's warm-up.
fn finest_order(block: usize, predictor: usize, limit: u32) -> u32 {
    let mut order = limit.min(MAX_PARTITION_ORDER);
    while order > 0 && (block % (1 << order) != 0 || (block >> order) <= predictor) {
        order -= 1;
    }
    order
}

/// Plans the coding of `residuals`, the residual of a block of `block`
/// frames after a predictor of order `predictor`, at partition orders up to
/// `limit`.
#[must_use]
pub fn plan(residuals: &[i64], block: usize, predictor: usize, limit: u32) -> ResidualPlan {
    let finest = finest_order(block, predictor, limit);
    let length = block >> finest;
    let mut partitions = [Partition::default(); MAX_PARTITIONS];
    for (index, &residual) in residuals.iter().enumerate() {
        let partition = &mut partitions[(index + predictor) / length];
        partition.count += 1;
        partition.sum += folded(residual);
        partition.magnitude |= magnitude(residual);
        partition.nonzero |= residual != 0;
    }
    let mut best = coded(&partitions, finest, false);
    let mut order = finest;
    loop {
        for wide in [false, true] {
            let candidate = coded(&partitions, order, wide);
            if candidate.bits < best.bits {
                best = candidate;
            }
        }
        if order == 0 {
            return best;
        }
        for index in 0..1 << (order - 1) {
            partitions[index] = partitions[2 * index].merged(partitions[2 * index + 1]);
        }
        order -= 1;
    }
}

/// The cheapest coding of the first 2^`order` of `partitions`, with 5-bit
/// parameters where `wide`.
fn coded(partitions: &[Partition; MAX_PARTITIONS], order: u32, wide: bool) -> ResidualPlan {
    let (limit, field) = if wide {
        (RICE2_LIMIT, 5)
    } else {
        (RICE_LIMIT, 4)
    };
    let mut codings = [Coding::Rice(0); MAX_PARTITIONS];
    let mut bits = 2 + 4;
    for (coding, partition) in codings.iter_mut().zip(&partitions[..1 << order]) {
        let (chosen, partition_bits) = partition.cheapest(limit, field);
        *coding = chosen;
        bits += partition_bits;
    }
    ResidualPlan {
        order,
        wide,
        codings,
        bits,
    }
}

/// Writes `residuals` as `plan` codes them, for a block of `block` frames
/// after a predictor of order `predictor`.
pub fn write(
    plan: &ResidualPlan,
    residuals: &[i64],
    block: usize,
    predictor: usize,
    writer: &mut BitWriter,
) {
    writer.put(u64::from(plan.wide), 2);
    writer.put(u64::from(plan.order), 4);
    let field = if plan.wide { 5 } else { 4 };
    let escape = (1u64 << field) - 1;
    let length = block >> plan.order;
    let mut start = 0;
    for (index, coding) in plan.codings[..1 << plan.order].iter().enumerate() {
        let end = (index + 1) * length - predictor;
        let partition = &residuals[start..end];
        start = end;
        match *coding {
            Coding::Rice(parameter) => {
                writer.put(u64::from(parameter), field);
                let mask = (1u64 << parameter) - 1;
                for &residual in partition {
                    let value = folded(residual);
                    writer.put_unary(value >> parameter);
                    writer.put(value & mask, parameter);
                }
            }
            Coding::Escaped(width) => {
                writer.put(escape, field);
                writer.put(u64::from(width), 5);
                for &residual in partition {
                    writer.put_signed(residual, width);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Coding, finest_order, folded, plan};

    #[test]
    fn folds_residuals_to_unsigned_numbers() {
        let folds: Vec<u64> = [0, -1, 1, -2, 2, i64::from(i32::MIN), i64::from(i32::MAX)]
            .into_iter()
            .map(folded)
            .collect();
        assert_eq!(
            folds,
            [0, 1, 2, 3, 4, u64::from(u32::MAX), u64::from(u32::MAX) - 1]
        );
    }

    #[test]
    fn partitions_only_where_the_block_divides_and_the_warm_up_fits() {
        assert_eq!(finest_order(4_096, 4, 6), 6);
        assert_eq!(finest_order(4_096, 12, 8), 6);
        assert_eq!(finest_order(1_000, 0, 6), 3);
        assert_eq!(finest_order(64, 8, 6), 2);
        assert_eq!(finest_order(1_001, 0, 6), 0);
    }

    #[test]
    fn escapes_zeros_and_takes_rice2_for_wide_residuals() {
        let zeros = plan(&[0; 256], 256, 0, 0);
        assert_eq!(zeros.codings[0], Coding::Escaped(0));
        // Magnitudes of 2^16 to 2^23, which a parameter of about 21 codes
        // in fewer bits than the 25 an escape would take.
        let wide: Vec<i64> = (0..256)
            .map(|index| (1 - 2 * (index % 2)) << (16 + index % 8))
            .collect();
        let planned = plan(&wide, 256, 0, 0);
        assert!(planned.wide);
        assert!(matches!(planned.codings[0], Coding::Rice(parameter) if parameter > 14));
    }
}
