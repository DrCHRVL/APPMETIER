# Skills prêtes à téléverser — Attaché de justice

Des méthodes prêtes à l'emploi pour l'attaché IA, au format `.skill`
(le même que les skills exportées de Claude web : archive ZIP contenant un
`SKILL.md` avec front-matter `name`/`description`).

## Installation

Paramètres → **Attaché IA** → **Skills** → **Téléverser** → choisir le
fichier `.skill`. Le nom et la description (le déclencheur) sont repris du
front-matter ; la skill vaut dès le run suivant de l'attaché.

## Skills disponibles

| Fichier | Usage |
|---|---|
| `bilan-semestriel-crimorg.skill` | Bilan périodique (semestriel, annuel) d'activité et de politique pénale du contentieux criminalité organisée : chiffres (`stats_synthese`), graphiques regardés et commentés (`stats_graphique`), tendances, affaires marquantes anonymisées, valorisation pour le procureur et les partenaires. Demander ensuite en chat : « prépare le bilan du premier semestre » (+ observations éventuelles). |

## Modifier / reconstruire

Le source de chaque skill vit dans le dossier du même nom
(`bilan-semestriel-crimorg/SKILL.md`). Après modification :

```bash
node scripts/build-skill.mjs docs/skills-attache/bilan-semestriel-crimorg
```

L'archive `.skill` est reconstruite à côté du dossier (ZIP à entrées
stockées, lisible par l'import de SIRAL comme par tout outil zip). La
description du front-matter doit rester ≤ 300 caractères : c'est elle qui
déclenche la skill, l'app tronque au-delà.
