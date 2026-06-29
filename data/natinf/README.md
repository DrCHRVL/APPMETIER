# Référentiel NATINF

La nomenclature **NATINF** (NATure d'INFraction) est le référentiel officiel des
infractions pénales, douanières et fiscales françaises, maintenu par la
**Direction des affaires criminelles et des grâces (DACG)** du ministère de la
Justice. Chaque infraction y porte un numéro unique (le « code NATINF »).

Dans SIRAL, le NATINF est un **référentiel en lecture seule** (ce n'est pas une
donnée de dossier, donc il n'est ni chiffré ni versionné dans les coffres). Il
sert de socle commun aux enquêtes préliminaires et aux instructions :
qualification des chefs de mise en examen, saisine in rem, qualifications
d'enquête, et rapprochement avec les tags « infractions ».

## Fichiers

| Fichier | Rôle | Généré par |
|---|---|---|
| `natinf-memento.json` | Extraction du **Mémento parquet** (codes fréquents : quantum « parquet » abrégé, thème). Source secondaire pour le libellé. | `scripts/parse-memento-pdf.py` |
| `natinf.json` | **Référentiel runtime** consommé par l'app (merge mémento + export officiel). | `scripts/build-natinf.mjs` |

`natinf.json` est la seule donnée chargée à l'exécution. Les deux fichiers sont
versionnés dans le dépôt et mis à jour par release.

## Source officielle (faisant foi)

Jeu de données « **Liste des infractions en vigueur de la nomenclature NATINF** »
publié par le Ministère de la Justice sur data.gouv.fr, sous Licence Ouverte 2.0,
**mis à jour chaque trimestre** :

> https://www.data.gouv.fr/datasets/liste-des-infractions-en-vigueur-de-la-nomenclature-natinf

Le fichier CSV comporte 5 colonnes : numéro NATINF, qualification simplifiée
(≤ 210 caractères), nature de l'infraction, articles définissant l'infraction,
articles édictant les peines. Il recense plus de 17 000 infractions en vigueur.

Consultation en ligne pour contrôle ponctuel : <https://natinf.fr/>.

## Mettre à jour le référentiel

1. Télécharger le CSV officiel le plus récent depuis la page data.gouv ci-dessus
   (vous contrôlez ainsi la source et la date de la version utilisée).
2. Reconstruire le référentiel en fusionnant le mémento et l'export officiel :

   ```bash
   node scripts/build-natinf.mjs --official /chemin/vers/export-natinf.csv
   ```

   - Le **libellé, la nature et les articles** proviennent de l'export officiel
     (ils font foi).
   - Le **quantum « parquet » abrégé, le thème et l'indicateur « fréquent »**
     proviennent du mémento.
   - Le script signale les éventuels **écarts de nature** entre les deux sources.

3. Sans l'option `--official`, le référentiel est reconstruit à partir du seul
   mémento (~1 090 codes courants) — état de démarrage, suffisant pour l'usage
   quotidien mais à compléter par l'export officiel.

## Régénérer le mémento (si le PDF évolue)

Le Mémento parquet (tableaux NATINF) est actualisé périodiquement. Pour
régénérer `natinf-memento.json` à partir d'une nouvelle version du PDF :

```bash
pip install pypdf
python3 scripts/parse-memento-pdf.py "Mémento parquet.pdf" data/natinf/natinf-memento.json
node scripts/build-natinf.mjs   # puis reconstruire le runtime
```

Les libellés issus du mémento sont volontairement secondaires (extraction de
tableaux) : l'export officiel reste la référence pour le libellé exact.
