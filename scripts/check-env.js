/**
 * check-env.js
 * Diagnostics environnement pour la preparation USB.
 * Remplace les one-liners Node.js inline du .bat (fragiles et illisibles).
 * Usage : node scripts/check-env.js
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

// -- Info systeme --
console.log('  Node version  : ' + process.version);
console.log('  Architecture  : ' + process.arch);
console.log('  Plateforme    : ' + process.platform);
console.log('  Memoire totale: ' + Math.round(os.totalmem() / 1024 / 1024) + ' Mo');
console.log('  Memoire libre : ' + Math.round(os.freemem() / 1024 / 1024) + ' Mo');
console.log('  CPUs          : ' + os.cpus().length + 'x ' + os.cpus()[0].model);

// -- Verification SWC --
console.log();
let swcOk = false;
try {
  require('@next/swc-win32-x64-msvc');
  console.log('  [SWC] OK - binaire natif win32-x64-msvc');
  swcOk = true;
} catch (_) {
  try {
    require('@next/swc-win32-ia32-msvc');
    console.log('  [SWC] OK - binaire natif win32-ia32');
    swcOk = true;
  } catch (_2) {
    console.log('  [SWC] ATTENTION: binaire natif NON TROUVE');
    console.log('  [SWC] Le build utilisera WASM (beaucoup plus lent)');
    console.log('  [SWC] Solution: npm install @next/swc-win32-x64-msvc');
  }
}

// -- Verification next.config --
console.log();
const configPath = path.join(process.cwd(), 'next.config.mjs');
if (fs.existsSync(configPath)) {
  const content = fs.readFileSync(configPath, 'utf8');
  const hasStandalone = content.includes("output: 'standalone'") || content.includes('output: "standalone"');
  const hasSwcMinify = content.includes('swcMinify: true');
  console.log('  [CONFIG] output standalone : ' + (hasStandalone ? 'OK' : 'MANQUANT !'));
  console.log('  [CONFIG] swcMinify         : ' + (hasSwcMinify ? 'OK' : 'non'));
} else {
  console.log('  [CONFIG] next.config.mjs introuvable !');
  process.exit(1);
}
