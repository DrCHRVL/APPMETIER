# Captures d'écran — Guide

Ce dossier accueille les captures d'écran référencées par `PRESENTATION.html`.
Toutes les images sont au format **PNG**, nommées **strictement** comme indiqué
ci-dessous : le document et le script de génération PDF s'appuient sur ces noms.

## Liste des captures attendues

| Fichier | Écran à capturer | Conseils de cadrage |
|---|---|---|
| `01-dashboard.png` | Tableau de bord principal (vue Enquêtes d'un contentieux) | Plein écran, barre latérale visible, header visible, plusieurs cartes d'enquêtes. |
| `02-sidebar.png` | Barre latérale développée avec les 3 contentieux | Zoom sur la sidebar uniquement (largeur ~260 px), avec badges d'alertes. |
| `03-enquete-detail.png` | Modale de détail d'une enquête (vue principale) | Ouvrir une enquête, capturer la modale entière avec ses sections visibles. |
| `04-enquete-actes.png` | Section "Actes" et "Documents" d'une enquête | Modale d'enquête, scroll jusqu'à la section Actes + zones glisser-déposer Documents. |
| `05-instructions-list.png` | Page Instructions (liste de dossiers) | Vue liste, filtres visibles. |
| `06-instruction-detail.png` | Modale de détail d'une instruction | Modale ouverte, timeline et infractions visibles. |
| `07-mindmap.png` | Cartographie / Mindmap | Vue principale avec plusieurs nœuds et liens, overlay actif si possible. |
| `08-stats.png` | Page Statistiques (graphiques audience / infractions) | Au moins 2 graphiques visibles. |
| `11-alerts.png` | Page Alertes (règles + alertes actives) | Vue avec règles configurées et badges. |
| `12-save-sync.png` | Page Sauvegarde / Synchronisation | Statut réseau, historique des sauvegardes. |
| `13-settings.png` | Modale Paramètres ou panneau Admin (utilisateurs) | Onglet utilisateurs si possible. |
| `14-about.png` | Écran "À propos" (logo, auteur, version) | Carte centrale entière. |
| `15-modifications.png` | Popup « modifications non vues » | Popup ouverte avec plusieurs modifs listées. |

> ℹ️ Les fichiers `09-air-import.png` et `10-permanence.png` ne sont plus
> référencés depuis la nouvelle version (modules retirés de la présentation).
> Vous pouvez les supprimer du dossier ou les laisser sans effet sur le PDF.

## Comment capturer rapidement (Windows)

- `Win + Maj + S` puis sélection de la zone — ou raccourci Snipping Tool.
- Enregistrer en PNG dans ce dossier avec le nom exact ci-dessus.
- Pour les modales : sélectionner la fenêtre Electron entière (`Alt + Impr écran`),
  recadrer ensuite si besoin pour ne garder que la zone utile.

## Régénérer le PDF après ajout des captures

Depuis la racine du repo :

```bash
bash docs/presentation/build-pdf.sh
```

Le fichier `docs/presentation/PRESENTATION.pdf` sera mis à jour.
