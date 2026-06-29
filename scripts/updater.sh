#!/bin/sh
# SIRAL — service de mise à jour du serveur (conteneur « updater »).
#
# Rôle : seul composant autorisé à toucher au dépôt git et au démon Docker.
# L'app (conteneur « siral ») ne peut pas se reconstruire elle-même : elle
# dialogue avec ce service par fichiers, via le volume partagé monté ici
# sur $STATE_DIR et côté app sur /updater (SIRAL_UPDATER_DIR) :
#
#   request.json  ← écrit par l'app  : { "action": "check" | "apply" }
#   check.json    → écrit ici        : SHA local / distant, commits de retard
#   commits.tsv   → écrit ici        : changelog brut (sha ⇥ auteur ⇥ date ⇥ sujet)
#   status.json   → écrit ici        : progression d'une mise à jour en cours
#   update.log    → écrit ici        : journal détaillé (diagnostic)
#
# Sécurité : rien du contenu de request.json n'est interprété comme commande —
# seule la valeur exacte de "action" est comparée à deux chaînes fixes.

set -u

REPO="${REPO_DIR:-/srv/repo}"
STATE="${STATE_DIR:-/state}"
BRANCH="${SIRAL_BRANCH:-main}"
PROJECT="${COMPOSE_PROJECT_NAME:-siral}"
# compose v2 (plugin embarqué dans CETTE image) ; -p épingle le nom de projet
# pour viser les mêmes conteneurs/volumes « siral_* » que l'hôte.
COMPOSE="docker compose -f $REPO/docker-compose.yml --project-directory $REPO -p $PROJECT"

mkdir -p "$STATE"
# le conteneur app (utilisateur non-root « siral ») doit pouvoir déposer request.json
chmod 0777 "$STATE"
touch "$STATE/update.log" && chmod 0666 "$STATE/update.log"

now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "[$(now)] $*" >> "$STATE/update.log"; }
# Dernières lignes du journal, sur une seule ligne — sert à enrichir les
# messages d'erreur affichés dans l'app (« voir update.log » seul est opaque).
log_tail() { tail -n 8 "$STATE/update.log" 2>/dev/null | tr '\n' ' '; }

# Récupère de l'espace disque avant un build : chaque mise à jour laisse
# derrière elle l'ancienne image « siral » (devenue orpheline) et du cache de
# build. Au fil des MAJ, ces reliquats saturent le disque et font échouer le
# build suivant — cause typique d'un updater « qui marchait avant ». On ne
# touche qu'aux images orphelines (non taguées) et au cache : rien d'utilisé
# par un conteneur en cours n'est supprimé.
free_space() {
  log "nettoyage : images orphelines et cache de build des MAJ précédentes"
  docker image prune -f >> "$STATE/update.log" 2>&1 || true
  docker builder prune -f >> "$STATE/update.log" 2>&1 || true
}

# git refuse par défaut un dépôt appartenant à un autre utilisateur (celui de l'hôte)
git config --global --add safe.directory "$REPO" 2>/dev/null

write_status() { # $1=state $2=step $3=message
  msg=$(printf '%s' "${3:-}" | tr -d '"\\\r' | tr '\n' ' ' | cut -c1-300)
  printf '{"state":"%s","step":"%s","message":"%s","at":"%s"}\n' \
    "$1" "$2" "$msg" "$(now)" > "$STATE/status.json.tmp"
  mv "$STATE/status.json.tmp" "$STATE/status.json"
  chmod 0644 "$STATE/status.json"
}

do_check() {
  fetch_ok=true
  if ! git -C "$REPO" fetch --quiet origin "$BRANCH" >> "$STATE/update.log" 2>&1; then
    fetch_ok=false
    log "git fetch origin/$BRANCH en échec (GitHub injoignable ou jeton invalide)"
  fi
  local_sha=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo "")
  remote_sha=$(git -C "$REPO" rev-parse "origin/$BRANCH" 2>/dev/null || echo "")
  count=$(git -C "$REPO" rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)
  git -C "$REPO" log --pretty=format:'%H%x09%an%x09%aI%x09%s' "HEAD..origin/$BRANCH" 2>/dev/null \
    > "$STATE/commits.tsv.tmp" && mv "$STATE/commits.tsv.tmp" "$STATE/commits.tsv" \
    && chmod 0644 "$STATE/commits.tsv"
  printf '{"localSha":"%s","remoteSha":"%s","commits":%s,"fetchOk":%s,"checkedAt":"%s"}\n' \
    "$local_sha" "$remote_sha" "${count:-0}" "$fetch_ok" "$(now)" > "$STATE/check.json.tmp"
  mv "$STATE/check.json.tmp" "$STATE/check.json"
  chmod 0644 "$STATE/check.json"
}

