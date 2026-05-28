#!/usr/bin/env node
/* eslint-disable */
/**
 * Génère le paquet "consultation lecture seule" à déposer sur le partage réseau.
 *
 * Étapes :
 *   1) Build statique Next.js (NEXT_CONSULTATION_BUILD=1, output:'export') → ./out/
 *   2) Lecture de data/data.json et filtrage selon les contentieux autorisés
 *      pour l'utilisateur cible (users.json sur le partage serveur).
 *   3) Écriture de data-snapshot.js + shim.js + Ouvrir.html dans out-consultation/.
 *   4) Optionnel : copie miroir vers --deploy <chemin> (ex: P:\Consultation_AppMetier).
 *
 * Usage :
 *   node scripts/export-consultation.js --user jdupont
 *   node scripts/export-consultation.js --user jdupont --deploy "P:\\Consultation_AppMetier"
 *   node scripts/export-consultation.js --user jdupont --skip-build      (debug)
 *
 * Si --user est absent et que users.json n'est pas lisible, on tombe en repli
 * "tous contentieux" (utile en dépannage uniquement).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ─── Args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const TARGET_USER = arg('--user');
const DEPLOY_DIR = arg('--deploy');
const SKIP_BUILD = args.includes('--skip-build');

const ROOT = path.resolve(__dirname, '..');
const DATA_FOLDER = path.join(ROOT, 'data');
const LOCAL_DATA_JSON = path.join(DATA_FOLDER, 'data.json');
const SERVER_CONFIG_PATH = path.join(DATA_FOLDER, 'server-config.json');
const NEXT_OUT_DIR = path.join(ROOT, 'out');
const FINAL_OUT_DIR = path.join(ROOT, 'out-consultation');
const SHIM_SRC = path.join(ROOT, 'public', 'consultation', 'shim.js');

// ─── Helpers ───────────────────────────────────────────────────────────
function log(msg) { console.log('[consultation] ' + msg); }
function warn(msg) { console.warn('[consultation] ⚠ ' + msg); }
function die(msg) { console.error('[consultation] ✖ ' + msg); process.exit(1); }

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch (e) { return null; }
}

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ─── 1. Configuration serveur ──────────────────────────────────────────
log('Lecture de la configuration serveur…');
const serverConfig = readJsonSafe(SERVER_CONFIG_PATH);
const serverRootPath = (serverConfig && serverConfig.serverRootPath) || '';
if (!serverRootPath) {
  warn('Aucun serverRootPath configuré dans data/server-config.json. '
     + 'Les chemins UNC des documents seront vides (la copie presse-papier sera tronquée).');
} else {
  log('  serverRootPath = ' + serverRootPath);
}

// ─── 2. Profil utilisateur cible ───────────────────────────────────────
let allowedContentieux = null; // null = "tous"
let targetUserRecord = null;
let usersList = [];

if (serverRootPath) {
  const usersJsonPath = path.join(serverRootPath, 'users.json');
  const usersConfig = readJsonSafe(usersJsonPath);
  if (usersConfig && Array.isArray(usersConfig.users)) {
    usersList = usersConfig.users;
    if (TARGET_USER) {
      const found = usersList.find(u =>
        (u.username || '').toLowerCase() === TARGET_USER.toLowerCase()
      );
      if (found) {
        targetUserRecord = found;
        allowedContentieux = (found.contentieux || []).map(c => c.contentieuxId);
        log('  utilisateur "' + TARGET_USER + '" trouvé — ' + allowedContentieux.length + ' contentieux');
      } else {
        warn('Utilisateur "' + TARGET_USER + '" introuvable dans users.json — repli sur tous les contentieux.');
      }
    } else {
      warn('--user non fourni : repli sur tous les contentieux.');
    }
  } else {
    warn('users.json absent ou illisible — repli sur tous les contentieux.');
  }
}

// ─── 3. Lecture de la donnée locale ────────────────────────────────────
log('Lecture de data/data.json…');
const localData = readJsonSafe(LOCAL_DATA_JSON);
if (!localData || typeof localData !== 'object') {
  die('Impossible de lire data/data.json (' + LOCAL_DATA_JSON + ').');
}

// ─── 4. Filtrage des clés ──────────────────────────────────────────────
// Clés à exclure quoi qu'il arrive (techniques, audit, sync)
const ALWAYS_EXCLUDE = new Set([
  'save_history', 'lastSave',
  'audit_log', 'pending_events', 'heartbeats',
  'admin_backups_meta',
]);

// Clés à exclure car spécifiques à un profil (préférences perso, etc.)
const EXCLUDE_PREFIXES = [
  'user_prefs_', 'instruction_', 'private_',
];

function isContentieuxKey(key) {
  return /^ctx_[^_]+_/.test(key);
}
function contentieuxIdOf(key) {
  const m = key.match(/^ctx_([^_]+)_/);
  return m ? m[1] : null;
}

const filteredData = {};
let keptCount = 0;
let droppedCtxCount = 0;
let droppedOtherCount = 0;

for (const [key, value] of Object.entries(localData)) {
  if (ALWAYS_EXCLUDE.has(key)) { droppedOtherCount++; continue; }
  if (EXCLUDE_PREFIXES.some(p => key.startsWith(p))) { droppedOtherCount++; continue; }

  if (isContentieuxKey(key)) {
    const id = contentieuxIdOf(key);
    if (allowedContentieux && !allowedContentieux.includes(id)) {
      droppedCtxCount++;
      continue;
    }
  }
  filteredData[key] = value;
  keptCount++;
}
log('Clés conservées : ' + keptCount
  + ' (contentieux non autorisés filtrés : ' + droppedCtxCount
  + ', techniques : ' + droppedOtherCount + ')');

// ─── 5. users.json filtré (seulement le profil cible, pour getCurrentUser) ─
const filteredUsers = targetUserRecord ? [targetUserRecord] : [];

// ─── 6. Build statique Next.js ─────────────────────────────────────────
if (!SKIP_BUILD) {
  log('Build statique Next.js (peut prendre 1–3 min)…');
  rmrf(NEXT_OUT_DIR);
  const env = Object.assign({}, process.env, {
    NEXT_CONSULTATION_BUILD: '1',
    NEXT_PUBLIC_CONSULTATION: '1',
  });
  const res = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'build'],
    { cwd: ROOT, env, stdio: 'inherit' }
  );
  if (res.status !== 0) die('next build a échoué (code ' + res.status + ').');
} else {
  log('--skip-build : on réutilise ./out tel quel.');
}

if (!fs.existsSync(NEXT_OUT_DIR)) {
  die('Dossier ./out introuvable après le build.');
}

// ─── 7. Assemblage du dossier final ───────────────────────────────────
log('Assemblage de ' + FINAL_OUT_DIR + '…');
rmrf(FINAL_OUT_DIR);
copyDir(NEXT_OUT_DIR, FINAL_OUT_DIR);

// 7a. shim.js
fs.copyFileSync(SHIM_SRC, path.join(FINAL_OUT_DIR, 'shim.js'));

// 7b. data-snapshot.js
const snapshot = {
  generatedAt: new Date().toISOString(),
  generatedBy: process.env.USERNAME || process.env.USER || 'inconnu',
  forUser: TARGET_USER || null,
  serverRootPath: serverRootPath,
  allowedContentieux: allowedContentieux,
  data: filteredData,
  documents: {},     // v1 : vide. Le shim génère les chemins UNC à la volée.
  users: filteredUsers,
};
const snapshotJson = JSON.stringify(snapshot);
const snapshotJs =
  '/* Généré automatiquement par scripts/export-consultation.js — ne pas éditer. */\n'
  + 'window.__CONSULTATION_SNAPSHOT__ = ' + snapshotJson + ';\n';
