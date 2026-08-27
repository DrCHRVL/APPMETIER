// utils/cassiopeeImportUtils.ts
//
// Import « bricolage » des données Cassiopée par copier-coller.
//
// Cassiopée (v2.cassiopee.intranet.justice.gouv.fr) est sur l'intranet justice,
// sans API et sans accès hors proxy : impossible de s'y connecter depuis SIRAL.
// De plus la page « Résumé Dossier » charge ses tableaux (Personnes, Événements,
// Infractions) en AJAX *après* le rendu — le code source HTML brut les contient
// donc vides. Le seul canal fiable est le copier-coller du tableau AFFICHÉ :
// quand on sélectionne un tableau HTML et qu'on le copie, on obtient du texte
// tabulé (une colonne = une tabulation, une ligne = une entrée).
//
// Ce module parse ces trois tableaux et les convertit vers le modèle
// d'instruction (MisEnExamen, Suspect, Victime, SaisineItem, EvenementInstruction).

import type { NatinfEntry, NatinfRef } from '@/types/natinf';
import { toRef } from '@/lib/natinf/natinfData';
import type {
  MisEnExamen,
  Suspect,
  Victime,
  SaisineItem,
  InfractionReproche,
  EvenementInstruction,
  MesureSurete,
  CategorieExpertise,
  PeriodeDetentionProvisoire,
  RegimeDetentionProvisoire,
  DemandeMiseEnLiberte,
} from '@/types/instructionTypes';
import { getCasDPById, type CasDP } from '@/config/dpRegimes';
import { calculatePeriodeDPEnd, calculateDMLEcheance } from '@/utils/instructionUtils';

// ──────────────────────────────────────────────
// GÉNÉRATEUR D'ID
// ──────────────────────────────────────────────

/**
 * Générateur d'identifiants monotone. On évite `Date.now()` dans une boucle
 * serrée (collisions possibles) : un compteur incrémental garantit l'unicité
 * au sein d'un même import.
 */
export const makeIdGen = (): (() => number) => {
  let seed = Date.now();
  return () => ++seed;
};

// ──────────────────────────────────────────────
// HELPERS TEXTE / DATE / NOM
// ──────────────────────────────────────────────

/** Normalise une chaîne : minuscules, sans accents, espaces compactés. */
export const normalizeText = (s: string | undefined | null): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Normalise un nom de personne pour la déduplication et le rapprochement :
 * on enlève le contenu entre parenthèses (ex : « (R) », « (TR) »), les accents
 * et la casse.
 */
export const normalizeNom = (nom: string | undefined | null): string =>
  normalizeText((nom || '').split('(')[0]);

/**
 * Convertit une date française (JJ/MM/AAAA ou J/M/AAAA, parfois sans zéro de
 * tête comme « 3/02/2026 ») vers l'ISO AAAA-MM-JJ utilisé par les `<input
 * type="date">` et le modèle. Renvoie '' si non reconnue.
 */
export const parseFrDate = (raw: string | undefined | null, pivotBirthYear = false): string => {
  if (!raw) return '';
  const str = String(raw).trim().replace(/^le\s+/i, '');
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  const [, dd, mm, yyRaw] = m;
  // Une année sur 2 chiffres pour une date de naissance (« 65 ») désigne 1965,
  // pas 2065 : on pivote sur l'année en cours. Les autres dates restent en 20YY.
  const century = pivotBirthYear && Number(yyRaw) > (new Date().getFullYear() % 100) ? '19' : '20';
  const year = yyRaw.length === 2 ? `${century}${yyRaw}` : yyRaw;
  const day = dd.padStart(2, '0');
  const month = mm.padStart(2, '0');
  if (Number(month) < 1 || Number(month) > 12) return '';
  if (Number(day) < 1 || Number(day) > 31) return '';
  // Rejeter les dates impossibles (31/02, 30/02…) : sans ce contrôle, le
  // <input type="date"> reste vide et new Date(iso) donne Invalid Date → NaN.
  const iso = `${year}-${month}-${day}`;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime()) || d.getDate() !== Number(day)) return '';
  return iso;
};

const DATE_CELL_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

/** Découpe un bloc collé en lignes de cellules (tabulations). */
const toRows = (text: string): string[][] =>
  (text || '')
    .split(/\r?\n/)
    .map(line => line.split('\t').map(c => c.trim()))
    .filter(cells => cells.some(c => c.length > 0));

/** Ligne d'en-tête d'un tableau Cassiopée (à ignorer) ? */
const isHeaderRow = (cells: string[]): boolean => {
  const joined = normalizeText(cells.join(' '));
  return (
    joined.includes('personnes concernees') ||
    (joined.includes('emetteur') && joined.includes('evenement')) ||
    (joined.includes('identite') && joined.includes('role')) ||
    (joined.startsWith('rang') && joined.includes('natinf'))
  );
};

/** Lignes de bruit UI (boutons, pagination…) à ignorer. */
const isNoiseRow = (cells: string[]): boolean => {
  const joined = normalizeText(cells.join(' '));
  if (!joined) return true;
  return (
    joined.startsWith('ajouter') ||
    joined.startsWith('creer') ||
    joined.includes('elements <<') ||
    joined === 'ok'
  );
};

// ──────────────────────────────────────────────
// TABLEAU « PERSONNES »
// Colonnes : Rang | Identité | Complément d'identité | B1 | Mineur |
//            Rôle | D.U.P | Catégorie pénale | Avocat
// ──────────────────────────────────────────────

export type CassiopeeRole =
  | 'mis_en_examen'
  | 'mis_en_cause'
  | 'temoin_assiste'
  | 'temoin'
  | 'victime'
  | 'victime_beneficiaire'
  | 'partie_civile'
  | 'autre';

export interface ParsedPersonne {
  rang?: string;
  nom: string;
  dateNaissance?: string; // ISO
  role: CassiopeeRole;
  roleLabel: string;
  mineur?: boolean;
  categoriePenale?: string; // "DP" | "CJ" | "ARSE" | autre libellé
  avocat?: string;
}

/** Détecte le rôle Cassiopée dans une cellule (ordre = spécifique → générique). */
const detectRole = (cells: string[]): { role: CassiopeeRole; label: string } => {
  const map: [RegExp, CassiopeeRole, string][] = [
    [/mis en examen/, 'mis_en_examen', 'Mis en examen'],
    [/mis en cause/, 'mis_en_cause', 'Mis en cause'],
    [/temoin assiste/, 'temoin_assiste', 'Témoin assisté'],
    [/partie civile/, 'partie_civile', 'Partie civile'],
    [/victime beneficiaire/, 'victime_beneficiaire', 'Victime bénéficiaire'],
    [/victime/, 'victime', 'Victime'],
    [/temoin/, 'temoin', 'Témoin'],
  ];
  for (const cell of cells) {
    const n = normalizeText(cell);
    for (const [re, role, label] of map) {
      if (re.test(n)) return { role, label };
    }
  }
  return { role: 'autre', label: '' };
};

