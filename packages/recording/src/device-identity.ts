/**
 * How a device the person chose once is recognised again (ADR-0070).
 *
 * A browser's device identifier is not taken to last: it is reset with the
 * site's data, and a device plugged into another port may be given another.
 * So a remembered device is found again by its identifier, then by its group
 * and its label together, and otherwise is not the same device. A label alone
 * is never enough: two of one model of interface have one label.
 *
 * A label is personal data (`REQ-PRIV-165`): it is compared here and never
 * written into a sentence this package makes.
 */

/** A device as the browser describes it, input or output. */
export interface DeviceIdentity {
  /** The browser's identifier for the device, which may change. */
  readonly id: string;

  /** The identifier of the physical device it belongs to, where the browser gives one. */
  readonly group?: string;

  /** Its name, where the permission lets the browser give one. */
  readonly label?: string;
}

/** Whether `current` is the device `remembered` was, by identifier, then by group and label. */
export function isSameDevice(remembered: DeviceIdentity, current: DeviceIdentity): boolean {
  if (remembered.id !== '' && remembered.id === current.id) return true;
  return (
    present(remembered.group) &&
    present(remembered.label) &&
    remembered.group === current.group &&
    remembered.label === current.label
  );
}

/** Whether a browser gave a value: it gives an empty string where it withholds one. */
function present(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}
