# Analyse profonde — architecture cible de l'IA dans SIRAL

*Document de vision, issu de la réflexion sur le dossier PRISON BREAK 2 (9 procédures
versées, 1 073 pièces). À affiner avant développement.*

## Le constat de départ

Le dépouillement d'un dossier massif ne passe ni dans une conversation Claude web
(4 M de caractères ne tiennent pas dans un contexte), ni dans le chat de l'attaché
(mêmes limites), ni en une nuit de bonne volonté. Et c'est un travail RARE mais
DÉCISIF : règlement d'un JIRS, recherche de liens entre dossiers, remplissage de la
cartographie. Il mérite un outil dédié — pas un bricolage de prompts.

## Le principe économique central : lire une fois, capitaliser

Le poste de coût n'est pas l'extraction (OCR et conversions sont locales, zéro
jeton) : c'est la LECTURE des pièces par le modèle. La règle d'or :

> **Chaque pièce n'est lue en entier qu'UNE fois dans la vie du dossier.
> Cette lecture produit une FICHE persistée. Tout le travail ultérieur
> (RD, DML, synthèses, cartographie, liens, questions au chat) consomme
> les fiches — jamais les pièces.**

La fiche est l'investissement ; le reste est de la rente. C'est aussi ce qui rend
le travail interruptible : l'état d'un dépouillement = les fiches déjà produites
+ un curseur. On peut s'arrêter à tout moment et reprendre sans rien relire.

## Les quatre étages de l'IA dans l'app

| Étage | Rôle | État | Modèle/effort par défaut |
|---|---|---|---|
| **1. Fil de l'eau** | Actualiser descriptions, détecter mis en cause, propositions d'actes/CR, classements | ✅ Existe (runs courts déclenchés par changement) | Économe (Haiku / effort bas) — sauf la description, un cran au-dessus : c'est le rappel général de la procédure, il doit être complet |
| **2. Secrétariat** | Boîte mail dédiée, compréhension des demandes, rédaction d'actes, portes de qualité | ✅ Existe (runs proactifs + chat) | Intermédiaire-haut (Sonnet / effort haut) : un acte engage le magistrat |
| **3. Chantiers d'analyse profonde** | Dépouillement intégral d'un dossier, liens inter-dossiers, remplissage carto | ❌ **À construire — le seul vrai développement** | Fiches : Sonnet / effort moyen (extraction structurée). Synthèse finale : modèle supérieur / effort haut, qui lit les FICHES |
| **4. Attaché de dossier** | Le chat flottant du détail d'enquête : UNE conversation persistée PAR dossier, avec sa mémoire | ✅ Existe (FloatingDossierChat) | Sonnet / effort moyen ; il ne dépouille pas lui-même : il LANCE un chantier et lit les fiches |

Les étages 1, 2 et 4 existent. L'affinage y est un travail de RÉGLAGES (matrice
modèle/effort par étage dans le panneau — les options existent déjà), pas de
structure. L'étage 3 est le chantier de développement.

## Intra-app ou connecteur Claude web ?

**Intra-app, sans hésitation, pour l'analyse profonde.** Le service attaché :

- tourne côté serveur : pas d'onglet à garder ouvert, pas de délai de 180 s par
  outil (contrainte du relais MCP du connecteur), pas de plafond de contexte
  d'une conversation — chaque fiche naît d'un run borné puis est PERSISTÉE ;
- possède déjà la gouvernance d'abonnement : fenêtre glissante de 5 h (`cap5h`),
  plafond hebdomadaire, **fenêtre de nuit** (`inNightWindow`) où le travail de
  fond est cantonné, messages de reprise automatique quand la fenêtre
  redescend — exactement la mécanique « travailler la nuit, s'interrompre,
  recommencer » ;
- a les sous-agents (lecture seule, sans récursion), le relevé de consommation
  par catégorie, l'audit.

**Le connecteur Claude web reste ce qu'il est : la télécommande.** Questions ad
hoc en mobilité, rédactions ponctuelles — et, à terme (phase 3), lecture des
FICHES et déclenchement d'un chantier depuis claude.ai. Il ne doit jamais être
le moteur du dépouillement : il lirait tout dans un contexte qui déborde, au prix
fort, sans reprise.

