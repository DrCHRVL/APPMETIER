# Refonte des alertes « non visuelles » (cloche)

> Objectif : que les alertes arrêtent de « revenir tout le temps ». On passe
> d'un modèle de **harcèlement périodique** à un modèle de **boîte de tri**
> où une alerte ne réapparaît que lorsque la situation réelle a changé.

## Le problème (ancien modèle)

Trois mécaniques faisaient revenir les alertes alors que rien n'avait bougé :

1. **Récurrence = re-snooze automatique.** « Valider » une règle récurrente ne
   supprimait pas l'alerte : elle la mettait en sommeil jusqu'à
   `aujourd'hui + intervalle`, puis `cleanupAlerts` la réactivait. Une alerte
   « récurrente tous les 8 jours » revenait donc tous les 8 jours, à vie.
2. **Clé de validation année-mois pour l'âge d'enquête.** La validation expirait
   à chaque changement de mois → une vieille enquête (toujours ≥ seuil)
   ré-alertait **chaque mois**, indéfiniment.
3. **Conditions sans état terminal.** « Valider » était un clic qui ne changeait
   rien au dossier ; l'obligation restait vraie, donc l'alerte avait « raison »
   de revenir.

## Le nouveau modèle : « silence jusqu'à changement réel »

Chaque alerte porte une **empreinte d'état** (`stateKey`) : une chaîne qui
capture la situation réelle qui la justifie. « Valider » mémorise cette
empreinte. L'alerte **reste muette tant que l'empreinte ne change pas**, et
réapparaît dès que la situation évolue réellement.

| Type d'alerte | Empreinte (`stateKey`) | Réapparaît quand… |
|---|---|---|
| `cr_delay` | dernier CR + palier de retard | un nouveau CR est déposé, ou le retard franchit un multiple du seuil |
| `enquete_age` | palier d'âge (`âge / seuil`) | l'enquête franchit le palier suivant (90 → 180 → 270…) |
| `acte_expiration` | acte + date d'expiration | l'acte est renouvelé/prolongé (nouvelle date) |
| `prolongation_pending` | acte + début de la prolongation | la prolongation change ; disparaît seule quand le statut change |
| `air_6_mois` / `air_12_mois` | palier fixe | passage au palier supérieur |
| `air_rdv_delai` | dernier RDV + palier | nouveau RDV procureur, ou retard franchissant un palier |

Les **paliers** servent de filet de sécurité : une obligation oubliée ressort
quand elle s'aggrave matériellement (un cran de plus), sans jamais « crier »
tant que rien n'a bougé. C'est ce qui remplace l'ancienne récurrence.

### Conséquences

- La **récurrence** des règles est supprimée (champ `recurrence` déprécié,
  ignoré par `AlertManager`). L'UI de configuration ne propose plus de régler
  un intervalle ; une note explique le nouveau comportement.
- Plus de **fenêtre temporelle** de validation (`VALIDATION_PERIODS` supprimé).
  Une validation reste valable tant que l'état ne change pas ; le journal est
  juste purgé après ~13 mois pour l'hygiène de stockage.
- Les anciennes validations (sans `stateKey`) sont respectées une dernière fois
  pour éviter un retour massif après mise à jour.

## La couche « boîte de tri » (UX)

- **Badge = nouveautés.** La pastille de la cloche ne compte plus le total des
  alertes actives mais seulement celles **jamais vues** (identité = empreinte
  comprise). Ouvrir la cloche remet le badge à zéro (`markAllSeen`). Un
  changement d'état réel ré-incrémente le badge. État stocké localement par
  poste (`{clé}_seen`).
- **Action « Traiter ».** Chaque alerte d'enquête a un bouton qui ouvre
  directement le dossier concerné.
- **« Reporter »** reste un snooze manuel à une date choisie (inchangé), avec
  dé-doublonnage : une alerte snoozée n'est plus ré-affichée en double.
- **Digest quotidien.** Quand les rappels push sont activés et qu'il reste des
  alertes actives, un seul créneau de rappel à 9h est programmé par jour, en
  plus des rappels d'échéance J-2 / J (voir `lib/web/pushReminders.ts`).

## Où c'est implémenté

| Fichier | Rôle |
|---|---|
| `utils/alerts/alertManager.ts` | `computeStateKey`, `wasAcknowledgedForState`, validation par empreinte, suppression de la récurrence |
| `hooks/useCombinedAlerts.ts` | empreintes AIR, merge snooze sans doublon, `unseenCount` + `markAllSeen` |
| `components/modals/AlertsModal.tsx` | bouton « Traiter », note explicative |
| `components/Header.tsx` | badge = nouveautés |
| `components/ContentieuxAlertsBubble.tsx` | retrait de l'UI de récurrence + note |
| `lib/web/pushReminders.ts` | digest quotidien à 9h |
| `types/interfaces.ts` | `Alert.stateKey`, `AlertValidation.stateKey`, `recurrence` déprécié |

## Réglage des seuils (paliers d'escalade)

Le palier d'escalade = le **seuil de la règle**. Pour calmer ou resserrer le
filet de sécurité, il suffit d'ajuster le seuil dans la bulle de configuration
du contentieux : un seuil d'âge à 90 j re-notifie tous les 90 j de
vieillissement ; à 180 j, tous les 180 j ; etc.
