/**
 * check-registry.js
 * Teste l'accessibilite directe de https://registry.npmjs.org/ (sans proxy).
 *   - code 0 si le registry repond 200 en moins de 5 s (pas besoin de proxy)
 *   - code 1 sinon (hors-ligne, proxy obligatoire, DNS KO...)
 *
 * Sert au launcher et a l'installer pour basculer automatiquement sur le
 * proxy RIE quand la connexion directe echoue.
 * Usage : node scripts/check-registry.js
 */

var https = require('https');

var req = https.get(
  'https://registry.npmjs.org/',
  { timeout: 5000 },
  function (res) {
    res.resume();
    process.exit(res.statusCode === 200 ? 0 : 1);
  }
);

req.on('error', function () { process.exit(1); });
req.on('timeout', function () { req.destroy(); process.exit(1); });
