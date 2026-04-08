/**
 * Obfuscation des fichiers JS du build Next.js pour la distribution USB.
 * Usage: node scripts/obfuscate-next.js <outputDir>
 */
const JO = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2];
if (!outputDir) {
  console.error('Usage: node obfuscate-next.js <outputDir>');
  process.exit(1);
}

const opts = {
  compact: true,
  controlFlowFlattening: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  unicodeEscapeSequence: true
};

function walkAndObfuscate(dir) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir);
  items.forEach(function (item) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walkAndObfuscate(full);
    } else if (item.endsWith('.js') && stat.size > 500 && stat.size < 5000000) {
      try {
        const code = fs.readFileSync(full, 'utf8');
        const result = JO.obfuscate(code, opts);
        fs.writeFileSync(full, result.getObfuscatedCode(), 'utf8');
      } catch (e) { }
    }
  });
}

walkAndObfuscate(path.join(outputDir, '.next', 'server'));
walkAndObfuscate(path.join(outputDir, '.next', 'static'));
// Le serveur standalone utilise ses propres copies dans .next/standalone/.next/
walkAndObfuscate(path.join(outputDir, '.next', 'standalone', '.next', 'server'));
walkAndObfuscate(path.join(outputDir, '.next', 'standalone', '.next', 'static'));
console.log('  Build Next.js protege');
