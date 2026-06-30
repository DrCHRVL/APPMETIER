// Types de la nomenclature NATAFF (NATure d'AFFaire).
//
// La NATAFF est la classification « type d'affaire » du ministère de la Justice
// (Cassiopée). Elle est plus grossière que le NATINF : là où une affaire de
// trafic de stupéfiants se décline en plusieurs NATINF (détention, transport,
// cession…), elle porte une seule NATAFF de niveau 2 (G1).
//
// On n'exploite que 2 niveaux :
//  - N1 : 12 grandes catégories (A → L), pour une vue d'ensemble (roll-up) ;
//  - N2 : ~74 sous-catégories (A1, B3, G1…), maille statistique principale.
// Le niveau 3 (G14…) est volontairement ignoré : il recoupe le grain du NATINF.
//
// Voir data/natinf/nataff.json pour la nomenclature et lib/natinf/nataff.ts
// pour la résolution NATINF → NATAFF.

/** Grande catégorie NATAFF (niveau 1), ex. « G — Infraction en matière de santé publique ». */
export interface NataffN1 {
  /** Lettre (A → L). */
  code: string;
  libelle: string;
}

/** Sous-catégorie NATAFF (niveau 2), ex. « G1 — …stupéfiants… ». */
export interface NataffN2 {
  /** Lettre + chiffre (ex. « G1 »). */
  code: string;
  /** Code N1 parent (ex. « G »). */
  n1: string;
  libelle: string;
}

/** Résolution d'un NATINF vers sa NATAFF (N2 + N1 parent). */
export interface NataffResolution {
  n2: NataffN2;
  n1: NataffN1;
}
