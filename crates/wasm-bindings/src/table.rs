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

#[cfg(test)]
mod tests {
    use super::Table;

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
