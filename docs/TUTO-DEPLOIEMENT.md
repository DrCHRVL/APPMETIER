# SIRAL — Tutoriel de mise en service sur un serveur

> De zéro à l'app en ligne, étape par étape. Durée totale : ~1 h.
> Aucune compétence d'administration préalable n'est supposée.

---

## 1. Commander le serveur et le domaine (~15 min)

### 1.1 Le serveur (VPS)
1. Créez un compte sur **ovhcloud.com** (hébergeur français).
2. Menu **Bare Metal Cloud → VPS** → choisissez la gamme **VPS vps2023-le-2**
   (2 vCPU, 4 Go RAM, ~7–9 €/mois) — suffisant et confortable.
3. Au moment du choix de l'image : **Ubuntu 24.04**.
4. Localisation : **France** (Gravelines ou Strasbourg).
5. **Ajoutez l'option « Snapshot automatique »** (~2 €/mois) — c'est une partie
   de la stratégie de sauvegarde, ne la sautez pas.
6. À la livraison (quelques minutes), OVH vous envoie un e-mail avec
   **l'adresse IP** du serveur et l'utilisateur initial (`ubuntu`).

### 1.2 Le domaine
1. Toujours chez OVH : **Web Cloud → Noms de domaine** → commandez un domaine
   (ex. `siral-service.fr`, ~8 €/an).
2. Dans la **Zone DNS** du domaine, créez un enregistrement :
   - Type : `A` · Sous-domaine : *(vide ou `app`)* · Cible : **l'IP du VPS**.
3. La propagation prend de quelques minutes à quelques heures.

---

## 2. Préparer le serveur (~15 min)

Connectez-vous en SSH (depuis Windows : PowerShell) :

```powershell
ssh ubuntu@VOTRE_IP
```

Puis collez ce bloc (mises à jour, pare-feu, Docker) :

