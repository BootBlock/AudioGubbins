import type { ReactNode } from 'react';

/**
 * Text present for a screen reader and absent for everyone else. Its rule is in
 * tokens.css, so a component drawn with any group's stylesheet can use it.
 */
export function VisuallyHidden({ children }: { readonly children: ReactNode }): ReactNode {
  return <span className="ag-visually-hidden">{children}</span>;
}
