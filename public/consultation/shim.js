/* eslint-disable */
/**
 * Mode consultation (lecture seule) — remplace window.electronAPI par un shim
 * qui sert un instantané JSON figé et ignore toutes les écritures.
 *
 * Chargé en tout premier dans app/layout.tsx quand NEXT_PUBLIC_CONSULTATION=1.
 *
 * L'instantané est fourni par `data-snapshot.js` (chargé juste après ce fichier),
 * qui définit `window.__CONSULTATION_SNAPSHOT__ = { generatedAt, serverRootPath, data, documents, users }`.
 *
 * Format de `data` : un objet plat { "<cle>": <valeur applicative> } correspondant
 * exactement à ce que `ElectronBridge.getData(<cle>)` doit retourner. Le shim
 * l'enveloppe dans { version, data } comme attendu par le bridge.
 */
(function () {
  'use strict';

  // Marqueur global utilisé par l'UI (CSS, code applicatif si besoin)
  window.__APP_READONLY__ = true;

  var snap = function () {
    return window.__CONSULTATION_SNAPSHOT__ || { data: {}, documents: {}, users: [], serverRootPath: '' };
  };

  // ──────────────────────────────────────────────────────────────────────
  // Notifications "lecture seule" — un toast minimal, débitable
  // ──────────────────────────────────────────────────────────────────────
  var lastToastAt = 0;
  function readonlyNotify(message) {
    var now = Date.now();
    if (now - lastToastAt < 4000) return; // anti-spam
    lastToastAt = now;
    showToast(message || 'Mode consultation — modification ignorée');
  }
  window.__readonlyNotify = readonlyNotify;

  function showToast(text) {
    try {
      var host = document.getElementById('__readonly_toast__');
      if (!host) {
        host = document.createElement('div');
        host.id = '__readonly_toast__';
        host.style.cssText = [
          'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
          'background:#1f2937', 'color:#fff', 'padding:10px 16px', 'border-radius:8px',
          'font-family:system-ui,sans-serif', 'font-size:14px', 'box-shadow:0 4px 12px rgba(0,0,0,.2)',
          'z-index:2147483647', 'opacity:0', 'transition:opacity .2s', 'pointer-events:none',
          'max-width:90vw', 'text-align:center'
        ].join(';');
        (document.body || document.documentElement).appendChild(host);
      }
      host.textContent = text;
      host.style.opacity = '1';
      clearTimeout(host._hideTimer);
      host._hideTimer = setTimeout(function () { host.style.opacity = '0'; }, 2500);
    } catch (e) { /* DOM pas prêt — ignoré */ }
  }

  // Copie un chemin réseau dans le presse-papier (utilisé pour les documents)
  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { readonlyNotify('Chemin copié : ' + text); },
          function () { fallbackCopy(text); }
        );
      } else {
        fallbackCopy(text);
      }
    } catch (e) {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    readonlyNotify('Chemin copié : ' + text);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers de réponse
  // ──────────────────────────────────────────────────────────────────────
  // Les valeurs de data.json sont déjà au format { version, data }
  // (cf. ElectronBridge.setDataInternal). On les retourne telles quelles ;
  // le bridge déballe lui-même.
  function readKey(key) {
    var data = snap().data || {};
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return data[key];
    }
    return null; // → bridge renverra defaultValue
  }

  function noopTrue() { readonlyNotify(); return Promise.resolve(true); }
  function noopFalse() { return Promise.resolve(false); }
  function noopNull() { return Promise.resolve(null); }
  function noopEmptyArr() { return Promise.resolve([]); }
  function noopVoid() { return Promise.resolve(); }
  function noopCancel() { readonlyNotify(); return Promise.resolve({ canceled: true }); }

  // Réponse type "pull" sans push : permet au MultiSync de bailler proprement
  function noopPull() {
    return Promise.resolve({ data: null, metadata: null, readOnly: true });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Document → on retourne le chemin réseau pour copie presse-papier
  // ──────────────────────────────────────────────────────────────────────
  function buildUncPath(enqueteNumero, cheminRelatif, contentieuxId) {
    var root = snap().serverRootPath || '';
    var parts = [root];
    if (contentieuxId) parts.push(contentieuxId);
    parts.push('documentenquete');
    if (enqueteNumero) parts.push(String(enqueteNumero));
    if (cheminRelatif) parts.push(String(cheminRelatif));
    return parts.filter(Boolean).join('\\').replace(/\\+/g, '\\');
  }

  function handleOpenDocument(enqueteNumero, cheminRelatif) {
    // On ne sait pas toujours à quel contentieux appartient l'enquête depuis ici,
    // mais le snapshot index les documents avec leur uncPath complet.
    var docs = (snap().documents || {})[enqueteNumero];
    if (docs && docs.length) {
      var match = docs.find(function (d) { return d.cheminRelatif === cheminRelatif; });
      if (match && match.uncPath) {
        copyToClipboard(match.uncPath);
        return Promise.resolve({ success: false, readOnly: true, uncPath: match.uncPath });
      }
    }
    // Repli : best-effort sans contentieuxId
    var unc = buildUncPath(enqueteNumero, cheminRelatif);
    copyToClipboard(unc);
    return Promise.resolve({ success: false, readOnly: true, uncPath: unc });
  }

  function handleOpenExternal(filePath) {
    if (filePath) copyToClipboard(String(filePath));
    return Promise.resolve({ success: false, readOnly: true });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Le shim complet
  // ──────────────────────────────────────────────────────────────────────
  var api = {
    // ── KV principal (utilisé par ElectronBridge.getData/setData) ──
    getData: function (key /*, defaultValue */) {
      if (key === '__keys__') {
        return Promise.resolve(Object.keys(snap().data || {}));
      }
      return Promise.resolve(readKey(key));
    },
    setData: noopTrue,
    clearData: noopTrue,
    getAllKeys: function () { return Promise.resolve(Object.keys(snap().data || {})); },

    // ── Dialogs / fichiers locaux ──
    openFileDialog: noopCancel,
    saveFileDialog: noopCancel,
    selectFolder: noopCancel,
    saveCasierFile: noopFalse,
    deleteCasierFile: noopFalse,
    openExternalFile: handleOpenExternal,
    openExternalUrl: function (url) {
      // URLs http(s) — on tente l'ouverture standard
      try { window.open(url, '_blank', 'noopener'); } catch (e) {}
      return Promise.resolve({ success: true });
    },

    saveFile: noopFalse,
    readFile: noopNull,
    listFiles: noopEmptyArr,
    deleteFile: noopFalse,

    // ── data.json / sauvegardes locales ──
    copyDataJson: noopFalse,
    restoreDataJson: noopFalse,
    getDataJsonInfo: function () { return Promise.resolve({ exists: false, readOnly: true }); },
    compareWithDataJson: function () { return Promise.resolve({ identical: true, readOnly: true }); },
    listDataJsonBackups: noopEmptyArr,
    getBackupStats: function () { return Promise.resolve({ count: 0, total: 0 }); },
    cleanOldBackups: noopFalse,

    // ── Documents ──
    saveDocuments: noopFalse,
    copyToExternalPath: noopFalse,
    validatePath: function () { return Promise.resolve({ valid: false, readOnly: true }); },
    openExternalFolder: handleOpenExternal,
    deleteFromExternalPath: noopFalse,
    syncDocuments: function () { return Promise.resolve({ added: 0, removed: 0, readOnly: true }); },
    scanForNewDocuments: noopEmptyArr,
    deleteDocument: noopFalse,
    openDocument: handleOpenDocument,
    documentExists: function () { return Promise.resolve(true); }, // on suppose présent pour ne pas casser l'UI
    getDocumentSize: function () { return Promise.resolve(0); },
    extractPDFText: function () { return Promise.resolve(''); },
    scanExternalPDFs: noopEmptyArr,

    // ── Config serveur ──
    serverConfig_get: function () {
      return Promise.resolve({ serverRootPath: snap().serverRootPath || '', readOnly: true });
    },
    serverConfig_setup: noopFalse,
    serverConfig_reset: noopFalse,

    // ── Sync data (DataSyncManager) ──
    dataSync_checkAccess: function () {
      return Promise.resolve({ accessible: true, readOnly: true });
    },
    dataSync_pull: noopPull,
    dataSync_push: noopFalse,
    dataSync_backupServer: noopFalse,
    dataSync_deleteServerBackup: noopFalse,
    dataSync_listServerBackups: noopEmptyArr,
    dataSync_readServerBackup: noopNull,
    dataSync_listAdminBackups: noopEmptyArr,
    dataSync_restoreAdminBackup: noopFalse,
    dataSync_checkContentieuxAccess: function () {
      return Promise.resolve({ accessible: true, readOnly: true });
    },
    dataSync_pullContentieux: noopPull,
    dataSync_pushContentieux: noopFalse,
    dataSync_backupContentieux: noopFalse,
    dataSync_listContentieuxBackups: noopEmptyArr,
    dataSync_readContentieuxBackup: noopNull,

    // ── users.json multi-contentieux ──
    dataSync_pullUsersConfig: function () {
      var users = snap().users || [];
      return Promise.resolve({ data: { users: users }, metadata: null, readOnly: true });
    },
    dataSync_pushUsersConfig: noopFalse,

    // ── Fichiers globaux partagés ──
    globalSync_pullTags: noopPull,
    globalSync_pushTags: noopFalse,
    globalSync_pullAudience: noopPull,
    globalSync_pushAudience: noopFalse,
    globalSync_pullAlerts: noopPull,
    globalSync_pushAlerts: noopFalse,
    globalSync_pullDeletedIds: noopPull,
    globalSync_pushDeletedIds: noopFalse,
    globalSync_pullCartographie: noopPull,
    globalSync_pushCartographie: noopFalse,
    globalSync_readLegacyAppData: noopNull,
    globalSync_pullUserPreferences: noopPull,
    globalSync_pushUserPreferences: noopFalse,
    globalSync_pullContentieuxAlerts: noopPull,
    globalSync_pushContentieuxAlerts: noopFalse,

    // ── Chemins effectifs ──
    paths_getEffective: function () {
      return Promise.resolve({ serverRootPath: snap().serverRootPath || '', contentieux: {}, readOnly: true });
    },
    paths_migrateContentieux: noopFalse,
    paths_migrateGeneral: noopFalse,

    // ── Sync Instruction (privé utilisateur) ──
    instructionSync_check: function () { return Promise.resolve({ accessible: false, readOnly: true }); },
    instructionSync_pull: noopPull,
    instructionSync_push: noopFalse,
    instructionSync_listBackups: noopEmptyArr,
    instructionSync_readBackup: noopNull,

    // ── Heartbeats / événements partagés / audit ──
    writeHeartbeat: noopVoid,
    removeHeartbeat: noopVoid,
    readAllHeartbeats: noopEmptyArr,
    writeSharedEvent: noopVoid,
    cleanupSharedEvents: noopVoid,
    startEventsWatcher: noopVoid,
    onSharedEvent: function () { /* no-op subscribe */ },
    readRecentSharedEvents: function () { return Promise.resolve({ events: [], partial: false }); },
    appendAuditLog: noopVoid,
    readAuditLog: noopEmptyArr,

    // ── Réseau ──
    startNetworkMonitor: noopVoid,
    stopNetworkMonitor: noopVoid,
    probeNetwork: function () { return Promise.resolve('healthy'); },
    getNetworkStatus: function () { return Promise.resolve('healthy'); },
    onNetworkStatus: function () { /* no-op */ },

    // ── Utilisateur courant ──
    getCurrentUser: function () {
      var u = (snap().users || []).find(function (x) { return x && x.consultation === true; });
      return Promise.resolve({
        username: (u && u.username) || 'consultation',
        displayName: (u && u.displayName) || 'Consultation (lecture seule)'
      });
    },

    // ── Mise à jour app ──
    checkAppUpdate: function () { return Promise.resolve({ hasUpdate: false, readOnly: true }); },
    applyAppUpdate: noopFalse,
    getUpdateChangelog: noopNull,
    approveAppUpdate: noopFalse,
    unapproveAppUpdate: noopFalse,
    getApprovedAppUpdate: noopNull,
  };

  // Installation
  window.electronAPI = api;

  // ──────────────────────────────────────────────────────────────────────
  // Intercepteur global des actions d'écriture (défense en profondeur)
  // ──────────────────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    if (!window.__APP_READONLY__) return;
    var target = e.target;
    if (!target || !target.closest) return;
    var hit = target.closest('[data-action="write"], [data-action="delete"], [data-action="save"], [data-action="import"], [data-action="sync"]');
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      readonlyNotify();
    }
  }, true);

  // ──────────────────────────────────────────────────────────────────────
  // Rafraîchissement automatique de l'instantané
  // Toutes les N minutes : on recharge data-snapshot.js et, si generatedAt a
  // changé, on recharge la page pour ré-hydrater toute l'UI.
  // ──────────────────────────────────────────────────────────────────────
  var REFRESH_EVERY_MS = 5 * 60 * 1000; // 5 minutes

  function poll() {
    var initial = snap().generatedAt;
    if (!initial) return; // pas de snapshot — on ne polle pas

    var s = document.createElement('script');
    s.src = './data-snapshot.js?ts=' + Date.now();
    s.onload = function () {
      try {
        if (snap().generatedAt && snap().generatedAt !== initial) {
          showToast('Mise à jour des données — rechargement…');
          setTimeout(function () { window.location.reload(); }, 800);
        }
      } catch (e) {}
      // On enlève le script pour ne pas laisser une centaine d'éléments dans le DOM
      try { s.parentNode && s.parentNode.removeChild(s); } catch (e) {}
    };
    s.onerror = function () {
      try { s.parentNode && s.parentNode.removeChild(s); } catch (e) {}
    };
    document.head.appendChild(s);
  }

  setInterval(poll, REFRESH_EVERY_MS);

  // ──────────────────────────────────────────────────────────────────────
  // Bandeau "Mode consultation"
  // ──────────────────────────────────────────────────────────────────────
  function mountBanner() {
    if (document.getElementById('__readonly_banner__')) return;
    var b = document.createElement('div');
    b.id = '__readonly_banner__';
    var gen = snap().generatedAt;
    var when = gen ? new Date(gen).toLocaleString('fr-FR') : '—';
    b.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;justify-content:center;flex-wrap:wrap">' +
      '  <strong>Mode consultation — lecture seule</strong>' +
      '  <span style="opacity:.85">Données figées au ' + when + '</span>' +
      '  <button id="__readonly_refresh__" style="background:#fff;color:#92400e;border:0;padding:4px 10px;border-radius:6px;font-weight:600;cursor:pointer">Actualiser</button>' +
      '</div>';
    b.style.cssText = [
      'position:sticky', 'top:0', 'z-index:2147483646',
      'background:#fbbf24', 'color:#78350f',
      'padding:8px 16px', 'font-family:system-ui,sans-serif', 'font-size:13px',
      'border-bottom:1px solid #d97706', 'text-align:center'
    ].join(';');
    document.body.insertBefore(b, document.body.firstChild);
    var btn = document.getElementById('__readonly_refresh__');
    if (btn) btn.addEventListener('click', function () { window.location.reload(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBanner);
  } else {
    mountBanner();
  }
})();