```bash
# Mises à jour + mises à jour de sécurité automatiques
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

# Pare-feu : seuls SSH et HTTPS entrent
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Déconnectez-vous puis reconnectez-vous (pour activer le groupe docker) :
`exit` puis `ssh ubuntu@VOTRE_IP`.

---

## 3. Installer SIRAL (~10 min)

### 3.1 Récupérer le code
Le dépôt est privé : créez un **jeton GitHub** (github.com → Settings →
Developer settings → Personal access tokens → *Fine-grained*, accès en
lecture au dépôt APPMETIER), puis :

```bash
git clone https://VOTRE_JETON@github.com/DrCHRVL/APPMETIER.git siral
cd siral
```

### 3.2 Configurer
```bash
cp .env.exemple .env
nano .env
```
Remplissez les trois valeurs :
- `SIRAL_DOMAINE=` votre domaine (ex. `siral-service.fr`) ;
- `SIRAL_SETUP_CODE=` le code d'enrôlement (longue valeur aléatoire — c'est
  lui qui empêche un inconnu de créer un compte ; à communiquer **oralement**
  aux membres du service) ;
- `SIRAL_SECRET=` le résultat de `openssl rand -hex 32`.

Sauvegardez (Ctrl+O, Entrée, Ctrl+X).

### 3.3 Lancer
```bash
docker compose up -d --build
```
Le premier build prend 5 à 10 minutes. Caddy obtient automatiquement le
certificat HTTPS (Let's Encrypt). Vérifiez :

```bash
docker compose ps        # les deux services doivent être "running"
```

Ouvrez **https://votre-domaine** : l'écran de connexion SIRAL apparaît.

---

## 4. Premier démarrage (~10 min)

1. **Enrôlement** : « Premier accès ? Enrôler une passkey » → identifiant
   (ex. votre login Windows), nom affiché, tribunal, code
   d'enrôlement → Windows Hello / Face ID crée la passkey. *Le premier compte
   créé est administrateur du serveur.*
2. **Votre trousseau personnel** (cloisonnement par clé individuelle) :
   - *Serveur vierge* : écran « Initialisation du chiffrement » — choisissez
     votre **phrase personnelle** (longue — quatre mots aléatoires). Des clés
     neuves sont générées et scellées dans votre trousseau.
   - Votre phrase personnelle est **irrécupérable** : imprimez-la, enveloppe
     scellée. En cas d'oubli, un collègue admin peut vous ré-inviter.
3. **Inviter les collègues** : Paramètres → **Utilisateurs & accès** →
   dépliez la carte du membre → section « Accès & clés » → « Inviter »
   (les contentieux à donner se règlent juste au-dessus, dans ses
   habilitations) → un **code d'invitation à usage unique** s'affiche :
   transmettez-le de vive voix.
   Le collègue s'enrôle (passkey + code d'enrôlement), saisit son code
   d'invitation et choisit SA phrase personnelle. Révoquer un membre se fait
   au même endroit.

---

## 5. Installer l'app sur les appareils (~2 min chacun)

- **PC (Edge/Chrome)** : ouvrez le site → menu ⋯ → **« Installer SIRAL »**.
  L'app a sa fenêtre, son icône, sa place dans le menu Démarrer.
- **iPhone (Safari)** : ouvrez le site → bouton Partager →
  **« Sur l'écran d'accueil »**. L'app s'ouvre en plein écran, Face ID sert
  de passkey. Fonctionne hors-ligne (les données déjà synchronisées restent
  consultables).
- Chaque membre du service s'enrôle avec **son** identifiant (celui de
  `users.json`) + le code d'enrôlement, saisit le **code d'invitation** remis
  par l'admin (Paramètres → Utilisateurs & accès), puis choisit sa **phrase
  personnelle**.

---

## 6. Sauvegardes (déjà en place, à vérifier une fois)

| Niveau | Quoi | Où | Automatique |
|---|---|---|---|
| 1 | Versions de chaque coffre (immutables) | volume `siral-data` | ✅ à chaque écriture |
| 2 | Snapshot complet du VPS | espace OVH | ✅ quotidien (option commandée en 1.1) |
| 3 | Export local chiffré | votre PC / clé USB | manuel (page Sauvegardes de l'app) |

Test de restauration trimestriel : restaurez un snapshot OVH sur un VPS
éphémère, vérifiez que l'app démarre et que la phrase ouvre le coffre.

---

## 7. Mettre à jour SIRAL

**Depuis l'app, sans SSH** : connectez-vous en administrateur →
Paramètres → **Mise à jour** → « Vérifier GitHub » → « Mettre à jour
depuis GitHub ». Le serveur récupère le code, se reconstruit et redémarre
tout seul (2 à 5 minutes) ; la page se recharge automatiquement à la fin.

C'est le conteneur **updater** (installé par `docker compose up -d --build`)
qui fait le travail : il est le seul à toucher au dépôt git et à Docker,
l'app lui transmet la demande par un volume partagé.

> **Installation déployée avant l'arrivée de l'updater ?** Faites une
> dernière mise à jour manuelle (commandes ci-dessous) pour l'installer ;
> toutes les suivantes se feront depuis l'app.

Équivalent manuel en SSH, si besoin :

```bash
cd ~/siral
git pull
docker compose up -d --build
```

## 8. Dépannage rapide

| Symptôme | Vérification |
|---|---|
| Le site ne répond pas | `docker compose ps`, puis `docker compose logs --tail 50` |
| Certificat HTTPS absent | le DNS pointe-t-il bien sur l'IP ? `dig +short votre-domaine` |
| « Code d'enrôlement incorrect » | valeur `SIRAL_SETUP_CODE` dans `.env`, puis `docker compose up -d` |
| Passkey refusée | l'URL doit être exactement `https://votre-domaine` (pas l'IP) |
| Phrase secrète refusée | c'est la bonne phrase ? (insensible aux espaces de début/fin — sinon, irrécupérable : restaurer un snapshot) |
| La MAJ in-app échoue ou « service non installé » | `docker compose ps updater`, puis `docker compose logs updater` ; journal détaillé : fichier `update.log` du volume `siral_updater-state` |

---

## Rappels de sécurité

- Le serveur ne voit **que des données chiffrées** : même compromis, il ne
  livre rien d'exploitable. La sécurité réelle repose sur 1) vos passkeys,
  2) la phrase secrète, 3) le code d'enrôlement.
- Ne stockez jamais la phrase secrète dans un e-mail ou un fichier. Papier,
  scellé, coffre.
- L'accès SSH au serveur = accès aux blobs chiffrés + possibilité de saboter
  le service, pas de lire les données. Gardez quand même le mot de passe
  SSH/clé en lieu sûr.
