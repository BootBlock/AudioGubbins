//! Objects the ABI names by handle.

/// Objects of one kind, each named by a handle from 1; 0 names nothing, so a
/// refused creation can answer it.
///
/// A released handle is reused by the next creation, so a module that runs for
/// hours does not grow its tables with every oscillator it ever made.
pub struct Table<T> {
    slots: Vec<Option<T>>,
    free: Vec<usize>,
}

impl<T> Table<T> {
    /// An empty table.
    pub const fn new() -> Self {
        Self {
            slots: Vec::new(),
            free: Vec::new(),
        }
    }

    /// Holds `value` and answers its handle, or 0 if the handles are spent.
    pub fn insert(&mut self, value: T) -> u32 {
        let index = if let Some(index) = self.free.pop() {
            self.slots[index] = Some(value);
            index
        } else {
            self.slots.push(Some(value));
            self.slots.len() - 1
        };
        u32::try_from(index + 1).unwrap_or(0)
    }

    /// The object `handle` names, if it names one.
    pub fn get_mut(&mut self, handle: u32) -> Option<&mut T> {
        let index = usize::try_from(handle).ok()?.checked_sub(1)?;
        self.slots.get_mut(index)?.as_mut()
    }

    /// The two objects `first` and `second` name, both open to change at
    /// once, for a call that reads one and writes the other.
    pub fn pair_mut(&mut self, first: u32, second: u32) -> Pair<'_, T> {
        let index = |handle: u32| usize::try_from(handle).ok()?.checked_sub(1);
        let (Some(one), Some(other)) = (index(first), index(second)) else {
            return Pair::Missing;
        };
        if one == other {
            return if self.get_mut(first).is_some() {
                Pair::Same
            } else {
                Pair::Missing
            };
        }
        // Split between the two, so each half lends one of them; checked, since
        // a split past the end would panic, and a handle can name anything.
        let Some((low, high)) = self.slots.split_at_mut_checked(one.max(other)) else {
            return Pair::Missing;
        };
        let (Some(Some(lower)), Some(Some(higher))) =
            (low.get_mut(one.min(other)), high.first_mut())
        else {
            return Pair::Missing;
        };
        if one < other {
            Pair::Both(lower, higher)
        } else {
            Pair::Both(higher, lower)
        }
    }

    /// Releases the object `handle` names, answering whether it named one.
    pub fn remove(&mut self, handle: u32) -> bool {
        let Some(index) = usize::try_from(handle)
            .ok()
            .and_then(|value| value.checked_sub(1))
        else {
            return false;
        };
        match self.slots.get_mut(index) {
            Some(slot @ Some(_)) => {
                *slot = None;
                self.free.push(index);
                true
            }
            _ => false,
        }
    }
}

/// What [`Table::pair_mut`] found.
pub enum Pair<'a, T> {
    /// Both objects, in the order they were asked for.
    Both(&'a mut T, &'a mut T),
    /// Both handles name the same object.
    Same,
    /// A handle names nothing.
    Missing,
}

#[cfg(test)]
mod tests {
    use super::{Pair, Table};

    #[test]
    fn lends_two_objects_at_once_in_the_order_asked() {
        let mut table = Table::new();
        let a = table.insert('a');
        let b = table.insert('b');
        assert!(matches!(table.pair_mut(a, b), Pair::Both('a', 'b')));
        assert!(matches!(table.pair_mut(b, a), Pair::Both('b', 'a')));
        assert!(matches!(table.pair_mut(a, a), Pair::Same));
        assert!(matches!(table.pair_mut(a, 9), Pair::Missing));
        assert!(matches!(table.pair_mut(0, a), Pair::Missing));
        assert!(table.remove(b));
        assert!(matches!(table.pair_mut(a, b), Pair::Missing));
        assert!(matches!(table.pair_mut(b, b), Pair::Missing));
    }

    #[test]
    fn names_from_one_and_reuses_a_released_handle() {
        let mut table = Table::new();
        assert_eq!(table.insert('a'), 1);
        assert_eq!(table.insert('b'), 2);
        assert!(table.remove(1));
        assert!(!table.remove(1));
        assert_eq!(table.insert('c'), 1);
        assert_eq!(table.get_mut(1).copied(), Some('c'));
        assert_eq!(table.get_mut(0), None);
        assert_eq!(table.get_mut(9), None);
    }
}