/**
 * Repère une catégorie pénale courte dans les cellules et la normalise vers les
 * trois natures de mesure du modèle (DP / CJ / ARSE). Cassiopée écrit parfois
 * « DET » (détenu) ou « DPAC » (détention + AC) : on les rabat sur « DP » ;
 * « CJPM » (contrôle judiciaire mineur) sur « CJ ».
 */
const detectCategoriePenale = (cells: string[]): string | undefined => {
  for (const cell of cells) {
    const c = cell.trim().toUpperCase();
    if (c === 'DP' || c === 'DET' || c === 'DPAC') return 'DP';
    if (c === 'CJ' || c === 'CJPM') return 'CJ';
    if (c === 'ARSE') return 'ARSE';
  }
  return undefined;
};

/**
 * Détecte, par correspondance EXACTE de cellule, la présence d'une catégorie
 * pénale coercitive (DP/DET/DPAC/CJ/CJPM/ARSE). Sert de repli pour importer une
 * ligne de personne dont le rôle n'est pas reconnu (dossier jugé : « Jugé »,
 * « Prévenu », « Condamné »…) : en instruction, une personne sous mesure de
 * sûreté est nécessairement mise en examen. La correspondance exacte (et non par
 * mot-clé) évite les faux positifs sur les lignes d'événements (« détention
 * provisoire » en toutes lettres ne déclenche rien).
 */
const PENAL_CAT_TOKENS = new Set(['DP', 'DET', 'DPAC', 'CJ', 'CJPM', 'ARSE']);
const hasPenalStateCell = (cells: string[]): boolean =>
  cells.some(c => PENAL_CAT_TOKENS.has(c.trim().toUpperCase()));

export const parsePersonnesTable = (text: string): ParsedPersonne[] => {
  const out: ParsedPersonne[] = [];
  for (const cells of toRows(text)) {
    if (isHeaderRow(cells) || isNoiseRow(cells)) continue;
    // Une ligne du tableau ÉVÉNEMENTS commence toujours par une date (1re
    // colonne) ; jamais une ligne du tableau PERSONNES (Rang ou Identité).
    // Sans ce garde-fou, un motif d'événement contenant un mot-clé de rôle en
    // toutes lettres (ex : « examen de victime ») fait détecter un rôle
    // « Victime » sur la ligne, et l'émetteur de l'événement (le magistrat)
    // est alors importé comme une personne du dossier.
    if (DATE_CELL_RE.test(cells[0])) continue;

    let { role, label } = detectRole(cells);
    if (role === 'autre') {
      // Repli : rôle non reconnu mais catégorie pénale coercitive présente
      // (dossier jugé, personne détenue/CJ/ARSE) → mis en examen.
      if (hasPenalStateCell(cells)) {
        role = 'mis_en_examen';
        label = 'Mis en examen';
      } else {
        continue; // ligne sans rôle exploitable
      }
    }

    // Rang = 1re cellule si purement numérique.
    const rang = /^\d+$/.test(cells[0]) ? cells[0] : undefined;

    // Nom = 1re cellule alphabétique qui n'est ni le rôle, ni une date,
    // ni une catégorie pénale, ni « Mention » (colonne B1), ni le placeholder
    // « X » (personne non dénommée / « contre X »).
    let nom = '';
    for (let i = rang ? 1 : 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c) continue;
      const n = normalizeText(c);
      if (DATE_CELL_RE.test(c)) continue;
      if (n === 'mention' || n === 'min' || n === 'non' || n === 'oui') continue;
      if (n === 'x' || n === '...' || n === '-') continue;
      if (['dp', 'det', 'dpac', 'cj', 'cjpm', 'arse'].includes(n)) continue;
      if (n === label.toLowerCase() || detectRole([c]).role !== 'autre') continue;
      if (/[a-zàâäéèêëïîôöùûüç]/i.test(c)) {
        nom = c.replace(/\s+/g, ' ').trim();
        break;
      }
    }
    if (!nom) continue;

    const dateCell = cells.find(c => DATE_CELL_RE.test(c));
    const dateNaissance = dateCell ? parseFrDate(dateCell, true) : undefined;
    const mineur = cells.some(c => normalizeText(c) === 'min');

    // Avocat = cellule contenant un « ; » (liste d'avocats).
    const avocatCell = cells.find(c => c.includes(';') && detectRole([c]).role === 'autre');
    const avocat = avocatCell ? avocatCell.replace(/;\s*$/, '').trim() : undefined;

    out.push({
      rang,
      nom,
      dateNaissance: dateNaissance || undefined,
      role,
      roleLabel: label,
      mineur: mineur || undefined,
      categoriePenale: detectCategoriePenale(cells),
      avocat,
    });
  }
  return out;
};

// ──────────────────────────────────────────────
// TABLEAU « INFRACTIONS »
// Colonnes : Rang | NATINF | Type | QS | Date et heure | Commune | Personnes…
// (La même NATINF est répétée par personne/victime → on déduplique par code.)
// ──────────────────────────────────────────────

export interface ParsedInfraction {
  natinfCode: string;
  libelle: string; // QS Cassiopée (repli si non trouvé au référentiel)
}

/** Personne visée par une ligne d'infraction, avec sa mention Cassiopée. */
export interface ParsedInfractionPersonne {
  nom: string;
  /** Mention entre parenthèses telle qu'écrite par Cassiopée (« R », « T », « TR »…). */
  mention?: string;
}

/**
 * Une LIGNE du tableau des infractions : la même NATINF y revient autant de
 * fois qu'il y a de faits distincts (dates, lieux, victimes, auteurs
 * différents). C'est cette granularité qui porte « qui est mis en cause pour
 * quoi » — la saisine in rem, elle, reste dédupliquée par code.
 */
export interface ParsedInfractionRow {
  rang?: string;
  natinfCode: string;
  /** Type Cassiopée : K (crime), D (délit), C (contravention). */
  typeCode?: string;
  libelle: string;
  /** Date ou période brute (« le 07/12/2025 », « du 01/10/2025 au 30/11/2025 »). */
  dateRaw?: string;
  /** 1re date de la cellule (ISO) — début de la période de prévention. */
  dateDebut?: string;
  /** Dernière date de la cellule (ISO) si la cellule en porte plusieurs. */
  dateFin?: string;
  lieu?: string;
  auteurs: ParsedInfractionPersonne[];
  victimes: ParsedInfractionPersonne[];
}

