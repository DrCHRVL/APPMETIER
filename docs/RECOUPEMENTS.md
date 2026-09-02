# Recoupements entre dossiers

> Deux dossiers parlent parfois de la même personne, de la même adresse ou de
> la même ligne sans que personne ne s'en aperçoive. La pièce arrive d'une
> autre unité, elle est classée, et le nom qui la relie à une affaire en cours
> dort dans un PDF. Un **chantier hebdomadaire**, sur le serveur, relit tout le
> fonds et signale ces coïncidences.

## Un chantier, pas une veille

Le rapprochement a d'abord été tenté **dans le navigateur du magistrat**. C'était
une erreur de principe, et elle s'est payée cher : comparer deux cents dossiers
et leurs pièces demande de tout tenir en mémoire, ce qu'un onglet ne peut pas
faire. Il a donc fallu brider le calcul — pièces tronquées à 300 000
caractères, pièces abandonnées au-delà d'un budget mémoire, huit extractions
par session, plafond de 200 signaux. Résultat : une détection **incomplète**
(près de deux mille pièces jamais analysées) et une application qui **gelait**
plusieurs secondes d'affilée, jusqu'au plantage de l'onglet.

Le calcul vit désormais dans le **service attaché** — le seul composant qui
détienne les clés, le serveur web ne voyant que des enveloppes chiffrées. Il
tourne :

- **une fois par semaine, la nuit du samedi au dimanche**, quand personne ne
  travaille ;
- **à la demande**, par le bouton « Lancer maintenant » de la vue d'ensemble.

C'est du **calcul pur** : aucune IA, aucun jeton consommé. Il ne dépend donc
pas de l'authentification Claude (qui, elle, expire) et le gouverneur du
forfait ne peut pas le mettre en attente.

Plus aucune bride : le fonds entier, toutes les pièces, tous les contentieux
confiés. L'application, elle, ne fait plus que **lire le résultat**.

## Le principe

Trois règles, dans cet ordre :

1. **Elle montre, elle ne fait rien.** Aucun signal n'écrit dans un dossier,
   ne crée un lien de cartographie, ne modifie une fiche. C'est un
   signalement : le magistrat vérifie et tranche.
2. **Elle ne coupe jamais la parole.** Pas de fenêtre qui s'ouvre, pas de
   confirmation à donner, rien qui s'interpose entre la saisie et l'écran.
   Une ligne repliée dans le dossier, une icône dans l'en-tête. C'est tout.
3. **Elle se tait dès qu'on l'a écartée**, et jusqu'à ce que la situation
   change réellement — même doctrine que les alertes
   (cf. [REFONTE-ALERTES.md](REFONTE-ALERTES.md)).

## Ce qu'elle rapproche

| Nature | Exemple | Comment |
|---|---|---|
| `personne` | « DOMONT Sherazed » ↔ « sherazed domont » | ordre Nom/Prénom indifférent, coquille tolérée, graphie phonétiquement équivalente étroitement bornée (« Yacine » ↔ « Yassine »), composé recollé — exactement les règles de la cartographie (`sameMecPerson`) |
| `patronyme` | « MEON Bryan » ↔ « MEON Louan » | même nom de famille, prénoms différents : lien familial possible |
| `telephone` | « 06.79.55.13.84 » ↔ « +33 6 79 55 13 84 » | ramené à 10 chiffres |
| `adresse` | « 16 rue Balzac » ↔ « 16 rue balzac appt 7 à AMIENS » | numéro + type de voie + nom, complément coupé |
| `plaque` | « GM-970-AY » ↔ « GM970AY » | sans séparateurs |
| `compte` | compte snapchat « pepitocroco2024 » | pseudo **présenté** près du nom d'un réseau — entre guillemets, annoncé (« sous le pseudonyme… »), ou reconnaissable à sa forme (un chiffre, un séparateur) — ou `@pseudo` |
| `iban`, `imei` | | à l'identique |

Un signal ne sort **que si la valeur est présente dans au moins deux
dossiers distincts**.

## Ce qui fait la précision

Le risque d'un tel dispositif, c'est le bruit : un PV est signé d'un OPJ, cite
un substitut, porte un en-tête de compagnie de gendarmerie. Deux garde-fous :

- **Un signal de personne exige un ancrage déclaré.** Un nom lu dans une pièce
  ne compte que s'il rejoint quelqu'un d'inscrit aux mis en cause / mis en
  examen d'un dossier. L'OPJ signataire et le substitut cité ne sont mis en
  cause nulle part : ils ne déclenchent rien.
