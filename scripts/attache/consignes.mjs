/**
 * SIRAL — Attaché de justice · CONSIGNES PAR DOMAINE (les prompts métier).
 *
 * Les « Consignes permanentes » (instructions.mjs) valent pour TOUT ce que
 * fait l'attaché. Ici, c'est l'étage en dessous : le prompt de CHAQUE tâche
 * automatique — la description d'un dossier, la recherche profonde dans la
 * cartographie, chaque étage d'un chantier d'analyse profonde.
 *
 * Ces prompts étaient jusqu'ici figés dans le code. Ils vivent maintenant
 * ici, en SOCLES nommés, que le magistrat peut depuis Paramètres → Attaché IA :
 *   - COMPLÉTER (mode « complement », le défaut) : son texte s'ajoute au socle ;
 *   - REMPLACER (mode « remplacement ») : son texte prend la place du socle.
 * Dans les deux cas, l'ENTÊTE (dossier, lot, angle demandé) et les DONNÉES
 * (liste des pièces, corpus de fiches) restent bâties par le moteur : une
 * consigne ne peut pas casser l'acheminement du contexte, seulement changer
 * la méthode et le format demandés.
 *
 * Stockage : `consignes.json`, enveloppe chiffrée (clé globale), versionnée à
 * chaque écriture — même modèle que la mémoire et les consignes permanentes.
 * Écrite par le navigateur de l'administrateur, jamais par l'agent.
 */
import { readEnvelopeFile } from './store.mjs'
import { decryptJson } from './crypto.mjs'

const FILE = 'consignes.json'

// ── Les socles : le texte d'instruction de chaque tâche ──────────────────
// Variables admises : {{dossier}}, {{pochette}}, {{lot}} — substituées au
// moment du run (elles restent valables dans un texte de remplacement).

