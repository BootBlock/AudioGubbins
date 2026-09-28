/**
 * Counts the tests in each file of a Vitest JSON report.
 *
 * Used when assembling a phase evidence package, so the counts quoted there are
 * read from the run rather than remembered.
 *
 * Usage: node tools/count-tests.mjs <report.json>
 */

import { readFileSync } from 'node:fs';

const [, , reportPath] = process.argv;
if (reportPath === undefined) {
  console.error('Usage: node tools/count-tests.mjs <report.json>');
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const counts = new Map();

for (const file of report.testResults) {
  const name = file.name
    .replaceAll('\\', '/')
    .split(/AudioGubbins[^/]*\//)
    .at(-1);
  counts.set(name, (counts.get(name) ?? 0) + file.assertionResults.length);
}

let total = 0;
for (const [name, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
  total += count;
  console.log(`${String(count).padStart(4)}  ${name}`);
}

console.log(`${String(total).padStart(4)}  total`);
