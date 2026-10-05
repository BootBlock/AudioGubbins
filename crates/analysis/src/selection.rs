//! The value of a given rank among values, found exactly by selection.
//!
//! A median and a percentile are order statistics: the value is one of the
//! inputs, so any exact method finds the same number. The method is stated
//! all the same, because the TypeScript reference path repeats it swap for
//! swap, and so the two agree even where a NaN makes "order" meaningless.

/// The rank, from 0, of the value at `share` of the way through `count`
/// values in ascending order: `⌊(count − 1) · share + 0.5⌋`, the nearest rank,
/// at most `count − 1`. `count` is at least one and `share` in `[0, 1]`.
pub(crate) fn rank_at(count: usize, share: f64) -> usize {
    let position = (crate::exact(count - 1) * share + 0.5).floor();
    // In [0, count − 1] for a share in [0, 1], so the cast is exact.
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a whole number from 0 to count - 1"
    )]
    let rank = position as usize;
    rank.min(count - 1)
}

/// The value of rank `rank`, from 0, among `values` in ascending order,
/// reordering `values`; `rank` is below their count.
///
/// Quickselect with Dijkstra's three-way partition. Over the range
/// `[low, high]`, starting at the whole slice, the pivot is the value at
/// `low + ⌊(high − low) / 2⌋`; then, with `lt = low`, `i = low` and
/// `end = high + 1`, while `i < end`: a value below the pivot is swapped to
/// `lt` and both advance; a value above it is swapped with the one before
/// `end`, which moves back; any other value, the pivot's equals and anything
/// a NaN makes incomparable, stays, and `i` advances. A rank below `lt`
/// continues in `[low, lt − 1]`, a rank at or past `end` in `[end, high]`,
/// and any other is the answer, the value at `rank`. The range shrinks every
/// pass, because the pivot stays between `lt` and `end`, so it ends on any
/// input; runs of equal values, a silence's, cost one pass.
pub(crate) fn select(values: &mut [f64], rank: usize) -> f64 {
    let (mut low, mut high) = (0, values.len().saturating_sub(1));
    while low < high {
        let pivot = values[low + (high - low) / 2];
        let (mut lt, mut i, mut end) = (low, low, high + 1);
        while i < end {
            let value = values[i];
            if value < pivot {
                values.swap(lt, i);
                lt += 1;
                i += 1;
            } else if value > pivot {
                end -= 1;
                values.swap(i, end);
            } else {
                i += 1;
            }
        }
        if rank < lt {
            high = lt - 1;
        } else if rank >= end {
            low = end;
        } else {
            return values[rank];
        }
    }
    values.get(rank).copied().unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "an order statistic is one of its inputs")]

    use super::{rank_at, select};
    use crate::signals::Noise;

    #[test]
    fn finds_the_value_a_sort_puts_at_each_rank() {
        let mut noise = Noise::new(7);
        for count in [1, 2, 3, 10, 101, 1_000] {
            let values: Vec<f64> = (0..count).map(|_| (noise.next() * 8.0).round()).collect();
            let mut sorted = values.clone();
            sorted.sort_by(f64::total_cmp);
            for (rank, expected) in sorted.iter().enumerate() {
                let mut scratch = values.clone();
                assert_eq!(select(&mut scratch, rank), *expected, "{count}: {rank}");
            }
        }
    }

    #[test]
    fn ends_on_runs_of_equal_values_and_on_nan() {
        let mut silence = vec![f64::NEG_INFINITY; 65_536];
        assert_eq!(select(&mut silence, 6_553), f64::NEG_INFINITY);
        let mut odd = vec![f64::NAN, 1.0, f64::NAN, -1.0, 0.0];
        let _ = select(&mut odd, 2);
        assert!(select(&mut [], 0).is_nan());
    }

    #[test]
    fn takes_the_nearest_rank() {
        assert_eq!(rank_at(1, 0.95), 0);
        assert_eq!(rank_at(10, 0.5), 5);
        assert_eq!(rank_at(11, 0.5), 5);
        assert_eq!(rank_at(100, 0.1), 10);
        assert_eq!(rank_at(100, 0.95), 94);
        assert_eq!(rank_at(5, 1.0), 4);
    }
}
