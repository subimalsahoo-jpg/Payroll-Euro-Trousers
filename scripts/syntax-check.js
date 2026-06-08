'use strict';

/**
 * Recursively syntax-checks every .js file in the project (excluding
 * node_modules) using Node's --check via child V8 parsing. Provides a
 * dependency-free `npm run check` that validates routes parse cleanly.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'storage']);

let checked = 0;
let failed = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.js')) {
      const file = path.join(dir, entry.name);
      const code = fs.readFileSync(file, 'utf8');
      try {
        // new Script parses without executing; throws on syntax errors.
        // eslint-disable-next-line no-new
        new vm.Script(code, { filename: file });
        checked += 1;
      } catch (err) {
        failed += 1;
        console.error(`SYNTAX ERROR: ${path.relative(ROOT, file)}\n  ${err.message}`);
      }
    }
  }
}

walk(ROOT);
console.log(`\nChecked ${checked} file(s), ${failed} error(s).`);
process.exit(failed ? 1 : 0);