export const SOCLES = {
  description: [
    'But : tenir « l\'objet » du dossier à jour au fil des CR et des actes/documents téléversés.',
    'MÉTHODE (2-3 lectures au plus, puis UNE écriture — va au neuf, ne relis pas tout) :',
    '1. lire_dossier numero:"{{dossier}}" — aperçu compact : faits, mis en cause ENREGISTRÉS, actes, index des CR, documents.',
    '2. Si des CR récents ne sont pas encore reflétés dans la description, lis SEULEMENT les plus récents utiles',
    '   (section:"cr").',
    '3. Si des actes/documents récents ne sont pas encore reflétés — y compris le cas SANS AUCUN CR, seulement des',
    '   pièces versées — commence par registre_lire numero:"{{dossier}}" : le sommaire pièce par pièce (type, date,',
    '   personnes, résumé), en UN SEUL APPEL même pour des dizaines de pièces. C\'EST LA SOURCE À PRIVILÉGIER : une',
    '   pièce océrisée peut faire des centaines de pages et épuiser à elle seule le budget de tours si tu la lis en',
    '   entier. N\'appelle dossier_arborescence puis lire_document (une page, SANS paginer avec offsetSuivant) QUE pour',
    '   une pièce précise que le registre ne couvre pas encore et qui te semble déterminante.',
    '4. actualiser_description — reprends la description existante et fais-la PROGRESSER (elle s\'enrichit et se reformule',
    '   au fil du temps), au FORMAT IMPOSÉ en DEUX PARTIES titrées EN MAJUSCULES, en PRISE DE NOTES (~80 %, mots',
    '   inutiles/verbes de liaison retirés, mais clair) :',
    '     SYNTHÈSE — vision globale des faits (qualification, mode opératoire, LIEUX, période, mesures, échéances) ;',
    '     MIS EN CAUSE — un par un les mis en cause enregistrés du dossier, chacun suivi des ÉLÉMENTS À CHARGE relevés.',
    '5. COHÉRENCE DES MIS EN CAUSE — la partie MIS EN CAUSE que tu viens d\'écrire ne porte que les mis en cause',
    '   ENREGISTRÉS. Si, en lisant, tu as relevé une personne MISE EN CAUSE (auteur, complice, fournisseur, logisticien,',
    '   guetteur…) qui ne figure PAS à la section « Mis en cause » du dossier : recouper_personnes sur ces noms, puis',
    '   proposer_mec (nom, role, source) pour chacun — proposition ✓/✗, JAMAIS ajouter_mec. Écarte victimes, témoins,',
    '   enquêteurs, magistrats et avocats, ainsi que les simples alias d\'une personne déjà enregistrée (l\'alias se dit',
    '   dans le rôle). Le dédoublonnage est automatique ; un nom voisin ou déjà connu ailleurs part avec un avertissement.',
    'Si RIEN de neuf n\'est à intégrer, n\'écris pas : termine sans appeler actualiser_description.',
    'Ne signale rien, ne publie rien, ne pose aucune question : cette tâche ne doit laisser aucune carte au magistrat.',
  ].join('\n'),

  mec: [
    'But : repérer les personnes MISES EN CAUSE qui apparaissent dans les CR, actes et documents du dossier mais ne',
    'figurent PAS encore à sa section « Mis en cause », et les PROPOSER au magistrat (✓/✗). Aucune écriture directe.',
    'MÉTHODE (3 lectures au plus, puis les propositions — va au neuf, ne relis pas tout) :',
    '1. lire_dossier numero:"{{dossier}}" — mis en cause DÉJÀ enregistrés, description, index des CR, actes, documents.',
    '2. Lis les CR récents (section:"cr") et, si un acte ou un PV récent le justifie, dossier_arborescence puis',
    '   lire_document sur les pièces les plus utiles — pas tout le dossier.',
    '3. Pour chaque personne MISE EN CAUSE relevée et absente de la section « Mis en cause » : recouper_personnes sur',
    '   son nom, puis proposer_mec (nom, role, source). Écarte victimes, témoins, enquêteurs, magistrats, avocats et les',
    '   simples alias d\'une personne déjà enregistrée (l\'alias se dit dans le rôle).',
    'Si personne ne manque, ne propose rien : termine sans déposer de proposition.',
    'Ne signale rien, ne publie rien, ne pose aucune question.',
  ].join('\n'),

  carto_chat: [
    'S\'il te colle un PV / un résumé / une synthèse pour en cartographier l\'affaire : RECOUPE d\'abord les noms (recouper_personnes), puis dépose une proposition de dossier EX NIHILO (proposer_dossier_carto — label, misEnCause, source). Les personnes connues seront rattachées, les inconnues créées en « MEC lié ex nihilo ». Le dossier n\'est créé qu\'à la validation ✓.',
    'Sinon, commence par carto_analyser (figures centrales, ponts entre affaires, co-occurrences, liens de renseignement tracés). Objectif : l\'aider à VOIR LES CONNEXIONS et améliorer la visibilité.',
    'S\'il te demande une ANALYSE TRANSVERSALE (« analyse TOUS les dossiers », « trouve les liens cachés », « quelle architecture derrière ces affaires ») : suis la MÉTHODE DE RECHERCHE PROFONDE — carto_corpus (enquêtes archivées + instruction, avec pièces), registre_recouper pour les entités déjà partagées (zéro jeton), puis sous_agents qui LISENT les pièces pour remonter surnoms, personnes au 2nd plan, adresses, plaques, téléphones, puis proposer_lien / proposer_mec_carto / proposer_dossier_carto. Les signaux faibles sont dans les PV, pas dans les listes de mis en cause. Si l\'exhaustivité sur tout le corpus est en jeu, ce n\'est plus un travail de conversation : dépose un CHANTIER (chantier_proposer) et annonce son devis.',
    'S\'il te demande L\'HISTOIRE d\'un clan, le CONFLIT entre deux clans, ou QUI EST une personne (« raconte-moi le clan X », « le conflit X/Y », « que sait-on de X ? ») : pars de carto_histoire (dossier de renseignement en un appel : membres, fiches, rôles, liens, dossiers réels/instruction/ex nihilo et documents versés), puis SUIS SA MÉTHODE — lecture des CR et descriptions (lire_dossier), des documents versés (carto_lire_document), du module instruction ; récit CHRONOLOGIQUE et SOURCÉ ; attention aux SUCCESSIONS et SCISSIONS (un réseau démantelé dont un lieutenant remonte sa structure). Au fil de la lecture, PROPOSE ce que tu découvres : proposer_lien (motivé et sourcé, personne↔personne ou personne↔dossier ex nihilo), proposer_note_mec, proposer_camp_carto. Si la matière déborde, sous_agents — ou mieux : un CHANTIER type « histoire » (chantier_proposer, sujet = le camp ou la personne), qui fait la chronique par lots la nuit puis le récit final. Annonce son devis.',
    'Tu peux aussi : identifier les figures pivots et les ponts entre affaires, repérer les cloisonnements, et SUGGÉRER les liens de renseignement manquants — que tu déposes en propositions (proposer_lien, avec la pièce source), jamais tracés d\'office. Réponses concises et structurées.',
  ].join('\n'),

  carto_profonde: [
    'Corpus COMPLET pour une recherche profonde de renseignement : toutes les enquêtes (archivées comprises) et tous les dossiers d\'instruction, avec leurs mis en cause DÉCLARÉS et le nombre de pièces. Les signaux faibles (surnoms, personnes au 2nd plan jamais mises en cause, adresses, plaques, téléphones, comptes) sont dans les PIÈCES — pas dans la liste des mis en cause.',
    'COMMENCE PAR LE REGISTRE : registre_recouper rend d\'un coup, à coût nul, les téléphones, plaques, IBAN, adresses et personnes présents dans AU MOINS DEUX dossiers — extraits automatiquement du texte de TOUTES les pièces versées — avec les pièces exactes de chaque côté. C\'est la carte des liens cachés dans la masse ; registre_lire(numero) donne le sommaire pièce par pièce d\'un dossier. VÉRIFIE ensuite chaque recoupement dans les pièces citées (lire_document) : une entité partagée peut être anodine (taxi, avocat, service public).',
    'MÉTHODE pour aller au-delà du registre : pieces_chercher pour localiser une personne ou une valeur précise ; dossier_arborescence(numero) puis lire_document sur les PV et pièces ; DÉLÈGUE à des sous_agents (un par dossier ou petit groupe, consigne autonome : « relève toute personne — nom, surnom, alias —, adresse, plaque, téléphone, compte, et ce qui la relie à une autre ; format : liste »). Au-delà de quelques dizaines de pièces, passe la main au CHANTIER (chantier_proposer, type "dossier" puis "liens") : devis chiffré, travail de nuit, chaque pièce lue une seule fois.',
    'CONSULTE AUSSI LES FICHES DE LA CARTE (carto_lire_fiches) : les notes des personnes ex nihilo et les descriptions des dossiers ex nihilo sont saisies par le magistrat lui-même — renseignement de première main (rôles supposés, contexte, époque), invisible depuis les dossiers réels. Les dossiers ex nihilo peuvent porter des DOCUMENTS versés (synthèse ou dossier complet — carto_lire_document) : la mémoire des réseaux démantelés. Recoupe le tout avec les pièces ; ne contredis jamais les notes du magistrat.',
    'Recoupe (recouper_personnes) puis PROPOSE (jamais tracé d\'office) : proposer_lien entre personnes reliées, proposer_mec_carto pour un suspect/surnom absent des dossiers, proposer_dossier_carto pour une architecture cachée (grappe autour d\'une même figure — ex. un détenu qui pilote plusieurs affaires), proposer_note_mec pour enrichir la fiche d\'une personne déjà connue (append-only), proposer_camp_carto quand un GROS amas se structure en groupes rivaux (membres sûrs uniquement ; les camps déjà assignés par le magistrat priment).',
  ].join('\n'),

  registre_fiche: [
    'But : le SOMMAIRE du dossier — une mini-fiche par pièce jointe, pour retrouver sans relire et recouper entre dossiers.',
    'SORTIE : un TABLEAU JSON STRICT, un objet par pièce jointe, AUCUN texte autour, AUCUNE balise markdown :',
    '[{ "chemin": "<chemin exact de la pièce, repris tel quel de son entête ═══ PIÈCE … ═══>",',
    '   "type": "<PV audition | PV synthèse | PV constatations | ordonnance | réquisition | rapport | retranscription | expertise | courrier | autre>",',
    '   "datePiece": "AAAA-MM-JJ — la date de l\'acte lui-même, pas celle du versement ; omets le champ si introuvable",',
    '   "personnes": [ { "nom": "NOM Prénom — VERBATIM de la pièce, orthographe conservée", "alias": "surnom éventuel", "role": "mis en cause | victime | témoin | enquêteur | tiers cité (un ou deux mots)" } ],',
    '   "resume": "2 à 3 phrases denses : qui fait quoi, où, quand — le fait utile, pas la forme" }]',
    'PERSONNES — le champ qui compte : EXHAUSTIF et FIDÈLE. Chaque personne nommée dans la pièce, surnoms et alias compris (« dit Momo »), orthographe de la pièce conservée — ce sont ces noms qui permettent les recoupements entre dossiers. N\'invente rien : une donnée absente s\'omet.',
    'Téléphones, plaques, IBAN et adresses sont déjà extraits automatiquement par ailleurs : ne les recopie dans le résumé que s\'ils PORTENT le fait (ex. « la ligne 06… est attribuée à X »).',
    'Pièce illisible ou vide : type "autre", resume "pièce illisible ou vide", personnes [].',
  ].join('\n'),

  chantier_fiche: [
    'TRAVAIL : lis INTÉGRALEMENT chacune des pièces listées plus bas (lire_document, chemin exact ; si offsetSuivant apparaît, lis la suite avant de conclure), puis rends UNE FICHE FACTUELLE unique couvrant tout le lot.',
    'PAGES IMAGES : ne les lis PAS (pas de integrale:true) — recense-les simplement dans la section dédiée de la fiche.',
    'LECTURE SEULE ABSOLUE : tu n\'appelles AUCUN outil d\'écriture (ni produire_document, ni proposer_*, ni classer_note, ni memoire) — le moteur du chantier range ta fiche lui-même.',
    '',
    'FORMAT IMPOSÉ DE LA FICHE (markdown, sections exactes ; chaque fait porte sa COTE = le chemin de la pièce ; verbatims entre guillemets, JAMAIS reformulés) :',
    '## Chronologie',
    '(faits datés, un par ligne : date — fait — cote)',
    '## Personnes',
    '(par personne : identité, alias, téléphones, véhicules/plaques, adresses, comptes, rôle apparent — avec cotes)',
    '## Déclarations utiles (verbatim)',
    '(citations exactes entre guillemets, qui parle, cote)',
    '## À charge / À décharge',
    '(éléments factuels, cotes — pas d\'appréciation)',
    '## Contradictions et points à vérifier',
    '## Actes manquants ou à envisager',
    '## Annexes images non lues',
    '(pièce — pages concernées)',
    '## Pièces sans intérêt d\'enquête',
    '(procédure pure : notifications, réquisitions type — une ligne par pièce)',
    '',
    'TA RÉPONSE FINALE EST LA FICHE, ET RIEN D\'AUTRE : aucun préambule, aucun commentaire, aucune conclusion hors fiche. Si une pièce est illisible, note-le dans la fiche (section Contradictions/à vérifier) et poursuis.',
  ].join('\n'),

  chantier_synthese: [
    'TRAVAIL : à partir des SEULES fiches (ne relis aucune pièce), rends une NOTE DE SYNTHÈSE d\'ensemble pour le magistrat :',
    '1. Vue générale (faits, période, organisation apparente).',
    '2. Par personne mise en cause : rôle, éléments à charge et à décharge (cotes).',
    '3. Recoupements transversaux (mêmes numéros, plaques, adresses, lieux à travers les pochettes).',
    '4. Contradictions majeures et points à trancher.',
    '5. Actes manquants / investigations à envisager.',
    '6. Angles morts : pochettes en échec, annexes images non lues — ce que la synthèse NE couvre PAS.',
    'Chaque affirmation porte ses cotes. Prose dense de magistrat, pas de remplissage.',
    'LECTURE SEULE ABSOLUE : aucun outil d\'écriture. TA RÉPONSE FINALE EST LA NOTE, RIEN D\'AUTRE.',
  ].join('\n'),

  chantier_liens_lot: [
    'TRAVAIL : dresse la TABLE DE SIGNALEMENTS de ce lot — tout ce qui peut se recouper avec un autre dossier. Une ligne par signalement, format exact :',
    '- <catégorie> | <valeur normalisée> | <contexte en une phrase> | <cote(s)>',
    'Catégories : personne (identité + alias), surnom, téléphone, plaque/véhicule, adresse/lieu, compte/moyen de paiement, date-événement marquante, mode opératoire.',
    'NORMALISE les valeurs (téléphones sans espaces, NOM Prénom, plaques sans tirets) pour permettre le rapprochement mécanique. Rien sans sa cote — la cote est le chemin de pièce que porte la fiche.',
    'LECTURE SEULE ABSOLUE : aucun outil (ni lecture de pièce, ni écriture) — les fiches jointes suffisent.',
    'TA RÉPONSE FINALE EST LA TABLE, RIEN D\'AUTRE.',
  ].join('\n'),

  chantier_liens_rapport: [
    'TRAVAIL : à partir des SEULES tables jointes, rends le RAPPORT DE RECOUPEMENTS :',
    '1. Recoupements FORTS (même téléphone, même plaque, même personne ou alias, même adresse, même compte dans PLUSIEURS dossiers) : pour chacun — la valeur, les dossiers concernés, LES COTES DE PART ET D\'AUTRE, ce que cela implique.',
    '2. Recoupements PROBABLES (graphies proches, surnoms, co-occurrences de lieux et de dates) : mêmes exigences, incertitude dite.',
    '3. Architecture d\'ensemble si elle se dessine (filière commune, logistique partagée, donneurs d\'ordre).',
    '4. Vérifications concrètes pour transformer un probable en certain (actes précis à envisager).',
    '5. Ce que le rapport NE couvre PAS (dossiers écartés faute de fiches, lots en échec).',
    'JAMAIS un recoupement sans ses cotes des deux côtés. Prose dense de magistrat, pas de remplissage.',
    'LECTURE SEULE ABSOLUE : aucun outil. TA RÉPONSE FINALE EST LE RAPPORT, RIEN D\'AUTRE.',
  ].join('\n'),

  chantier_carto_lot: [
    'TRAVAIL, en trois temps :',
    '1. Repère dans les fiches jointes ce qui mérite la cartographie : personnes au rôle structurant, ponts entre affaires, fournisseurs/logisticiens récurrents — pas les seconds couteaux sans relief.',
    '2. Confronte à l\'existant : recouper_personnes sur chaque nom retenu (carto_lister_liens au besoin) pour ne proposer QUE du nouveau.',
    '3. Dépose tes PROPOSITIONS : proposer_mec_carto pour une personne absente de la carto qui le mérite, proposer_lien pour un lien de renseignement sourcé (pièce = la cote portée par la fiche). Le magistrat validera ou refusera chacune.',
    'SEULS outils d\'écriture autorisés : proposer_mec_carto et proposer_lien. Aucune lecture de pièce — les fiches jointes suffisent.',
    'TA RÉPONSE FINALE : un compte rendu bref — une ligne par proposition déposée (qui/quoi, pourquoi, cote), puis ce que tu n\'as PAS proposé et pourquoi.',
  ].join('\n'),

  chantier_carto_bilan: [
    'TRAVAIL : rends une NOTE DE BILAN pour le magistrat :',
    '1. Les propositions déposées (personnes, liens), regroupées par affaire — pour chacune : pourquoi elle mérite validation, sa cote.',
    '2. Les figures centrales et les ponts entre affaires qui se dégagent.',
    '3. Ce qui n\'a PAS été proposé et pourquoi (déjà en carto, trop faible).',
    '4. Rappel : les propositions se valident page Assistant de justice (« Proposition à valider ») et au bas de la Cartographie.',
    'LECTURE SEULE ABSOLUE : aucun outil. TA RÉPONSE FINALE EST LA NOTE, RIEN D\'AUTRE.',
  ].join('\n'),

  chantier_histoire_lot: [
    'TRAVAIL : depuis les fiches jointes, extrais TOUT ce qui concerne le SUJET (le clan / la personne et ses membres, nommés dans l\'entête) — une CHRONIQUE FACTUELLE datée, une ligne par fait, format exact :',
    '- <date ou période> | <fait en une phrase — qui fait quoi, avec qui> | <rôle des membres impliqués> | <cote(s)>',
    'Relève en particulier : prises et pertes de pouvoir, interpellations, incarcérations, condamnations, sorties, violences subies ou commises, alliances et trahisons, territoires, flux (stups, argent, armes), et toute mention d\'un basculement (un lieutenant qui prend son autonomie, un groupe qui se scinde).',
    'Après la chronique, deux courtes sections : « PERSONNES GRAVITANT » (secondes mains, proches, non-membres récurrents — avec cotes) et « SIGNAUX DE SUCCESSION/SCISSION » (indices qu\'un réseau mute, même ténus — dits comme indices).',
    'Rien sans sa cote. Ignore ce qui ne touche ni le sujet ni son entourage direct.',
    'LECTURE SEULE ABSOLUE : aucun outil — les fiches jointes suffisent.',
  ].join('\n'),

  chantier_histoire_recit: [
    'TRAVAIL : rends L\'HISTOIRE DU SUJET — un RÉCIT DE RENSEIGNEMENT chronologique et SOURCÉ, en prose dense de magistrat :',
    '1. ORIGINES : d\'où vient le groupe/la personne, premier dossier connu, territoire et activité de départ.',
    '2. CHRONOLOGIE : les épisodes datés qui structurent l\'histoire (affaires, interpellations, condamnations, violences, alliances) — chaque fait avec son dossier et sa cote.',
    '3. ORGANIGRAMME DANS LE TEMPS : chef(s), lieutenants, rôles — et leurs évolutions.',
    '4. SUCCESSIONS ET SCISSIONS : un démantèlement dont un lieutenant remonte sa propre structure avec les mêmes hommes, un groupe qui mute ou change de nom — dates, déclencheurs, qui a suivi qui. Croise avec les camps et fiches de la carte joints au contexte.',
    '5. CONFLITS : les groupes rivaux, les épisodes d\'affrontement, l\'état actuel du rapport de forces.',
    '6. AUJOURD\'HUI : ce qui reste actif, les incertitudes, ce qu\'il faudrait vérifier.',
    'Les NOTES DU MAGISTRAT jointes au contexte sont des décisions : ne les contredis jamais — un élément qui s\'en écarte se présente comme élément nouveau, sourcé.',
    'OUTILS PERMIS, avec parcimonie : carto_lire_document (documents versés sur les dossiers ex nihilo — souvent la mémoire des réseaux anciens), puis les PROPOSITIONS tirées de ta lecture : proposer_lien (motivé + source), proposer_note_mec, proposer_camp_carto (camp successeur nommé explicitement, ex. « Réseau Zouaoui (ex-Krasniqi) »). Aucune lecture de pièce brute.',
    'TA RÉPONSE FINALE EST LE RÉCIT, suivi d\'une courte liste des propositions déposées.',
  ].join('\n'),
}

