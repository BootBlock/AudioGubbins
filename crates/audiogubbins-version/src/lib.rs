//! AudioGubbins version identifiers for Rust components.
//!
//! REQ-REPO-187 requires one primary product release version shared by the web
//! application and the first-party Godot integration packages, and requires the
//! internal compatibility identifiers to stay distinct from it. A user upgrading
//! from AudioGubbins 0.1.0 to 0.2.0 should never have to reason about which
//! persistence schema version that implies.
//!
//! `version.json` at the repository root is the single source of truth.
//! `tools/sync-version.mjs` generates [`generated`] from it, and
//! `pnpm version:check` fails the fast verification tier if the two disagree.

mod generated;

pub use generated::{
    DIAGNOSTIC_BUNDLE_SCHEMA_VERSION, PRODUCT_VERSION, PRODUCT_VERSION_MAJOR,
    PRODUCT_VERSION_MINOR, PRODUCT_VERSION_PATCH, SHORTCUT_PROFILE_SCHEMA_VERSION,
    USER_PREFERENCES_SCHEMA_VERSION, WORKSPACE_LAYOUT_SCHEMA_VERSION,
};

/// The AudioGubbins product release version, as users see it.
///
/// This is deliberately a distinct type from any schema version. Passing a
/// persistence schema version where a product version is expected is a
/// compile error rather than a wrong number on an About screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ProductVersion {
    /// Breaking product release.
    pub major: u32,
    /// Feature release.
    pub minor: u32,
    /// Correction release.
    pub patch: u32,
}

impl ProductVersion {
    /// The product version this build was compiled from.
    #[must_use]
    pub const fn current() -> Self {
        Self {
            major: PRODUCT_VERSION_MAJOR,
            minor: PRODUCT_VERSION_MINOR,
            patch: PRODUCT_VERSION_PATCH,
        }
    }

    /// Whether this build is pre-1.0.
    ///
    /// The specification applies a different schema-breaking policy before 1.0,
    /// so components that make migration decisions need to ask this directly
    /// rather than comparing the major component by hand.
    #[must_use]
    pub const fn is_pre_release_series(self) -> bool {
        self.major == 0
    }
}

impl core::fmt::Display for ProductVersion {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(formatter, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The crate manifest version and the generated constants both derive from
    /// `version.json`. If they ever disagree, one of the two generation paths
    /// has silently stopped running.
    #[test]
    fn crate_manifest_agrees_with_generated_product_version() {
        assert_eq!(env!("CARGO_PKG_VERSION"), PRODUCT_VERSION);
    }

    #[test]
    fn current_version_renders_as_the_generated_string() {
        assert_eq!(ProductVersion::current().to_string(), PRODUCT_VERSION);
    }

    #[test]
    fn product_version_orders_by_component_significance() {
        let base = ProductVersion { major: 0, minor: 1, patch: 0 };
        assert!(base < ProductVersion { major: 0, minor: 1, patch: 1 });
        assert!(base < ProductVersion { major: 0, minor: 2, patch: 0 });
        assert!(base < ProductVersion { major: 1, minor: 0, patch: 0 });
    }

    #[test]
    fn pre_one_point_zero_is_reported_as_the_pre_release_series() {
        assert!(ProductVersion { major: 0, minor: 9, patch: 9 }.is_pre_release_series());
        assert!(!ProductVersion { major: 1, minor: 0, patch: 0 }.is_pre_release_series());
    }

    /// REQ-REPO-187 prohibits conflating the product version with an internal
    /// compatibility identifier. Schema versions start at 1 and move on their own.
    #[test]
    fn schema_versions_are_independent_positive_integers() {
        for version in [
            USER_PREFERENCES_SCHEMA_VERSION,
            WORKSPACE_LAYOUT_SCHEMA_VERSION,
            SHORTCUT_PROFILE_SCHEMA_VERSION,
            DIAGNOSTIC_BUNDLE_SCHEMA_VERSION,
        ] {
            assert!(version >= 1, "schema versions are one-based");
        }
    }
}
