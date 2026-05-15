#!/usr/bin/env node
/*
 * Import one-shot des dossiers d'instruction depuis le SUIVI_INSTRU.xlsx
 * du parquet d'Amiens vers le data.json de l'application.
 *
 * Usage :
 *   node scripts/import-instructions-xlsx.js \
 *     --xlsx ./SUIVI_INSTRU.xlsx \
 *     --user audran.chevalier \
 *     --parquetier A.CHEVALIER \
 *     [--data-json ./data/data.json] \
 *     [--dry-run]
 *
 * Comportement :
 *   - Lit l'onglet "Saisie" du classeur.
 *   - Filtre les lignes du parquetier dont la "Date 175" est vide
 *     (= dossiers en cours, hors reglement).
 *   - Mappe le JI vers un cabinetId existant dans instructionConfig
 *     (par magistratParDefaut, sinon par "order" via JI_TO_CAB_ORDER).
 *   - Parse intelligemment la liste des MEX (virgules, " et ", parens).
 *   - Cree un DossierInstruction par ligne (mesureSurete = libre par
 *     defaut ; statut brut conserve en notes).
 *   - Fusionne dans data.json sous la cle instructions__<user>.
 *     Les dossiers deja presents (meme numeroParquet) sont ignores.
 *
 * Aucune dependance hors `xlsx` (deja dans package.json).
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Mapping JI -> ordre du cabinet (override possible si le data.json
// contient deja des cabinets nommes ou avec magistratParDefaut).
const JI_TO_CAB_ORDER = {
  LESNIEWSKI: 1,
  SIEBERT: 2,
  MOINE: 3,
  SEGUIN: 4,
};

// Colonnes de l'onglet Saisie (1-based pour clarte).
const COL = {
  parquetier: 9,
  numeroParquet: 10,
  numeroInstruction: 11,
  ji: 12,
  mex: 13,
  faits: 14,
  tomes: 15,
  statut: 16,
  dateRI: 17,
  date175: 18,
};

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--xlsx') args.xlsx = argv[++i];
    else if (a === '--user') args.user = argv[++i];
    else if (a === '--parquetier') args.parquetier = argv[++i];
    else if (a === '--data-json') args.dataJson = argv[++i];
    else throw new Error('Argument inconnu : ' + a);
  }
  if (!args.xlsx) throw new Error('--xlsx <path> requis');
  if (!args.user) throw new Error('--user <windowsUsername> requis');
  if (!args.parquetier) throw new Error('--parquetier <name> requis');
  args.dataJson = args.dataJson || path.join(__dirname, '..', 'data', 'data.json');
  return args;
}

function toIsoDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return d.y + '-' + pad(d.m) + '-' + pad(d.d);
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

// Parse la liste de mis en examen depuis une chaine libre.
// Retourne { mex: [{nom, notes?}], victimes: [{nom}] }.
function parseMexField(raw) {
  if (!raw || typeof raw !== 'string') return { mex: [], victimes: [] };
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return { mex: [], victimes: [] };

  // Capture toutes les parentheses et les retire pour le split. Le placeholder
  // est sans espace pour resister a un trim() des morceaux.
  const parens = [];
  const stripped = cleaned.replace(/\s*\(([^()]*)\)/g, (_m, inner) => {
    parens.push(inner.trim());
    return '@@P' + (parens.length - 1) + '@@';
  });

  // Split sur virgules puis " et " (insensible a la casse).
  const parts = stripped
    .split(',')
    .flatMap((s) => s.split(/\s+et\s+/i))
    .map((s) => s.trim())
    .filter(Boolean);

  const mex = [];
  const victimes = [];

  for (const partRaw of parts) {
    // Reinjecte les parens.
    const part = partRaw.replace(/@@P(\d+)@@/g, (_m, idx) => ' (' + parens[+idx] + ')').trim();
    if (!part) continue;

    // Cas "X" seul ou "X (...)"
    const xMatch = part.match(/^X\b\s*(?:\(([^)]*)\))?\s*$/i);
    if (xMatch) {
      const inside = (xMatch[1] || '').trim();
      const note = inside ? 'Auteur inconnu — ' + inside : 'Auteur inconnu';
      mex.push({ nom: 'X', notes: note });
      const v = inside.match(/victime\s*:?\s*(.+)/i);
      if (v && v[1]) victimes.push({ nom: v[1].trim() });
      // Heuristique : "CPC <nom>" -> partie civile en victime
      const c = inside.match(/^CPC\s+(.+)$/i);
      if (c && c[1]) victimes.push({ nom: c[1].trim() });
      continue;
    }

    // Cas "Nom Prenom (CPC|victime : Truc Bidule)"
    const vicMatch = part.match(/^(.*?)\s*\(\s*(?:CPC|victime)\s*:?\s*([^)]+)\)\s*$/i);
    if (vicMatch) {
      const nom = vicMatch[1].trim();
      const vic = vicMatch[2].trim();
      if (nom) mex.push({ nom });
      if (vic) victimes.push({ nom: vic });
      continue;
    }

    // Cas generique : nom + parens eventuelles en notes.
    const generic = part.match(/^(.*?)\s*(?:\(([^)]*)\))?\s*$/);
    const nom = (generic ? generic[1] : part).trim();
    const noteParen = generic && generic[2] ? generic[2].trim() : null;
    if (!nom) continue;
    mex.push(noteParen ? { nom, notes: noteParen } : { nom });
  }

  return { mex, victimes };
}

function buildJiCabinetResolver(instructionConfig) {
  const cabinets = (instructionConfig && Array.isArray(instructionConfig.cabinets))
    ? instructionConfig.cabinets
    : [];

  const norm = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const byMagistrat = new Map();
  for (const c of cabinets) {
    if (c.magistratParDefaut) byMagistrat.set(norm(c.magistratParDefaut), c.id);
  }
  const byOrder = new Map(cabinets.map((c) => [c.order, c.id]));

  return function resolve(jiName) {
    if (!jiName) return null;
    const k = norm(jiName);
    if (byMagistrat.has(k)) return byMagistrat.get(k);
    const labelHit = cabinets.find((c) => norm(c.label).includes(k));
    if (labelHit) return labelHit.id;
    const order = JI_TO_CAB_ORDER[k];
    if (order && byOrder.has(order)) return byOrder.get(order);
    if (order) return 'cab-' + order;
    return null;
  };
}

let idCounter = Date.now();
const nextId = () => ++idCounter;

function buildDossier(row, resolveCabinetId) {
  const ji = (row.ji || '').toString().trim();
  const cabinetId = resolveCabinetId(ji);
  const dateRI = toIsoDate(row.dateRI);
  if (!dateRI) throw new Error('Date RI manquante pour ' + row.numeroParquet);
  if (!cabinetId) throw new Error('Cabinet introuvable pour JI "' + ji + '" (' + row.numeroParquet + ')');

  const { mex, victimes } = parseMexField(row.mex);
  const now = new Date().toISOString();
  const statutRaw = (row.statut || '').toString().trim();

  const misEnExamen = mex.map((m) => ({
    id: nextId(),
    nom: m.nom,
    dateMiseEnExamen: dateRI,
    infractions: row.faits ? [{ id: 1, qualification: row.faits.toString().trim() }] : [],
    elementsPersonnalite: [],
    mesureSurete: { type: 'libre' },
    dmls: [],
    notes: m.notes || undefined,
  }));

  const victimesOut = victimes.map((v) => ({ id: nextId(), nom: v.nom }));

  const notePerso = statutRaw
    ? [{
        id: nextId(),
        date: now,
        contenu: 'Statut importe depuis SUIVI_INSTRU.xlsx : « ' + statutRaw + ' ». A verifier et preciser (DP, CJ, ARSE, libre...).',
        tags: ['import-xlsx'],
      }]
    : [];

  return {
    id: nextId(),
    numeroInstruction: (row.numeroInstruction || '').toString().trim(),
    numeroParquet: (row.numeroParquet || '').toString().trim(),
    cabinetId,
    magistratInstructeur: ji || undefined,
    dateOuverture: dateRI,
    dateRI,
    description: row.faits ? row.faits.toString().trim() : undefined,
    misEnExamen,
    victimes: victimesOut,
    ops: [],
    debatsJLD: [],
    notesPerso: notePerso,
    verifications: [],
    evenements: [],
    etatReglement: 'en_cours',
    tags: [],
    dateCreation: now,
    dateMiseAJour: now,
  };
}

function readXlsxRows(xlsxPath, parquetier) {
  const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  const ws = wb.Sheets['Saisie'];
  if (!ws) throw new Error('Onglet "Saisie" introuvable dans le classeur');
  const range = XLSX.utils.decode_range(ws['!ref']);

  const rows = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const get = (col1) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c: col1 - 1 })];
      return cell ? cell.v : null;
    };
    const parq = get(COL.parquetier);
    if (parq !== parquetier) continue;
    if (get(COL.date175)) continue;
    rows.push({
      excelRow: r + 1,
      parquetier: parq,
      numeroParquet: get(COL.numeroParquet),
      numeroInstruction: get(COL.numeroInstruction),
      ji: get(COL.ji),
      mex: get(COL.mex),
      faits: get(COL.faits),
      tomes: get(COL.tomes),
      statut: get(COL.statut),
      dateRI: get(COL.dateRI),
    });
  }
  return rows;
}

function loadDataJson(p) {
  if (!fs.existsSync(p)) return {};
  const raw = fs.readFileSync(p, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function backupDataJson(p) {
  if (!fs.existsSync(p)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = p + '.bak-import-' + stamp;
  fs.copyFileSync(p, bak);
  return bak;
}

function main() {
  const args = parseArgs(process.argv);
  const data = loadDataJson(args.dataJson);
  const config = data['instructionConfig'] || null;
  const resolveCabinetId = buildJiCabinetResolver(config);

  const rows = readXlsxRows(args.xlsx, args.parquetier);
  console.log(rows.length + ' ligne(s) en cours pour ' + args.parquetier);

  const dossiers = rows.map((r) => buildDossier(r, resolveCabinetId));

  const storageKey = 'instructions__' + args.user;
  const existing = Array.isArray(data[storageKey]) ? data[storageKey] : [];
  const existingByParquet = new Set(existing.map((d) => d.numeroParquet));

  const fresh = dossiers.filter((d) => !existingByParquet.has(d.numeroParquet));
  const skipped = dossiers.length - fresh.length;
  console.log('   -> ' + fresh.length + ' nouveau(x), ' + skipped + ' deja present(s) (skip)');

  for (const d of dossiers) {
    const mexNames = d.misEnExamen.map((m) => m.nom).join(' | ') || '(aucun)';
    const victimes = d.victimes.length ? ' [vic: ' + d.victimes.map((v) => v.nom).join(' | ') + ']' : '';
    const dup = existingByParquet.has(d.numeroParquet) ? ' [SKIP]' : '';
    console.log('   - ' + d.numeroParquet + ' (' + d.numeroInstruction + ') ' + d.magistratInstructeur + ' -> ' + d.cabinetId + ' | MEX: ' + mexNames + victimes + dup);
  }

  if (args.dryRun) {
    console.log('\n[dry-run] data.json non modifie');
    return;
  }

  const merged = [...existing, ...fresh];
  const next = { ...data, [storageKey]: merged };

  const bak = backupDataJson(args.dataJson);
  if (bak) console.log('Backup : ' + bak);

  fs.mkdirSync(path.dirname(args.dataJson), { recursive: true });
  fs.writeFileSync(args.dataJson, JSON.stringify(next, null, 2), 'utf8');
  console.log('OK ' + fresh.length + ' dossier(s) ecrit(s) dans ' + args.dataJson + ' (cle ' + storageKey + ')');
}

try {
  main();
} catch (e) {
  console.error('ERREUR : ' + e.message);
  process.exit(1);
}