// ── Le catalogue servi au panneau d'administration ───────────────────────
// Un ordre et des libellés stables : c'est la table des matières que voit le
// magistrat. `variables` liste ce que le moteur substitue dans le socle.

export const CATALOGUE = [
  {
    id: 'description', groupe: 'Rédaction automatique', label: 'Description du dossier (« l\'objet »)',
    resume: 'Le prompt du run court qui tient la description à jour au fil des CR et des pièces versées.',
    quand: 'À chaque dossier qui bouge (en fond, après une période de calme) et sur l\'icône « Actualiser » de la description.',
    variables: ['{{dossier}}'],
  },
  {
    id: 'mec', groupe: 'Rédaction automatique', label: 'Détection des mis en cause',
    resume: 'Le prompt qui relit le dossier pour PROPOSER (✓/✗) les personnes mises en cause manquantes.',
    quand: 'Icône « Actualiser » de la section Mis en cause, et en fin d\'actualisation de description.',
    variables: ['{{dossier}}'],
  },
  {
    id: 'registre_fiche', groupe: 'Rédaction automatique', label: 'Registre des pièces (mini-fiches)',
    resume: 'Le prompt des mini-fiches du registre : type, date, PERSONNES (noms, alias) et résumé de chaque pièce versée.',
    quand: 'Au fil de l\'eau, par lots courts, une fois la pièce ingérée (texte + entités déjà extraits).',
    variables: ['{{dossier}}'],
    avertissement: 'Le moteur attend un TABLEAU JSON strict : un remplacement qui change la sortie met les mini-fiches en échec.',
  },
  {
    id: 'carto_profonde', groupe: 'Cartographie', label: 'Recherche profonde (corpus transversal)',
    resume: 'La MÉTHODE servie avec le corpus complet : comment dépouiller les pièces de tous les dossiers, déléguer aux sous-agents, recouper et proposer.',
    quand: 'Dès que l\'attaché appelle carto_corpus — le cœur d\'une analyse transversale de renseignement.',
    variables: [],
  },
  {
    id: 'carto_chat', groupe: 'Cartographie', label: 'Cadrage du chat cartographie',
    resume: 'Le contexte injecté au premier message d\'une conversation ouverte depuis le module Cartographie.',
    quand: 'Premier message de chaque conversation lancée depuis la carte.',
    variables: [],
  },
  {
    id: 'chantier_fiche', groupe: 'Analyse profonde', label: 'Dépouillement d\'un lot → fiche',
    resume: 'Le prompt du dépouillement : ce que l\'attaché lit, ce qu\'il en retient, et le FORMAT IMPOSÉ de la fiche.',
    quand: 'À chaque lot d\'un chantier « dossier en détail ».',
    variables: ['{{dossier}}', '{{pochette}}', '{{lot}}'],
    avertissement: 'Le moteur attend une fiche en markdown avec des titres « ## » : un remplacement qui supprime les sections rend les lots en échec.',
  },
  {
    id: 'chantier_synthese', groupe: 'Analyse profonde', label: 'Note de synthèse du dossier',
    resume: 'Le prompt de la synthèse finale, bâtie sur les seules fiches.',
    quand: 'Une fois tous les lots d\'un chantier « dossier en détail » traités.',
    variables: ['{{dossier}}'],
  },
  {
    id: 'chantier_liens_lot', groupe: 'Analyse profonde', label: 'Liens — table de signalements',
    resume: 'Le prompt qui transforme les fiches d\'un dossier en table de signalements normalisée.',
    quand: 'À chaque lot d\'un chantier « liens entre dossiers ».',
    variables: ['{{dossier}}', '{{lot}}'],
  },
  {
    id: 'chantier_liens_rapport', groupe: 'Analyse profonde', label: 'Liens — rapport de recoupements',
    resume: 'Le prompt du rapport final qui croise les tables de signalements de tous les dossiers.',
    quand: 'Une fois tous les lots d\'un chantier « liens » traités.',
    variables: [],
  },
  {
    id: 'chantier_carto_lot', groupe: 'Analyse profonde', label: 'Cartographie — propositions d\'un lot',
    resume: 'Le prompt qui tire des fiches les personnes et les liens à proposer à la carte.',
    quand: 'À chaque lot d\'un chantier « cartographie ».',
    variables: ['{{dossier}}', '{{lot}}'],
  },
  {
    id: 'chantier_carto_bilan', groupe: 'Analyse profonde', label: 'Cartographie — note de bilan',
    resume: 'Le prompt du bilan final : ce qui a été proposé, ce qui ne l\'a pas été et pourquoi.',
    quand: 'Une fois tous les lots d\'un chantier « cartographie » traités.',
    variables: [],
  },
  {
    id: 'chantier_histoire_lot', groupe: 'Analyse profonde', label: 'Histoire — chronique d\'un lot',
    resume: 'Le prompt qui extrait des fiches la chronique datée du sujet (clan ou personne), cotée ligne à ligne.',
    quand: 'À chaque lot d\'un chantier « histoire ».',
    variables: ['{{dossier}}', '{{lot}}', '{{sujet}}'],
  },
  {
    id: 'chantier_histoire_recit', groupe: 'Analyse profonde', label: 'Histoire — le récit',
    resume: 'Le prompt du récit final : origines, chronologie, organigramme, successions/scissions, conflits, état actuel.',
    quand: 'Une fois tous les lots d\'un chantier « histoire » traités.',
    variables: ['{{sujet}}'],
  },
]

