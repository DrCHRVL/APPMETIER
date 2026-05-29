#!/usr/bin/env node
/* eslint-disable */
/**
 * Construit la "coquille" statique HTML/JS/CSS qui sera embarquée dans l'app
 * Electron (extraResources) et déployée sur le partage réseau quand l'admin
 * active la consultation lecture seule.
 *
 * À exécuter UNE FOIS avant de packager l'app (electron-builder le ramasse
 * ensuite via la config "extraResources" de package.json).
 *
 *   npm run build:consultation-shell
 *
 * Produit ./consultation-shell/ contenant : index.html, _next/*, shim.js,
 * Ouvrir.html. La donnée elle-même (data-snapshot.js) est écrite au moment
 * de l'activation, par main.js — pas ici.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NEXT_OUT_DIR = path.join(ROOT, 'out');
const SHELL_DIR = path.join(ROOT, 'consultation-shell');
const SHIM_SRC = path.join(ROOT, 'public', 'consultation', 'shim.js');

function log(m) { console.log('[shell] ' + m); }
function die(m) { console.error('[shell] ✖ ' + m); process.exit(1); }

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
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

log('Build statique Next.js (output: export, NEXT_PUBLIC_CONSULTATION=1)…');
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
if (!fs.existsSync(NEXT_OUT_DIR)) die('Dossier ./out introuvable après le build.');

log('Assemblage de ./consultation-shell/…');
rmrf(SHELL_DIR);
copyDir(NEXT_OUT_DIR, SHELL_DIR);
fs.copyFileSync(SHIM_SRC, path.join(SHELL_DIR, 'shim.js'));

// Page d'accueil statique — la donnée concrète (utilisateur, date) est
// remplie par main.js au moment de l'activation via une simple substitution.
const ouvrirTemplate = `<!doctype html>
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
      <li>Les boutons d'écriture sont <strong>grisés</strong>.</li>
      <li>Cliquer sur une pièce jointe copie son chemin réseau dans le presse-papier.</li>
      <li>Les données sont rafraîchies automatiquement par votre collègue.</li>
    </ul>
    <a class="btn" href="./index.html">Entrer dans l'application</a>
  </div>
  <p class="meta">Vous êtes redirigée automatiquement dans quelques secondes.</p>
</body>
</html>
`;
fs.writeFileSync(path.join(SHELL_DIR, 'Ouvrir.html'), ouvrirTemplate, 'utf-8');

log('Terminé. ' + SHELL_DIR + ' prêt à être embarqué par electron-builder.');