# Annule l'avance git vers $1 (le SHA d'avant le merge) : utilisé quand le
# build ou le redémarrage échoue, pour que le dépôt repointe sur le code
# réellement servi par le conteneur. Sans ça, git avance mais le conteneur
# reste sur l'ancienne image : l'app croit alors être « à jour » alors que les
# nouveautés ne tournent pas, et l'admin ne peut plus relancer la mise à jour.
rollback_to() {
  [ -n "$1" ] || return
  log "retour du dépôt sur $1 (build/redémarrage échoué) pour rester cohérent avec le conteneur"
  git -C "$REPO" reset --hard "$1" >> "$STATE/update.log" 2>&1 || true
  do_check
}

do_apply() {
  # rotation du journal avant un build (les builds sont verbeux)
  [ "$(wc -c < "$STATE/update.log" 2>/dev/null || echo 0)" -gt 2000000 ] && : > "$STATE/update.log"
  log "── mise à jour demandée ──"
  write_status updating fetch ""
  if ! git -C "$REPO" fetch origin "$BRANCH" >> "$STATE/update.log" 2>&1; then
    write_status error fetch "Échec du git fetch (GitHub injoignable ou jeton invalide) — $(log_tail)"
    return
  fi
  # SHA réellement déployé (= servi par le conteneur) avant toute avance.
  prev_sha=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo "")
  write_status updating pull ""
  if ! git -C "$REPO" merge --ff-only "origin/$BRANCH" >> "$STATE/update.log" 2>&1; then
    write_status error pull "Avance rapide impossible : le dépôt du serveur a divergé — intervention SSH requise"
    return
  fi
  write_status updating build ""
  free_space
  if ! $COMPOSE build siral >> "$STATE/update.log" 2>&1; then
    rollback_to "$prev_sha"
    write_status error build "Échec de la reconstruction Docker (disque ou mémoire insuffisants ?) — $(log_tail)"
    return
  fi
  write_status updating restart ""
  if ! $COMPOSE up -d siral >> "$STATE/update.log" 2>&1; then
    rollback_to "$prev_sha"
    write_status error restart "Échec du redémarrage du conteneur — $(log_tail)"
    return
  fi
  do_check
  write_status done done "Mise à jour appliquée"
  log "── mise à jour terminée : $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null) ──"
}

# Reconstruit + redémarre le conteneur sur le code DÉJÀ présent dans le dépôt,
# sans toucher à git. Sert à rattraper une mise à jour dont le dépôt avait
# avancé mais dont le build avait échoué : l'app affiche « à jour » alors que
# le conteneur sert l'ancienne image — ce bouton force enfin la reconstruction.
do_rebuild() {
  [ "$(wc -c < "$STATE/update.log" 2>/dev/null || echo 0)" -gt 2000000 ] && : > "$STATE/update.log"
  log "── reconstruction forcée (version inchangée) ──"
  write_status updating build ""
  free_space
  if ! $COMPOSE build siral >> "$STATE/update.log" 2>&1; then
    write_status error build "Échec de la reconstruction Docker (disque ou mémoire insuffisants ?) — $(log_tail)"
    return
  fi
  write_status updating restart ""
  if ! $COMPOSE up -d siral >> "$STATE/update.log" 2>&1; then
    write_status error restart "Échec du redémarrage du conteneur — $(log_tail)"
    return
  fi
  do_check
  write_status done done "Reconstruction terminée"
  log "── reconstruction terminée : $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null) ──"
}

log "démarrage du service de mise à jour (dépôt : $REPO, branche : $BRANCH)"
write_status idle "" ""
do_check

LAST_AUTO=$(date +%s)
while true; do
  if [ -f "$STATE/request.json" ]; then
    req=$(cat "$STATE/request.json" 2>/dev/null || echo "")
    rm -f "$STATE/request.json"
    case "$req" in
      *'"action":"apply"'* | *'"action": "apply"'*) do_apply ;;
      *'"action":"rebuild"'* | *'"action": "rebuild"'*) do_rebuild ;;
      *'"action":"check"'* | *'"action": "check"'*) do_check ;;
      *) log "requête ignorée : $req" ;;
    esac
  fi
  ts=$(date +%s)
  if [ $((ts - LAST_AUTO)) -ge 600 ]; then
    do_check
    LAST_AUTO=$ts
  fi
  sleep 3
done
