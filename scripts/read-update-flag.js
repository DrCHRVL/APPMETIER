/**
 * read-update-flag.js
 * Lit le fichier post-update.flag (JSON) passé en argument et sort avec :
 *   - code 0 si la propriete "needsInstall" est vraie (npm install requis)
 *   - code 1 sinon (fichier absent, JSON invalide, ou needsInstall absent/faux)
 *
 * Sert au launcher pour eviter un `node -e` complexe dans du batch.
 * Usage : node scripts/read-update-flag.js <chemin-vers-post-update.flag>
 */

var fs = require('fs');

var flagPath = process.argv[2];
if (!flagPath) {
  process.exit(1);
}

try {
  var raw = fs.readFileSync(flagPath, 'utf8');
  var flag = JSON.parse(raw);
  process.exit(flag && flag.needsInstall ? 0 : 1);
} catch (e) {
  process.exit(1);
}
