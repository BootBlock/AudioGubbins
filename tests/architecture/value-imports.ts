/**
 * The values a source file takes from other modules, read from its declarations
 * rather than its text: every name an import or a re-export takes that is not a
 * type alone, a default import, a namespace import as the whole module, an
 * import for its effect, and a dynamic import. A type is erased before the code
 * runs, so a module taking only types from a package runs none of it; a rule
 * that a file takes no value from a package reads this.
 */

import ts from 'typescript';

/** A value a file takes, by the module it names and what it takes of it. */
export interface TakenValue {
  /** The specifier as written, or `(computed)` for a dynamic import of no literal. */
  readonly module: string;

  /**
   * The name taken: `default`, `*` for the whole module, or `(effect)` for an
   * import run for its effect.
   */
  readonly name: string;
}

/** What an import declaration takes as values. */
function importedValues(declaration: ts.ImportDeclaration, module: string): TakenValue[] {
  const clause = declaration.importClause;
  if (clause === undefined) return [{ module, name: '(effect)' }];
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return [];
  const taken: TakenValue[] = clause.name === undefined ? [] : [{ module, name: 'default' }];
  const bindings = clause.namedBindings;
  if (bindings === undefined) return taken;
  if (ts.isNamespaceImport(bindings)) return [...taken, { module, name: '*' }];
  for (const element of bindings.elements) {
    if (!element.isTypeOnly)
      taken.push({ module, name: (element.propertyName ?? element.name).text });
  }
  return taken;
}

/** What a re-export takes as values. */
function exportedValues(declaration: ts.ExportDeclaration, module: string): TakenValue[] {
  if (declaration.isTypeOnly) return [];
  const clause = declaration.exportClause;
  if (clause === undefined || ts.isNamespaceExport(clause)) return [{ module, name: '*' }];
  return clause.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => ({ module, name: (element.propertyName ?? element.name).text }));
}

/** Every value `file` takes from another module (see the module comment). */
export function valuesTaken(file: ts.SourceFile): readonly TakenValue[] {
  const taken: TakenValue[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      taken.push(...importedValues(node, node.moduleSpecifier.text));
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      taken.push(...exportedValues(node, node.moduleSpecifier.text));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments;
      const module =
        specifier !== undefined && ts.isStringLiteralLike(specifier)
          ? specifier.text
          : '(computed)';
      taken.push({ module, name: '*' });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return taken;
}
