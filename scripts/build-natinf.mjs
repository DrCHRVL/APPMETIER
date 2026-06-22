#!/usr/bin/env node
/**
 * Construit le référentiel NATINF runtime (data/natinf/natinf.json) à partir de :
 *
 *   1. data/natinf/natinf-memento.json  — extraction du « Mémento parquet »
 *      (codes fréquents, quantum abrégé « parquet », thème). Toujours présent.
 *
 *   2. [optionnel] l'export OFFICIEL data.gouv.fr « Liste des infractions en
 *      vigueur de la nomenclature NATINF » (Ministère de la Justice / DACG).
 *      C'est la source FAISANT FOI pour le libellé, la nature et les articles.
 *      Voir data/natinf/README.md pour le lien direct et la procédure.
 *
 * Le mémento apporte ce que l'export officiel n'a pas (quantum « parquet »
 * abrégé, thème, indicateur « fréquent ») ; l'export officiel apporte
 * l'exhaustivité et les libellés/articles faisant foi. Le merge se fait par code.
 *
 * Usage :
 *   node scripts/build-natinf.mjs                       # mémento seul
 *   node scripts/build-natinf.mjs --official <fichier.csv>   # mémento + officiel
 *
 * Sans dépendance externe (Node >= 18).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEMENTO = join(ROOT, 'data/natinf/natinf-memento.json');
const OUT = join(ROOT, 'data/natinf/natinf.json');

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const officialIdx = args.indexOf('--official');
const officialPath = officialIdx >= 0 ? args[officialIdx + 1] : null;

// ── Lecture CSV robuste (délimiteur auto ; ou , ; encodage utf-8 / latin1) ──
function readCsv(path) {
  let raw = readFileSync(path);
  // Détection grossière de l'encodage : présence d'octets > 0x7F mal formés UTF-8
  let text = raw.toString('utf-8');
  if (text.includes('�')) text = raw.toString('latin1');
  text = text.replace(/^﻿/, ''); // BOM
  const firstLine = text.slice(0, text.indexOf('\n'));
  const delimiter = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const rows = parseDelimited(text, delimiter);
  return rows;
}

// Parse CSV/; en gérant les champs entre guillemets et les retours à la ligne internes.
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Repère les colonnes officielles par mots-clés d'en-tête (robuste aux variantes).
function mapColumns(header) {
  const find = (...keys) => header.findIndex(h => keys.some(k => norm(h).includes(k)));
  return {
    code: find('natinf', 'numero', 'numéro', 'code'),
    libelle: find('qualif', 'libelle', 'libellé', 'intitule'),
    nature: find('nature'),
    def: find('definiss', 'definit', 'définiss', 'incrimin'),
    rep: find('peine', 'edict', 'édict', 'reprim', 'répress', 'repress'),
  };
}

// Nature officielle (texte) -> nature normalisée + classe de contravention.
function normalizeNature(natureStr) {
  const n = norm(natureStr);
  if (!n) return {};
  if (n.includes('crime')) return { nature: 'crime' };
  if (n.includes('contravention')) {
    const m = n.match(/(\d)\s*(e|eme|ème|er)?\s*class/);
    return m ? { nature: 'contravention', classe: parseInt(m[1], 10) } : { nature: 'contravention' };
  }
  if (n.includes('delit')) return { nature: 'delit' };
  return {};
}

function quantumLabel(nature, q) {
  if (!q) q = {};
  if (nature === 'crime') {
    if (q.perpetuite) return 'Crime — réclusion à perpétuité';
    if (q.reclusionAnnees) return `Crime — ${q.reclusionAnnees} ans`;
    return 'Crime';
  }
  if (nature === 'delit') {
    if (q.emprisonnementMois) {
      const m = q.emprisonnementMois;
      return m % 12 === 0 ? `Délit — ${m / 12} an${m / 12 > 1 ? 's' : ''}` : `Délit — ${m} mois`;
    }
    if (q.amendeSeule) return 'Délit — amende';
    return 'Délit';
  }
  if (nature === 'contravention') {
    return q.classe ? `Contravention — ${q.classe}e classe` : 'Contravention';
  }
  return 'Nature indéterminée';
}

// ── Construction ────────────────────────────────────────────────────────────
const memento = JSON.parse(readFileSync(MEMENTO, 'utf-8'));
const byCode = new Map();

// 1) Base = mémento (fréquents, quantum « parquet », thème)
for (const e of memento) {
  const quantum = {};
  if (e.perpetuite) quantum.perpetuite = true;
  if (e.reclusionAnnees != null) quantum.reclusionAnnees = e.reclusionAnnees;
  if (e.emprisonnementMois != null) quantum.emprisonnementMois = e.emprisonnementMois;
  if (e.amendeSeule) quantum.amendeSeule = true;
  if (e.classe != null) quantum.classe = e.classe;
  byCode.set(e.code, {
    code: e.code,
    libelle: e.libelleMemento || `NATINF ${e.code}`,
    nature: e.nature,
    quantum,
    theme: e.categorie || undefined,
    frequent: true,
  });
}

// 2) Overlay export officiel (libellé/nature/articles faisant foi + exhaustivité)
let report = { official: 0, added: 0, enriched: 0, natureMismatch: [] };
if (officialPath) {
  const rows = readCsv(officialPath);
  const header = rows[0];
  const col = mapColumns(header);
  if (col.code < 0 || col.libelle < 0) {
    console.error('Colonnes officielles introuvables. En-tête lu :', header);
    process.exit(1);
  }
  console.log('Colonnes officielles détectées :', col, '\nEn-tête :', header.map((h, i) => `${i}:${h}`).join(' | '));
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const code = (row[col.code] || '').trim();
    if (!code) continue;
    report.official++;
    const off = {
      libelle: (row[col.libelle] || '').trim(),
      natureRaw: col.nature >= 0 ? (row[col.nature] || '').trim() : '',
      def: col.def >= 0 ? (row[col.def] || '').trim() : '',
      rep: col.rep >= 0 ? (row[col.rep] || '').trim() : '',
    };
    const offNat = normalizeNature(off.natureRaw);
    const existing = byCode.get(code);
    if (existing) {
      report.enriched++;
      // Cross-check nature mémento vs officiel
      if (offNat.nature && existing.nature !== 'inconnu' && offNat.nature !== existing.nature) {
        report.natureMismatch.push({ code, memento: existing.nature, officiel: offNat.nature });
      }
      // Libellé officiel fait foi ; nature officielle fait foi ; on garde le
      // quantum « parquet » précis (années/mois) du mémento.
      existing.libelle = off.libelle || existing.libelle;
      if (offNat.nature) existing.nature = offNat.nature;
      if (offNat.classe != null && existing.quantum.classe == null) existing.quantum.classe = offNat.classe;
      existing.natureOfficielle = off.natureRaw || undefined;
      existing.articlesDefinition = off.def || undefined;
      existing.articlesRepression = off.rep || undefined;
    } else {
      report.added++;
      const quantum = offNat.classe != null ? { classe: offNat.classe } : {};
      byCode.set(code, {
        code,
        libelle: off.libelle || `NATINF ${code}`,
        nature: offNat.nature || 'inconnu',
        quantum,
        frequent: false,
        natureOfficielle: off.natureRaw || undefined,
        articlesDefinition: off.def || undefined,
        articlesRepression: off.rep || undefined,
      });
    }
  }
}

// 3) Finalisation : quantumLabel + tri par code
const out = [...byCode.values()]
  .map(e => ({ ...e, quantumLabel: quantumLabel(e.nature, e.quantum) }))
  .sort((a, b) => parseInt(a.code, 10) - parseInt(b.code, 10));

writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n', 'utf-8');

console.log(`\n✓ ${OUT}`);
console.log(`  Total codes        : ${out.length}`);
console.log(`  Fréquents (mémento): ${out.filter(e => e.frequent).length}`);
if (officialPath) {
  console.log(`  Lignes officielles : ${report.official}`);
  console.log(`  Enrichis (match)   : ${report.enriched}`);
  console.log(`  Ajoutés (officiel) : ${report.added}`);
  if (report.natureMismatch.length) {
    console.log(`  ⚠ Écarts de nature mémento/officiel : ${report.natureMismatch.length}`);
    for (const m of report.natureMismatch.slice(0, 20)) {
      console.log(`     NATINF ${m.code} : mémento=${m.memento} officiel=${m.officiel}`);
    }
    if (report.natureMismatch.length > 20) console.log(`     … (+${report.natureMismatch.length - 20})`);
  }
} else {
  console.log('  (export officiel non fourni — référentiel = mémento seul ;');
  console.log('   relancer avec --official <csv> pour compléter, cf. data/natinf/README.md)');
}
