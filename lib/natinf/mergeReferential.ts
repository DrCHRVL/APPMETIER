// Fusion « officiel + mémento » du référentiel NATINF, exécutable au runtime
// (navigateur) — même logique que scripts/build-natinf.mjs, pour que la mise à
// jour par upload du CSV officiel produise un référentiel identique au build CLI.
//
// L'export officiel data.gouv / DACG est encodé en Latin-1 (windows-1252) et
// séparé par « ; ». Le libellé, la nature et les articles en proviennent (ils
// font foi) ; le quantum « parquet », le thème et l'indicateur « fréquent »
// proviennent du mémento.

import type { NatinfEntry, NatinfNature, NatinfQuantum } from '@/types/natinf';

/** Entrée brute du mémento (data/natinf/natinf-memento.json). */
export interface MementoRawEntry {
  code: string;
  libelleMemento?: string | null;
  quantumRaw?: string;
  nature: NatinfNature;
  perpetuite?: boolean;
  reclusionAnnees?: number;
  emprisonnementMois?: number;
  amendeSeule?: boolean;
  classe?: 1 | 2 | 3 | 4 | 5;
  categorie?: string;
}

export interface MergeReport {
  total: number;
  frequent: number;
  official: number;
  enriched: number;
  added: number;
  natureMismatch: { code: string; memento: NatinfNature; officiel: NatinfNature }[];
}

export interface MergeResult {
  entries: NatinfEntry[];
  report: MergeReport;
}

const norm = (s: string): string =>
  (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Décode le contenu brut d'un CSV officiel. L'export DACG est en Latin-1 ;
 * on tente l'UTF-8 et on bascule en windows-1252 si des caractères de
 * remplacement apparaissent.
 */
export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (utf8.includes('�')) {
    return new TextDecoder('windows-1252', { fatal: false }).decode(buffer);
  }
  return utf8;
}

/** Parse un CSV/; en gérant les guillemets et les retours à la ligne internes. */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
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

function readCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n'));
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  return parseDelimited(text, delimiter);
}

function mapColumns(header: string[]) {
  const find = (...keys: string[]) => header.findIndex(h => keys.some(k => norm(h).includes(k)));
  return {
    code: find('natinf', 'numero', 'numéro', 'code'),
    libelle: find('qualif', 'libelle', 'libellé', 'intitule'),
    nature: find('nature'),
    def: find('defini', 'definiss', 'definit', 'incrimin'),
    rep: find('peine', 'edict', 'édict', 'reprim', 'répress', 'repress'),
  };
}

function normalizeNature(natureStr: string): { nature?: NatinfNature; classe?: 1 | 2 | 3 | 4 | 5 } {
  const n = norm(natureStr);
  if (!n) return {};
  if (n.includes('crime')) return { nature: 'crime' };
  if (n.includes('contravention')) {
    const m = n.match(/(\d)\s*(e|eme|ème|er)?\s*class/);
    return m ? { nature: 'contravention', classe: parseInt(m[1], 10) as 1 | 2 | 3 | 4 | 5 } : { nature: 'contravention' };
  }
  if (n.includes('delit')) return { nature: 'delit' };
  if (n.includes('civil')) return { nature: 'civile' };
  return {};
}

export function quantumLabel(nature: NatinfNature, q: NatinfQuantum = {}): string {
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
  if (nature === 'civile') return 'Infraction civile';
  return 'Nature indéterminée';
}

/**
 * Fusionne le mémento (base) avec l'export officiel (overlay faisant foi).
 * @param officialCsvText contenu décodé du CSV officiel
 * @param memento entrées brutes du mémento (natinf-memento.json)
 */
export function mergeReferential(officialCsvText: string, memento: MementoRawEntry[]): MergeResult {
  const byCode = new Map<string, NatinfEntry>();

  // 1) Base = mémento
  for (const e of memento) {
    const quantum: NatinfQuantum = {};
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
      quantumLabel: '',
      theme: e.categorie || undefined,
      frequent: true,
    });
  }

  // 2) Overlay export officiel
  const report: MergeReport = { total: 0, frequent: 0, official: 0, enriched: 0, added: 0, natureMismatch: [] };
  const rows = readCsv(officialCsvText);
  if (!rows.length) throw new Error('CSV vide ou illisible.');
  const col = mapColumns(rows[0]);
  if (col.code < 0 || col.libelle < 0) {
    throw new Error('Colonnes NATINF/qualification introuvables dans le CSV (en-tête : ' + rows[0].join(' | ') + ').');
  }
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const code = (row[col.code] || '').trim();
    if (!code) continue;
    report.official++;
    const offLibelle = (row[col.libelle] || '').trim();
    const offNatureRaw = col.nature >= 0 ? (row[col.nature] || '').trim() : '';
    const offDef = col.def >= 0 ? (row[col.def] || '').trim() : '';
    const offRep = col.rep >= 0 ? (row[col.rep] || '').trim() : '';
    const offNat = normalizeNature(offNatureRaw);
    const existing = byCode.get(code);
    if (existing) {
      report.enriched++;
      if (offNat.nature && existing.nature !== 'inconnu' && offNat.nature !== existing.nature) {
        report.natureMismatch.push({ code, memento: existing.nature, officiel: offNat.nature });
      }
      existing.libelle = offLibelle || existing.libelle;
      if (offNat.nature) existing.nature = offNat.nature;
      if (offNat.classe != null && existing.quantum.classe == null) existing.quantum.classe = offNat.classe;
      existing.natureOfficielle = offNatureRaw || undefined;
      existing.articlesDefinition = offDef || undefined;
      existing.articlesRepression = offRep || undefined;
    } else {
      report.added++;
      const quantum: NatinfQuantum = offNat.classe != null ? { classe: offNat.classe } : {};
      byCode.set(code, {
        code,
        libelle: offLibelle || `NATINF ${code}`,
        nature: offNat.nature || 'inconnu',
        quantum,
        quantumLabel: '',
        frequent: false,
        natureOfficielle: offNatureRaw || undefined,
        articlesDefinition: offDef || undefined,
        articlesRepression: offRep || undefined,
      });
    }
  }

  // 3) Finalisation
  const entries = [...byCode.values()]
    .map(e => ({ ...e, quantumLabel: quantumLabel(e.nature, e.quantum) }))
    .sort((a, b) => parseInt(a.code, 10) - parseInt(b.code, 10));

  report.total = entries.length;
  report.frequent = entries.filter(e => e.frequent).length;
  return { entries, report };
}
