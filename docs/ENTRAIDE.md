# Module Entraide internationale

Suivi des demandes d'entraide (DEE, dénonciations officielles, CRI, exécution
de décisions, civil), reçues ou émises. Remplace le « tableau de suivi
international » : un **registre partagé** par tous les utilisateurs du module
(greffe et magistrats), avec échéances calculées, délais légaux, courriers et
mails préremplis.

Activation : Paramètres → Utilisateurs → module « Entraide internationale ».
Les pièces restent dans ESABORA / NPP ; SIRAL ne garde que le suivi et les
courriers qu'il génère.

## Principe : l'état se déduit de la chronologie

Une demande ne stocke ni son étape ni son échéance. Chaque bouton ajoute un
événement daté (`evenements`) ; `lib/entraide/core.mjs` en déduit l'étape,
chez qui est le dossier, l'échéance interne, les délais légaux et la
« prochaine étape » proposée. Seules les dates se corrigent à la main.

| Événement | Effet |
|---|---|
| `envoi_enqueteurs` / `relance_enqueteurs` | chez les enquêteurs, retour attendu à 3 mois |
| `retour_enqueteurs` (`partiel`) | avis du magistrat (ou attente maintenue si partiel) |
| `envoi_autorite` | reçue : attente de l'AR ; émise : réponse attendue à 4 mois |
| `relance_autorite`, `prorogation` | nouveau délai (`delaiMois` ou `echeance` fixe) |
| `document_prepare` → `signature` → envoi | parapheur : à signer, signé, envoyé |
| `cloture` / `reouverture` | un dossier clôturé le reste jusqu'à réouverture |

Chaque action passe par une fenêtre de confirmation qui dit ce qu'elle va
changer (étape, échéance) et permet d'antidater l'événement
(`components/entraide/ConfirmationAction.tsx`). Le même jour, un retour des
enquêteurs précède une relance saisie au même instant (reprise Excel) : le
dossier repart chez les enquêteurs.

**Dénonciation officielle.** Émise : envoi → attente de l'accusé de
réception → « Réception confirmée » clôture (rien d'autre n'est attendu).
Reçue : une décision, « Accepter » (les faits partent en enquête ordinaire,
hors suivi) ou « Refuser » (classement) — l'une et l'autre clôturent, avec
l'issue portée par l'événement de clôture.

**Drapeaux.** Orange = suivi renforcé demandé par le magistrat ; rouge =
résultats urgents. Délais raccourcis (`DELAIS.drapeau` : enquêteurs 2 / 1
mois, autorité 3 / 2 mois), pré-alerte plus tôt (45 / 60 jours), tête de
liste, mention dans les relances et délai imprimé sur T1/T2.

Délais légaux (DEE reçue, dir. 2014/41/UE) : accusé de réception annexe B à
7 jours (art. 16), exécution à 30 + 90 jours (art. 12). Toute autre échéance
légale (prescription, date butoir de l'État) se saisit sur la fiche.

Les délais se règlent dans `DELAIS` (`lib/entraide/core.mjs`).

## Données

Coffre chiffré `entraide` (périmètre global du trousseau) : `demandes`
(dont `natinf` : infraction ou son équivalent français, `drapeau`,
`observations` en texte enrichi),
`autorites` (mots-clés appris à la saisie, langue des courriers), `services`
(cases cochées sur T1/T2), `signataires` (bloc signature de chaque magistrat),
`tombstones`. Fusion par id, la `dateMiseAJour` la plus récente gagne
(`utils/dataSync/EntraideSyncService.ts`).

## Courriers et mails

Modèles `public/modeles/entraide/<doc>_<langue>.odt` — les trames du service,
balisées `{{cle}}` : T1 (soit-transmis aux enquêteurs), T2 (relance), T3
(retour à l'autorité étrangère, FR/EN), T4 (relance de l'autorité, FR/EN).
Remplis par `utils/entraide/documents.ts` (mise en page et logo intacts).
L'image de signature n'est apposée que sur un courrier validé par son
titulaire (« Valider et signer »). Mails : `utils/entraide/mails.ts`
(Copier / Ouvrir dans Outlook).

Trames T1/T2 : police = commissariats d'Amiens et d'Abbeville (la ligne DRPJ
et la case DDSP ont disparu ; `migrerServices` remet à niveau les services
déjà enregistrés). Une « autre unité » saisie une fois est proposée ensuite.

Recherche globale (en-tête) : les demandes, clôturées comprises, ouvrent leur
fiche (groupe « Entraide internationale »).

## Statistiques

Section « ENTRAIDE » de la page Statistiques ; source unique
`lib/stats/entraideCore.mjs`, chaque carte porte sa règle.

## Lecture d'une pièce (administrateur seul)

Bouton « Lire une pièce » dans la création d'une demande et dans la fiche,
visible du seul administrateur du TJ confié à l'attaché (route
`/api/attache/entraide-analyse`, 404 pour toute autre session ; masqué par
l'interrupteur de visibilité). Le service extrait le texte (OCR si scan) et
rend en un tour une fiche : synthèse des faits, ce qui est demandé, lieux
d'exécution, personnes, autorité et référence, mesures du catalogue, date
butoir, points de vigilance — qui préremplit les champs encore vides.
La pièce n'est pas conservée ; la fiche de lecture est gardée chiffrée dans
l'espace de l'attaché (`entraide-analyses/<id>.json`), hors registre partagé
(`scripts/attache/entraideAnalyse.mjs`).

## Connecteur Claude web

`entraide_lister`, `entraide_lire`, `entraide_referentiel`, `entraide_stats`
(lecture) ; `entraide_creer`, `entraide_modifier`, `entraide_completer`
(NATINF, personnes, mesures en lot), `entraide_evenement`,
`entraide_autorite`, `entraide_importer` (écritures versionnées, interdites
aux runs autonomes). `entraide_importer` est idempotent (clé : onglet + ligne
d'origine) : la reprise du tableau Excel peut être rejouée sans doublon.

Tests : `node scripts/entraide-core.test.mjs`,
`node scripts/attache-entraide.test.mjs`,
`node scripts/attache-entraide-lecture.test.mjs`.
