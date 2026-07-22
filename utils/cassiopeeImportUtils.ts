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
  EvenementInstruction,
  MesureSurete,
  CategorieExpertise,
  PeriodeDetentionProvisoire,
  RegimeDetentionProvisoire,
} from '@/types/instructionTypes';
import { getCasDPById, type CasDP } from '@/config/dpRegimes';
import { calculatePeriodeDPEnd } from '@/utils/instructionUtils';

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
export const parseFrDate = (raw: string | undefined | null): string => {
  if (!raw) return '';
  const str = String(raw).trim().replace(/^le\s+/i, '');
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  const [, dd, mm, yyRaw] = m;
  const year = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
  const day = dd.padStart(2, '0');
  const month = mm.padStart(2, '0');
  if (Number(month) < 1 || Number(month) > 12) return '';
  if (Number(day) < 1 || Number(day) > 31) return '';
  return `${year}-${month}-${day}`;
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
    const dateNaissance = dateCell ? parseFrDate(dateCell) : undefined;
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

export const parseInfractionsTable = (text: string): ParsedInfraction[] => {
  const byCode = new Map<string, ParsedInfraction>();
  for (const cells of toRows(text)) {
    if (isHeaderRow(cells) || isNoiseRow(cells)) continue;

    // Le code NATINF est un entier (4 à 6 chiffres en général). On prend la
    // 1re cellule purement numérique qui n'est pas le rang (petit nombre).
    let natinfCode = '';
    let libelle = '';
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i].trim();
      if (/^\d{3,6}$/.test(c)) {
        natinfCode = c;
        // Le libellé (QS) est la 1re cellule alphabétique après le code,
        // en sautant la colonne « Type » (une seule lettre, ex : « K »).
        for (let j = i + 1; j < cells.length; j++) {
          const cand = cells[j].trim();
          if (cand.length > 3 && /[a-zàâäéèêëïîôöùûüç]/i.test(cand)) {
            libelle = cand;
            break;
          }
        }
        break;
      }
    }
    if (!natinfCode) continue;
    if (!byCode.has(natinfCode)) {
      byCode.set(natinfCode, { natinfCode, libelle });
    } else if (libelle && !byCode.get(natinfCode)!.libelle) {
      byCode.get(natinfCode)!.libelle = libelle;
    }
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
// ORDDP) = placement initial ; les ORDDP suivantes = prolongations. Les durées
// (initiale, tranche) proviennent du cas légal déduit de la saisine → cohérence
// avec l'art applicable. Prudence : on ne devine ni les mises en liberté ni les
// prolongations exceptionnelles CHINS ; le résultat est signalé « à vérifier ».
// ──────────────────────────────────────────────

/** Codes d'événement Cassiopée marquant une (re)décision de détention. */
const DP_ORDONNANCE_CODES = new Set(['MD', 'ORDDP']);

export const deriveDpPeriodesForPersonne = (
  nom: string,
  parsedEvents: ParsedEvenement[],
  opts: { regime: RegimeDetentionProvisoire; cas?: CasDP; newId: () => number },
): PeriodeDetentionProvisoire[] => {
  const key = normalizeNom(nom);
  const dpEvents = parsedEvents.filter(
    ev =>
      ev.date &&
      ev.code &&
      DP_ORDONNANCE_CODES.has(ev.code.toUpperCase()) &&
      ev.auteurs.some(a => normalizeNom(a) === key),
  );
  if (dpEvents.length === 0) return [];

  // Regroupe par date : mandat de dépôt + ORDDP du même jour = une ordonnance.
  const dates = Array.from(new Set(dpEvents.map(ev => ev.date))).sort();

  const dureeInit = opts.cas?.dureeInitialeMois || (opts.regime === 'criminel' ? 12 : 4);
  const dureeTranche = opts.cas?.trancheProlongationMois || (opts.regime === 'criminel' ? 6 : 4);

  return dates.map((d, i) => {
    const type: 'placement' | 'prolongation' = i === 0 ? 'placement' : 'prolongation';
    const duree = i === 0 ? dureeInit : dureeTranche;
    return {
      id: opts.newId(),
      dateDebut: d,
      dureeMois: duree,
      dateFin: calculatePeriodeDPEnd(d, duree),
      regime: opts.regime,
      type,
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
        note: '⚠ Cassiopée : contrôle judiciaire (CJ) — préciser la date et les obligations.',
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
    mesure = {
      type: 'detenu',
      depuis: opts.dpPeriodes[0].dateDebut,
      regime: opts.regime ?? opts.dpPeriodes[0].regime,
      casDPId: opts.casDPId,
      periodes: opts.dpPeriodes,
    };
    const nbProl = opts.dpPeriodes.length - 1;
    note = `⚠ DP reconstituée depuis Cassiopée : placement + ${nbProl} prolongation(s), régime/cas déduits de la saisine in rem. À vérifier (mises en liberté et prolongations exceptionnelles non reprises).`;
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
    infractions: [],
    elementsPersonnalite: [],
    mesureSurete: mesure,
    dmls: [],
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