## Le stockage n'est pas le problème — l'affichage l'est

Sur le serveur, chaque pièce est un blob chiffré sous son chemin relatif complet
(`PV/AMI-26-162-157_Jonction/D2/piece.pdf.enc`) + un index par enquête :
l'arborescence versée est INTACTE. Ce qui est « en vrac », c'est la liste à plat
de la section documents. Correctif d'affichage (petit, indépendant) : vue en
ARBORESCENCE repliable par pochette dans chaque zone — le composant existe déjà
dans le module instruction (« Dossier complet »). Convention de versement : une
pochette racine par procédure (déjà le cas).

## Le chantier d'analyse profonde — spécification

### L'objet

Un `chantier` (JSON chiffré, données de l'attaché) :

```
{
  id, type: 'dossier' | 'liens' | 'carto',
  cible: numéro(s) de dossier,
  consigne: précisions du magistrat (angle, personnes, période),
  plan: [ { pochette, pieces: [rel…] } ],        // figé au lancement (arborescence)
  curseur: { pochette, indexPiece },
  fiches: [ { pochette, ref } ],                  // productions déjà écrites
  budget: { jetonsMax?, nuitSeulement: true },
  etat: 'en_cours' | 'pause' | 'fenetre_pleine' | 'synthese' | 'termine',
  journal: [ { date, evenement } ]
}
```

### L'exécution

- **Runs bornés en série**, jamais un marathon : chaque run traite UN LOT
  (une pochette ou ~10-15 pièces), écrit ses fiches, avance le curseur,
  s'arrête. Checkpoint par lot — un crash ne coûte qu'un lot.
- **Ordonnancement par le tick existant** du service (comme apprentissage et
  étude) : tant que ─ fenêtre de nuit (ou autorisation jour explicite),
  cap 5 h non atteint, budget du chantier non épuisé ─ on lance le lot
  suivant. Fenêtre pleine → état `fenetre_pleine`, reprise automatique.
- **Fiche au format imposé** (c'est elle qui fait la valeur) :
  chronologie datée · personnes (identités, alias, téléphones, véhicules,
  adresses, comptes) · déclarations utiles VERBATIM avec cote · éléments à
  charge / à décharge · contradictions · actes manquants · annexes images
  non lues (pages N–M). Stockée en production type `fiche` (consultable,
  exportable) + entrée courte en mémoire du dossier.
- **Pages images** : jamais océrisées d'office (doctrine actée) — la fiche
  les recense ; le magistrat commande `integrale` pièce par pièce.
- **Synthèse finale** : un run dédié, modèle supérieur, qui lit LES FICHES
  (pas les pièces) et produit la note d'ensemble + les propositions
  transversales.

### Les trois types de chantier (même moteur)

1. **Dossier en détail** : fiches par pochette + synthèse — la base du RD.
2. **Liens inter-dossiers** : croise les FICHES de plusieurs dossiers
   (personnes, numéros, plaques, adresses) → rapport de recoupements, avec
   cotes des deux côtés.
3. **Cartographie** : depuis les fiches, générer des propositions
   (`proposer_mec_carto`, `proposer_lien`) — le magistrat valide, comme
   aujourd'hui ; l'IA ne peuple jamais la carto directement.

Les types 2 et 3 ne relisent RIEN : ils consomment le capital de fiches. S'il
manque des fiches, ils déclenchent d'abord un chantier de type 1.

### L'interface

- **Bande « Analyses profondes »** en page Assistant de justice (admin) :
  l'état du parc en une ligne — devis à valider, chantiers en cours, terminés —
  puis une ligne par chantier avec sa jauge et ses actions immédiates
  (lancer, reprendre, mettre en pause).
- **Atelier plein écran** (« Ouvrir l'atelier ») : liste filtrable à gauche
  (tous / en cours / devis / terminés, plus une recherche), détail complet à
  droite — avancement chiffré, devis (pièces, lots, jetons, nuits), pochette
  par pochette avec sa propre jauge, journal des pas, et les productions
  (fiches, synthèse, rapport) lisibles, éditables et exportables sur place.
  Le moteur tourne côté service : fermer l'atelier n'interrompt rien.
  Le formulaire « Nouvelle analyse » s'ouvre en SURIMPRESSION (voile +
  fenêtre), jamais dans la colonne du détail : fondu dans la page, il se
  lisait comme la suite du chantier affiché derrière.
- **Dépouillement en masse** (fait) : la cible « tous les dossiers archivés »
  du formulaire crée UN chantier par dossier archivé, chacun avec son devis à
  valider — idempotent (dossiers déjà en chantier ou sans pièces écartés et
  nommés), création en arrière-plan, devis au fil de l'eau, bilan publié au
  fil de l'assistant (`createChantiersEnMasse`, portées `archives` / `toutes`
  / `en_cours` côté moteur), avancement persisté et REPRIS après un
  redémarrage du service (`reprendreMasse`).
- **Le moteur, deuxième génération** (fait — voir
  AMELIORATIONS-ANALYSE-PROFONDE.md pour le détail) : vague GLISSANTE bornée à
  front × 2 lots par pas (plus de barrière sur le lot le plus lent), équité
  entre chantiers actifs, plafond de jetons par chantier (pause propre),
  jetons RÉELS comptés à côté du devis, rythme observé → temps restant,
  chantier « complément » (les pièces déjà couvertes par des fiches ne se
  relisent pas, sauf « relire »), synthèse HIÉRARCHIQUE des très gros dossiers
  (une synthèse par grosse pochette, puis la note finale), relance des lots en
  échec et de la synthèse, chaînage un-clic des devis manquants d'un chantier
  liens/carto, cache des chantiers déchiffrés, détail (journal complet, lots
  par pochette) servi à la demande.
- **Le pas en cours** : le moteur pose un marqueur avant chaque run (lot,
  pochette, nombre de pièces, numéro de tentative — ou rédaction de la
  synthèse) et le retire après. La bande et l'atelier affichent « En ce
  moment … depuis 6 min », et le sondage passe de 60 s à 20 s tant qu'un
  chantier tourne. Un marqueur qui survivrait à un redémarrage du service est
  périmé (au-delà du timeout de lot) et n'est plus servi : jamais de faux
  « en cours ».
- **Déclencheurs** là où le besoin naît : le chat de dossier (étage 4) propose
  « lancer le dépouillement complet » ; la cartographie propose « remplir
  depuis les dossiers » ; la fiche d'enquête montre l'état du chantier.
- **Depuis la conversation** (fait) : l'attaché — et Claude web par le
  connecteur — dépose lui-même le chantier avec `chantier_proposer` dès qu'une
  demande suppose de lire plus de pièces qu'une conversation n'en tient. Le
  chantier apparaît en DEVIS dans la bande, marqué « déposé par l'assistant » ;
  le magistrat valide d'un clic. `chantier_piloter` lance ou met en pause sur
  instruction explicite. Règle donnée à l'agent : une réserve d'exhaustivité
  (« je n'ai pas pu ouvrir chaque PV ») n'est pas une conclusion, c'est une
  demande de devis — et le gratuit (`registre_recouper`, `pieces_chercher`)
  s'épuise AVANT de proposer de dépenser.
- Le chat de dossier répond ensuite en s'appuyant sur les fiches — questions
  précises à coût minime.

## Phasage proposé

- **Phase 0 (immédiat, petit)** : vue en arborescence des zones de documents
  (affichage seulement).
- **Phase 1 (le cœur)** : l'objet chantier + le type « dossier en détail » +
  panneau de progression + lancement depuis le chat de dossier. Réutilise :
  gouvernance nuit/5 h, runs bornés, productions, mémoire dossier, usage.
- **Phase 2** : chantiers « liens » et « carto » sur les fiches.
- **Phase 3** : exposer au connecteur la lecture des fiches et le lancement
  d'un chantier (Claude web = télécommande mobile) — *fait* :
  `chantiers_etat`, `chantier_proposer`, `chantier_piloter` et les productions
  (`productions_lister` / `production_lire`) sont dans le périmètre du
  connecteur comme dans celui du chat.

## Ce qui ne change pas

Une conversation par dossier (déjà le cas), écritures partagées signées du
magistrat, propositions validées par lui, mentions de l'IA réservées à
l'administrateur, E2EE : le chantier vit dans les données de l'attaché, ses
livrables passent par les canaux existants (productions, mémoire, propositions).