/** Découpe « NOM Prénom (R); AUTRE Nom ; » en noms + mentions. */
const splitPersonnesAvecMention = (segment: string): ParsedInfractionPersonne[] =>
  segment
    .split(';')
    .map(part => {
      const nom = part.split('(')[0].replace(/\s+/g, ' ').trim();
      const mention = part.match(/\(([^)]*)\)/)?.[1]?.trim();
      return { nom, mention: mention || undefined };
    })
    .filter(p => p.nom.length > 0 && normalizeText(p.nom) !== 'x' && p.nom !== '...');

/** Cellule « AUT : … ; VIC : … ; » d'une ligne d'infraction. */
const parseInfractionPersonnes = (
  raw: string | undefined,
): { auteurs: ParsedInfractionPersonne[]; victimes: ParsedInfractionPersonne[] } => {
  if (!raw) return { auteurs: [], victimes: [] };
  const aut = raw.match(/AUT\s*:\s*([^]*?)(?=VIC\s*:|$)/i);
  const vic = raw.match(/VIC\s*:\s*([^]*)$/i);
  return {
    auteurs: aut ? splitPersonnesAvecMention(aut[1]) : [],
    victimes: vic ? splitPersonnesAvecMention(vic[1]) : [],
  };
};

/**
 * Parse le tableau « Infractions » ligne à ligne.
 * Colonnes : Rang | NATINF | Type | QS | Date et heure | Commune et lieu |
 * Personnes concernées | Info | Prescription courte.
 * Les positions ne sont pas prises pour acquises : le code NATINF, la cellule
 * de date et la cellule des personnes sont repérés par leur forme, ce qui
 * absorbe les colonnes en plus ou en moins d'un export à l'autre.
 */
export const parseInfractionRows = (text: string): ParsedInfractionRow[] => {
  const out: ParsedInfractionRow[] = [];
  for (const cells of toRows(text)) {
    if (isHeaderRow(cells) || isNoiseRow(cells)) continue;

    // Rang (1re cellule numérique) puis code NATINF : quand les deux premières
    // cellules sont numériques, la 1re est le rang — sinon le 1er entier de
    // 3 à 6 chiffres est le code.
    const hasRang = /^\d+$/.test(cells[0] || '') && /^\d{3,6}$/.test(cells[1] || '');
    const rang = hasRang ? cells[0] : undefined;
    let natinfIdx = -1;
    for (let i = hasRang ? 1 : 0; i < cells.length; i++) {
      if (/^\d{3,6}$/.test(cells[i].trim())) { natinfIdx = i; break; }
    }
    if (natinfIdx === -1) continue;
    const natinfCode = cells[natinfIdx].trim();

    // Type = cellule d'une seule lettre juste après le code (K/D/C).
    const typeCandidate = (cells[natinfIdx + 1] || '').trim();
    const typeCode = /^[A-Za-z]$/.test(typeCandidate) ? typeCandidate.toUpperCase() : undefined;

    // Libellé (QS) = 1re cellule alphabétique après le code, colonne « Type »
    // sautée.
    let libelle = '';
    let libelleIdx = -1;
    for (let j = natinfIdx + 1; j < cells.length; j++) {
      const cand = cells[j].trim();
      if (cand.length > 3 && /[a-zàâäéèêëïîôöùûüç]/i.test(cand)) {
        libelle = cand;
        libelleIdx = j;
        break;
      }
    }

    // Personnes concernées = 1re cellule portant « AUT : » ou « VIC : ».
    const personnesIdx = cells.findIndex(c => /AUT\s*:|VIC\s*:/i.test(c));
    const { auteurs, victimes } = parseInfractionPersonnes(
      personnesIdx >= 0 ? cells[personnesIdx] : undefined,
    );

    // Date / période = 1re cellule postérieure au libellé portant une date
    // (« le 07/12/2025 », « du … au … », « entre le … et le … »).
    let dateRaw: string | undefined;
    let dateIdx = -1;
    for (let j = Math.max(libelleIdx, natinfIdx) + 1; j < cells.length; j++) {
      if (personnesIdx >= 0 && j >= personnesIdx) break;
      if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(cells[j])) { dateRaw = cells[j].trim(); dateIdx = j; break; }
    }
    const dates = (dateRaw?.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || []).map(d => parseFrDate(d)).filter(Boolean);

    // Lieu = cellule suivant la date (avant les personnes).
    let lieu: string | undefined;
    if (dateIdx >= 0) {
      const cand = (cells[dateIdx + 1] || '').trim();
      if (cand && (personnesIdx < 0 || dateIdx + 1 < personnesIdx)) lieu = cand.replace(/\s+/g, ' ');
    }

    out.push({
      rang,
      natinfCode,
      typeCode,
      libelle,
      dateRaw,
      dateDebut: dates[0] || undefined,
      dateFin: dates.length > 1 ? dates[dates.length - 1] : undefined,
      lieu,
      auteurs,
      victimes,
    });
  }
  return out;
};

/** Infractions dédupliquées par code (alimente la saisine in rem). */
export const parseInfractionsTable = (text: string): ParsedInfraction[] => {
  const byCode = new Map<string, ParsedInfraction>();
  for (const row of parseInfractionRows(text)) {
    const existing = byCode.get(row.natinfCode);
    if (!existing) byCode.set(row.natinfCode, { natinfCode: row.natinfCode, libelle: row.libelle });
    else if (row.libelle && !existing.libelle) existing.libelle = row.libelle;
  }
  return Array.from(byCode.values());
};

// ──────────────────────────────────────────────
// LISTE « NATINF en cours/amnistiées » (bloc Résumé Dossier)
//
// Format alternatif, NON tabulé : un code puis son libellé séparés par des
// espaces, un par ligne (ex : « 7990     TRANSPORT NON AUTORISE DE
// STUPEFIANTS »). Le tableau « Infractions » (parseInfractionsTable), lui,
// est tabulé — ces deux sources sont complémentaires. On ignore volontairement
// les codes NATAFF (alphabétiques, ex : « G16 »), qui ne correspondent pas au
// référentiel NATINF numérique de la saisine.
// ──────────────────────────────────────────────

/** Préfixe de libellé (« NATINF en cours/amnistiées : ») à retirer. */
const NATINF_LABEL_RE = /^[^0-9]*natinf[^:]*:\s*/i;

export const parseNatinfList = (text: string): ParsedInfraction[] => {
  const byCode = new Map<string, ParsedInfraction>();
  for (const rawLine of (text || '').split(/\r?\n/)) {
    // Tabulations → espaces, puis on retire un éventuel libellé de tête.
    const line = rawLine.replace(/\t/g, ' ').replace(NATINF_LABEL_RE, '').trim();
    if (!line) continue;
    // « <code numérique 3–6 chiffres> <libellé> ». Le code doit être en tête de
    // ligne et suivi d'un espace : exclut les dates (JJ/MM/AAAA) et les rangs.
    const m = line.match(/^(\d{3,6})\s+(.+)$/);
    if (!m) continue;
    const code = m[1];
    const libelle = m[2].replace(/\s+/g, ' ').trim();
    if (!byCode.has(code)) byCode.set(code, { natinfCode: code, libelle });
    else if (libelle && !byCode.get(code)!.libelle) byCode.get(code)!.libelle = libelle;
  }
  return Array.from(byCode.values());
};

