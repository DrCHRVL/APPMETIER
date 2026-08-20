# Veille de recoupements

> Deux dossiers parlent parfois de la même personne, de la même adresse ou de
> la même ligne sans que personne ne s'en aperçoive. La pièce arrive d'une
> autre unité, elle est classée, et le nom qui la relie à une affaire en cours
> dort dans un PDF. La veille lit ce qui est **déjà** dans l'application et
> signale ces coïncidences — sans rien interrompre.

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
| `personne` | « DOMONT Sherazed » ↔ « sherazed domont » | ordre Nom/Prénom indifférent, coquille tolérée, composé recollé — exactement les règles de la cartographie (`sameMecPerson`) |
| `patronyme` | « MEON Bryan » ↔ « MEON Louan » | même nom de famille, prénoms différents : lien familial possible |
| `telephone` | « 06.79.55.13.84 » ↔ « +33 6 79 55 13 84 » | ramené à 10 chiffres |
| `adresse` | « 16 rue Balzac » ↔ « 16 rue balzac appt 7 à AMIENS » | numéro + type de voie + nom, complément coupé |
| `plaque` | « GM-970-AY » ↔ « GM970AY » | sans séparateurs |
| `compte` | compte snapchat « pepitocroco2024 » | pseudo cité près du nom d'un réseau, ou `@pseudo` |
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

Enfin, la veille ne rend que les **200 signaux les mieux notés** (et au plus
huit occurrences par signal, dont une par dossier au minimum) : au-delà, une
liste cesse d'être lisible.

## Ce qu'elle lit — et ce qu'elle ne lit pas

Elle relit ce qui est déjà déchiffré pour l'affichage : mis en cause,
description, notes, comptes rendus, actes (lignes d'écoute, objets géolocalisés,
autres actes), et — côté instruction — saisine, mis en examen, notes et
événements. **Rien ne sort du poste** : tout est calculé en mémoire, dans le
navigateur.

Les **pièces** suivent le régime de la recherche documentaire :

- les pièces déjà analysées (cache local) sont couvertes, à coût nul ;
- une pièce **versée depuis moins de 45 jours** et jamais lue est analysée
  d'office, dans la limite de 8 par session — c'est précisément le PV qui
  vient d'arriver qu'il faut lire ;
- tout le reste du fonds attend le bouton **« Analyser N pièces »** de la vue
  d'ensemble. Aucune extraction massive n'est lancée en silence.

## Où ça se voit

| Endroit | Ce qu'on voit |
|---|---|
| Fiche d'enquête / d'instruction | une ligne repliée sous l'en-tête : « N recoupements avec d'autres dossiers ». La déplier vaut « j'ai vu ». |
| En-tête de l'application | une icône de chaînon, avec une pastille comptant les signaux jamais consultés. Absente s'il n'y a rien. |
| Vue d'ensemble (clic sur l'icône) | tous les signaux, le plus solide d'abord, l'onglet « Écartés » et le bouton d'analyse des pièces. |

Chaque signal se déplie sur ses occurrences : le dossier, l'endroit (fiche,
compte rendu, pièce…) et la citation exacte du passage. Un bouton ouvre l'autre
dossier.

## Silence jusqu'à changement réel

Chaque signal porte une **empreinte** : la liste des dossiers où la valeur
apparaît. « Écarter » mémorise cette empreinte, personnellement (écarter chez
soi n'éteint rien chez les collègues). Le signal reste muet tant que
l'empreinte ne bouge pas — et ressort dès qu'un dossier de plus rejoint la
coïncidence, parce que la question n'est alors plus la même.

## Performance

La veille passe toujours après l'utilisateur : le calcul est repoussé d'une
seconde après la dernière modification, puis exécuté dans un temps mort du
navigateur, en **rendant la main toutes les 25 ms**. Sur un fonds de 300
dossiers et 5 Mo de texte, le calcul complet prend environ 0,7 s réparti sur
l'ensemble, sans qu'aucune tranche ne dépasse 30 ms. Il s'interrompt dès que
les données changent.

## Où c'est implémenté

| Fichier | Rôle |
|---|---|
| `types/recoupementTypes.ts` | signaux, occurrences, corpus, gestes de l'utilisateur |
| `utils/recoupements/extract.ts` | formes canoniques (téléphone, adresse, plaque…) et détection des noms dans un texte |
| `utils/recoupements/engine.ts` | rapprochement, ancrage déclaré, notation, empreintes |
| `utils/recoupements/corpus.ts` | ce que la veille a le droit de lire, par dossier |
| `hooks/useRecoupements.ts` | lecture des pièces (cache / pièces récentes / à la demande), calcul au repos, gestes |
| `components/recoupements/` | la ligne repliée, la liste, la vue d'ensemble |
| `scripts/recoupements.test.mjs` | scénario complet + non-régression sur le bruit (`node scripts/recoupements.test.mjs`) |

Les formes canoniques sont alignées sur celles de l'attaché de justice
(`scripts/attache/carto.mjs`, `normEntite`) : ce que l'application rapproche,
l'outil `carto_rapprochements` le rapproche aussi.
