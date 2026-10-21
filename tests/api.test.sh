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
IMG=/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDs6KKK8I7T/9k=  # JPEG 8x8 fijo (sin dependencias)
CORN='[[-35.9,-60.42],[-35.9025,-60.33],[-35.995,-60.333],[-35.992,-60.425]]'
U=$(curl -s -b $A "${J[@]}" -d "{\"id\":\"RB16001\",\"data\":\"data:image/jpeg;base64,$IMG\"}" $B/api.php?action=upload); chk foto "$U" 'uploads/RB16001-'
chk foto-falsa "$(curl -s -b $A "${J[@]}" -d '{"id":"RB1","data":"data:image/jpeg;base64,PD9waHAgZWNobyAxOw=="}' $B/api.php?action=upload)" 'no permitido'
chk lote "$(curl -s -b $A "${J[@]}" -d '{"lot":{"_origNum":16,"num":16,"ha":460,"nombre":"Molino","subs":[]}}' $B/api.php?action=saveLot)" '"nombre":"Molino"'
chk lote-con-silos "$(curl -s -b $A "${J[@]}" -d '{"lot":{"_origNum":16,"num":30,"ha":460}}' $B/api.php?action=saveLot)" 'tiene silos'
GEO='{"georef":{"points":[{"lote":21,"vi":0,"lat":-35.9,"lng":-60.42},{"lote":24,"vi":2,"lat":-35.9025,"lng":-60.33},{"lote":6,"vi":2,"lat":-35.995,"lng":-60.333},{"lote":1,"vi":4,"lat":-35.992,"lng":-60.425},{"lote":16,"vi":0,"lat":-35.95,"lng":-60.36}]}}'
chk georef "$(curl -s -b $A "${J[@]}" -d "$GEO" $B/api.php?action=saveGeoref)" '"key":"L16-0"'
chk georef-pocos "$(curl -s -b $A "${J[@]}" -d '{"georef":{"points":[{"lote":1,"vi":0}]}}' $B/api.php?action=saveGeoref)" 'entre 4 y 12'
chk georef-esquina-mala "$(curl -s -b $A "${J[@]}" -d '{"georef":{"points":[{"lote":1,"vi":99},{"lote":2,"vi":0},{"lote":3,"vi":0},{"lote":4,"vi":0}]}}' $B/api.php?action=saveGeoref)" 'inválida'
SH='{"change":{"lots":[{"num":16,"poly":[[548,407],[740,410],[740,610.4],[545,599.9]],"label":[640,505],"subs":[]}],"outline":null,"silos":[{"id":"RB16001","map":[548,450],"t":40,"ang":1.5}]}}'
R=$(curl -s -b $A "${J[@]}" -d "$SH" $B/api.php?action=saveShapes)
chk forma "$R" '"poly0":\[\[551.7,407\]'
chk forma-silo "$R" '"map":\[548,450\]'
chk forma-invalida "$(curl -s -b $A "${J[@]}" -d '{"change":{"lots":[{"num":16,"poly":[[1,1]]}]}}' $B/api.php?action=saveShapes)" 'inválida'
chk usuario "$(curl -s -b $A "${J[@]}" -d '{"u":{"user":"peon","nombre":"Peón","pass":"campo123","rol":"operador"}}' $B/api.php?action=saveUser)" '"user":"peon"'
curl -s -c $O "${J[@]}" -d '{"user":"peon","pass":"campo123"}' $B/api.php?action=login >/dev/null
chk op-no-borra "$(curl -s -b $O "${J[@]}" -d '{"id":"RB16001"}' $B/api.php?action=deleteSilo)" 'Solo el administrador'
chk op-no-mueve "$(curl -s -b $O "${J[@]}" -d '{"prevId":"RB16001","silo":{"id":"RB16001","lote":16,"kg":1,"map":[1,1]}}' $B/api.php?action=saveSilo)" 'permiso'
chk op-alta "$(curl -s -b $O "${J[@]}" -d '{"silo":{"lote":3,"kg":5000,"map":[300,800],"t":1,"ang":0}}' $B/api.php?action=saveSilo)" '"creadoPor":"peon"'
chk op-no-georef "$(curl -s -b $O "${J[@]}" -d "$GEO" $B/api.php?action=saveGeoref)" 'Solo el administrador'
chk op-no-mapa "$(curl -s -b $O "${J[@]}" -d "{\"map\":{\"corners\":$CORN},\"data\":\"data:image/jpeg;base64,$IMG\"}" $B/api.php?action=uploadMap)" 'Solo el administrador'
chk op-no-forma "$(curl -s -b $O "${J[@]}" -d "$SH" $B/api.php?action=saveShapes)" 'Solo el administrador'
M=$(curl -s -b $A "${J[@]}" -d "{\"map\":{\"nombre\":\"Vuelo octubre\",\"fecha\":\"2026-10-20\",\"corners\":$CORN,\"crs\":\"UTM 21S\"},\"data\":\"data:image/jpeg;base64,$IMG\"}" $B/api.php?action=uploadMap)
chk mapa-subir "$M" '"src":"uploads/maps/m'
MID=$(echo "$M" | grep -o '"id":"m[a-z0-9]*"' | head -1 | cut -d'"' -f4)
chk mapa-archivo "$(curl -s -o /dev/null -w '%{http_code}' $B/$(echo "$M" | grep -o 'uploads/maps/[a-z0-9]*\.jpg' | head -1))" 200
chk mapa-editar "$(curl -s -b $A "${J[@]}" -d "{\"map\":{\"id\":\"$MID\",\"nombre\":\"Vuelo 2\",\"fecha\":\"2026-10-21\",\"corners\":[[-35.8,-60.4],[-35.8,-60.3],[-35.9,-60.3],[-35.9,-60.4]]}}" $B/api.php?action=saveMap)" '"nombre":"Vuelo 2"'
chk mapa-esquinas-malas "$(curl -s -b $A "${J[@]}" -d "{\"map\":{\"id\":\"$MID\",\"corners\":[[1,2]]}}" $B/api.php?action=saveMap)" '4 esquinas'
chk mapa-no-imagen "$(curl -s -b $A "${J[@]}" -d "{\"map\":{\"corners\":$CORN},\"data\":\"data:image/png;base64,PD9waHAgZWNobyAxOw==\"}" $B/api.php?action=uploadMap)" 'no permitido'
chk borrar "$(curl -s -b $A "${J[@]}" -d '{"id":"RB05001"}' $B/api.php?action=deleteSilo)" '"ok":true'
chk mapa-borrar "$(curl -s -b $A "${J[@]}" -d "{\"id\":\"$MID\"}" $B/api.php?action=deleteMap)" '"maps":\[\]'
code=$(curl -s -o /dev/null -w '%{http_code}' $B/api.php?action=nada); chk accion-desconocida "$code" 404
echo "api: $pass OK, $fail fallas"; [ $fail -eq 0 ]
