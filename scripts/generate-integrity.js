/**
 * Generation du fichier d'integrite SHA-256 pour la distribution USB.
 * Usage: node scripts/generate-integrity.js <outputDir>
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2];
if (!outputDir) {
  console.error('Usage: node generate-integrity.js <outputDir>');
  process.exit(1);
}

const m = {};
['main.js', 'preload.js', 'package.json'].forEach(function (f) {
  const fp = path.join(outputDir, f);
  if (fs.existsSync(fp)) {
    const c = fs.readFileSync(fp);
    m[f] = crypto.createHash('sha256').update(c).digest('hex');
  }
});

fs.writeFileSync(
  path.join(outputDir, '.integrity'),
  JSON.stringify(m, null, 2),
  'utf8'
);
console.log('  Integrite generee');
