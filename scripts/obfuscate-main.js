/**
 * Obfuscation de main.js et preload.js pour la distribution USB.
 * Usage: node scripts/obfuscate-main.js <outputDir>
 */
const JO = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2];
if (!outputDir) {
  console.error('Usage: node obfuscate-main.js <outputDir>');
  process.exit(1);
}

const opts = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.7,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: true,
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 0.9,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  transformObjectKeys: true,
  unicodeEscapeSequence: true,
  numbersToExpressions: true,
  splitStrings: true,
  splitStringsChunkLength: 5
};

['main.js', 'preload.js'].forEach(function (f) {
  const p = path.join(outputDir, f);
  try {
    const code = fs.readFileSync(p, 'utf8');
    const result = JO.obfuscate(code, opts);
    fs.writeFileSync(p, result.getObfuscatedCode(), 'utf8');
    console.log('  Protege: ' + f);
  } catch (e) {
    console.error('  Erreur ' + f + ': ' + e.message);
  }
});
