// lib/recoupements/valeursCore.mjs
//
// EXTRACTION DES VALEURS COMPARABLES d'un texte de procédure.
//
// Un PV ne dit jamais deux fois la même chose de la même façon : « 06.79.55.13.84 »
// et « +33 6 79 55 13 84 », « 16 rue Balzac » et « 16 rue balzac appt 7 à AMIENS ».
// Ce module ramène chaque valeur à une forme CANONIQUE, seule comparable.
//
// Les formes canoniques des téléphones, plaques, IBAN et adresses sont alignées
// sur celles de l'attaché de justice (`scripts/attache/carto.mjs`, normEntite) :
// ce que l'application rapproche, l'attaché le rapproche aussi.
//
// Module PUR, partagé par l'application et le service attaché : c'est le
// serveur qui compare désormais les dossiers, mais la règle de canonisation
// doit rester la même des deux côtés.

/** Une valeur trouvée dans un texte. */

// ──────────────────────────────────────────────
// NORMALISATION
// ──────────────────────────────────────────────

/**
 * Minuscules sans accents, MÊME LONGUEUR que la chaîne d'origine : les index
 * restent alignés, ce qui permet de citer le passage exact du document où la
 * valeur a été trouvée. Un caractère dont la translittération ne fait pas
 * exactement un caractère (œ, ß…) est laissé tel quel — l'alignement prime.
 */
export function normalizeAligned(text) {
  const plat = (c) => {
    const sans = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return sans.length === c.length ? sans : c;
  };
  const bas = text.toLowerCase();
  // Chemin normal : le passage en minuscules conserve la longueur (toujours
  // vrai en français) — seuls les caractères non ASCII sont translittérés.
  if (bas.length === text.length) return bas.replace(/[^\x00-\x7F]/g, plat);
  let out = '';
  for (const c of text) {
    const b = c.toLowerCase();
    out += plat(b.length === c.length ? b : c);
  }
  return out;
}

/** Mots (≥ 3 caractères) d'un texte déjà normalisé — prétri des recherches. */
export function motsDe(normalise) {
  const set = new Set();
  for (const mot of normalise.split(/[^a-z0-9]+/)) {
    if (mot.length >= 3) set.add(mot);
  }
  return set;
}

/**
 * Mots (≥ 3 caractères) d'un texte normalisé, RESTREINTS à une liste utile.
 *
 * Le prétri des fragments ne répond qu'à une seule question : « ce texte
 * contient-il tel mot d'un nom déclaré ? ». Retenir TOUS les mots de chaque
 * pièce pour y répondre — dix à vingt mille par PV, sur des centaines de
 * pièces — c'était des millions de chaînes gardées en mémoire simultanément,
 * plusieurs centaines de mégaoctets, et l'onglet qui tombe. On ne retient donc
 * que les mots susceptibles d'être demandés.
 */
export function motsRetenus(normalise, utiles) {
  const set = new Set();
  if (utiles.size === 0) return set;
  for (const mot of normalise.split(/[^a-z0-9]+/)) {
    if (mot.length >= 3 && utiles.has(mot)) set.add(mot);
  }
  return set;
}

/** Minuscules sans accents, ponctuation réduite à l'espace. */
export function normalizeLoose(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Numéro français ramené à 10 chiffres commençant par 0. Accepte 0X…, +33X…,
 * 0033X…, 33X… et le format à 9 chiffres sans le zéro initial.
 * Renvoie null si ce n'est pas un numéro français plausible.
 */
export function canonPhone(raw) {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('0033')) d = d.slice(4);
  else if (d.startsWith('33') && d.length >= 11) d = d.slice(2);
  else if (d.startsWith('0') && d.length === 10) return /^0[1-9]\d{8}$/.test(d) ? d : null;
  if (d.length === 9) d = '0' + d;
  if (d.length !== 10) return null;
  return /^0[1-9]\d{8}$/.test(d) ? d : null;
}

