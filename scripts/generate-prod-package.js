/**
 * generate-prod-package.js
 * Genere un package.json allege pour la distribution USB.
 * Supprime devDependencies pour que le collegue n'installe que le runtime.
 * Usage : node scripts/generate-prod-package.js <outputDir>
 */

const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2];
if (!outputDir) {
  console.error('Usage: node generate-prod-package.js <outputDir>');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
delete pkg.devDependencies;

const nbProd = Object.keys(pkg.dependencies || {}).length;
const outPath = path.join(outputDir, 'package.json');
fs.writeFileSync(outPath, JSON.stringify(pkg, null, 2), 'utf8');

console.log('  package.json: ' + nbProd + ' deps production');
