/**
 * generate-prod-package.js
 * Genere un package.json allege pour la distribution USB.
 * Supprime devDependencies et javascript-obfuscator des dependencies.
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
const nbTotal = Object.keys(pkg.dependencies || {}).length;

delete pkg.devDependencies;
if (pkg.dependencies) {
  delete pkg.dependencies['javascript-obfuscator'];
}

const nbProd = Object.keys(pkg.dependencies || {}).length;
const outPath = path.join(outputDir, 'package.json');
fs.writeFileSync(outPath, JSON.stringify(pkg, null, 2), 'utf8');

console.log('  package.json: ' + nbProd + ' deps production (supprime ' + (nbTotal - nbProd) + ')');
