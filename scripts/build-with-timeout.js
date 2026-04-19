/**
 * build-with-timeout.js
 * Lance next build avec un timeout et un heartbeat pour montrer la progression.
 * Usage : node scripts/build-with-timeout.js [timeout_en_secondes]
 */

const { spawn } = require('child_process');

const TIMEOUT = parseInt(process.argv[2], 10) || 600; // 10 minutes par defaut

console.log('  Build en cours (timeout: ' + TIMEOUT + 's)...');
console.log();

const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'build'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: process.env }
);

// Mots-cles de progression Next.js
const KEYWORDS = [
  'Compiling', 'Compiled', 'Generating', 'Collecting',
  'Finalizing', 'Creating an optimized', 'Route', 'Build error',
  'Error', 'Warning', 'warn', 'Module not found',
];

child.stdout.on('data', function (data) {
  var lines = data.toString().split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    for (var k = 0; k < KEYWORDS.length; k++) {
      if (line.includes(KEYWORDS[k])) {
        console.log('  [NEXT] ' + line.substring(0, 100));
        break;
      }
    }
  }
});

child.stderr.on('data', function (data) {
  process.stderr.write(data);
});

// Heartbeat toutes les 30 secondes
var elapsed = 0;
var heartbeat = setInterval(function () {
  elapsed += 30;
  console.log('  [' + elapsed + 's] Build en cours...');
}, 30000);

// Timeout
var timer = setTimeout(function () {
  console.error();
  console.error('  TIMEOUT: le build a depasse ' + TIMEOUT + ' secondes.');
  child.kill();
  setTimeout(function () {
    try { child.kill('SIGKILL'); } catch (_) {}
    process.exit(99);
  }, 5000);
}, TIMEOUT * 1000);

child.on('close', function (code) {
  clearInterval(heartbeat);
  clearTimeout(timer);
  console.log();
  console.log('  Build termine (code: ' + (code || 0) + ')');
  process.exit(code || 0);
});

child.on('error', function (err) {
  clearInterval(heartbeat);
  clearTimeout(timer);
  console.error('  ERREUR: impossible de lancer next build: ' + err.message);
  process.exit(1);
});