/**
 * Fusionne les infractions du tableau tabulé et de la liste « NATINF » du bloc
 * Résumé, dédupliquées par code. Utile quand l'utilisateur colle tout le contenu
 * Cassiopée d'un bloc : les deux formats coexistent alors dans le même texte.
 */
export const parseAllInfractions = (text: string): ParsedInfraction[] => {
  const byCode = new Map<string, ParsedInfraction>();
  for (const inf of [...parseInfractionsTable(text), ...parseNatinfList(text)]) {
    if (!byCode.has(inf.natinfCode)) byCode.set(inf.natinfCode, inf);
    else if (inf.libelle && !byCode.get(inf.natinfCode)!.libelle) {
      byCode.get(inf.natinfCode)!.libelle = inf.libelle;
    }
  }
  return Array.from(byCode.values());
};

// ──────────────────────────────────────────────
// EN-TÊTE « Résumé Dossier »
// N° Parquet, N° dans cabinet (→ n° d'instruction), Identifiant Justice.
// ──────────────────────────────────────────────

export interface ParsedResumeHeader {
  /** N° de parquet (ex : « 23082000064 »). */
  numeroParquet?: string;
  /** N° dans le cabinet → sert de n° d'instruction (ex : « JI CABJI2 23000009 »). */
  numeroInstruction?: string;
  /** Identifiant Justice unique du dossier (ex : « 2301062620X »). */
  identifiantJustice?: string;
}

/**
 * Cherche la valeur associée à un libellé dans le bloc Résumé. Chaque ligne est
 * découpée en cellules (tabulations) : la valeur est la 1re cellule non vide
 * APRÈS celle qui porte le libellé (ou le texte après « : » dans la même
 * cellule). `exclude` écarte les faux libellés voisins (ex : « Parquet Général »
 * pour « N° Parquet »).
 */
const findHeaderValue = (
  lines: string[],
  match: (normalizedCell: string) => boolean,
): string | undefined => {
  for (const line of lines) {
    const cells = line.split('\t').map(c => c.trim());
    for (let i = 0; i < cells.length; i++) {
      if (!match(normalizeText(cells[i]))) continue;
      for (let j = i + 1; j < cells.length; j++) {
        if (cells[j]) return cells[j].replace(/\s+/g, ' ').trim();
      }
      // Valeur éventuellement collée après « : » dans la même cellule.
      const after = cells[i].split(':').slice(1).join(':').replace(/\s+/g, ' ').trim();
      if (after) return after;
    }
  }
  return undefined;
};

export const parseResumeHeader = (text: string): ParsedResumeHeader => {
  const lines = (text || '').split(/\r?\n/);
  const numeroParquet = findHeaderValue(
    lines,
    n => n.includes('parquet') && !n.includes('general') && !n.includes('affaire'),
  );
  const numeroInstruction = findHeaderValue(lines, n => n.includes('dans cabinet'));
  const identifiantJustice = findHeaderValue(lines, n => n.includes('identifiant justice'));
  const out: ParsedResumeHeader = {};
  if (numeroParquet) out.numeroParquet = numeroParquet;
  if (numeroInstruction) out.numeroInstruction = numeroInstruction;
  if (identifiantJustice) out.identifiantJustice = identifiantJustice;
  return out;
};

/**
 * Déduit la date du réquisitoire introductif (= ouverture de l'information) à
 * partir des événements collés : événement de code « RI » ou dont le libellé
 * contient « réquisitoire introductif ». Renvoie la plus ancienne (ISO).
 */
export const findRIDateFromEvenements = (events: ParsedEvenement[]): string | undefined => {
  const dates = events
    .filter(
      e =>
        e.date &&
        (normalizeText(e.code) === 'ri' ||
          normalizeText(e.eventLabel).includes('requisitoire introductif')),
    )
    .map(e => e.date)
    .sort();
  return dates[0];
};

// ──────────────────────────────────────────────
// TABLEAU « ÉVÉNEMENTS »
// Colonnes : Date | Emetteur | Événement | Motif | Destinataire | Personnes…
// ──────────────────────────────────────────────

export interface ParsedEvenement {
  date: string; // ISO
  dateRaw: string;
  emetteur?: string;
  code?: string; // ex : "MD", "OSC", "EXPERT"
  eventLabel: string; // ex : "MD - mandat de dépôt"
  motif?: string;
  destinataire?: string;
  auteurs: string[];
  victimes: string[];
}

/** Extrait les noms d'une chaîne « AUT : … ; VIC : … ; ». */
const parsePersonnesConcernees = (raw: string | undefined): { auteurs: string[]; victimes: string[] } => {
  const auteurs: string[] = [];
  const victimes: string[] = [];
  if (!raw) return { auteurs, victimes };

  const autMatch = raw.match(/AUT\s*:\s*([^]*?)(?=VIC\s*:|$)/i);
  const vicMatch = raw.match(/VIC\s*:\s*([^]*)$/i);

  const splitNames = (segment: string): string[] =>
    segment
      .split(';')
      .map(s => s.replace(/\([^)]*\)/g, '').trim()) // retire « (R) », « (TR) »…
      .filter(s => s.length > 0 && normalizeText(s) !== 'x' && s !== '...');

  if (autMatch) auteurs.push(...splitNames(autMatch[1]));
  if (vicMatch) victimes.push(...splitNames(vicMatch[1]));
  return { auteurs, victimes };
};

export const parseEvenementsTable = (text: string): ParsedEvenement[] => {
  const out: ParsedEvenement[] = [];
  for (const cells of toRows(text)) {
    if (isHeaderRow(cells) || isNoiseRow(cells)) continue;

    // 1re cellule = date. Sinon, ce n'est pas une ligne d'événement.
    const dateRaw = cells[0];
    if (!DATE_CELL_RE.test(dateRaw)) continue;
    const date = parseFrDate(dateRaw);
    if (!date) continue;

    const emetteur = cells[1] || undefined;
    const eventLabel = cells[2] || '';
    const motif = cells[3] || undefined;
    const destinataire = cells[4] || undefined;
    const personnesRaw = cells[5] || cells.slice(5).join(' ');

    const code = eventLabel.includes(' - ')
      ? eventLabel.split(' - ')[0].trim()
      : undefined;

    const { auteurs, victimes } = parsePersonnesConcernees(personnesRaw);

    out.push({
      date,
      dateRaw,
      emetteur,
      code,
      eventLabel,
      motif: motif || undefined,
      destinataire: destinataire || undefined,
      auteurs,
      victimes,
    });
  }
  return out;
};