/** Le catalogue avec le socle intégré — servi au panneau d'administration. */
export function catalogueAvecSocles() {
  return CATALOGUE.map((c) => ({ ...c, socle: SOCLES[c.id] || '' }))
}

// ── Lecture des consignes du magistrat ───────────────────────────────────

const MODES = new Set(['complement', 'remplacement'])

/** Toutes les consignes par domaine, déchiffrées. `{}` si aucune. */
export function readConsignes(keys) {
  const env = readEnvelopeFile(FILE)
  if (!env) return {}
  try {
    const { content } = decryptJson(keys.global, env)
    if (!content || typeof content !== 'object') return {}
    const out = {}
    for (const [id, v] of Object.entries(content)) {
      if (!SOCLES[id] || !v || typeof v !== 'object') continue
      const texte = typeof v.texte === 'string' ? v.texte.slice(0, 40_000) : ''
      const mode = MODES.has(v.mode) ? v.mode : 'complement'
      if (texte.trim()) out[id] = { mode, texte }
    }
    return out
  } catch {
    return {}
  }
}

function substituer(texte, vars) {
  let out = String(texte || '')
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.split(`{{${k}}}`).join(String(v ?? ''))
  }
  return out
}

/**
 * Le bloc d'instructions d'une tâche : le socle (ou le texte de remplacement
 * du magistrat), suivi le cas échéant de son complément. Ne touche ni à
 * l'entête ni aux données du prompt — le moteur les garde en main.
 */
export function bloc(keys, id, vars = {}) {
  const socle = SOCLES[id] || ''
  let c = null
  try { c = readConsignes(keys)[id] || null } catch { c = null }
  if (!c) return substituer(socle, vars)
  if (c.mode === 'remplacement') return substituer(c.texte, vars)
  return [
    substituer(socle, vars),
    '',
    '── CONSIGNES DU MAGISTRAT POUR CETTE TÂCHE (elles priment en cas de doute) ──',
    substituer(c.texte, vars),
  ].join('\n')
}

/** Prompt complet : entête (contexte figé) + bloc d'instructions + données. */
export function prompt(keys, id, { entete = [], vars = {}, donnees = [] } = {}) {
  return [
    ...(Array.isArray(entete) ? entete : [entete]),
    '',
    bloc(keys, id, vars),
    ...(Array.isArray(donnees) ? donnees : [donnees]),
  ].filter((l) => l !== null && l !== undefined && l !== false).join('\n')
}
