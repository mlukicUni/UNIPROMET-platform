#!/usr/bin/env bash
# Automatsko azuriranje servera kada se grana main na GitHub-u promeni.
#
# Pokrece ga unipromet-update.timer (na 2 minuta) kao root. Instalira se kao root-ova kopija
# /usr/local/sbin/unipromet-update (deploy/install-services.sh), pa izmena ovog fajla
# na GitHub-u NE menja skriptu na serveru dok se install-services.sh ponovo ne pokrene.
#
# Tok: git fetch -> ako ima novog commit-a: npm ci (samo ako se package-lock promenio) i build
# u odvojenom folderu /opt/unipromet-admin-build (stanje: /var/lib/unipromet-update) -> ako build prodje: stop, zamena koda,
# dist/ (i node_modules/), start -> provera /login. Ako build ne prodje, aplikacija se ne dira.
# Ako provera posle restarta ne prodje, vraca se prethodna verzija.
# Neuspeli commit se ne pokusava ponovo dok ne stigne novi (ili rucno: --force).
#
# Rucno: sudo unipromet-update [--force]
# Log: /opt/unipromet-admin/data/logs/deploy.log
{
set -uo pipefail

LIVE=/opt/unipromet-admin
BUILD=/opt/unipromet-admin-build
STATE=/var/lib/unipromet-update
LOG=$LIVE/data/logs/deploy.log
SVC=unipromet-admin
APP_USER=uniadmin
BRANCH=main
HEALTH_URL=https://127.0.0.1:3000/login

as_app() { runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" "$@"; }
log() { echo "[$(date '+%F %T')] $*" >>"$LOG"; echo "$*"; }
notify() { as_app node "$LIVE/deploy/notify-deploy.js" "$1" "$2" >>"$LOG" 2>&1 || true; }

healthy() {
  local i code
  for i in $(seq 1 30); do
    sleep 2
    code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 3 "$HEALTH_URL" || true)
    if [ "$code" = "200" ]; then
      # jos par sekundi da se uhvati pad odmah posle starta
      sleep 5
      systemctl is-active --quiet "$SVC" && return 0
      return 1
    fi
  done
  return 1
}

exec 9>/run/unipromet-update.lock
flock -n 9 || exit 0

mkdir -p "$STATE"
[ -f "$LOG" ] || install -m 644 -o "$APP_USER" -g "$APP_USER" /dev/null "$LOG"
cd "$LIVE" || exit 1

if ! as_app git fetch -q origin "$BRANCH"; then
  log "git fetch nije uspeo (GitHub nedostupan?)"
  exit 1
fi
CUR=$(as_app git rev-parse HEAD)
NEW=$(as_app git rev-parse "origin/$BRANCH")
[ "$CUR" = "$NEW" ] && exit 0
if [ "${1:-}" != "--force" ] && [ "$(cat "$STATE/failed" 2>/dev/null)" = "$NEW" ]; then
  exit 0
fi

SUBJ=$(as_app git log -1 --format='%h %s' "$NEW")
log "=== Nova verzija: $SUBJ (trenutna ${CUR:0:7})"

fail_build() {
  log "Build NIJE uspeo ($1) - aplikacija ostaje na ${CUR:0:7}"
  echo "$NEW" >"$STATE/failed"
  notify fail "Azuriranje na $SUBJ nije uspelo: $1. Server i dalje radi na ${CUR:0:7}. Detalji: $LOG"
  exit 1
}

# 1) Build u odvojenom folderu - aplikacija za to vreme radi normalno
if [ ! -d "$BUILD/.git" ]; then
  rm -rf "$BUILD"
  install -d -o "$APP_USER" -g "$APP_USER" "$BUILD"
  as_app git clone -q "$(as_app git -C "$LIVE" remote get-url origin)" "$BUILD" || fail_build "git clone"
fi
cd "$BUILD" || fail_build "build folder"
as_app git fetch -q origin "$BRANCH" || fail_build "git fetch (build)"
as_app git reset -q --hard "$NEW" || fail_build "git reset (build)"
as_app git clean -qfdx -e node_modules || fail_build "git clean (build)"

LOCK_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ ! -d node_modules ] || [ "$(cat "$STATE/lock-hash" 2>/dev/null)" != "$LOCK_HASH" ]; then
  log "npm ci (package-lock.json se promenio)"
  as_app npm ci --no-audit --no-fund >>"$LOG" 2>&1 || fail_build "npm ci"
  echo "$LOCK_HASH" >"$STATE/lock-hash"
fi
log "build (tsc)"
as_app npm run build >>"$LOG" 2>&1 || fail_build "tsc"
[ -f dist/server.js ] || fail_build "nema dist/server.js"

# 2) Zamena verzije (kratak prekid rada)
DEPS_CHANGED=0
cmp -s "$LIVE/package-lock.json" "$BUILD/package-lock.json" || DEPS_CHANGED=1
rm -rf "$STATE/prev"
mkdir -p "$STATE/prev"
cp -a "$LIVE/dist" "$STATE/prev/dist"
[ "$DEPS_CHANGED" = 1 ] && cp -a "$LIVE/node_modules" "$STATE/prev/node_modules"

log "Build OK, restart na novu verziju (zavisnosti promenjene: $DEPS_CHANGED)"
systemctl stop "$SVC"
cd "$LIVE"
as_app git reset -q --hard "$NEW"
rsync -a --delete "$BUILD/dist/" "$LIVE/dist/"
[ "$DEPS_CHANGED" = 1 ] && rsync -a --delete "$BUILD/node_modules/" "$LIVE/node_modules/"
systemctl start "$SVC"

if healthy; then
  rm -f "$STATE/failed"
  log "OK - server radi na ${NEW:0:7}"
  notify ok "Server je azuriran na: $SUBJ"
  exit 0
fi

# 3) Nova verzija ne radi - vracanje prethodne
log "Provera posle restarta NIJE prosla - vracam ${CUR:0:7}"
systemctl stop "$SVC"
as_app git reset -q --hard "$CUR"
rsync -a --delete "$STATE/prev/dist/" "$LIVE/dist/"
[ "$DEPS_CHANGED" = 1 ] && rsync -a --delete "$STATE/prev/node_modules/" "$LIVE/node_modules/"
systemctl start "$SVC"
echo "$NEW" >"$STATE/failed"
if healthy; then
  log "Vraceno na ${CUR:0:7}"
  notify fail "Verzija $SUBJ se nije pokrenula posle restarta, vracena je prethodna (${CUR:0:7}). Pogledati data/logs/server.err.log."
else
  log "UPOZORENJE: ni prethodna verzija ne odgovara posle vracanja"
  notify fail "Verzija $SUBJ se nije pokrenula, a ni vracena verzija ${CUR:0:7} ne odgovara. Potrebna je rucna provera servera."
fi
exit 1
}
