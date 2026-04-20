/**
 * build-with-timeout.js
 * Lance next build avec un timeout et un heartbeat pour montrer la progression.
 * Usage : node scripts/build-with-timeout.js [timeout_en_secondes]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TIMEOUT = parseInt(process.argv[2], 10) || 600; // 10 minutes par defaut

// Eviter les EPIPE silencieux si stdout/stderr sont fermes avant la fin
process.stdout.on('error', function () {});
process.stderr.on('error', function () {});

// Log brut et complet du build dans .next/build.log (cree le dossier .next si besoin)
try { fs.mkdirSync('.next', { recursive: true }); } catch (_) {}
const logPath = path.join('.next', 'build.log');
const logStream = fs.createWriteStream(logPath, { flags: 'w' });
logStream.write('--- next build demarre ' + new Date().toISOString() + ' ---\n');

console.log('  Build en cours (timeout: ' + TIMEOUT + 's)...');
console.log('  Log brut : ' + logPath);
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
  logStream.write(data);
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
  logStream.write(data);
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
  logStream.write('\nTIMEOUT apres ' + TIMEOUT + 's\n');
  child.kill();
  setTimeout(function () {
    try { child.kill('SIGKILL'); } catch (_) {}
    shutdown(99);
  }, 5000);
}, TIMEOUT * 1000);

function shutdown(exitCode) {
  clearInterval(heartbeat);
  clearTimeout(timer);
  console.log();
  console.log('  Build termine (code: ' + exitCode + ')');
  console.log('  Log brut : ' + logPath);
  // Ferme le fichier log puis exit quand le flush est fait (evite la perte
  // de la derniere ligne). Filet de securite : hard-exit a 2s.
  try {
    logStream.end(function () { process.exit(exitCode); });
  } catch (_) {
    process.exit(exitCode);
  }
  setTimeout(function () { process.exit(exitCode); }, 2000).unref();
}

child.on('close', function (code) {
  shutdown(code || 0);
});

child.on('error', function (err) {
  logStream.write('\nERREUR spawn: ' + err.message + '\n');
  console.error('  ERREUR: impossible de lancer next build: ' + err.message);
  shutdown(1);
});
