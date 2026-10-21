#!/bin/bash
# Prueba de api.php contra un servidor PHP local: tests/api.test.sh http://127.0.0.1:8765
B=${1:-http://127.0.0.1:8765}; J=(-H 'Content-Type: application/json'); A=/tmp/semia-a.txt; O=/tmp/semia-o.txt; rm -f $A $O
pass=0; fail=0
chk(){ if echo "$2" | grep -q "$3"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FALLA: $1 → $2"; fi; }
chk ping "$(curl -s $B/api.php?action=ping)" '"app":"semia"'
chk sin-sesion "$(curl -s $B/api.php?action=state)" 'Sesión expirada'
chk login-mal "$(curl -s -c $A "${J[@]}" -d '{"user":"rodma","pass":"x"}' $B/api.php?action=login)" 'incorrectos'
chk login-ok "$(curl -s -c $A -b $A "${J[@]}" -d '{"user":"rodma","pass":"rmaldonado"}' $B/api.php?action=login)" '"rol":"admin"'
S=$(curl -s -b $A $B/api.php?action=state); if echo "$S" | grep -q '"hash"'; then fail=$((fail+1)); echo 'FALLA: expone hash'; else pass=$((pass+1)); fi
chk csrf "$(curl -s -b $A -d 'x=1' $B/api.php?action=saveSilo)" 'no válida'
SILO='{"silo":{"id":"RB16001","lote":16,"kg":180000,"grano":"Soja","obs":"ok","map":[600,500],"t":10,"ang":0.1,"origen":"gps","gps":{"lat":-35.9,"lng":-60.4,"acc":4}}}'
chk alta "$(curl -s -b $A "${J[@]}" -d "$SILO" $B/api.php?action=saveSilo)" '"id":"RB16001"'
chk id-dup→siguiente "$(curl -s -b $A "${J[@]}" -d "$SILO" $B/api.php?action=saveSilo)" '"id":"RB16002"'
chk lote-1-digito "$(curl -s -b $A "${J[@]}" -d '{"silo":{"id":"x","lote":5,"kg":1,"map":[1,1],"t":1,"ang":0}}' $B/api.php?action=saveSilo)" '"id":"RB05001"'
chk kg-invalido "$(curl -s -b $A "${J[@]}" -d '{"silo":{"lote":5,"kg":"abc","map":[1,1]}}' $B/api.php?action=saveSilo)" 'Kg inválido'
chk mover "$(curl -s -b $A "${J[@]}" -d '{"prevId":"RB16002","silo":{"id":"RB16002","lote":16,"kg":180000,"map":[620,520],"t":30,"ang":0.2}}' $B/api.php?action=saveSilo)" '620'
IMG=$(python3 -c "import base64,io;from PIL import Image;b=io.BytesIO();Image.new('RGB',(8,8),(200,180,120)).save(b,'JPEG');print(base64.b64encode(b.getvalue()).decode())")
U=$(curl -s -b $A "${J[@]}" -d "{\"id\":\"RB16001\",\"data\":\"data:image/jpeg;base64,$IMG\"}" $B/api.php?action=upload); chk foto "$U" 'uploads/RB16001-'
chk foto-falsa "$(curl -s -b $A "${J[@]}" -d '{"id":"RB1","data":"data:image/jpeg;base64,PD9waHAgZWNobyAxOw=="}' $B/api.php?action=upload)" 'no permitido'
chk lote "$(curl -s -b $A "${J[@]}" -d '{"lot":{"_origNum":16,"num":16,"ha":460,"nombre":"Molino","subs":[]}}' $B/api.php?action=saveLot)" '"nombre":"Molino"'
chk lote-con-silos "$(curl -s -b $A "${J[@]}" -d '{"lot":{"_origNum":16,"num":30,"ha":460}}' $B/api.php?action=saveLot)" 'tiene silos'
GEO='{"georef":{"points":[{"key":"NO","lat":-35.9,"lng":-60.42},{"key":"NE","lat":-35.9025,"lng":-60.33},{"key":"SE","lat":-35.995,"lng":-60.333},{"key":"SO","lat":-35.992,"lng":-60.425}]}}'
chk georef "$(curl -s -b $A "${J[@]}" -d "$GEO" $B/api.php?action=saveGeoref)" '"lat":-35.9025'
chk usuario "$(curl -s -b $A "${J[@]}" -d '{"u":{"user":"peon","nombre":"Peón","pass":"campo123","rol":"operador"}}' $B/api.php?action=saveUser)" '"user":"peon"'
curl -s -c $O "${J[@]}" -d '{"user":"peon","pass":"campo123"}' $B/api.php?action=login >/dev/null
chk op-no-borra "$(curl -s -b $O "${J[@]}" -d '{"id":"RB16001"}' $B/api.php?action=deleteSilo)" 'Solo el administrador'
chk op-no-mueve "$(curl -s -b $O "${J[@]}" -d '{"prevId":"RB16001","silo":{"id":"RB16001","lote":16,"kg":1,"map":[1,1]}}' $B/api.php?action=saveSilo)" 'permiso'
chk op-alta "$(curl -s -b $O "${J[@]}" -d '{"silo":{"lote":3,"kg":5000,"map":[300,800],"t":1,"ang":0}}' $B/api.php?action=saveSilo)" '"creadoPor":"peon"'
chk op-no-georef "$(curl -s -b $O "${J[@]}" -d "$GEO" $B/api.php?action=saveGeoref)" 'Solo el administrador'
chk borrar "$(curl -s -b $A "${J[@]}" -d '{"id":"RB05001"}' $B/api.php?action=deleteSilo)" '"ok":true'
code=$(curl -s -o /dev/null -w '%{http_code}' $B/api.php?action=nada); chk accion-desconocida "$code" 404
echo "api: $pass OK, $fail fallas"; [ $fail -eq 0 ]
