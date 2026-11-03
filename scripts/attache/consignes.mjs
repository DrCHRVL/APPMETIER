/**
 * SIRAL — Attaché de justice · CONSIGNES PAR DOMAINE (les prompts métier).
 *
 * Les « Consignes permanentes » (instructions.mjs) valent pour TOUT ce que
 * fait l'attaché. Ici, c'est l'étage en dessous : le prompt de CHAQUE tâche
 * automatique — la description d'un dossier, la recherche profonde dans la
 * cartographie, les mini-fiches du registre.
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
    'But : profiter de la lecture COMPLÈTE du dossier « {{dossier}} » pour tout remettre à jour d\'un coup — description, mis en',
    'cause et leurs rôles, liens de la cartographie, mémoire du dossier — afin que ce travail d\'analyse ne soit pas à refaire.',
    'Le magistrat l\'a demandé (bouton « Actualiser ») : c\'est son instruction expresse pour les écritures ci-dessous.',
    'MATIÈRE — tout t\'est JOINT plus bas : description actuelle, mémoire du dossier, TOUS les CR (texte intégral), les actes,',
    'le SOMMAIRE DU REGISTRE de toutes les pièces serveur, les mis en cause connus dans d\'autres dossiers, les liens déjà tracés',
    'sur la carte et les entités partagées avec d\'autres dossiers. Les éléments ★ sont arrivés depuis la dernière actualisation :',
    'concentre-toi sur eux, l\'acquis est déjà dans la description et la mémoire. Ne relance pas lire_dossier ni registre_lire.',
    'lire_document (une page, sans paginer) SEULEMENT pour une pièce SANS fiche, ou une entité partagée à vérifier, déterminante',
    '— cinq lectures au plus.',
    '',
    'DANS CET ORDRE :',
    '1. actualiser_description — TOUJOURS, une seule fois, avec la description COMPLÈTE (pas un ajout) : on repart de l\'existant',
    '   et on le fait PROGRESSER (s\'il est vide, on rédige tout). FORMAT IMPOSÉ, texte brut, DEUX PARTIES titrées EN MAJUSCULES :',
    '     SYNTHÈSE — vision globale des faits : qualification, mode opératoire, LIEUX, période, organisation apparente,',
    '       mesures et actes en cours, échéances. Chaque fait important daté ; rien d\'inventé.',
    '     MIS EN CAUSE — un par un les mis en cause ENREGISTRÉS, chacun suivi des ÉLÉMENTS À CHARGE relevés (avec la pièce ou',
    '       le CR qui les fonde, en bref). C\'est ICI que se dit le détail sur chaque personne.',
    '   STYLE PRISE DE NOTES : rédigé à ~80 %, phrases nominales courtes, mots inutiles et verbes de liaison retirés, mais clair',
    '   pour un collègue qui découvre le dossier. Dense, factuel, sans remplissage.',
    '2. RÔLES DES MIS EN CAUSE ENREGISTRÉS — si le rôle d\'un mis en cause est vide, faux ou dépassé au vu du dossier :',
    '   modifier_mec (numero, nom, role). Rôle COURT : 2 à 6 mots (« gérant du point de deal », « fournisseur résine »,',
    '   « guetteur », « tête de réseau »). Jamais de phrase longue : le détail va dans la description. Ne touche pas un rôle juste.',
    '3. NOUVEAUX MIS EN CAUSE / SUSPECTS — toute personne MISE EN CAUSE ou SUSPECTÉE (auteur, complice, fournisseur, logisticien,',
    '   guetteur…) absente de la section « Mis en cause » : recouper_personnes, puis proposer_mec (nom, role COURT de 2 à 6 mots,',
    '   source) — proposition ✓/✗, JAMAIS ajouter_mec. Écarte victimes, témoins, enquêteurs, magistrats, avocats et simples alias',
    '   d\'un enregistré (l\'alias se dit dans la description).',
    '4. LIENS DE LA CARTOGRAPHIE — proposer_lien (numero:"{{dossier}}", sourceNom, targetNom, label court, source = pièce/CR),',
    '   seulement s\'il est VRAIMENT pertinent et absent des « liens déjà tracés » :',
    '   - liens MATÉRIELS (même téléphone, plaque, adresse, compte, transactions, logistique) : seulement entre personnes qui ne',
    '     sont PAS déjà mises en cause ensemble dans un même dossier (ce lien-là, la carte le voit déjà) — typiquement avec une',
    '     personne d\'un AUTRE dossier, via les entités partagées jointes, vérifiées dans la pièce ;',
    '   - liens PERSONNELS (famille, couple, amitié proche, ancien dossier commun non renseigné, codétention…) : à proposer',
    '     largement dès qu\'une pièce les établit, y compris entre co-mis en cause.',
    '   Pas de lien supposé ni de simple co-présence : chaque lien cite sa pièce.',
    '5. MÉMOIRE DU DOSSIER — memoire_dossier_noter, une à trois lignes télégraphiques, pour les acquis d\'analyse DURABLES',
    '   absents de la mémoire jointe (alias établis, lignes attribuées, véhicules, hiérarchie du réseau, point à vérifier) : ce',
    '   que la prochaine lecture n\'aura pas à redécouvrir. Rien si rien de durable n\'est neuf.',
    'Ne signale rien, ne publie rien, ne pose aucune question : cette tâche ne doit laisser aucune carte au magistrat.',
  ].join('\n'),

  flux: [
    'But : à chaque mouvement du dossier (pièces versées, CR rédigés, actes ajoutés), intégrer le NEUF — sans relire',
    'l\'ancien — en quatre gestes, dans cet ordre, puis t\'arrêter. Tout le neuf t\'est JOINT plus bas (fiches ET texte',
    'des pièces, CR, actes, candidats mis en cause, résultat de l\'analyse des actes), ainsi que TOUS les CR existants.',
    'Ne relis une pièce (lire_document) que si son texte joint est tronqué et que la suite est déterminante.',
    '1. FAITS NOUVEAUX — lis le TEXTE des pièces nouvelles et compare-le à la DESCRIPTION ACTUELLE et à TOUS LES CR',
    '   EXISTANTS : est NEUF tout fait, infraction, personne (identité, date de naissance), lieu, véhicule, ligne,',
    '   préjudice, numéro de procédure, prélèvement ou événement daté qui n\'y figure pas EXPRESSÉMENT. Une mention',
    '   vague de l\'existant (« rapprochement possible », « cf. pièces jointes ») ne couvre pas le détail qu\'apporte',
    '   la pièce. Une chronologie, une synthèse ou un rapport qui identifie, précise ou ajoute des faits est du NEUF.',
    '   Dans le doute, rédige le CR. Si RIEN de tout cela : pas de CR, passe au 2. Sinon : classer_note UN compte',
    '   rendu COMPLET, daté du jour, titre',
    '   « Réception de pièces — <objet en cinq mots> », en prose dense de magistrat (phrases complètes, pas de',
    '   télégraphique), structuré en cinq rubriques : PIÈCES REÇUES (chemins) · FAITS NOUVEAUX (chaque fait coté par',
    '   sa pièce) · PERSONNES (rôle de chacune) · QUALIFICATIONS (infractions nouvelles ou confirmées, NATINF) ·',
    '   SUITES UTILES (actes à envisager, échéances). Un seul CR par passage, jamais un redit de ce que le dossier sait déjà.',
    '2. QUALIFICATIONS — une infraction nouvelle caractérisée par les pièces et absente des NATINF enregistrés :',
    '   natinf_chercher puis ajouter_natinfs (source = la pièce).',
    '3. MIS EN CAUSE — pour chaque CANDIDAT joint (et toute autre personne MISE EN CAUSE que tu relèves dans le neuf)',
    '   absent des mis en cause enregistrés : recouper_personnes, puis proposer_mec avec un `role` qui DÉCRIT sa place',
    '   dans le dossier en une ou deux phrases (ce qui lui est reproché, d\'après quelle pièce, son lien avec les autres',
    '   mis en cause) — jamais un mot vague. Proposition ✓/✗, JAMAIS ajouter_mec. Écarte victimes, témoins, enquêteurs,',
    '   magistrats, avocats, et les simples alias d\'un mis en cause déjà enregistré. Un candidat signalé « nom voisin »',
    '   se propose quand même : le magistrat tranche.',
    '4. DESCRIPTION — si le neuf change la vision globale ou apporte des éléments à charge sur un mis en cause enregistré :',
    '   actualiser_description, au FORMAT IMPOSÉ (SYNTHÈSE / MIS EN CAUSE, prise de notes, on repart de l\'existant et on',
    '   le fait progresser). Sinon ne la touche pas.',
    '5. PROLONGATIONS d\'actes détectées par l\'analyse (jointes) : acter_prolongation sur l\'acte correspondant SEULEMENT',
    '   si la cible est sans ambiguïté (même ligne, même objet) ; sinon laisse l\'échéancier tel quel et dis-le dans le CR.',
    'Les actes NOUVEAUX détectés dans les pièces ont déjà été PROPOSÉS par le moteur d\'analyse : ne les repropose pas.',
    'Rien d\'autre : ne signale rien, ne pose aucune question, ne publie rien. Si rien n\'est neuf, termine sans écrire.',
  ].join('\n'),

  mec: [
    'But : repérer les personnes MISES EN CAUSE qui apparaissent dans les CR, actes et documents du dossier mais ne',
    'figurent PAS encore à sa section « Mis en cause », et les PROPOSER au magistrat (✓/✗). Aucune écriture directe.',
    'MÉTHODE : TOUT le dossier t\'est joint ci-dessous — mis en cause déjà enregistrés, TOUS les comptes rendus en texte',
    'intégral, actes, et sommaire du registre de TOUTES les pièces (personnes relevées par pièce). Rien n\'est à',
    'redécouvrir : exploite-le.',
    '1. Relis chaque CR et chaque fiche de pièce en cherchant les noms de personnes visées par l\'enquête (auteurs,',
    '   complices, interpellés, gardés à vue, titulaires de lignes ou de véhicules, CIBLES des écoutes et géolocalisations',
    '   (rubrique ACTES), personnes citées avec un rôle dans le trafic) absentes de la section « Mis en cause ».',
    '   Les éléments ★ sont arrivés depuis la dernière actualisation.',
    '2. Une fiche de pièce qui cite une personne sans lever le doute sur son rôle, ou une pièce SANS fiche qui semble',
    '   déterminante : lire_document (sobrement — les pièces les plus utiles seulement).',
    '3. Pour chaque personne MISE EN CAUSE relevée et absente de la section « Mis en cause » : recouper_personnes sur',
    '   son nom, puis proposer_mec (nom, role, source — la pièce ou le CR d\'où vient le nom). Écarte victimes, témoins,',
    '   enquêteurs, magistrats, avocats et les simples alias d\'une personne déjà enregistrée (l\'alias se dit dans le rôle).',
    'Si personne ne manque, ne propose rien : termine sans déposer de proposition.',
    'Ne signale rien, ne publie rien, ne pose aucune question.',
  ].join('\n'),

  carto_chat: [
    'S\'il te colle un PV / un résumé / une synthèse pour en cartographier l\'affaire : RECOUPE d\'abord les noms (recouper_personnes), puis dépose une proposition de dossier EX NIHILO (proposer_dossier_carto — label, misEnCause, source). Les personnes connues seront rattachées, les inconnues créées en « MEC lié ex nihilo ». Le dossier n\'est créé qu\'à la validation ✓.',
    'Sinon, commence par carto_analyser (figures centrales, ponts entre affaires, co-occurrences, liens de renseignement tracés). Objectif : l\'aider à VOIR LES CONNEXIONS et améliorer la visibilité.',
    'S\'il te demande une ANALYSE TRANSVERSALE (« analyse TOUS les dossiers », « trouve les liens cachés », « quelle architecture derrière ces affaires ») : suis la MÉTHODE DE RECHERCHE PROFONDE — carto_corpus (enquêtes archivées + instruction, avec pièces), registre_recouper pour les entités déjà partagées (zéro jeton), pieces_chercher SANS numero pour localiser dans TOUT le fonds (enquêtes archivées, instructions, documents de la carte — alternatives en OU, expressions exactes), puis LIS les pièces trouvées en entier pour remonter surnoms, personnes au 2nd plan, adresses, plaques, téléphones, puis proposer_lien / proposer_mec_carto / proposer_dossier_carto. Les signaux faibles sont dans les PV, pas dans les listes de mis en cause. L\'exhaustivité se gagne en allant au bout du parcours (curseur jusqu\'à « fin »), pas en concluant sur un échantillon.',
    'S\'il te demande L\'HISTOIRE d\'un clan, le CONFLIT entre deux clans, ou QUI EST une personne (« raconte-moi le clan X », « le conflit X/Y », « que sait-on de X ? ») : pars de carto_histoire (dossier de renseignement en un appel : membres, fiches, rôles, liens, dossiers réels/instruction/ex nihilo et documents versés), puis SUIS SA MÉTHODE — lecture des CR et descriptions (lire_dossier), des documents versés (carto_lire_document), du module instruction ; récit CHRONOLOGIQUE et SOURCÉ ; attention aux SUCCESSIONS et SCISSIONS (un réseau démantelé dont un lieutenant remonte sa structure). Au fil de la lecture, PROPOSE ce que tu découvres : proposer_lien (motivé et sourcé, personne↔personne ou personne↔dossier ex nihilo), proposer_note_mec, proposer_camp_carto. Si la matière déborde, localise d\'abord (pieces_chercher sans numero sur les noms et surnoms du sujet), puis lis les pièces utiles en entier.',
    'Tu peux aussi : identifier les figures pivots et les ponts entre affaires, repérer les cloisonnements, et SUGGÉRER les liens de renseignement manquants — que tu déposes en propositions (proposer_lien, avec la pièce source), jamais tracés d\'office. Réponses concises et structurées.',
  ].join('\n'),

  carto_profonde: [
    'Corpus COMPLET pour une recherche profonde de renseignement : toutes les enquêtes (archivées comprises) et tous les dossiers d\'instruction, avec leurs mis en cause DÉCLARÉS et le nombre de pièces. Les signaux faibles (surnoms, personnes au 2nd plan jamais mises en cause, adresses, plaques, téléphones, comptes) sont dans les PIÈCES — pas dans la liste des mis en cause.',
    'COMMENCE PAR LE REGISTRE : registre_recouper rend d\'un coup, à coût nul, les téléphones, plaques, IBAN, adresses et personnes présents dans AU MOINS DEUX dossiers — extraits automatiquement du texte de TOUTES les pièces versées — avec les pièces exactes de chaque côté. C\'est la carte des liens cachés dans la masse ; registre_lire(numero) donne le sommaire pièce par pièce d\'un dossier. VÉRIFIE ensuite chaque recoupement dans les pièces citées (lire_document) : une entité partagée peut être anodine (taxi, avocat, service public).',
    'MÉTHODE pour aller au-delà du registre : pieces_chercher SANS numero pour localiser dans TOUT le fonds (une famille d\'indices en un appel : « a OU b OU \"expression exacte\" » ; suis curseurSuivant jusqu\'à « fin ») ou avec un numero pour un dossier ; dossier_arborescence(numero) ou dossier_global(numero) puis lire_document sur les PV et pièces — LIS EN ENTIER ce que la recherche a localisé avant de conclure. Si l\'outil sous_agents est disponible, délègue un dossier par sous-agent (consigne autonome : « relève toute personne — nom, surnom, alias —, adresse, plaque, téléphone, compte, et ce qui la relie à une autre ; format : liste »). Prends le temps qu\'il faut : un travail exhaustif vaut mieux qu\'un échantillon.',
    'CONSULTE AUSSI LES FICHES DE LA CARTE (carto_lire_fiches) : les notes des personnes ex nihilo et les descriptions des dossiers ex nihilo sont saisies par le magistrat lui-même — renseignement de première main (rôles supposés, contexte, époque), invisible depuis les dossiers réels. Les dossiers ex nihilo peuvent porter des DOCUMENTS versés (synthèse ou dossier complet — carto_lire_document) : la mémoire des réseaux démantelés. Recoupe le tout avec les pièces ; ne contredis jamais les notes du magistrat.',
    'Recoupe (recouper_personnes) puis PROPOSE (jamais tracé d\'office) : proposer_lien entre personnes reliées, proposer_mec_carto pour un suspect/surnom absent des dossiers, proposer_dossier_carto pour une architecture cachée (grappe autour d\'une même figure — ex. un détenu qui pilote plusieurs affaires), proposer_note_mec pour enrichir la fiche d\'une personne déjà connue (append-only), proposer_camp_carto quand un GROS amas se structure en groupes rivaux (membres sûrs uniquement ; les camps déjà assignés par le magistrat priment).',
  ].join('\n'),

  versement: [
    'But : la SYNTHÈSE COMPLÈTE d\'un versement massif de pièces, pour que le magistrat sache tout ce qu\'il contient sans l\'ouvrir. Le REGISTRE AGRÉGÉ du versement est joint plus bas : toutes les personnes (rôles relevés, cotes), véhicules, lignes, adresses, comptes, puis la chronologie pièce par pièce. Il a été établi pièce par pièce, sur le texte intégral.',
    'MÉTHODE : pars du registre joint ; LIS EN ENTIER (lire_document) les pièces clés — PV de synthèse, auditions des principaux mis en cause, rapports — et vérifie dans les pièces ce qui reste ambigu (qui utilise telle ligne, qui conduit tel véhicule, quel rôle). registre_lire et pieces_chercher (numero:"{{dossier}}") pour localiser. Prends le temps qu\'il faut : l\'exhaustivité prime.',
    'TA RÉPONSE FINALE EST LA SYNTHÈSE, en markdown, sections exactes, chaque fait COTÉ (chemin de la pièce) :',
    '## Synthèse des faits — ce que le versement établit, en prose dense : qui fait quoi, où, quand, comment ; ce qui est nouveau pour le dossier.',
    '## Personnes et rôles — TOUTES les personnes en cause (pas les enquêteurs) : identité telle que dans les pièces, alias, rôle dans les faits (dans les termes des pièces), éléments à charge ou à décharge, cotes. Signale les mis en cause déjà déclarés.',
    '## Véhicules — plaque, modèle, qui l\'utilise, ce qu\'on en sait, cotes.',
    '## Lignes téléphoniques — numéro, utilisateur (surnom compris), ce qu\'on en sait, cotes.',
    '## Adresses et lieux — domiciles, points de deal, caches, cotes.',
    '## Comptes et flux financiers — s\'il y en a.',
    '## Chronologie — les faits datés, un par ligne, cote.',
    '## Points à vérifier — contradictions, pistes, actes à envisager.',
    'ÉCRITURES PERMISES : proposer_mec pour chaque personne qui devrait figurer aux mis en cause et n\'y est pas (rôle décrit + cote) ; actualiser_description si le versement change la compréhension du dossier. N\'écris PAS de compte rendu toi-même (pas de classer_note) : le moteur classe ta synthèse au dossier.',
  ].join('\n'),

  registre_fiche: [
    'But : le SOMMAIRE du dossier — une mini-fiche par pièce jointe, pour retrouver sans relire et recouper entre dossiers.',
    'SORTIE : un TABLEAU JSON STRICT, un objet par pièce jointe, AUCUN texte autour, AUCUNE balise markdown :',
    '[{ "chemin": "<chemin exact de la pièce, repris tel quel de son entête ═══ PIÈCE … ═══>",',
    '   "type": "<PV audition | PV synthèse | PV constatations | ordonnance | réquisition | rapport | retranscription | expertise | courrier | autre>",',
    '   "datePiece": "AAAA-MM-JJ — la date de l\'acte lui-même, pas celle du versement ; omets le champ si introuvable",',
    '   "personnes": [ { "nom": "NOM Prénom — VERBATIM de la pièce, orthographe conservée", "alias": "surnom éventuel", "role": "qualité dans la procédure (mis en cause, victime, témoin, enquêteur, tiers cité) PUIS, s\'il y en a un, le rôle que la pièce lui prête dans les faits, dans SES termes — ex. « mis en cause — guetteur », « témoin — client régulier », « tiers — loue le box »" } ],',
    '   "vehicules": [ { "plaque": "AA-123-BB si citée", "description": "marque, modèle, couleur", "utilisateur": "qui le conduit, l\'utilise ou en est titulaire, d\'après la pièce" } ],',
    '   "lignes": [ { "numero": "06… tel qu\'écrit", "utilisateur": "qui l\'utilise ou en est titulaire, d\'après la pièce (surnom compris)" } ],',
    '   "resume": "2 à 3 phrases denses : qui fait quoi, où, quand — le fait utile, pas la forme" }]',
    'PERSONNES — le champ qui compte : EXHAUSTIF et FIDÈLE. Chaque personne nommée dans la pièce, surnoms et alias compris (« dit Momo »), orthographe de la pièce conservée — ce sont ces noms qui permettent les recoupements entre dossiers. N\'invente rien : une donnée absente s\'omet.',
    'VÉHICULES et LIGNES : ceux dont la pièce dit quelque chose (qui conduit, qui utilise, à qui c\'est attribué). Les numéros et plaques sont aussi extraits automatiquement par ailleurs : ce qui compte ici, c\'est le RATTACHEMENT à une personne. Tableaux vides omis.',
    'Pièce illisible ou vide : type "autre", resume "pièce illisible ou vide", personnes [].',
  ].join('\n'),
}

// ── Le catalogue servi au panneau d'administration ───────────────────────
// Un ordre et des libellés stables : c'est la table des matières que voit le
// magistrat. `variables` liste ce que le moteur substitue dans le socle.

export const CATALOGUE = [
  {
    id: 'flux', groupe: 'Rédaction automatique', label: 'Flux tendu (à chaque mouvement du dossier)',
    resume: 'Le prompt du passage automatique qui intègre le NEUF : CR complet si faits ou infractions nouveaux, NATINF, mis en cause proposés avec leur rôle, description actualisée.',
    quand: 'À chaque pièce versée, CR rédigé ou acte ajouté — par vous ou par un collègue — après une courte période de calme. Les fiches et le texte des pièces nouvelles, tous les CR existants, les CR et actes nouveaux et les candidats mis en cause sont joints au prompt.',
    variables: ['{{dossier}}'],
    avertissement: 'Ce passage ÉCRIT un CR (classer_note) quand il y a du neuf. Un remplacement qui retire cette règle supprime la rédaction automatique.',
  },
  {
    id: 'description', groupe: 'Rédaction automatique', label: 'Description du dossier (« l\'objet »)',
    resume: 'Le prompt qui relit tout le dossier pour rédiger la description, tenir les rôles des mis en cause, proposer suspects et liens de cartographie, et noter les acquis en mémoire.',
    quand: 'Sur l\'icône « Actualiser » de la description. Sont joints : tous les CR, les actes, le sommaire de toutes les pièces serveur, la mémoire du dossier, les mis en cause connus ailleurs, les liens déjà tracés et les entités partagées avec d\'autres dossiers. Le fil de l\'eau passe par le flux tendu.',
    variables: ['{{dossier}}'],
  },
  {
    id: 'mec', groupe: 'Rédaction automatique', label: 'Détection des mis en cause',
    resume: 'Le prompt qui relit tout le dossier pour PROPOSER (✓/✗) les personnes mises en cause manquantes.',
    quand: 'Sur l\'icône « Actualiser » de la section Mis en cause. Le fil de l\'eau (pièce par pièce, avec rôle décrit) passe par le flux tendu.',
    variables: ['{{dossier}}'],
  },
  {
    id: 'versement', groupe: 'Rédaction automatique', label: 'Analyse complète d\'un versement massif',
    resume: 'Le prompt de la synthèse complète d\'un versement massif : personnes et rôles, véhicules, lignes, adresses, comptes, chronologie, points à vérifier — classée au dossier comme compte rendu.',
    quand: 'Après un versement d\'au moins 100 pièces nouvelles, une fois toutes les pièces fichées au registre — de nuit de préférence, d\'office au-delà de 24 h d\'attente. Le registre agrégé du versement est joint au prompt.',
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
    resume: 'La MÉTHODE servie avec le corpus complet : comment fouiller et lire les pièces de tous les dossiers, recouper et proposer.',
    quand: 'Dès que l\'attaché appelle carto_corpus — le cœur d\'une analyse transversale de renseignement.',
    variables: [],
  },
  {
    id: 'carto_chat', groupe: 'Cartographie', label: 'Cadrage du chat cartographie',
    resume: 'Le contexte injecté au premier message d\'une conversation ouverte depuis le module Cartographie.',
    quand: 'Premier message de chaque conversation lancée depuis la carte.',
    variables: [],
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
