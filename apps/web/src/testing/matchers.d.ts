/**
 * Brings the jest-dom matchers into this package's type environment.
 *
 * The shared test setup imports them at run time; this makes the compiler
 * agree, so `toBeInTheDocument` and `toHaveFocus` are typed rather than merely
 * working. A test whose assertions are untyped can assert on a matcher that
 * does not exist and still pass.
 */
import '@testing-library/jest-dom/vitest';
