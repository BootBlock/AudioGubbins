/**
 * The type of each of Lucide's per-glyph modules.
 *
 * `lucide-react`'s root export offers each glyph only as a finished React
 * component, which draws its own `<svg>` and keeps its geometry to itself. The
 * icon vocabulary needs that geometry: it measures each glyph's ink to centre
 * it in the grid, and draws the glyph inside its own `<svg>`. Each per-glyph
 * module exports the geometry as `__iconData`, but ships no declaration, and
 * the package has no `exports` map that could carry one, so this declaration
 * types them all with the package's own published type. Importing one module
 * per glyph also keeps the bundle to the glyphs the vocabulary names.
 */
declare module 'lucide-react/dist/esm/icons/*.mjs' {
  import type { LucideIconData } from 'lucide-react';

  export const __iconData: LucideIconData;
}