// ──────────────────────────────────────────────
// CONSTRUCTION DU MODÈLE
// ──────────────────────────────────────────────

export interface BuildContext {
  newId: () => number;
  /** Résolution d'un code NATINF vers le référentiel (hook useNatinf). */
  resolveNatinf?: (code: string) => NatinfEntry | undefined;
}

// ──────────────────────────────────────────────
// RÉGIME / CAS LÉGAL DE DP DÉDUIT DE LA SAISINE IN REM
//
// Le régime de détention (criminel/correctionnel) et le cas légal applicable
// (durées initiale/max/tranche) découlent de la NATURE des faits dont le juge
// est saisi (saisine in rem), pas d'un choix arbitraire. On dérive une
// suggestion depuis les NATINF de la saisine ; elle reste modifiable.
// ──────────────────────────────────────────────

export interface CasDPSuggestion {
  regime: RegimeDetentionProvisoire;
  casDPId?: string;
  cas?: CasDP;
  /** Explication lisible du raisonnement (pour l'UI). */
  reason: string;
}

const BO_STUP_TERRO_RE = /bande organisee|stupefiant|terror|proxenet|extorsion/;

/**
 * Déduit le régime de DP et un cas légal probable à partir des NATINF de la
 * saisine in rem. Renvoie null si aucune NATINF exploitable.
 */
export const suggestCasDPFromNatinfRefs = (
  refs: (NatinfRef | undefined | null)[],
  resolve?: (code: string) => NatinfEntry | undefined,
): CasDPSuggestion | null => {
  const valid = refs.filter((r): r is NatinfRef => !!r);
  if (valid.length === 0) return null;

  const crimes = valid.filter(r => r.nature === 'crime');
  const text = normalizeText(valid.map(r => r.libelle).join(' | '));
  const boStupTerro = BO_STUP_TERRO_RE.test(text);

  if (crimes.length > 0) {
    // Régime criminel (art 145-2).
    let peineSup20 = false;
    for (const r of crimes) {
      const e = resolve?.(r.code);
      if (e?.quantum?.perpetuite || (e?.quantum?.reclusionAnnees ?? 0) >= 20) peineSup20 = true;
    }
    let casDPId: string;
    let reason: string;
    if (boStupTerro || crimes.length > 1) {
      casDPId = 'crim-pluriel-ou-stup-terro';
      reason = crimes.length > 1
        ? 'Plusieurs crimes visés → régime criminel, cas art 145-2 (durée max 48 mois).'
        : 'Crime en bande organisée / stupéfiants / terrorisme → régime criminel, cas art 145-2 (48 mois).';
    } else if (peineSup20) {
      casDPId = 'crim-peine-sup-20';
      reason = 'Crime puni d\'au moins 20 ans → régime criminel, art 145-2 (durée max 36 mois).';
    } else {
      casDPId = 'crim-peine-inf-20';
      reason = 'Crime puni de moins de 20 ans → régime criminel, art 145-2 (durée max 24 mois).';
    }
    return { regime: 'criminel', casDPId, cas: getCasDPById(casDPId), reason };
  }

  // Régime correctionnel (art 145-1 / 145-1-1).
  let casDPId: string | undefined;
  let reason: string;
  if (boStupTerro) {
    casDPId = 'del-stup-am-bo';
    reason = 'Délit de stupéfiants / association de malfaiteurs / BO → art 145-1-1 (24 mois).';
  } else {
    let maxMois = 0;
    for (const r of valid) {
      const e = resolve?.(r.code);
      maxMois = Math.max(maxMois, e?.quantum?.emprisonnementMois ?? 0);
    }
    if (maxMois > 60) {
      casDPId = 'del-sup-5-ans';
      reason = 'Délit puni de plus de 5 ans → art 145-1 al 2 (durée max 12 mois).';
    } else if (maxMois >= 36) {
      casDPId = 'del-3-5-ans';
      reason = 'Délit puni de 3 à 5 ans → art 145-1 al 1 (durée max 4 mois, non prolongeable).';
    } else {
      casDPId = undefined;
      reason = 'Régime correctionnel : cas légal à préciser (quantum indéterminé).';
    }
  }
  return { regime: 'correctionnel', casDPId, cas: getCasDPById(casDPId), reason };
};

/** Variante prenant directement la saisine in rem. */
export const suggestCasDPFromSaisine = (
  saisine: SaisineItem[],
  resolve?: (code: string) => NatinfEntry | undefined,
): CasDPSuggestion | null =>
  suggestCasDPFromNatinfRefs(
    saisine.map(s => s.natinfRef ?? (s.natinfCode && resolve ? (() => {
      const e = resolve(s.natinfCode!);
      return e ? toRef(e) : null;
    })() : null)),
    resolve,
  );

// ──────────────────────────────────────────────
// RECONSTITUTION PRUDENTE DES PÉRIODES DE DP
//
// Depuis les événements Cassiopée : la 1re ordonnance de DP (mandat de dépôt /
// ORDDP) d'un épisode = placement ; les ORDDP suivantes du même épisode =
// prolongations. Mais une personne peut être libérée puis replacée en DP plus
// tard (ex : REFPROL — refus de prolongation — qui met fin à la DP en cours,
// suivi d'un MAMENER — mandat d'amener, nouvelle arrestation — puis d'une
// nouvelle ORDDP) : cette 2e ORDDP est un nouveau PLACEMENT, pas la
// prolongation de l'épisode clos par le REFPROL. On détecte donc les
// événements qui mettent fin à la DP en cours (REFPROL, ORDLIB) pour rouvrir
// un nouvel épisode « placement » à l'ordonnance suivante.
//
// Les durées (initiale, tranche) proviennent du cas légal déduit de la
// saisine → cohérence avec l'art applicable. Prudence : on ne devine pas les
// prolongations exceptionnelles CHINS ; le résultat est signalé « à
// vérifier ».
// ──────────────────────────────────────────────

/** Codes d'événement Cassiopée marquant une (re)décision de détention. */
const DP_ORDONNANCE_CODES = new Set(['MD', 'ORDDP']);
/** Codes d'événement Cassiopée mettant fin à la DP en cours (remise en liberté). */
const DP_FIN_CODES = new Set(['REFPROL', 'ORDLIB']);

