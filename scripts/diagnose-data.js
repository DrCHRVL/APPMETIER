/**
 * diagnose-data.js
 * Diagnostic NON DESTRUCTIF du fichier data.json local.
 * Affiche les cles presentes et, pour les cles d'enquetes (legacy + multi-contentieux),
 * le nombre d'enquetes et leur statut. Permet de localiser ou sont reellement
 * stockes les dossiers quand la vue apparait vide.
 *
 * Usage : node scripts/diagnose-data.js [chemin/vers/data.json]
 * Par defaut : ./data/data.json
 */

const fs = require('fs');
const path = require('path');

const target = process.argv[2] || path.join(__dirname, '..', 'data', 'data.json');

console.log('Lecture de : ' + target);
if (!fs.existsSync(target)) {
  console.error('  -> Fichier introuvable.');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(target, 'utf8'));
} catch (err) {
  console.error('  -> JSON illisible : ' + err.message);
  process.exit(1);
}

const keys = Object.keys(data);
console.log('Nombre de cles : ' + keys.length);

function describeEnquetes(arr) {
  if (!Array.isArray(arr)) return '(pas un tableau)';
  const byStatut = {};
  for (const e of arr) {
    const s = (e && e.statut) || '(sans statut)';
    byStatut[s] = (byStatut[s] || 0) + 1;
  }
  const detail = Object.entries(byStatut).map(([s, n]) => s + '=' + n).join(', ');
  return arr.length + ' enquete(s) [' + detail + ']';
}

console.log('\n=== Cles liees aux enquetes ===');
const enqueteKeys = keys.filter(k => k === 'enquetes' || /_enquetes$/.test(k));
if (enqueteKeys.length === 0) {
  console.log('  Aucune cle d\'enquetes trouvee.');
} else {
  for (const k of enqueteKeys) {
    console.log('  ' + k + ' : ' + describeEnquetes(data[k]));
  }
}

console.log('\n=== Flag de migration ===');
console.log('  migration_multi_contentieux_done = ' + JSON.stringify(data.migration_multi_contentieux_done));

console.log('\n=== Toutes les cles ===');
for (const k of keys.sort()) {
  const v = data[k];
  let size;
  if (Array.isArray(v)) size = 'tableau[' + v.length + ']';
  else if (v && typeof v === 'object') size = 'objet{' + Object.keys(v).length + '}';
  else size = JSON.stringify(v);
  console.log('  ' + k + ' : ' + size);
}
