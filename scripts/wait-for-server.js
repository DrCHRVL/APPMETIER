/**
 * wait-for-server.js
 * Attend que le serveur Next.js standalone reponde sur http://127.0.0.1:PORT.
 *   - code 0 des qu'une requete HTTP obtient une reponse (n'importe quel statut)
 *   - code 1 si le serveur ne repond pas apres TIMEOUT secondes
 *
 * Usage : node scripts/wait-for-server.js [port=3000] [timeout_en_secondes=60]
 */

var http = require('http');

var port = parseInt(process.argv[2], 10) || 3000;
var timeoutSec = parseInt(process.argv[3], 10) || 60;
var deadline = Date.now() + timeoutSec * 1000;

function ping() {
  var req = http.get(
    { host: '127.0.0.1', port: port, path: '/', timeout: 2000 },
    function (res) {
      res.resume();
      process.exit(0);
    }
  );
  req.on('error', retryOrGiveUp);
  req.on('timeout', function () { req.destroy(); retryOrGiveUp(); });
}

function retryOrGiveUp() {
  if (Date.now() >= deadline) {
    process.exit(1);
  }
  setTimeout(ping, 1000);
}

ping();
