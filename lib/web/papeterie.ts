/**
 * SIRAL — papeterie institutionnelle (identité du parquet).
 *
 * Deux niveaux, tenus dans la configuration d'habilitations du TJ
 * (coffre `users-config`, chiffré) :
 *  - le TRIBUNAL (juridiction, ville, adresse, standard, mail du service) —
 *    réglé par l'administrateur du TJ ;
 *  - le MAGISTRAT (nom, qualité, section, signature, mail) — réglé par chacun
 *    dans « Mon profil ».
 * `appliquerPapeterie` fusionne ces réglages dans l'objet PAPETERIE au
 * chargement des habilitations ; tout le code lit PAPETERIE au moment de
 * produire un document. Aucune autre partie du code ne doit coder « en dur »
 * une adresse, un nom ou une section.
 *
 * Sans réglage : le TJ d'origine (Amiens) garde sa papeterie historique ; un
 * autre TJ part d'un modèle neutre construit sur son nom.
 */
export interface Papeterie {
  /** Ligne d'en-tête « Cour d'appel — Tribunal judiciaire ». */
  juridiction: string;
  /** Ligne « Parquet du procureur de la République ». */
  parquet: string;
  /** Rattachement court du magistrat (actes : requêtes, soit-transmis). */
  section: string;
  /** Rattachement détaillé (courriers) : section + compétences. */
  sectionDetail: string;
  /** Ville du lieu de signature (« Fait à … »). */
  ville: string;
  magistrat: {
    /** Forme « NOM Prénom » (en-tête, « Nous, … »). */
    nomQualite: string;
    /** Forme « Prénom NOM » (signature). */
    prenomNom: string;
    /** Qualité (« substitut du Procureur de la République »). */
    qualite: string;
    /** Rattachement (« près le tribunal judiciaire d'AMIENS »). */
    ressort: string;
  };
  /** Bloc signature, ligne à ligne (calé à droite). */
  signature: string[];
  /** Bloc coordonnées du pied de page (courriers). */
  coordonnees: {
    adresse: string[];
    mails: string[];
    standard: string;
    /** Ligne des compétences, en bas de page. */
    thematiques: string;
  };
}

const PAPETERIE_AMIENS: Papeterie = {
  juridiction: "Cour d'Appel d'Amiens — Tribunal Judiciaire d'Amiens",
  parquet: 'Parquet du procureur de la République',
  section: 'Section Criminalité Organisée',
  sectionDetail: 'Section Criminalité organisée — Entraide pénale européenne',
  ville: 'Amiens',
  magistrat: {
    nomQualite: 'CHEVALIER Audran',
    prenomNom: 'Audran CHEVALIER',
    qualite: 'substitut du Procureur de la République',
    ressort: "près le tribunal judiciaire d'AMIENS",
  },
  signature: [
    'P/ Le Procureur de la République',
    'Audran CHEVALIER',
    'Substitut',
  ],
  coordonnees: {
    adresse: [
      "Tribunal Judiciaire d'Amiens",
      '14 rue Robert de Luzarches',
      'CS 32722',
      '80027 Amiens Cedex 1',
    ],
    mails: ['audran.chevalier@justice.fr', 'crimorg.tj-amiens@justice.fr'],
    standard: '03.22.82.47.07',
    thematiques: 'Criminalité Organisée · CyberCriminalité · Entraide pénale internationale',
  },
};

/** Réglages du tribunal (administrateur du TJ). */
export interface PapeterieTj {
  juridiction?: string;
  parquet?: string;
  ville?: string;
  /** « près le tribunal judiciaire d'AMIENS » */
  ressort?: string;
  adresse?: string[];
  standard?: string;
  /** Mail(s) du service, imprimés au pied des courriers. */
  mailsService?: string[];
}

/** Réglages personnels du magistrat (Mon profil). */
export interface PapeteriePerso {
  /** « NOM Prénom » */
  nomQualite?: string;
  /** « Prénom NOM » */
  prenomNom?: string;
  /** « substitut du procureur de la République » */
  qualite?: string;
  /** Mention courte sous la signature (« Substitut »). */
  fonctionCourte?: string;
  section?: string;
  sectionDetail?: string;
  thematiques?: string;
  mail?: string;
}

