/**
 * Offering something to the person as a download, the one way every browser
 * gives to hand them a file (REQ-PRIV-161).
 *
 * Shared by the text a command saves and the bundle or archive a project flow
 * writes, so the release of the address is decided once.
 */

/**
 * Offers the blob as a download under `filename`. Throws what the browser
 * throws where it refuses, as a locked-down kiosk may, for the caller to say.
 */
export function offerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.click();

  // Released on the next turn rather than at once. Revoking the address in the
  // same task as the click cancels the download in some engines, because the
  // navigation it starts has not read the address yet.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
