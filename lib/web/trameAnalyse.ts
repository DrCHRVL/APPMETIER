/**
 * SIRAL — analyse d'un acte déjà rédigé → proposition de trame de forme.
 *
 * Le magistrat verse un acte QU'IL A DÉJÀ FAIT (un courrier signé, une requête
 * partie au JLD) et l'application en tire sa papeterie : elle repère, ligne à
 * ligne, ce qui relève de la FORME (en-tête, logo, coordonnées, formules
 * figées — à garder tel quel) et ce qui relève du CONTENU de cet acte-là
 * (titre, destinataire, objet, corps, signature — à remplacer par les balises).
 * Elle propose aussi les types d'actes que la trame doit servir. La trame se
 * fait donc toute seule ; le magistrat corrige à la marge (chaque ligne reste
 * réassignable dans le panneau) puis enregistre.
 *
 * Deux moteurs, dans cet ordre :
 *  1. l'ANALYSTE de l'attaché — un run Claude d'un seul tour, sans aucun outil,
 *     spécialisé dans la mise en page des actes du parquet (route
 *     `/api/attache/analyse-trame`, réservée à l'administrateur du TJ confié).
 *     On ne lui envoie que le SQUELETTE de l'acte : chaque ligne tronquée à
 *     160 caractères — assez pour reconnaître un en-tête d'une phrase de
 *     réquisition, jamais assez pour reconstituer le fond du dossier ;
 *  2. à défaut (attaché absent, service coupé, réponse illisible), les règles
 *     locales ci-dessous, déterministes et instantanées.
 *
 * Le classement local sert TOUJOURS de socle : la réponse de l'IA ne fait que
 * corriger les lignes qu'elle mentionne. Une ligne oubliée garde donc un rôle
 * réfléchi plutôt qu'un rôle par défaut.
 */

import type { ParaInfo, PlanAction, TrameFormeFormat, TrameFormeType } from './trameModele';
import { paragraphesTrame, appliquerPlan } from './trameDoc';

/** Rôle d'une ligne de l'acte dans la future trame. */
export type RoleLigne =
  | 'papeterie'     // conservée telle quelle (en-tête, coordonnées, mentions figées)
  | 'titre'         // → {{TITRE}}
  | 'destinataire'  // → {{DESTINATAIRE}}
  | 'objet'         // label conservé, valeur → {{OBJET}}
  | 'date'          // label conservé, valeur → {{DATE}}
  | 'corps'         // → {{CORPS}} (la 1ʳᵉ ligne), les suivantes disparaissent
  | 'signature'     // → {{SIGNATURE}} (la 1ʳᵉ ligne), les suivantes disparaissent
  | 'retirer';      // ligne supprimée de la trame

export const ROLE_LABELS: Record<RoleLigne, string> = {
  papeterie: 'Papeterie (garder)',
  titre: 'Titre → {{TITRE}}',
  destinataire: 'Destinataire → {{DESTINATAIRE}}',
  objet: 'Objet → {{OBJET}}',
  date: 'Date → {{DATE}}',
  corps: 'Corps de l\'acte → {{CORPS}}',
  signature: 'Signature → {{SIGNATURE}}',
  retirer: 'Retirer la ligne',
};

export const ROLES: RoleLigne[] = ['papeterie', 'titre', 'destinataire', 'objet', 'date', 'corps', 'signature', 'retirer'];

export interface LigneProposee {
  /** Rang du paragraphe dans le document (identifiant stable). */
  index: number;
  texte: string;
  role: RoleLigne;
  /** Caractères conservés avant la balise (le label « Objet : », « …, le »). */
  garde: number;
  /** Une phrase courte : pourquoi ce rôle. */
  motif?: string;
}

export interface PropositionTrame {
  nom: string;
  types: TrameFormeType[];
  lignes: LigneProposee[];
  resume: string;
  /** Qui a classé les lignes : l'analyste de l'attaché, ou les règles locales. */
  origine: 'ia' | 'local';
  modele?: string;
}