export function deVille(ville: string): string {
  return /^[aeiouyhàâéèêëîïôöûü]/i.test(ville) ? `d'${ville}` : `de ${ville}`;
}

/** « TJ Lille » / « Tribunal judiciaire de Lille » → « Lille ». */
export function villeDuTj(nomTj: string): string {
  return nomTj
    .replace(/^\s*(tj|tribunal judiciaire)\s*(de |d['’]\s*)?/i, '')
    .trim();
}

/** Valeurs par défaut du tribunal, d'après son nom. */
export function papeterieTjParDefaut(nomTj: string, origine: boolean): Required<PapeterieTj> {
  if (origine) {
    const a = PAPETERIE_AMIENS;
    return {
      juridiction: a.juridiction, parquet: a.parquet, ville: a.ville, ressort: a.magistrat.ressort,
      adresse: [...a.coordonnees.adresse], standard: a.coordonnees.standard,
      mailsService: ['crimorg.tj-amiens@justice.fr'],
    };
  }
  const ville = villeDuTj(nomTj) || 'Ville';
  return {
    juridiction: `Tribunal judiciaire ${deVille(ville)}`,
    parquet: 'Parquet du procureur de la République',
    ville,
    ressort: `près le tribunal judiciaire ${deVille(ville.toUpperCase())}`,
    adresse: [`Tribunal judiciaire ${deVille(ville)}`],
    standard: '',
    mailsService: [],
  };
}

/** Valeurs par défaut du magistrat. L'administrateur du serveur, à Amiens, garde la papeterie historique. */
export function papeteriePersoParDefaut(nomAffiche: string, historique: boolean): Required<PapeteriePerso> {
  if (historique) {
    const a = PAPETERIE_AMIENS;
    return {
      nomQualite: a.magistrat.nomQualite, prenomNom: a.magistrat.prenomNom, qualite: a.magistrat.qualite,
      fonctionCourte: a.signature[2], section: a.section, sectionDetail: a.sectionDetail,
      thematiques: a.coordonnees.thematiques, mail: 'audran.chevalier@justice.fr',
    };
  }
  return {
    nomQualite: nomAffiche, prenomNom: nomAffiche,
    qualite: 'substitut du procureur de la République', fonctionCourte: 'Substitut',
    section: '', sectionDetail: '', thematiques: '', mail: '',
  };
}

function plein<T extends object>(defauts: Required<T>, saisi?: T): Required<T> {
  const out = { ...defauts };
  for (const [k, v] of Object.entries(saisi || {})) {
    const vide = v === undefined || v === null || (typeof v === 'string' && !v.trim())
      || (Array.isArray(v) && !v.some((x) => String(x).trim()));
    if (!vide) (out as Record<string, unknown>)[k] = Array.isArray(v) ? v.filter((x) => String(x).trim()) : v;
  }
  return out;
}

/**
 * Papeterie EN VIGUEUR (mutée par appliquerPapeterie) — lue au moment de
 * produire chaque document.
 */
export const PAPETERIE: Papeterie = JSON.parse(JSON.stringify(PAPETERIE_AMIENS));

/** Réglages du tribunal en vigueur, et s'ils s'écartent des trames d'origine. */
let tjEnVigueur: Required<PapeterieTj> = papeterieTjParDefaut('', true);
let tjPersonnalise = false;
export function papeterieTjEnVigueur(): { tj: Required<PapeterieTj>; personnalise: boolean } {
  return { tj: tjEnVigueur, personnalise: tjPersonnalise };
}

export function appliquerPapeterie(opts: {
  tj?: PapeterieTj;
  perso?: PapeteriePerso;
  nomTj: string;
  origine: boolean;
  nomAffiche: string;
  historique: boolean;
}): void {
  const t = plein(papeterieTjParDefaut(opts.nomTj, opts.origine), opts.tj);
  const m = plein(papeteriePersoParDefaut(opts.nomAffiche, opts.historique), opts.perso);
  tjEnVigueur = t;
  tjPersonnalise = !opts.origine || JSON.stringify(t) !== JSON.stringify(papeterieTjParDefaut(opts.nomTj, true));
  const next: Papeterie = {
    juridiction: t.juridiction,
    parquet: t.parquet,
    section: m.section,
    sectionDetail: m.sectionDetail || m.section,
    ville: t.ville,
    magistrat: { nomQualite: m.nomQualite, prenomNom: m.prenomNom, qualite: m.qualite, ressort: t.ressort },
    signature: ['P/ Le Procureur de la République', m.prenomNom, m.fonctionCourte],
    coordonnees: {
      adresse: t.adresse,
      mails: [m.mail, ...t.mailsService].filter(Boolean),
      standard: t.standard,
      thematiques: m.thematiques,
    },
  };
  Object.assign(PAPETERIE, next);
}

/** « Audran CHEVALIER, substitut, » — signataire des actes SAS / clôture. */
export function signatairePapeterie(): string {
  const fonction = (PAPETERIE.signature[2] || '').trim();
  return `${PAPETERIE.magistrat.prenomNom}${fonction ? `, ${fonction.charAt(0).toLowerCase()}${fonction.slice(1)}` : ''},`;
}

/**
 * Trames ODT (Entraide) : elles portent l'en-tête et le pied de page du parquet
 * d'Amiens. Hors TJ d'origine — ou si l'administrateur a modifié la papeterie —
 * on y substitue celle du tribunal en vigueur.
 */
export function adapterTrameOdt(xmlSource: string): string {
  const { tj, personnalise } = papeterieTjEnVigueur();
  if (!personnalise) return xmlSource;
  const x = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = tj.juridiction.split(/\s+[—–-]\s+/).map((p) => p.trim()).filter(Boolean);
  const cour = parts.length > 1 ? parts[0] : '';
  const tribunal = parts.length > 1 ? parts[1] : (parts[0] || '');
  const villeCour = cour.replace(/^cour d['’]appel\s*(de |d['’])?/i, '').trim();
  const V = (t: string) => t.toUpperCase();
  const mail = tj.mailsService[0] || '';
  const remplacements: Array<[string, string]> = [
    // en-tête
    [">COUR D'APPEL D'AMIENS<", `>${x(V(cour || tribunal))}<`],
    [">TRIBUNAL JUDICIAIRE D'AMIENS<", `>${x(cour ? V(tribunal) : '')}<`],
    [">TRIBUNAL JUDICIAIRE<", `>${x(cour ? 'TRIBUNAL JUDICIAIRE' : '')}<`],
    [">AMIENS COURT OF APPEAL<", `>${x(cour ? `${V(villeCour)} COURT OF APPEAL` : `${V(tj.ville)} JUDICIAL COURT`)}<`],
    [">AMIENS JUDICIAL COURT<", `>${x(cour ? `${V(tj.ville)} JUDICIAL COURT` : '')}<`],
    // corps
    ["le tribunal judiciaire d'Amiens", x(`le tribunal judiciaire ${deVille(tj.ville)}`)],
    ['the Amiens Judicial Court', x(`the ${tj.ville} Judicial Court`)],
    ['Amiens, le {{date}}', '{{ville}}, le {{date}}'],
    ['Amiens, {{date}}', '{{ville}}, {{date}}'],
    // pied de page
    [">Tribunal judiciaire d'Amiens<", `>${x(tj.adresse[0] || '')}<`],
    ['>14, rue Robert de Luzarches<', `>${x(tj.adresse[1] || '')}<`],
    ['>CS 32722<', `>${x(tj.adresse[2] || '')}<`],
    ['>80027 AMIENS CEDEX 1<', `>${x(tj.adresse.slice(3).join(', '))}<`],
    ['standard :<text:s/>03228236500', x(tj.standard ? `standard : ${tj.standard}` : '')],
    ['standard : 03228236500', x(tj.standard ? `standard : ${tj.standard}` : '')],
    ['>secrétariat procureur : 0322823618<', '><'],
    ['sec.pr.tj-amiens@justice.fr', x(mail)],
  ];
  let out = xmlSource;
  for (const [avant, apres] of remplacements) out = out.split(avant).join(apres);
  return out;
}