- **Un patronyme trop répandu ne dit rien.** Au-delà de cinq dossiers, le nom
  de famille cesse d'être un indice et le signal est abandonné.

S'y ajoutent une liste de mots qui ne sont pas des patronymes (grades,
institutions, en-têtes) et l'exigence d'un numéro dans les adresses de voie.

Un signal dont les dossiers ne partagent **aucun** mis en cause est marqué
« inédit » et remonte en tête : c'est le pont qui n'existait pas encore.

Enfin, la veille borne sa restitution (2 000 signaux les mieux notés, 40
occurrences par signal dont au plus 6 par dossier et une par dossier au
minimum — cf. `DEFAUTS` dans `moteurCore.mjs`) : au-delà, une liste cesse
d'être lisible. Ces plafonds étaient bien plus bas du temps du calcul dans
le navigateur ; ils sont ceux d'un affichage raisonnable, plus ceux d'une
mémoire qui manque.

## Ce qu'il lit

Mis en cause, description, notes, comptes rendus, actes (lignes d'écoute,
objets géolocalisés, autres actes), et — côté instruction — saisine, mis en
examen, notes et événements. Plus le **texte intégral de toutes les pièces**,
océrisation comprise pour les PV scannés.

**Rien ne sort du serveur** : le chantier lit des coffres qu'il déchiffre avec
les clés que l'administrateur lui a remises, calcule en mémoire, et redépose un
coffre chiffré. Le serveur web qui l'héberge ne voit à aucun moment de clair.

### Périmètre

L'attaché ne lit que les contentieux qui lui ont été **explicitement confiés** :
`SIRAL_ATTACHE_CONTENTIEUX` en liste (`crimorg,environnement,ecofi`), et pour
chacun une clé remise depuis le navigateur déverrouillé de l'administrateur
(Paramètres → Attaché IA → « Remettre les clés »). Un contentieux dont la clé
manque **sort du corpus**, et la vue d'ensemble le dit — un périmètre incomplet
doit se voir, jamais se deviner.

C'est le point qui décide de l'intérêt du dispositif : les recoupements qui
valent quelque chose sont ceux qui **traversent** les contentieux, un même
homme se retrouvant mis en cause au stup et cité dans une procédure financière.

### Les pièces jamais lues

Chaque chantier extrait le texte des pièces encore inconnues, dans la limite
d'un temps imparti (`SIRAL_ATTACHE_RECOUP_EXTRACTION_MIN`, deux heures par
défaut) — un premier passage sur un fonds de dix mille pièces jamais ouvertes
prendrait des jours. Ce n'est **pas** une limite sur la détection : tout ce qui
est en cache entre dans le corpus, et ce qui n'a pas pu être lu cette nuit le
sera la suivante, le cache étant persistant. La vue d'ensemble affiche toujours
le compte exact : « 2 700/2 700 pièces lues », ou ce qu'il en reste.

## Où ça se voit

| Endroit | Ce qu'on voit |
|---|---|
| Fiche d'enquête / d'instruction | une ligne repliée sous l'en-tête : « N recoupements avec d'autres dossiers ». La déplier vaut « j'ai vu ». |
| En-tête de l'application | une icône de chaînon, avec une pastille comptant les signaux jamais consultés. **Toujours présente** — pâlie quand il n'y a rien à montrer, mais jamais retirée : c'est le seul chemin vers la vue d'ensemble, donc vers la relance du chantier. |
| Vue d'ensemble (clic sur l'icône) | tous les signaux, le plus solide d'abord, l'onglet « Écartés », la **date du dernier chantier** et ce qu'il a pu lire. L'administrateur y trouve « Lancer maintenant ». |
| Attaché IA / connecteur | l'outil **`recoupements_lire`** sert les signaux à l'IA (filtres par dossier, nature, `inedits` ; occurrences écrêtées) — la veille cesse d'être un coffre que seule l'application lisait. Un signal reste un signalement : l'IA vérifie dans les pièces citées avant tout `proposer_lien`. |

L'icône a été un temps masquée quand il n'y avait aucun signal. C'était une
impasse : sur un fonds neuf, aucun chantier n'ayant tourné, il n'y avait rien à
montrer — donc pas d'icône, donc aucun moyen de lancer le premier chantier
avant la nuit du samedi au dimanche. Et un utilisateur qui avait écarté ses
derniers signaux perdait l'accès à l'onglet « Écartés » où il aurait pu les
réactiver. Elle reste donc en place, discrète.

