# Captures d'écran — Guide

Ce dossier accueille les captures d'écran référencées par `PRESENTATION.html`.
Toutes les images sont au format **PNG**, nommées **strictement** comme indiqué
ci-dessous.

## Deux dossiers, deux usages

| Dossier | Rôle |
|---|---|
| `_raw/` | Captures **brutes** sorties de l'app, **avant** caviardage. Non publiées. |
| (ce dossier) | Captures **prêtes à diffuser** : soit identiques aux brutes (rien à cacher), soit caviardées par le script. |

## Workflow recommandé

1. Capturer l'écran et l'enregistrer dans `_raw/` avec le nom exact (cf. tableau ci-dessous).
2. Si la capture contient des données à caviarder (noms, descriptions, CR…), définir les zones dans `../redaction_manifest.json` (coordonnées en pourcentages, voir les exemples déjà présents).
3. Lancer la chaîne complète :

```bash
bash docs/presentation/build-pdf.sh
```

Le script :
- applique le caviardage (`redact.py`) sur les fichiers présents dans `_raw/` ;
- complète par des placeholders pour les captures encore manquantes ;
- régénère le PDF final.

Vous pouvez aussi caviarder seul, sans rebuild PDF :

```bash
python3 docs/presentation/redact.py
```

## Liste des captures attendues

| Fichier | Écran | Caviardage habituel |
|---|---|---|
| `01-dashboard.png` | Tableau de bord (vue Enquêtes d'un contentieux) | Noms en timeline + À faire + cartes d'enquêtes. |
| `02-sidebar.png` | Barre latérale développée | Aucun. |
| `03-enquete-detail.png` | Modale de détail d'enquête (en-tête + sections) | Description, mis en cause, CR. |
| `04-enquete-actes.png` | Section Actes + zones Documents (glisser-déposer) | Noms de fichiers (contiennent des noms). |
| `05-instructions-list.png` | Liste des instructions (cabinets + dossiers) | Numéro de parquet + nom du JI, intitulé. |
| `06-instruction-detail.png` | Détail d'instruction : mis en examen, infractions, mesures, pédagogie | Identité + infractions + notes ; **conserver** le panneau "Vérification légale" (illustre la pédagogie). |
| `07-mindmap.png` | Cartographie / Mindmap | Labels des nœuds. |
| `08-stats.png` | Page Statistiques | Aucun (chiffres agrégés). |
| `11-alerts.png` | Page Alertes | Intitulés / numéros si visibles. |
| `12-save-sync.png` | Page Sauvegarde / Sync | Aucun. |
| `13-settings.png` | Panneau Admin (utilisateurs) | Noms / prénoms / emails. |
| `14-about.png` | Écran "À propos" | Aucun. |
| `15-modifications.png` | Popup « modifications non vues » | Nom de l'enquête en tête + identifiant utilisateur + lignes mentionnant des noms. |

> ℹ️ `09-air-import.png` et `10-permanence.png` ne sont plus utilisés (modules retirés de la présentation).

## Format des zones de caviardage

Dans `redaction_manifest.json`, chaque zone est exprimée en pourcentage de
l'image (`x`, `y`, `largeur`, `hauteur` ∈ [0, 1]) — donc indépendamment de
la résolution d'origine. Effet par défaut : pixelisation block 12 px + flou
Gaussien rayon 2,5 px. Ajustable globalement (`_defaults`) ou par fichier.
