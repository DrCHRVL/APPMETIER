# Skills prêtes à téléverser — Claude web (connecteur SIRAL)

Des méthodes au format `.skill` (archive ZIP contenant un `SKILL.md` avec
front-matter `name`/`description`) à téléverser **dans claude.ai** — pas
dans SIRAL — pour que Claude web exploite au mieux le connecteur SIRAL
(voir [CONNECTEUR-CLAUDE-WEB.md](../CONNECTEUR-CLAUDE-WEB.md)).

## Installation (claude.ai)

Paramètres → **Capacités** (Capabilities) → **Skills** → **Téléverser une
skill** → choisir le fichier `.skill`. La skill se déclenche ensuite toute
seule dès qu'une conversation touche à son domaine (c'est la `description`
du front-matter qui sert de déclencheur).

## Skills disponibles

| Fichier | Usage |
|---|---|
| `mobilisation-siral.skill` | Méthode complète de mobilisation du connecteur SIRAL : identifier le bon dossier (numéros, mis en cause, lignes), lire les données en économe (aperçus, sections paginées, pièces, actes déjà rédigés), recouper une pièce versée en conversation (PV, ordonnance), rédiger selon les trames du magistrat et remettre l'acte dans SIRAL (`produire_document` + `acteMeta`), avec la discipline d'écriture (instruction explicite, `[À CONFIRMER]`, récapitulatif). |

## Modifier / reconstruire

Le source vit dans le dossier du même nom (`mobilisation-siral/SKILL.md`).
Après modification :

```bash
node scripts/build-skill.mjs docs/skills-claude-web/mobilisation-siral
```

La `description` du front-matter doit rester ≤ 300 caractères. Ces mêmes
fichiers `.skill` sont aussi importables dans SIRAL (Paramètres → Attaché
IA → Skills) si l'on veut la même méthode côté attaché — mais celle-ci est
pensée pour Claude web, qui découvre les outils par le connecteur.