Chaque signal se déplie sur ses occurrences : le dossier, l'endroit (fiche,
compte rendu, pièce…) et la citation exacte du passage. Un bouton ouvre l'autre
dossier.

## Les dossiers dissimulés aux juristes assistants

Le chantier tourne sur le fonds entier : il ignore qui lira ses signaux. Un
dossier marqué `hiddenFromJA` est donc retranché **à l'affichage**, dans le
navigateur de l'utilisateur concerné — exactement comme il l'était du temps où
le corpus se construisait là (la donnée y était déjà ; seule la construction du
corpus l'écartait). Un signal qui ne touche QUE des dossiers interdits
disparaît ; s'il en touche d'autres, il reste, amputé de ceux-là.

## Silence jusqu'à changement réel

Chaque signal porte une **empreinte** : la liste des dossiers où la valeur
apparaît. « Écarter » mémorise cette empreinte, personnellement (écarter chez
soi n'éteint rien chez les collègues). Le signal reste muet — et ressort dès
qu'un dossier de PLUS rejoint la coïncidence, parce que la question n'est
alors plus la même. Il ressort alors marqué « déjà écarté » : l'écartement n'a
pas lâché, c'est la situation qui a changé.

La comparaison se fait **par inclusion**, pas caractère à caractère : tant que
les dossiers du jour étaient déjà connus au moment du geste, silence. Un
dossier qui QUITTE la coïncidence — une pièce pas encore relue au démarrage,
une enquête archivée, une préliminaire versée dans son instruction — ne
réveille rien. Et un « j'ai vu » passif (déplier un bandeau, fermer la vue
d'ensemble) ne défait jamais un écartement : seul un geste explicite le fait,
depuis l'onglet « Écartés ».

## Coût pour l'application

Une lecture de coffre. Rien d'autre, jamais — l'onglet ne calcule plus rien.

Côté serveur, le chantier rend la main entre deux dossiers (`setImmediate`)
pour que le service continue de répondre au panneau d'administration et de
relever les mails pendant qu'il travaille. Le conteneur de l'attaché porte par
ailleurs un `cpu_shares` réduit : dès que le magistrat se sert de SIRAL, c'est
l'application qui passe devant.

## Où c'est implémenté

| Fichier | Rôle |
|---|---|
| `types/recoupementTypes.ts` | signaux, occurrences, corpus, gestes de l'utilisateur |
| `lib/recoupements/nomsCore.mjs` | identité des personnes : normalisation, clé insensible à l'ordre des mots, rapprochement tolérant |
| `lib/recoupements/valeursCore.mjs` | formes canoniques (téléphone, adresse, plaque…) et détection des noms dans un texte |
| `lib/recoupements/moteurCore.mjs` | rapprochement, ancrage déclaré, notation, empreintes |
| `lib/recoupements/corpusCore.mjs` | ce que le chantier a le droit de lire, par dossier |
| `scripts/attache/recoupements.mjs` | le chantier : corpus complet, texte des pièces, écriture du coffre |
| `scripts/attache/ordonnancement.mjs` | quand le chantier part (nuit du samedi au dimanche, une fois par semaine) |
| `app/api/attache/recoupements/route.ts` | déclenchement manuel — administrateur du TJ confié uniquement |
| `utils/recoupements/gestes.ts` | doctrine des gestes : ce qui ressort, ce qui reste muet, ce qui s'écrit |
| `hooks/useRecoupements.ts` | lecture du coffre, retrait des dossiers interdits, gestes |
| `components/recoupements/` | la ligne repliée, la liste, la vue d'ensemble |
| `scripts/recoupements.test.mjs` | scénario complet + non-régression sur le bruit (`node scripts/recoupements.test.mjs`) |
| `scripts/recoupements-chantier.test.mjs` | quand le chantier part (`node scripts/recoupements-chantier.test.mjs`) |
| `scripts/recoupements-gestes.test.mjs` | non-régression sur les écartements (`node scripts/recoupements-gestes.test.mjs`) |

Les modules `lib/recoupements/*.mjs` sont du JavaScript **partagé** app ↔
attaché, selon le motif déjà en place pour les statistiques (`lib/stats/*.mjs`)
: il n'existe qu'une seule implémentation des règles, et c'est celle que la
suite de tests exécute — pas une copie.

Les formes canoniques sont alignées sur celles de l'attaché de justice
(`scripts/attache/carto.mjs`, `normEntite`) : ce que l'application rapproche,
l'outil `carto_rapprochements` le rapproche aussi.
