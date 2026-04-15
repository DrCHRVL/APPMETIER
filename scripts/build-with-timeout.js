/**
 * build-with-timeout.js
 * Wrapper pour next build avec timeout, progression et logging.
 * Usage : node scripts/build-with-timeout.js [timeout_en_secondes]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TIMEOUT = parseInt(process.argv[2], 10) || 600; // 10 minutes par defaut
const LOG_FILE = path.join(__dirname, '..', 'next-build.log');

// Nettoyer les variables problematiques pour le child process
const env = Object.assign({}, process.env);
delete env.DEBUG;
delete env.NEXT_PRIVATE_WORKER_THREADS;

const log = fs.createWriteStream(LOG_FILE);
log.write(`[BUILD] Debut: ${new Date().toLocaleString()}\n`);
log.write(`[BUILD] Timeout: ${TIMEOUT}s\n\n`);

console.log(`        Build en cours (timeout: ${TIMEOUT}s)...`);
console.log(`        Log detaille : ${LOG_FILE}`);
console.log();

const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'build'],
  { stdio: ['ignore', 'pipe', 'pipe'], env }
);

// Mots-cles Next.js a afficher dans la console pour montrer la progression
const PHASE_KEYWORDS = [
  'Compiling', 'Compiled', 'Generating', 'Collecting',
  'Finalizing', 'Creating an optimized', 'Route', 'Build error',
  'Error', 'Warning', 'warn', 'Module not found',
];

child.stdout.on('data', (data) => {
  log.write(data);
  const lines = data.toString().split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (PHASE_KEYWORDS.some((kw) => trimmed.includes(kw))) {
      console.log(`        [NEXT] ${trimmed.substring(0, 80)}`);
    }
  }
});

child.stderr.on('data', (data) => {
  log.write(data);
});

// Heartbeat toutes les 15 secondes
let elapsed = 0;
const heartbeat = setInterval(() => {
  elapsed += 15;
  console.log(`        [${elapsed}s] Build en cours...`);
}, 15000);

// Timeout
const timeout = setTimeout(() => {
  console.error();
  console.error(`        TIMEOUT: le build a depasse ${TIMEOUT} secondes.`);
  console.error(`        Consultez le log : ${LOG_FILE}`);
  log.write(`\n[BUILD] TIMEOUT apres ${TIMEOUT}s\n`);
  child.kill();
  setTimeout(() => {
    try { child.kill('SIGKILL'); } catch (_) {}
    log.end();
    process.exit(99);
  }, 5000);
}, TIMEOUT * 1000);

child.on('close', (code) => {
  clearInterval(heartbeat);
  clearTimeout(timeout);
  log.write(`\n[BUILD] Termine avec code: ${code}\n`);
  log.end();
  console.log();
  console.log(`        Build termine (code: ${code})`);
  process.exit(code || 0);
});

child.on('error', (err) => {
  clearInterval(heartbeat);
  clearTimeout(timeout);
  console.error(`        ERREUR: impossible de lancer next build: ${err.message}`);
  log.write(`\n[BUILD] Erreur: ${err.message}\n`);
  log.end();
  process.exit(1);
});
