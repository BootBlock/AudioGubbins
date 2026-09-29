/**
 * Asking the person for files through the page's own file input.
 *
 * Every browser has one, where only Chromium has the pickers, and it is what a
 * person's assistive technology and a test harness both know how to answer. The
 * input is put in the page for as long as it is open, since a detached one is
 * refused by some engines, and taken out again however it ends. Opened from the
 * handler of the person's gesture, as every browser requires of a picker.
 */

/** What the input is asked for. */
export interface FileInputRequest {
  /** The kinds of file offered, as the input's `accept` reads them. */
  readonly accept?: string;

  /** A whole folder rather than one file. */
  readonly folder?: boolean;
}

/**
 * Opens the input and settles with the files chosen, or with none where the
 * person dismissed it.
 */
export function chooseThroughInput(request: FileInputRequest): Promise<readonly File[]> {
  const input = document.createElement('input');
  input.type = 'file';
  input.hidden = true;
  if (request.accept !== undefined) input.accept = request.accept;
  if (request.folder === true) input.webkitdirectory = true;

  return new Promise((resolve) => {
    const settle = (files: readonly File[]): void => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => {
      settle(Array.from(input.files ?? []));
    });
    // Dismissing the dialogue is its own event, so a person who closed it is
    // not left with an operation waiting for ever.
    input.addEventListener('cancel', () => {
      settle([]);
    });
    document.body.append(input);
    input.click();
  });
}