export const deriveDpPeriodesForPersonne = (
  nom: string,
  parsedEvents: ParsedEvenement[],
  opts: { regime: RegimeDetentionProvisoire; cas?: CasDP; newId: () => number },
): PeriodeDetentionProvisoire[] => {
  const key = normalizeNom(nom);
  // Ordonnances de DP ET événements de fin de DP, dans l'ordre chronologique :
  // c'est cet ordre réel (pas seulement les dates d'ordonnances) qui dit si une
  // ORDDP rouvre un nouvel épisode.
  const relevant = parsedEvents
    .filter(
      ev =>
        ev.date &&
        ev.code &&
        (DP_ORDONNANCE_CODES.has(ev.code.toUpperCase()) || DP_FIN_CODES.has(ev.code.toUpperCase())) &&
        ev.auteurs.some(a => normalizeNom(a) === key),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (relevant.length === 0) return [];

  const dureeInit = opts.cas?.dureeInitialeMois || (opts.regime === 'criminel' ? 12 : 4);
  const dureeTranche = opts.cas?.trancheProlongationMois || (opts.regime === 'criminel' ? 6 : 4);

  const periodes: PeriodeDetentionProvisoire[] = [];
  // Vrai tant qu'aucun épisode n'est en cours (avant la 1re ordonnance, ou
  // juste après un REFPROL/ORDLIB) : la prochaine ordonnance rencontrée est
  // alors un PLACEMENT, pas une prolongation de l'épisode précédent.
  let episodeClos = true;
  let derniereDate: string | undefined;

  for (const ev of relevant) {
    const code = ev.code!.toUpperCase();
    if (DP_FIN_CODES.has(code)) {
      episodeClos = true;
      continue;
    }
    // Mandat de dépôt + ORDDP du même jour = une seule ordonnance.
    if (derniereDate === ev.date) continue;
    derniereDate = ev.date;

    const type: 'placement' | 'prolongation' = episodeClos ? 'placement' : 'prolongation';
    const duree = type === 'placement' ? dureeInit : dureeTranche;
    periodes.push({
      id: opts.newId(),
      dateDebut: ev.date,
      dureeMois: duree,
      dateFin: calculatePeriodeDPEnd(ev.date, duree),
      regime: opts.regime,
      type,
    });
    episodeClos = false;
  }

  return periodes;
};

// ──────────────────────────────────────────────
// DEMANDES DE MISE EN LIBERTÉ (DML)
//
// Cassiopée ne distingue pas les DML des demandes de modification du contrôle
// judiciaire : les deux portent le même code d'événement DELIBCJ (« demande de
// mise en liberté ou relative au contrôle judiciaire »). L'objet réel se lit
// dans l'ordonnance de soit-communiqué (OSC) que le juge prend dans la foulée,
// dont le motif précise « sur demande de mise en liberté » ou « aux fins de
// modification du contrôle judiciaire ». On se sert donc de l'OSC la plus
// proche (fenêtre de 15 jours) pour trancher, avec repli sur la catégorie
// pénale (une personne en DP qui saisit le juge demande sa liberté).
//
// L'issue n'est jamais écrite noir sur blanc : une ORDLIB (ordonnance relative
// à la mise en liberté) postérieure signale une demande tranchée, sans dire
// dans quel sens. On déduit alors le sens de l'état actuel de la personne
// (toujours en DP → rejetée ; libérée → accordée) et on l'indique en note.
// ──────────────────────────────────────────────

/** Code d'événement Cassiopée d'une demande de mise en liberté / de CJ. */
const DML_EVENT_CODE = 'DELIBCJ';
/** Code d'événement d'une ordonnance statuant sur la liberté. */
const ORD_LIBERTE_CODE = 'ORDLIB';
/** Fenêtre (en jours) de rattachement d'une OSC à la demande qui la motive. */
const OSC_WINDOW_JOURS = 15;

const daysBetween = (isoA: string, isoB: string): number =>
  Math.round((new Date(`${isoB}T00:00:00Z`).getTime() - new Date(`${isoA}T00:00:00Z`).getTime()) / 86_400_000);

/** L'événement concerne-t-il cette personne (émetteur ou personne concernée) ? */
const eventConcerne = (ev: ParsedEvenement, key: string): boolean =>
  normalizeNom(ev.emetteur) === key || ev.auteurs.some(a => normalizeNom(a) === key);

/**
 * Objet réel d'un DELIBCJ : « dml », « cj » (modification du contrôle
 * judiciaire) ou `undefined` si les événements ne permettent pas de trancher.
 */
const objetDemande = (
  ev: ParsedEvenement,
  key: string,
  allEvents: ParsedEvenement[],
): 'dml' | 'cj' | undefined => {
  const osc = allEvents
    .filter(
      o =>
        normalizeText(o.code) === 'osc' &&
        eventConcerne(o, key) &&
        daysBetween(ev.date, o.date) >= 0 &&
        daysBetween(ev.date, o.date) <= OSC_WINDOW_JOURS,
    )
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const motif = normalizeText(osc?.motif);
  if (motif.includes('mise en liberte')) return 'dml';
  if (motif.includes('controle judiciaire')) return 'cj';
  return undefined;
};

export interface DmlDeriveOptions {
  newId: () => number;
  /** Catégorie pénale Cassiopée de la personne (« DP », « CJ », « ARSE »…). */
  categoriePenale?: string;
}

/**
 * Reconstitue les DML d'une personne depuis les événements Cassiopée. Les
 * demandes portant sur le seul contrôle judiciaire sont écartées. L'échéance
 * légale (10 jours ouvrables, art. 148) est recalculée depuis la date de dépôt.
 */
export const deriveDMLsForPersonne = (
  nom: string,
  parsedEvents: ParsedEvenement[],
  opts: DmlDeriveOptions,
): DemandeMiseEnLiberte[] => {
  const key = normalizeNom(nom);
  const enDP = opts.categoriePenale === 'DP';

  const demandes = parsedEvents
    .filter(
      ev =>
        ev.date &&
        normalizeText(ev.code) === normalizeText(DML_EVENT_CODE) &&
        eventConcerne(ev, key),
    )
    .filter(ev => {
      const objet = objetDemande(ev, key, parsedEvents);
      // Sans OSC exploitable : on ne retient la demande que pour une personne
      // détenue (une demande de CJ n'a pas d'échéance des 10 jours à suivre).
      return objet ? objet === 'dml' : enDP;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Dédoublonnage par date de dépôt (une demande peut apparaître deux fois si
  // elle est annoncée par la personne puis enregistrée par le cabinet).
  const parDate = new Map<string, ParsedEvenement>();
  demandes.forEach(ev => { if (!parDate.has(ev.date)) parDate.set(ev.date, ev); });
  const dates = Array.from(parDate.keys()).sort();

  const ordonnances = parsedEvents
    .filter(ev => ev.date && normalizeText(ev.code) === normalizeText(ORD_LIBERTE_CODE) && eventConcerne(ev, key))
    .map(ev => ev.date)
    .sort();

  return dates.map((date, i) => {
    const suivante = dates[i + 1];
    // Demande tranchée : une ordonnance sur la liberté est intervenue après le
    // dépôt (avant la demande suivante s'il y en a une).
    const tranchee = ordonnances.some(o => o >= date && (!suivante || o < suivante));
    const statut: DemandeMiseEnLiberte['statut'] = tranchee
      ? (enDP ? 'rejetee' : 'accordee')
      : 'en_attente';
    const notes = tranchee
      ? `Importée de Cassiopée (DELIBCJ du ${date.split('-').reverse().join('/')}) — issue déduite d'une ordonnance postérieure (${enDP ? 'personne toujours en DP → rejet' : 'personne libérée → mise en liberté'}) : à vérifier.`
      : `Importée de Cassiopée (DELIBCJ du ${date.split('-').reverse().join('/')}) — aucune ordonnance postérieure trouvée : réputée en attente, à vérifier.`;
    return {
      id: opts.newId(),
      dateDepot: date,
      dateEcheance: calculateDMLEcheance(date),
      statut,
      notes,
    };
  });
};

/** Mesure de sûreté déduite de la catégorie pénale Cassiopée (repli sans DP
 *  reconstituée). On pose la bonne *nature* de mesure avec des périodes vides
 *  et une note d'invite : les dates de DP proviennent des ordonnances JLD. */
const mesureFromCategorie = (cat?: string): { mesure: MesureSurete; note?: string } => {
  switch (cat) {
    case 'DP':
      return {
        mesure: { type: 'detenu', depuis: '', regime: 'criminel', periodes: [] },
        note: '⚠ Cassiopée : détention provisoire (DP) — saisir le placement et les prolongations dans « Mesures de sûreté ».',
      };
    case 'CJ':
      return {
        mesure: { type: 'cj', depuis: '' },
        note: '⚠ Cassiopée : contrôle judiciaire (CJ) — préciser la date de placement.',
      };
    case 'ARSE':
      return {
        mesure: { type: 'arse', depuis: '' },
        note: '⚠ Cassiopée : ARSE — préciser la date et le lieu.',
      };
    default:
      return { mesure: { type: 'libre' } };
  }
};

const buildNote = (p: ParsedPersonne, catNote?: string): string | undefined => {
  const parts: string[] = [];
  if (catNote) parts.push(catNote);
  if (p.avocat) parts.push(`Avocat(s) : ${p.avocat}`);
  return parts.length ? parts.join('\n') : undefined;
};

/** Options de construction d'un MEX : DP reconstituée depuis les événements. */
export interface MexBuildOptions {
  /** Périodes de DP reconstituées (placement + prolongations). */
  dpPeriodes?: PeriodeDetentionProvisoire[];
  /** Régime déduit de la saisine in rem. */
  regime?: RegimeDetentionProvisoire;
  /** Cas légal déduit de la saisine in rem. */
  casDPId?: string;
  /** DML reconstituées depuis les événements (compteur art. 148). */
  dmls?: DemandeMiseEnLiberte[];
  /** Chefs de mise en examen déduits du tableau des infractions. */
  infractions?: InfractionReproche[];
}

/** Convertit un mis en examen parsé vers le modèle. Si la personne est en DP et
 *  que des périodes ont pu être reconstituées depuis les événements, on pose une
 *  mesure `detenu` complète (régime/cas déduits de la saisine in rem) ; sinon on
 *  se rabat sur la nature de mesure seule. */
export const buildMisEnExamen = (
  p: ParsedPersonne,
  ctx: BuildContext,
  opts?: MexBuildOptions,
): MisEnExamen => {
  let mesure: MesureSurete;
  let note: string | undefined;

  if (p.categoriePenale === 'DP' && opts?.dpPeriodes && opts.dpPeriodes.length > 0) {
    // La personne peut avoir connu plusieurs épisodes de DP distincts (remise
    // en liberté puis nouveau placement) : « depuis » doit refléter le début
    // de l'épisode EN COURS (le dernier placement), pas le tout premier.
    const placements = opts.dpPeriodes.filter(per => per.type === 'placement');
    const depuis = placements[placements.length - 1]?.dateDebut ?? opts.dpPeriodes[0].dateDebut;
    mesure = {
      type: 'detenu',
      depuis,
      regime: opts.regime ?? opts.dpPeriodes[0].regime,
      casDPId: opts.casDPId,
      periodes: opts.dpPeriodes,
    };
    const nbProl = opts.dpPeriodes.length - placements.length;
    note =
      placements.length > 1
        ? `⚠ DP reconstituée depuis Cassiopée : ${placements.length} placements distincts (remise en liberté puis nouveau placement en cours de procédure) + ${nbProl} prolongation(s) au total, régime/cas déduits de la saisine in rem. À vérifier (prolongations exceptionnelles non reprises).`
        : `⚠ DP reconstituée depuis Cassiopée : placement + ${nbProl} prolongation(s), régime/cas déduits de la saisine in rem. À vérifier (mises en liberté et prolongations exceptionnelles non reprises).`;
  } else {
    const r = mesureFromCategorie(p.categoriePenale);
    mesure = r.mesure;
    note = r.note;
  }

  return {
    id: ctx.newId(),
    nom: p.nom,
    dateNaissance: p.dateNaissance,
    dateMiseEnExamen: '', // inconnue depuis le résumé — à compléter
    infractions: opts?.infractions ?? [],
    elementsPersonnalite: [],
    mesureSurete: mesure,
    dmls: opts?.dmls ?? [],
    notes: buildNote(p, note),
  };
};

export const buildSuspect = (p: ParsedPersonne, ctx: BuildContext): Suspect => ({
  id: ctx.newId(),
  nom: p.nom,
  role: p.roleLabel || undefined,
});

export const buildVictime = (p: ParsedPersonne, ctx: BuildContext): Victime => ({
  id: ctx.newId(),
  nom: p.nom,
  partieCivile: p.role === 'partie_civile' || undefined,
  notes: p.avocat ? `Avocat(s) : ${p.avocat}` : undefined,
});

/** Convertit une infraction parsée vers un chef de saisine in rem. */
export const buildSaisineItem = (inf: ParsedInfraction, ctx: BuildContext): SaisineItem => {
  const entry = ctx.resolveNatinf?.(inf.natinfCode);
  return {
    id: ctx.newId(),
    qualification: entry?.libelle || inf.libelle || `NATINF ${inf.natinfCode}`,
    natinfCode: inf.natinfCode,
    natinfRef: entry ? toRef(entry) : undefined,
    acte: 'introductif',
  };
};

// ──────────────────────────────────────────────
// CHEFS DE MISE EN EXAMEN (saisine in personam)
//
// Le tableau des infractions dit, ligne par ligne, qui est mis en cause pour
// quels faits. Une même NATINF revient autant de fois qu'il y a de faits
// distincts (4 extorsions = 4 lignes) : on regroupe par code, car un chef de
// mise en examen se compte par qualification, et on porte le détail des faits
// (période, lieu, victimes, mention Cassiopée) dans l'explication.
// ──────────────────────────────────────────────

/** Rend une date ISO au format français court (pour les explications). */
const isoToFr = (iso?: string): string => (iso ? iso.split('-').reverse().join('/') : '');

/** Résumé d'une ligne d'infraction, tel qu'écrit dans l'explication du chef. */
const describeInfractionRow = (row: ParsedInfractionRow, mention?: string): string => {
  const parts: string[] = [];
  if (row.dateRaw) parts.push(row.dateRaw);
  else if (row.dateDebut) parts.push(`le ${isoToFr(row.dateDebut)}`);
  if (row.lieu) parts.push(row.lieu);
  if (mention) parts.push(`mention Cassiopée « ${mention} »`);
  if (row.victimes.length > 0) parts.push(`victime(s) : ${row.victimes.map(v => v.nom).join(', ')}`);
  const prefix = row.rang ? `rang ${row.rang} — ` : '';
  return `• ${prefix}${parts.join(' · ')}`;
};

/**
 * Chefs de mise en examen d'une personne, déduits du tableau des infractions.
 * Un chef par code NATINF ; les faits multiples sont listés en explication.
 */
export const buildInfractionsForPersonne = (
  nom: string,
  rows: ParsedInfractionRow[],
  ctx: BuildContext,
): InfractionReproche[] => {
  const key = normalizeNom(nom);
  const parCode = new Map<string, ParsedInfractionRow[]>();
  for (const row of rows) {
    if (!row.auteurs.some(a => normalizeNom(a.nom) === key)) continue;
    const list = parCode.get(row.natinfCode);
    if (list) list.push(row);
    else parCode.set(row.natinfCode, [row]);
  }

  return Array.from(parCode.entries()).map(([code, faits]) => {
    const entry = ctx.resolveNatinf?.(code);
    const debuts = faits.map(f => f.dateDebut).filter(Boolean).sort() as string[];
    const lieux = Array.from(new Set(faits.map(f => f.lieu).filter(Boolean))) as string[];
    const lignes = faits.map(f =>
      describeInfractionRow(f, f.auteurs.find(a => normalizeNom(a.nom) === key)?.mention),
    );
    const entete =
      faits.length > 1
        ? `Importé de Cassiopée — ${faits.length} faits :`
        : 'Importé de Cassiopée :';
    return {
      id: ctx.newId(),
      qualification: entry?.libelle || faits[0].libelle || `NATINF ${code}`,
      natinfCode: code,
      natinfRef: entry ? toRef(entry) : undefined,
      // Date retenue = début du fait le plus ancien ; le détail complet des
      // périodes reste lisible dans l'explication.
      dateInfraction: debuts[0] || undefined,
      // Un seul lieu → champ dédié ; plusieurs → laissé vide, détail en dessous.
      lieuInfraction: lieux.length === 1 ? lieux[0] : undefined,
      explication: [entete, ...lignes].join('\n'),
    };
  });
};

/** Type d'événement timeline générique pour les imports Cassiopée non spécialisés. */
export const CASSIOPEE_EVT_TYPE = 'autre';

/** Déduit la catégorie d'expertise depuis le motif Cassiopée. */
const expertiseCategorieFromMotif = (
  motif?: string,
): { categorie: CategorieExpertise; libelle?: string } => {
  const n = normalizeText(motif);
  if (n.includes('psychologique')) return { categorie: 'psychologique' };
  if (n.includes('psychiatrique')) return { categorie: 'psychiatrique' };
  if (n.includes('genetique') || n.includes('adn')) return { categorie: 'adn' };
  if (n.includes('arme') || n.includes('balistique')) return { categorie: 'balistique' };
  if (n.includes('autopsie')) return { categorie: 'autopsie' };
  if (n.includes('papillaire') || n.includes('empreinte')) return { categorie: 'papillaire' };
  return { categorie: 'autre', libelle: motif || undefined };
};

/**
 * Convertit un événement parsé vers le modèle timeline. Tente de rattacher
 * l'événement à un MEX/victime lorsqu'un seul nom concerné correspond.
 */
export const buildEvenement = (
  ev: ParsedEvenement,
  ctx: BuildContext,
  linkers: {
    mexByName: Map<string, number>;
    victimeByName: Map<string, number>;
  },
): EvenementInstruction => {
  const isExpertise = normalizeText(ev.code) === 'expert' || normalizeText(ev.eventLabel).startsWith('expert');

  const descParts: string[] = [];
  if (ev.emetteur) descParts.push(`Émetteur : ${ev.emetteur}`);
  if (ev.destinataire) descParts.push(`Destinataire : ${ev.destinataire}`);
  if (ev.auteurs.length) descParts.push(`Auteur(s) : ${ev.auteurs.join(', ')}`);
  if (ev.victimes.length) descParts.push(`Victime(s) : ${ev.victimes.join(', ')}`);
  descParts.push('(importé de Cassiopée)');

  // Rattachement à une personne si un seul nom concerné est reconnu.
  let misEnExamenId: number | undefined;
  if (ev.auteurs.length === 1) {
    misEnExamenId = linkers.mexByName.get(normalizeNom(ev.auteurs[0]));
  }
  let victimeId: number | undefined;
  if (ev.victimes.length === 1) {
    victimeId = linkers.victimeByName.get(normalizeNom(ev.victimes[0]));
  }

  if (isExpertise) {
    const { categorie, libelle } = expertiseCategorieFromMotif(ev.motif);
    return {
      id: ctx.newId(),
      type: 'expertise',
      date: ev.date,
      titre: `Expertise${ev.motif ? ` — ${ev.motif}` : ''}`,
      description: descParts.join('\n'),
      categorieExpertise: categorie,
      expertiseLibelle: categorie === 'autre' ? libelle : undefined,
      misEnExamenId,
      victimeId,
    };
  }

  const titre = ev.eventLabel + (ev.motif ? ` — ${ev.motif}` : '');
  return {
    id: ctx.newId(),
    type: CASSIOPEE_EVT_TYPE,
    date: ev.date,
    titre: titre || 'Événement Cassiopée',
    description: descParts.join('\n'),
    misEnExamenId,
    victimeId,
  };
};

// ──────────────────────────────────────────────
// DÉDUPLICATION vis-à-vis d'un dossier existant
// ──────────────────────────────────────────────

/** Indique si un nom est déjà présent parmi une liste de personnes existantes. */
export const nameExists = (nom: string, existing: { nom: string }[]): boolean => {
  const n = normalizeNom(nom);
  return existing.some(e => normalizeNom(e.nom) === n);
};
