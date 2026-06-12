# Présentation APP MÉTIER

Dossier contenant la présentation générale de l'application au format PDF
(à destination des décideurs et de la documentation interne).

## Contenu

| Fichier | Rôle |
|---|---|
| `PRESENTATION.html` | Source HTML/CSS de la présentation (texte + structure + références aux captures). |
| `PRESENTATION.pdf` | PDF compilé prêt à diffuser. |
| `PISTES-AMELIORATION.md` | Pistes d'amélioration du produit projeté, priorisées (quick wins / moyen terme / horizon). |
| `plaquette/PLAQUETTE-SIRAL.html` | Plaquette produit A4 recto-verso (charte « Lumière » palette Justice), auto-suffisante. |
| `plaquette/PLAQUETTE-SIRAL.pdf` | Plaquette compilée, prête à imprimer. Régénérer : `bash plaquette/build-plaquette.sh`. |
| `build-pdf.sh` | Script de génération du PDF depuis le HTML. |
| `_gen_placeholders.py` | Script utilitaire générant des images de remplacement pour les captures non encore disponibles. |
| `screenshots/` | Captures d'écran référencées dans le document. |
| `screenshots/README.md` | Liste des captures attendues et conventions de nommage. |

## Régénérer le PDF

```bash
bash docs/presentation/build-pdf.sh
```

Dépendances : `python3`, `weasyprint` (`pip install weasyprint`), `Pillow`
(`pip install Pillow`). Sur Debian/Ubuntu, WeasyPrint a besoin de
`libpango-1.0-0` et `libpangoft2-1.0-0` (paquets système).

## Mettre à jour les captures d'écran

1. Capturer les écrans listés dans `screenshots/README.md`.
2. Enregistrer chaque PNG dans `screenshots/` avec **exactement** le nom indiqué
   (les noms de fichiers sont référencés dans `PRESENTATION.html`).
3. Relancer `bash docs/presentation/build-pdf.sh`.

Les images de remplacement existantes seront **conservées telles quelles** par
le script tant que vous n'avez pas écrasé chaque PNG par sa version définitive.

## Modifier le contenu

Éditer `PRESENTATION.html` directement. La structure est commentée par section
pour faciliter la navigation. Les styles sont embarqués dans la balise
`<style>` en début de fichier ; tout est auto-suffisant (aucune dépendance
externe à charger).