// ── Règles locales ───────────────────────────────────────────────────────────

function deburr(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Lignes de papeterie : identité de la juridiction, coordonnées, références. */
const PAP_RE = /\b(cour d'appel|tribunal judiciaire|tribunal de grande|parquet|procureur de la republique|republique francaise|liberte, egalite|ministere de la justice|section |cabinet|affaire suivie par|telephone|tel\s*[:.]|courriel|@justice\.fr|cedex|\bcs\s?\d{4,}|www\.|n° parquet|numero parquet|nos ref|vos ref|dossier suivi par)\b/;

/** Titres d'actes du parquet (le mot pivot suffit, la casse fait le reste). */
const TITRE_RE = /\b(requete|requisitoire|requisition|soit[- ]transmis|ordonnance|autorisation|proces[- ]verbal|commission rogatoire|mandat|avis|note|reponse|prolongation|saisine)\b/;

/** Bloc signature : formules de départ d'un acte du parquet. */
const SIG_RE = /\b(p\/ le procureur|pour le procureur|le procureur de la republique|procureur adjoint|vice[- ]procureur|substitut|magistrat|le juge|par delegation)\b/;

/** Formule de politesse : marqueur de courrier. */
const POLITESSE_RE = /\b(je vous prie (d'agreer|de croire)|veuillez agreer|veuillez croire|sentiments (distingues|devoues)|consideration distinguee)\b/;

/** Ligne de date (« Fait à Amiens, le 3 mars 2026 », « Amiens, le 3 mars 2026 »). */
function positionDate(texte: string): number | null {
  const m = texte.match(/^(.*?\ble\s+)(\d{1,2}(?:er)?[\s/.-].*)$/i);
  if (m && m[1].length <= 60) return m[1].length;
  if (/^\s*\d{1,2}[\s/.-][\w/.-]+[\s/.-]\d{2,4}\s*$/.test(texte)) return 0;
  return null;
}

/** Position de la valeur derrière un label « Objet : … ». */
function positionObjet(texte: string): number | null {
  const m = texte.match(/^(\s*objet\s*[:\-–]?\s*)(.*)$/i);
  return m && m[2].trim() ? m[1].length : null;
}

function ratioMajuscules(s: string): number {
  const lettres = s.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  if (lettres.length < 3) return 0;
  const maj = lettres.replace(/[^A-ZÀ-Þ]/g, '').length;
  return maj / lettres.length;
}

/**
 * Position par défaut de la balise quand l'utilisateur réaffecte une ligne :
 * derrière le label « Objet : », derrière le « …, le » d'une date, sinon en
 * tête de ligne (la ligne entière devient la balise).
 */
export function gardeParDefaut(texte: string, role: RoleLigne): number {
  if (role === 'objet') return positionObjet(texte) ?? 0;
  if (role === 'date') return positionDate(texte) ?? 0;
  return 0;
}

/**
 * Classement local, déterministe. On lit l'acte comme on le lirait à l'œil :
 * un en-tête, éventuellement un titre, un destinataire et un objet, un corps,
 * une signature — et on ne touche jamais à ce qui ressemble à de la papeterie.
 */
export function analyseLocale(paras: ParaInfo[], nomFichier: string): PropositionTrame {
  const n = paras.length;
  const roles: RoleLigne[] = new Array(n).fill('papeterie');
  const gardes: number[] = new Array(n).fill(0);
  const motifs: string[] = new Array(n).fill('');
  const norm = paras.map((p) => deburr(p.texte).trim());

  const marquer = (i: number, role: RoleLigne, garde: number, motif: string) => {
    roles[i] = role; gardes[i] = garde; motifs[i] = motif;
  };

  // 1) Titre : ligne courte, en capitales ou mise en évidence, portant un mot pivot.
  let titreIdx = -1;
  for (let i = 0; i < n && i < Math.max(12, Math.floor(n * 0.5)); i += 1) {
    const t = paras[i].texte.trim();
    if (!t || t.length > 140) continue;
    if (PAP_RE.test(norm[i])) continue;
    const pivot = TITRE_RE.test(norm[i]);
    const evidence = ratioMajuscules(t) > 0.6 || paras[i].gras || paras[i].centre || paras[i].tableau;
    if (pivot && evidence) { titreIdx = i; break; }
  }
  if (titreIdx >= 0) marquer(titreIdx, 'titre', 0, 'ligne de titre (mot pivot + mise en évidence)');

  // 2) Objet et destinataire (courriers), dans l'en-tête de l'acte.
  let objetIdx = -1;
  let destIdx = -1;
  for (let i = 0; i < n; i += 1) {
    if (objetIdx >= 0) break;
    const pos = positionObjet(paras[i].texte);
    if (pos != null) { objetIdx = i; marquer(i, 'objet', pos, 'label « Objet » conservé, valeur remplacée'); }
  }
  const limiteDest = objetIdx >= 0 ? objetIdx : Math.min(n, Math.max(6, Math.floor(n * 0.3)));
  for (let i = 0; i < limiteDest; i += 1) {
    if (roles[i] !== 'papeterie' || !paras[i].texte.trim()) continue;
    if (PAP_RE.test(norm[i])) continue;
    if (/^(monsieur|madame|messieurs|mesdames|maitre|a l'attention|a l'intention)\b/.test(norm[i]) && paras[i].texte.length < 160) {
      destIdx = i;
      marquer(i, 'destinataire', 0, 'ligne d\'adresse du destinataire');
      break;
    }
  }

  // 3) Dates (« Fait à …, le … »), où qu'elles soient.
  for (let i = 0; i < n; i += 1) {
    if (roles[i] !== 'papeterie') continue;
    const pos = positionDate(paras[i].texte);
    if (pos != null) marquer(i, 'date', pos, 'date de l\'acte');
  }

  // 4) Bloc signature : on remonte depuis la fin tant que les lignes en ont l'air.
  let sigDebut = n;
  for (let i = n - 1; i >= 0; i -= 1) {
    const t = paras[i].texte.trim();
    if (!t) { if (sigDebut <= i + 1) sigDebut = i; continue; }
    if (roles[i] === 'date') { sigDebut = i; continue; }
    const nom = /^[A-ZÀ-Þ][\wÀ-ÿ'’-]+ [A-ZÀ-Þ]{2,}$|^[A-ZÀ-Þ]{2,}[\s'’-][A-ZÀ-Þ][\wÀ-ÿ'’-]+$/.test(t);
    if (SIG_RE.test(norm[i]) || (nom && t.length < 60) || (paras[i].droite && t.length < 80)) { sigDebut = i; continue; }
    break;
  }
  const aSignature = sigDebut < n && paras.slice(sigDebut).some((p) => SIG_RE.test(deburr(p.texte)));
  if (aSignature) {
    for (let i = sigDebut; i < n; i += 1) {
      if (roles[i] === 'date') continue;
      marquer(i, 'signature', 0, 'bloc de signature');
    }
  }

  // 5) Corps : tout ce qui reste entre l'en-tête et la signature.
  const apresEntete = Math.max(
    titreIdx, objetIdx, destIdx,
    ...roles.map((r, i) => (r === 'date' && i < (aSignature ? sigDebut : n) / 2 ? i : -1)),
  );
  const finCorps = aSignature ? sigDebut : n;
  for (let i = apresEntete + 1; i < finCorps; i += 1) {
    if (roles[i] !== 'papeterie') continue;
    if (PAP_RE.test(norm[i])) continue;
    if (!paras[i].texte.trim() && roles[i - 1] !== 'corps') continue; // ligne vide de respiration
    marquer(i, 'corps', 0, 'contenu propre à cet acte');
  }
  // Une ligne vide en fin de corps n'apporte rien : on la rend à la papeterie.
  for (let i = finCorps - 1; i > apresEntete; i -= 1) {
    if (roles[i] === 'corps' && !paras[i].texte.trim()) roles[i] = 'papeterie';
    else break;
  }

  // 6) Types d'actes servis par la trame.
  const tout = norm.join(' \n ');
  const types: TrameFormeType[] = [];
  const titre = titreIdx >= 0 ? norm[titreIdx] : '';
  if (/soit[- ]transmis/.test(titre) || /soit[- ]transmis/.test(tout)) types.push('soit-transmis');
  if (/requete|requisitoire|requisition|ordonnance|autorisation|saisine|prolongation|aux fins/.test(titre)) types.push('requete');
  if ((objetIdx >= 0 && destIdx >= 0) || POLITESSE_RE.test(tout)) types.push('courrier');
  if (!types.length) types.push('defaut');

  const lignes: LigneProposee[] = paras.map((p, i) => ({
    index: p.index,
    texte: p.texte,
    role: roles[i],
    garde: gardes[i],
    motif: motifs[i] || undefined,
  }));

  return {
    nom: nomPropose(titreIdx >= 0 ? paras[titreIdx].texte : '', nomFichier),
    types,
    lignes,
    resume: resumeLignes(lignes),
    origine: 'local',
  };
}

/** Nom lisible pour la trame : le titre de l'acte, à défaut le nom du fichier. */
function nomPropose(titre: string, nomFichier: string): string {
  const t = titre.trim().replace(/\s+/g, ' ');
  if (t && t.length <= 70) {
    const min = t.toLocaleLowerCase('fr-FR');
    return min.charAt(0).toLocaleUpperCase('fr-FR') + min.slice(1);
  }
  return nomFichier.replace(/\.(docx|odt)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Trame';
}

export function resumeLignes(lignes: LigneProposee[]): string {
  const gardees = lignes.filter((l) => l.role === 'papeterie').length;
  const balises = lignes.filter((l) => ['titre', 'destinataire', 'objet', 'date'].includes(l.role)).length;
  const contenu = lignes.filter((l) => l.role === 'corps' || l.role === 'signature').length;
  return `${lignes.length} lignes lues : ${gardees} gardées telles quelles, ${balises} converties en balises, ${contenu} remplacées par le contenu variable.`;
}

// ── Analyse par l'attaché (IA dédiée aux trames de forme) ────────────────────

const MAX_LIGNE = 160;
const MAX_LIGNES = 400;

interface ReponseIA {
  ok?: boolean;
  nom?: string;
  types?: string[];
  lignes?: Array<{ i?: number; role?: string; garde?: number; motif?: string }>;
  resume?: string;
  model?: string;
  error?: string;
}

const TYPES_VALIDES: TrameFormeType[] = ['courrier', 'requete', 'soit-transmis', 'defaut'];

/**
 * Demande son avis à l'analyste de l'attaché. Renvoie null (sans bruit) si la
 * fonctionnalité n'est pas ouverte à cet utilisateur ou si le service est
 * indisponible : le classement local prend alors le relais.
 */
async function analyseIA(paras: ParaInfo[], nomFichier: string, format: TrameFormeFormat): Promise<ReponseIA | null> {
  try {
    const lignes = paras.slice(0, MAX_LIGNES).map((p) => ({
      i: p.index,
      t: p.texte.slice(0, MAX_LIGNE),
      ...(p.gras ? { gras: 1 } : {}),
      ...(p.centre ? { centre: 1 } : {}),
      ...(p.droite ? { droite: 1 } : {}),
      ...(p.tableau ? { tableau: 1 } : {}),
    }));
    const res = await fetch('/api/attache/analyse-trame', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nomFichier, format, lignes }),
    });
    if (!res.ok) return null;
    const data = await res.json() as ReponseIA;
    return data && data.ok && Array.isArray(data.lignes) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Analyse un acte déjà rédigé et propose une trame de forme complète.
 * Le fichier ne quitte JAMAIS le navigateur : seule sa charpente textuelle,
 * tronquée ligne à ligne, peut être soumise à l'analyste de l'attaché.
 */
export async function analyserActe(
  base64: string,
  format: TrameFormeFormat,
  nomFichier: string,
): Promise<PropositionTrame> {
  const paras = paragraphesTrame(base64, format);
  const base = analyseLocale(paras, nomFichier);
  if (!paras.length) return base;

  const ia = await analyseIA(paras, nomFichier, format);
  if (!ia) return base;

  const parIndex = new Map(base.lignes.map((l) => [l.index, l]));
  for (const l of ia.lignes || []) {
    const cible = parIndex.get(Number(l.i));
    if (!cible) continue;
    const role = ROLES.includes(l.role as RoleLigne) ? l.role as RoleLigne : null;
    if (!role) continue;
    cible.role = role;
    cible.garde = Math.max(0, Math.min(cible.texte.length, Number(l.garde) || 0));
    if (l.motif) cible.motif = String(l.motif).slice(0, 160);
  }
  const lignes = base.lignes;
  const types = (Array.isArray(ia.types) ? ia.types : [])
    .filter((t): t is TrameFormeType => TYPES_VALIDES.includes(t as TrameFormeType));
  return {
    nom: (ia.nom || '').trim().slice(0, 70) || base.nom,
    types: types.length ? Array.from(new Set(types)) : base.types,
    lignes,
    resume: (ia.resume || '').trim().slice(0, 400) || resumeLignes(lignes),
    origine: 'ia',
    modele: ia.model,
  };
}

// ── De la proposition à la trame ─────────────────────────────────────────────

/** Contrôles de bon sens sur une proposition, avant enregistrement. */
export function verifierProposition(prop: PropositionTrame): string[] {
  const alertes: string[] = [];
  if (!prop.lignes.some((l) => l.role === 'corps')) {
    alertes.push('Aucune ligne n\'est marquée « corps » : la trame n\'aurait nulle part où déverser le texte de l\'acte.');
  }
  if (!prop.types.length) alertes.push('Aucun type d\'acte sélectionné : la trame ne serait jamais utilisée.');
  const restant = prop.lignes.filter((l) => l.role === 'papeterie' && l.texte.trim().length > 180).length;
  if (restant) {
    alertes.push(`${restant} ligne(s) longue(s) restent en papeterie : vérifiez qu'il ne s'agit pas du texte de cet acte-ci.`);
  }
  return alertes;
}

/** Plan d'écriture correspondant à la proposition (une action par paragraphe). */
export function planProposition(prop: PropositionTrame, paras: ParaInfo[]): PlanAction[] {
  const parIndex = new Map(prop.lignes.map((l) => [l.index, l]));
  let corpsPose = false;
  let signaturePosee = false;
  return paras.map((p) => {
    const l = parIndex.get(p.index);
    if (!l) return { action: 'garder' } as PlanAction;
    switch (l.role) {
      case 'titre': return { action: 'remplacer', garde: 0, suffixe: '{{TITRE}}' };
      case 'destinataire': return { action: 'remplacer', garde: 0, suffixe: '{{DESTINATAIRE}}' };
      case 'objet': return { action: 'remplacer', garde: l.garde, suffixe: '{{OBJET}}' };
      case 'date': return { action: 'remplacer', garde: l.garde, suffixe: '{{DATE}}' };
      case 'retirer': return { action: 'supprimer' };
      case 'corps':
        if (corpsPose) return { action: 'supprimer' };
        corpsPose = true;
        return { action: 'remplacer', garde: 0, suffixe: '{{CORPS}}' };
      case 'signature':
        if (signaturePosee) return { action: 'supprimer' };
        signaturePosee = true;
        return { action: 'remplacer', garde: 0, suffixe: '{{SIGNATURE}}' };
      default: return { action: 'garder' };
    }
  });
}

/** Construit la trame (fichier balisé, base64) à partir de l'acte et de la proposition. */
export function construireTrame(base64: string, format: TrameFormeFormat, prop: PropositionTrame): string {
  const paras = paragraphesTrame(base64, format);
  return appliquerPlan(base64, format, planProposition(prop, paras));
}
