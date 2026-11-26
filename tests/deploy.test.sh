#!/bin/bash
# Simula un despliegue de Hostinger (la carpeta del sitio se reemplaza entera)
# y comprueba que los datos, fotos y mapas siguen intactos: tests/deploy.test.sh
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d); WEB=$T/acopia.app/public_html; PORT=${PORT:-8799}
export HOME=$T/home; mkdir -p $HOME; unset ACOPIA_DATA; DAT=$HOME/acopia-datos
B=http://127.0.0.1:$PORT; J=(-H 'Content-Type: application/json'); A=$T/c.txt; pass=0; fail=0
chk(){ if echo "$2" | grep -q "$3"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FALLA: $1 → $2"; fi; }
deploy(){ rm -rf "$WEB"; mkdir -p "$WEB"; cp -r "$ROOT/public_html/." "$WEB/"; rm -f "$WEB/data.json"; }
start(){ (cd "$WEB" && HOME=$HOME php -S 127.0.0.1:$PORT >/dev/null 2>&1 & echo $! > $T/pid); sleep 0.6; }
stop(){ kill "$(cat $T/pid)" 2>/dev/null; sleep 0.2; }
# 1) instalación anterior: datos DENTRO de la web (como estaba antes) → deben migrarse
deploy; echo '{"version":1,"estancia":{"nombre":"Vieja","sigla":"VJ"},"lots":[],"silos":[{"id":"VJ01001","lote":1}],"users":[]}' > "$WEB/data.json"
cp "$ROOT/public_html/data.seed.json" "$T/seed.json"
python3 - "$WEB/data.json" "$T/seed.json" <<'PY'
import json,sys; d=json.load(open(sys.argv[1])); s=json.load(open(sys.argv[2])); d['users']=s['users']; d['lots']=s['lots']; json.dump(d,open(sys.argv[1],'w'))
PY
mkdir -p "$WEB/uploads/maps"; echo foto > "$WEB/uploads/VJ01001-0123abcd.jpg"
start
chk login "$(curl -s -c $A "${J[@]}" -d '{"user":"rodma","pass":"rmaldonado"}' $B/api.php?action=login)" '"rol":"admin"'
chk migra-datos "$(curl -s -b $A $B/api.php?action=state)" 'VJ01001'
chk migra-fotos "$(test -f $DAT/uploads/VJ01001-0123abcd.jpg && echo si)" si
chk sin-datos-en-web "$(test -e $WEB/data.json && echo hay || echo nada)" nada
# 2) cargar un silo nuevo y después redesplegar dos veces (carpeta del sitio borrada)
chk alta "$(curl -s -b $A "${J[@]}" -d '{"silo":{"lote":16,"kg":1000,"grano":"Soja","map":[600,500],"t":1,"ang":0}}' $B/api.php?action=saveSilo)" '"ok":true'
stop; deploy; start; stop; deploy; start
chk datos-tras-despliegue "$(curl -s -b $A $B/api.php?action=state)" 'VJ01001'
chk silo-nuevo-tras-despliegue "$(curl -s -b $A $B/api.php?action=state)" '"grano":"Soja"'
chk foto-tras-despliegue "$(curl -s -b $A "$B/api.php?action=file&p=VJ01001-0123abcd.jpg")" foto
chk respaldo-diario "$(ls $DAT/backups/ 2>/dev/null)" 'data-'
chk datos-no-accesibles "$(curl -s -o /dev/null -w '%{http_code}' $B/data.json)" 404
# 3) despliegue «atómico»: cada versión en una carpeta nueva, public_html es un enlace y la anterior se borra
REL=1
rdeploy(){ REL=$((REL+1)); local R=$T/acopia.app/releases/$REL; mkdir -p "$R/public_html"; cp -r "$ROOT/public_html/." "$R/public_html/"; rm -rf "$WEB"; ln -sfn "$R/public_html" "$WEB"; [ -n "${PREV:-}" ] && rm -rf "$PREV"; PREV=$R; }
stop; rdeploy; start
chk alta-2 "$(curl -s -b $A "${J[@]}" -d '{"silo":{"lote":16,"kg":2000,"grano":"Maíz","map":[610,510],"t":1,"ang":0}}' $B/api.php?action=saveSilo)" '"ok":true'
stop; rdeploy; start; stop; rdeploy; start
chk datos-tras-version-nueva "$(curl -s -b $A $B/api.php?action=state)" '"grano":"Maíz"'
chk datos-tras-version-nueva-2 "$(curl -s -b $A $B/api.php?action=state)" 'VJ01001'
chk datos-en-carpeta-personal "$(curl -s -b $A $B/api.php?action=health)" '"fueraDeLaWeb":true'
stop; rm -rf "$T"
echo "despliegue: $pass OK, $fail fallas"; [ $fail -eq 0 ]