fs.writeFileSync(path.join(FINAL_OUT_DIR, 'data-snapshot.js'), snapshotJs, 'utf-8');
const sizeMb = (Buffer.byteLength(snapshotJs, 'utf-8') / 1024 / 1024).toFixed(2);
log('  data-snapshot.js : ' + sizeMb + ' Mo');

// 7c. Ouvrir.html — page d'accueil amicale, redirige vers index.html
const generatedAtHuman = new Date(snapshot.generatedAt).toLocaleString('fr-FR');
const userLine = TARGET_USER ? ('Profil : <strong>' + TARGET_USER + '</strong> · ') : '';
const ouvrir = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Consultation AppMetier — Ouvrir</title>
<meta http-equiv="refresh" content="3; url=./index.html">
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 60px auto; padding: 0 20px; color: #1f2937; }
  h1 { color: #92400e; }
  .card { background: #fffbeb; border: 1px solid #fbbf24; padding: 20px; border-radius: 10px; }
  .meta { color: #6b7280; font-size: 13px; margin-top: 16px; }
  ul { line-height: 1.7; }
  a.btn { display: inline-block; background: #92400e; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; margin-top: 12px; }
</style>
</head>
<body>
  <h1>Consultation AppMetier — lecture seule</h1>
  <div class="card">
    <p>Cette page est une <strong>copie de consultation</strong> de l'application AppMetier.
       Elle s'ouvre dans votre navigateur (Edge), sans rien installer.</p>
    <ul>
      <li>Toutes les vues et fiches détail sont consultables.</li>
      <li>Les boutons d'écriture (enregistrer, supprimer, importer…) sont <strong>grisés</strong>.</li>
      <li>Pour ouvrir une pièce jointe : un clic copie le chemin réseau dans le presse-papier — collez-le dans l'Explorateur Windows.</li>
      <li>Les données sont mises à jour automatiquement plusieurs fois par jour.</li>
    </ul>
    <a class="btn" href="./index.html">Entrer dans l'application</a>
  </div>
  <p class="meta">
    ${userLine}Données figées au <strong>${generatedAtHuman}</strong><br>
    Vous êtes redirigée automatiquement dans quelques secondes.
  </p>
</body>
</html>
`;
fs.writeFileSync(path.join(FINAL_OUT_DIR, 'Ouvrir.html'), ouvrir, 'utf-8');

// 7d. README pour la personne qui exécute (vous)
const readme = `Paquet "Consultation lecture seule" généré le ${generatedAtHuman}.

Comment l'utiliser :
  1. Copiez le contenu de ce dossier dans le partage réseau (ex: P:\\Consultation_AppMetier\\).
  2. Votre collègue ouvre "Ouvrir.html" en double-cliquant — elle est redirigée vers l'app.
  3. La page se met à jour toute seule quand vous relancez l'export (toutes les ~5 min côté navigateur).

Pour automatiser : voir scripts/scheduled-task.ps1 (tâche planifiée Windows).

Paramètres utilisés :
  Profil filtré      : ${TARGET_USER || '(aucun — repli "tous contentieux")'}
  Contentieux exposés: ${allowedContentieux ? allowedContentieux.join(', ') : 'tous'}
  Serveur racine     : ${serverRootPath || '(non configuré)'}
  Clés conservées    : ${keptCount}
`;
fs.writeFileSync(path.join(FINAL_OUT_DIR, 'LISEZ-MOI.txt'), readme, 'utf-8');

// ─── 8. Déploiement optionnel ─────────────────────────────────────────
if (DEPLOY_DIR) {
  log('Déploiement vers ' + DEPLOY_DIR + '…');
  try {
    fs.mkdirSync(DEPLOY_DIR, { recursive: true });
    copyDir(FINAL_OUT_DIR, DEPLOY_DIR);
    log('  ✓ Copie terminée.');
  } catch (e) {
    warn('Impossible de copier vers ' + DEPLOY_DIR + ' : ' + e.message);
    warn('Le paquet reste disponible localement dans ' + FINAL_OUT_DIR);
  }
}

log('Terminé.');
log('Dossier prêt : ' + FINAL_OUT_DIR);
if (!DEPLOY_DIR) {
  log('Pour déployer : --deploy "P:\\Consultation_AppMetier"');
}