/** Affichage d'un numéro canonique : 06 79 55 13 84. */
export function formatPhone(canon) {
  return canon.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

/** Plaque sans séparateurs, en majuscules. */
export function canonPlate(raw) {
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** IBAN sans espaces, en majuscules. */
export function canonIban(raw) {
  return String(raw).toUpperCase().replace(/[^0-9A-Z]/g, '');
}

// ──────────────────────────────────────────────
// ADRESSES
// ──────────────────────────────────────────────

/** Type de voie → forme canonique (les abréviations sont ramenées au mot plein). */
const VOIE_CANON = {
  rue: 'rue', r: 'rue',
  avenue: 'avenue', av: 'avenue',
  boulevard: 'boulevard', bd: 'boulevard', blvd: 'boulevard',
  allee: 'allee', allees: 'allee',
  impasse: 'impasse', imp: 'impasse',
  chemin: 'chemin', ch: 'chemin',
  place: 'place', pl: 'place',
  route: 'route', rte: 'route',
  cite: 'cite',
  quai: 'quai',
  passage: 'passage',
  square: 'square',
  villa: 'villa',
  hameau: 'hameau',
  residence: 'residence', res: 'residence',
  lotissement: 'lotissement',
  faubourg: 'faubourg',
  esplanade: 'esplanade',
  cours: 'cours',
  sentier: 'sentier',
};

/** Voies qui se passent d'un numéro (on nomme le lieu, pas le porche). */
const VOIE_SANS_NUMERO = new Set(['residence', 'cite', 'hameau', 'lotissement']);

/**
 * Mots qui terminent le nom de la voie : ce qui suit est un complément
 * (étage, appartement, commune…) et non le nom de la rue. Sans cette coupe,
 * « 16 rue Balzac » et « 16 rue Balzac appt 7 à Amiens » ne se rejoindraient
 * jamais.
 */
const FIN_DE_VOIE = new Set([
  'appt', 'apt', 'appartement', 'appartements', 'bat', 'batiment', 'bat1', 'esc', 'escalier',
  'etage', 'porte', 'chez', 'cage', 'entree', 'boite', 'bp', 'cs', 'a', 'au', 'aux', 'to',
]);

const MAX_MOTS_VOIE = 4;

// La virgule entre le numéro et le type de voie est la convention postale
// française — « 12, rue Monstrelet » — et l'écriture majoritaire des PV et des
// fiches. Sans elle, ces adresses-là étaient purement et simplement invisibles
// à la veille : la voie était bien reconnue, mais amputée de son numéro, donc
// écartée par `canonAdresse`.
//
// La virgule SEULEMENT : un point séparerait deux phrases (« … 250 euros.
// Place de la gare, il a rencontré… ») et fabriquerait une adresse qui n'a
// jamais été écrite.
const RE_ADRESSE = new RegExp(
  String.raw`(\d{1,4})?\s*(?:bis|ter|quater)?\s*,?\s*\b(` +
  Object.keys(VOIE_CANON).join('|') +
  String.raw`)\b\.?\s+([A-Za-zÀ-ÿ0-9'’\-]+(?:\s+[A-Za-zÀ-ÿ0-9'’\-]+){0,6})`,
  'gi'
);

/** Forme canonique d'une adresse, ou null si elle n'est pas exploitable. */
export function canonAdresse(numero, voie, nom) {
  const type = VOIE_CANON[normalizeLoose(voie).replace(/\s/g, '')];
  if (!type) return null;
  const num = (numero || '').replace(/^0+/, '');
  if (!num && !VOIE_SANS_NUMERO.has(type)) return null;

  const mots = [];
  for (const mot of normalizeLoose(nom).split(' ')) {
    if (!mot) continue;
    if (FIN_DE_VOIE.has(mot)) break;
    // Code postal / numéro de bâtiment : le nom de la voie est fini.
    if (/^\d{3,}$/.test(mot)) break;
    // Articles : conservés (« rue de l eglise ») mais ils ne comptent pas
    // comme mots signifiants.
    mots.push(mot);
    if (mots.filter(m => !['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd'].includes(m)).length >= MAX_MOTS_VOIE) break;
  }
  const signifiants = mots.filter(m => !['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd'].includes(m));
  if (signifiants.length === 0) return null;
  // Un nom de voie d'une seule lettre ou d'un seul chiffre n'identifie rien.
  if (signifiants.join('').length < 3) return null;

  return `${num ? num + ' ' : ''}${type} ${mots.join(' ')}`.trim();
}

// ──────────────────────────────────────────────
// COMPTES / PSEUDOS
// ──────────────────────────────────────────────

// Un pseudo ne se ramasse pas au fil de la phrase. L'ancienne règle prenait le
// nom du réseau, sautait jusqu'à vingt caractères et retenait ce qui suivait :
// elle rendait « comme », « avait », « Ainsi » — le mot de la phrase, tout
// simplement — et jusqu'à des morceaux de mots (« ement », pris au milieu de
// « signalement »), faute d'exiger un début de mot. Elle MANQUAIT en prime le
// vrai pseudo : le saut étant gourmand, « Compte Instagram : katsu80 exploité »
// rendait « ploit ».
//
// Un pseudo se PRÉSENTE. Trois façons, et rien d'autre :
//   · entre guillemets — « jul.62 » ;
//   · annoncé par le mot qui le nomme — « sous le pseudonyme Kaiser » ;
//   · par sa forme même — un identifiant porte un chiffre ou un séparateur au
//     milieu (« jul.62 », « kayzer_80 »), ce qu'aucun mot de la langue ne fait.
// Un deux-points ou la simple juxtaposition ne suffisent pas seuls : ils
// n'ouvrent la porte qu'à ce qui a DÉJÀ la forme d'un identifiant.

/** Réseaux dont le nom ne veut rien dire d'autre en français. */
const RESEAUX_NETS = 'snapchat|instagram|insta|tiktok|telegram|whatsapp|facebook|messenger|discord|wickr|threema';
/** Réseaux dont le nom est aussi un mot courant : exigés avec une capitale. */
const RESEAUX_AMBIGUS = 'signal|snap';
const AMBIGUS = new Set(RESEAUX_AMBIGUS.split('|'));

const RE_RESEAU = new RegExp(String.raw`\b(?:${RESEAUX_NETS}|${RESEAUX_AMBIGUS})\b`, 'gi');
const RE_ARROBASE = /(?:^|[\s(])@([A-Za-z][A-Za-z0-9._\-]{3,29})\b/g;

/** Fenêtre, après le nom du réseau, où un pseudo peut se présenter. */
const FENETRE_PSEUDO = 40;
/** Forme d'un identifiant : un début de mot, une lettre d'abord, 4 signes au moins. */
const RE_CANDIDAT_PSEUDO = /\b([A-Za-z][A-Za-z0-9._\-]{3,29})\b/g;
/** Mots qui NOMMENT un pseudo : ce qui suit en est un, même sans chiffre. */
const RE_ANNONCE = /(?:pseudos?|pseudonymes?|alias|surnoms?|identifiants?|logins?|nom d(?:e |'|’)utilisateur)\W*$/i;
/** Guillemet ouvrant. L'apostrophe droite et la courbe en sont exclues : le
 *  français les sème à chaque élision (« l'application »). */
const RE_OUVRE_CITATION = /[«"“‘]\s*$/;

/** Mots qui suivent souvent un nom de réseau sans être un pseudo. */
const NON_PSEUDO = new Set([
  'compte', 'comptes', 'account', 'utilise', 'utilisee', 'utilisation', 'application',
  'reponse', 'requisition', 'donnees', 'story', 'stories', 'snap', 'nommee', 'intitule',
  'denomme', 'creation', 'connexion', 'connection', 'profil', 'pseudo', 'suivant',
  'nomme', 'appele', 'appelee', 'ouvert', 'ouverte', 'active', 'inactif', 'depuis', 'entre',
  // Mots de la langue qu'un deux-points peut mettre en tête de proposition.
  'aucun', 'aucune', 'ainsi', 'avait', 'etait', 'etaient', 'comme', 'cette', 'celui',
  'celle', 'plusieurs', 'notamment', 'egalement', 'ensuite', 'toutefois', 'cependant',
  'lequel', 'laquelle', 'exploitation', 'exploite', 'exploitee', 'extraction', 'analyse',
  'analysee', 'message', 'messages', 'conversation', 'conversations', 'groupe', 'groupes',
  'photo', 'photos', 'video', 'videos', 'audio', 'capture', 'captures', 'contact',
  'contacts', 'numero', 'numeros', 'telephone', 'portable', 'ligne', 'lignes', 'adresse',
  'identifiant', 'pseudonyme', 'utilisateur', 'installee', 'installe', 'presente',
  'trouve', 'trouvee', 'retrouve', 'retrouvee', 'indique', 'indiquee', 'declare',
  'declaree', 'confirme', 'confirmee', 'precise', 'precisee',
]);
/** Un nom de réseau n'est pas un pseudo (« Snapchat et Instagram »). */
const NOMS_RESEAUX = new Set(`${RESEAUX_NETS}|${RESEAUX_AMBIGUS}`.split('|'));

/**
 * Forme d'un identifiant : un chiffre, ou un séparateur au milieu. Aucun mot
 * de la langue n'en porte — c'est ce qui distingue « kayzer_80 » de « comme ».
 */
function formeIdentifiant(candidat) {
  return /\d/.test(candidat) || /[A-Za-z0-9][._-][A-Za-z0-9]/.test(candidat);
}

/** Ce qui reste d'un texte jusqu'à la fin de la phrase en cours. */
function jusquaFinDePhrase(texte) {
  const coupe = texte.search(/[;!?\n]|\.(?:\s|$)/);
  return coupe === -1 ? texte : texte.slice(0, coupe);
}

/** Pseudos présentés à côté d'un nom de réseau social. */
function pseudosDeReseaux(texte) {
  const trouves = [];
  RE_RESEAU.lastIndex = 0;
  let reseau;

  while ((reseau = RE_RESEAU.exec(texte)) !== null) {
    const nom = reseau[0];
    // « Signal », « Snap » : mots courants du français. Sans capitale, c'est la
    // phrase qui parle — « le signal du téléphone », « un snap envoyé ».
    if (AMBIGUS.has(nom.toLowerCase()) && nom[0] !== nom[0].toUpperCase()) continue;

    const finReseau = reseau.index + nom.length;
    // Un pseudo ne se présente jamais de l'autre côté d'un point : au-delà, la
    // phrase parle d'autre chose.
    const fenetre = jusquaFinDePhrase(texte.slice(finReseau, finReseau + FENETRE_PSEUDO));
    const avant = texte.slice(Math.max(0, reseau.index - 32), reseau.index);

    RE_CANDIDAT_PSEUDO.lastIndex = 0;
    let candidat;
    while ((candidat = RE_CANDIDAT_PSEUDO.exec(fenetre)) !== null) {
      const mot = candidat[1];
      const plat = normalizeLoose(mot);
      if (NON_PSEUDO.has(plat) || NOMS_RESEAUX.has(plat)) continue;

      const separateur = fenetre.slice(0, candidat.index);
      const suite = fenetre.slice(candidat.index + mot.length);
      // Annonce placée avant le réseau (« sous le pseudo Snapchat Kaiser ») :
      // elle ne vaut que si rien ne s'est glissé entre le réseau et le mot.
      const annonce = RE_ANNONCE.test(separateur)
        || (!/[A-Za-z]/.test(separateur) && RE_ANNONCE.test(avant));
      const cite = RE_OUVRE_CITATION.test(separateur) && /^\s*[»"”’']/.test(suite);

      if (!annonce && !cite && !formeIdentifiant(mot)) continue;
      trouves.push({ pseudo: mot, index: finReseau + candidat.index });
    }
  }
  return trouves;
}

// ──────────────────────────────────────────────
// NOMS DE PERSONNES DANS LE TEXTE LIBRE
// ──────────────────────────────────────────────

// « MEON Louan », « ROUSSEAU Jean Pierre » (patronyme en capitales d'abord).
const RE_NOM_MAJ_PRENOM = /\b([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’-]{2,})(?:\s+([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’-]{2,}))?\s+([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]{1,}(?:\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]+)?)/g;
// « Louan MEHON » (prénom d'abord).
const RE_PRENOM_NOM_MAJ = /\b([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]{1,})\s+([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’-]{2,})\b/g;

/** Mots en capitales qui ne sont pas des patronymes (en-têtes, grades, institutions). */
export const MOTS_NON_PATRONYMES = new Set([
  'gendarmerie', 'nationale', 'police', 'judiciaire', 'brigade', 'compagnie', 'departementale',
  'officier', 'adjudant', 'major', 'capitaine', 'lieutenant', 'commandant', 'colonel', 'general',
  'marechal', 'gardien', 'brigadier', 'agent', 'commissaire', 'procureur', 'republique',
  'substitut', 'magistrat', 'juge', 'greffier', 'avocat', 'batonnier', 'tribunal', 'cour',
  'parquet', 'chambre', 'instruction', 'enquete', 'flagrance', 'preliminaire', 'proces',
  'verbal', 'natinf', 'article', 'articles', 'code', 'procedure', 'penale', 'ministere',
  'justice', 'france', 'francaise', 'monsieur', 'madame', 'mademoiselle',
  'nous', 'vous', 'ils', 'elles', 'cette', 'renseignements', 'investigations',
  'environnements', 'verifications', 'demande', 'interception', 'telephonique', 'objet',
  'destinataire', 'annexe', 'piece', 'feuillet', 'dossier', 'unite', 'residence', 'batiment',
  'appartement', 'commune', 'voie', 'publique', 'secteur', 'service', 'section', 'groupe',
  'operateur', 'bouygues', 'orange', 'free', 'sfr', 'telecom', 'snapchat', 'tiktok',
  'instagram', 'facebook', 'telegram', 'whatsapp', 'iphone', 'samsung', 'android',
  'stupefiants', 'cannabis', 'heroine', 'cocaine', 'trafic', 'vente', 'ventes', 'usage',
]);

/** Prénoms fantômes : le second mot capitalisé n'est pas un prénom. */
const MOTS_NON_PRENOMS = new Set([
  'nous', 'vous', 'ils', 'elles', 'cette', 'ces', 'les', 'des', 'une', 'son', 'sa', 'ses',
  'lors', 'dans', 'pour', 'avec', 'sans', 'sous', 'chez', 'apres', 'avant', 'depuis', 'selon',
  'monsieur', 'madame', 'mademoiselle', 'france', 'paris', 'amiens', 'doullens', 'lille',
  'nord', 'sud', 'est', 'ouest', 'saint', 'sainte', 'rue', 'avenue', 'place', 'route',
]);

/** Un nom trouvé dans un texte, avec sa position. */

/** Vrai si le mot peut être un patronyme (ni institution, ni grade, ni ville). */
export function estPatronymePlausible(mot) {
  const n = normalizeLoose(mot);
  return n.length >= 3 && !MOTS_NON_PATRONYMES.has(n) && !MOTS_NON_PRENOMS.has(n);
}

/**
 * Noms « NOM Prénom » ou « Prénom NOM » repérés dans un texte de procédure.
 * On s'appuie sur la convention typographique des PV (patronyme en capitales) :
 * c'est faillible, mais le moteur n'ouvre un signal que si le nom rejoint une
 * personne DÉCLARÉE quelque part — une mauvaise détection reste sans effet.
 */
export function extractNames(texte) {
  const out = [];
  const vus = new Set();

  const pousser = (brut, patronyme, index) => {
    const nom = brut.replace(/\s+/g, ' ').trim();
    const cle = `${normalizeLoose(nom)}@${index}`;
    if (vus.has(cle)) return;
    vus.add(cle);
    out.push({ brut: nom, patronyme, index });
  };

  RE_NOM_MAJ_PRENOM.lastIndex = 0;
  let m;
  while ((m = RE_NOM_MAJ_PRENOM.exec(texte)) !== null) {
    const patronyme = normalizeLoose(m[1]);
    if (!estPatronymePlausible(m[1])) continue;
    // « NOM COMPOSE Prénom » : le second mot en capitales fait partie du nom.
    const second = m[2] && estPatronymePlausible(m[2]) ? m[2] : '';
    const prenom = m[3];
    if (MOTS_NON_PRENOMS.has(normalizeLoose(prenom.split(' ')[0]))) continue;
    pousser(`${m[1]}${second ? ' ' + second : ''} ${prenom}`, patronyme, m.index);
  }

  RE_PRENOM_NOM_MAJ.lastIndex = 0;
  while ((m = RE_PRENOM_NOM_MAJ.exec(texte)) !== null) {
    const patronyme = normalizeLoose(m[2]);
    if (!estPatronymePlausible(m[2])) continue;
    if (MOTS_NON_PRENOMS.has(normalizeLoose(m[1]))) continue;
    pousser(`${m[2]} ${m[1]}`, patronyme, m.index);
  }

  return out;
}

// ──────────────────────────────────────────────
// EXTRACTION GÉNÉRALE
// ──────────────────────────────────────────────

// Suite de chiffres et de séparateurs assez longue pour être un numéro.
const RE_SUITE_CHIFFRES = /(?:\+|00)?\d[\d\s.\-/()]{7,22}\d/g;
const RE_PLAQUE = /\b[A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2}\b/g;
const RE_IBAN = /\bFR\d{2}(?:\s?[0-9A-Z]{4}){5,7}\b/gi;
const RE_IMEI = /\bimei\b\D{0,12}(\d{15})\b/gi;

/**
 * Toutes les valeurs comparables d'un texte : téléphones, plaques, adresses,
 * comptes, IBAN, IMEI. Les noms de personnes passent par `extractNames`
 * (traitement séparé, car ils demandent un rapprochement approximatif).
 */
export function extractValues(texte) {
  const out = [];
  const vus = new Set();

  const pousser = (v) => {
    const cle = `${v.kind}:${v.canon}`;
    if (vus.has(cle)) return;
    vus.add(cle);
    out.push(v);
  };

  let m;

  RE_SUITE_CHIFFRES.lastIndex = 0;
  while ((m = RE_SUITE_CHIFFRES.exec(texte)) !== null) {
    // Une suite contenant « / » est une référence de procédure, pas un numéro.
    if (m[0].includes('/')) continue;
    const canon = canonPhone(m[0]);
    if (!canon) continue;
    pousser({ kind: 'telephone', canon, valeur: formatPhone(canon), brut: m[0].trim(), index: m.index });
  }

  RE_PLAQUE.lastIndex = 0;
  while ((m = RE_PLAQUE.exec(texte)) !== null) {
    const canon = canonPlate(m[0]);
    if (canon.length !== 7) continue;
    pousser({ kind: 'plaque', canon, valeur: `${canon.slice(0, 2)}-${canon.slice(2, 5)}-${canon.slice(5)}`, brut: m[0].trim(), index: m.index });
  }

  RE_IBAN.lastIndex = 0;
  while ((m = RE_IBAN.exec(texte)) !== null) {
    const canon = canonIban(m[0]);
    if (canon.length < 20) continue;
    pousser({ kind: 'iban', canon, valeur: canon, brut: m[0].trim(), index: m.index });
  }

  RE_IMEI.lastIndex = 0;
  while ((m = RE_IMEI.exec(texte)) !== null) {
    pousser({ kind: 'imei', canon: m[1], valeur: m[1], brut: m[0].trim(), index: m.index });
  }

  RE_ADRESSE.lastIndex = 0;
  while ((m = RE_ADRESSE.exec(texte)) !== null) {
    const canon = canonAdresse(m[1], m[2], m[3]);
    if (!canon) continue;
    pousser({ kind: 'adresse', canon, valeur: canon, brut: m[0].replace(/\s+/g, ' ').trim(), index: m.index });
  }

  for (const { pseudo, index } of pseudosDeReseaux(texte)) {
    pousser({ kind: 'compte', canon: pseudo.toLowerCase(), valeur: pseudo, brut: pseudo, index });
  }

  RE_ARROBASE.lastIndex = 0;
  while ((m = RE_ARROBASE.exec(texte)) !== null) {
    // Une adresse mail n'est pas un pseudo de réseau social.
    if (texte[m.index] === '@' && m.index > 0 && /[A-Za-z0-9._-]/.test(texte[m.index - 1])) continue;
    const canon = m[1].toLowerCase();
    if (NON_PSEUDO.has(normalizeLoose(m[1]))) continue;
    pousser({ kind: 'compte', canon, valeur: `@${m[1]}`, brut: `@${m[1]}`, index: m.index });
  }

  return out;
}

/** Courte citation autour d'une position, pour montrer le contexte. */
export function extrait(texte, index, largeur = 110) {
  const debut = Math.max(0, index - Math.floor(largeur / 3));
  const fin = Math.min(texte.length, index + largeur);
  const morceau = texte.slice(debut, fin).replace(/\s+/g, ' ').trim();
  return `${debut > 0 ? '…' : ''}${morceau}${fin < texte.length ? '…' : ''}`;
}
