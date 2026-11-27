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
chk email-invalido "$(curl -s -b $A "${J[@]}" -d '{"u":{"user":"peon","nombre":"Peón","email":"no-es-mail","rol":"operador"}}' $B/api.php?action=saveUser)" 'email no es válido'
chk email-celular "$(curl -s -b $A "${J[@]}" -d '{"u":{"user":"peon","nombre":"Peón","email":"peon@campo.com","tel":"+54 9 2346 555123","rol":"operador"}}' $B/api.php?action=saveUser)" '"tel":"+54 9 2346 555123"'
chk perfil-tema "$(curl -s -b $A "${J[@]}" -d '{"u":{"user":"rodma","nombre":"Rodrigo","rol":"admin","tema":"dark"}}' $B/api.php?action=saveUser)" '"tema":"dark"'
# «Mantener sesión iniciada»: cookie persistente (con vencimiento) solo si se pide
H=$(curl -s -D - -o /dev/null "${J[@]}" -d '{"user":"peon","pass":"campo123","recordar":true}' $B/api.php?action=login | grep -i '^set-cookie')
chk recordar-persistente "$H" '[Ee]xpires='
H=$(curl -s -D - -o /dev/null "${J[@]}" -d '{"user":"peon","pass":"campo123"}' $B/api.php?action=login | grep -i '^set-cookie' | tail -1)
if echo "$H" | grep -qi 'expires='; then fail=$((fail+1)); echo "FALLA: sin recordar no debe persistir → $H"; else pass=$((pass+1)); fi
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
MP=$(echo "$M" | grep -o 'uploads/maps/[a-z0-9]*\.jpg' | head -1 | cut -c9-)
chk mapa-archivo "$(curl -s -b $A -o /dev/null -w '%{http_code}' "$B/api.php?action=file&p=$MP")" 200
chk mapa-sin-sesion "$(curl -s -o /dev/null -w '%{http_code}' "$B/api.php?action=file&p=$MP")" 401
chk archivo-ruta-mala "$(curl -s -b $A -o /dev/null -w '%{http_code}' "$B/api.php?action=file&p=../data.json")" 404
chk datos-fuera-web "$(curl -s -b $A $B/api.php?action=health)" '"fueraDeLaWeb":true'
chk mapa-editar "$(curl -s -b $A "${J[@]}" -d "{\"map\":{\"id\":\"$MID\",\"nombre\":\"Vuelo 2\",\"fecha\":\"2026-10-21\",\"corners\":[[-35.8,-60.4],[-35.8,-60.3],[-35.9,-60.3],[-35.9,-60.4]]}}" $B/api.php?action=saveMap)" '"nombre":"Vuelo 2"'
chk mapa-esquinas-malas "$(curl -s -b $A "${J[@]}" -d "{\"map\":{\"id\":\"$MID\",\"corners\":[[1,2]]}}" $B/api.php?action=saveMap)" '4 esquinas'
chk mapa-no-imagen "$(curl -s -b $A "${J[@]}" -d "{\"map\":{\"corners\":$CORN},\"data\":\"data:image/png;base64,PD9waHAgZWNobyAxOw==\"}" $B/api.php?action=uploadMap)" 'no permitido'
# Silobolsa por GPS: cabecera (A) y cola (B)
GPS2='{"silo":{"lote":16,"kg":200000,"grano":"Maíz","map":[600,500],"map2":[640,505],"latlng":[-35.9,-60.4],"latlng2":[-35.9004,-60.4],"largo":44.5,"t":null,"ang":0.12,"origen":"gps","gps":{"lat":-35.9,"lng":-60.4,"acc":3,"n":12},"gps2":{"lat":-35.9004,"lng":-60.4,"acc":4,"n":9}}}'
R=$(curl -s -b $A "${J[@]}" -d "$GPS2" $B/api.php?action=saveSilo)
chk gps-ab "$R" '"map2":\[640,505\]'
chk gps-largo "$R" '"largo":44.5'
chk gps-b-fix "$R" '"gps2":{"lat":-35.9004'
chk gps-map2-malo "$(curl -s -b $A "${J[@]}" -d '{"silo":{"lote":16,"kg":1,"map":[1,1],"map2":[1]}}' $B/api.php?action=saveSilo)" 'fin de la bolsa'
OPS=$(curl -s -b $O "${J[@]}" -d '{"silo":{"lote":3,"kg":7000,"map":[300,800],"map2":[320,800],"largo":40}}' $B/api.php?action=saveSilo)
OPID=$(echo "$OPS" | grep -o '"id":"RB03[0-9]*","lote":3,"lot":"3","kg":7000' | cut -d'"' -f4)
chk op-no-mueve-b "$(curl -s -b $O "${J[@]}" -d "{\"prevId\":\"$OPID\",\"silo\":{\"id\":\"$OPID\",\"lote\":3,\"kg\":7000,\"map\":[300,800],\"map2\":[330,810]}}" $B/api.php?action=saveSilo)" 'Solo el administrador puede mover'
chk op-edita-kg "$(curl -s -b $O "${J[@]}" -d "{\"prevId\":\"$OPID\",\"silo\":{\"id\":\"$OPID\",\"lote\":3,\"kg\":7500,\"map\":[300,800],\"map2\":[320,800],\"largo\":40}}" $B/api.php?action=saveSilo)" '"kg":7500'
# Lotes desde KML
KML='{"change":{"lots":[{"num":3,"ha":10,"nombre":"Bajo","poly":[[10,10],[100,10],[100,100],[10,100]],"label":[55,55]},{"num":16,"ha":12,"poly":[[110,10],[200,10],[200,100],[110,100]],"label":[155,55]}],"outline":[[10,10],[200,10],[200,100],[10,100]],"georef":{"lat0":-35.9,"lng0":-60.4,"s":0.2,"ox":100,"oy":50,"kml":{"archivo":"campo.kml"}},"silos":[{"id":"RB16001","lote":16,"map":[150,50],"map2":null,"t":null,"ang":null,"latlng":[-35.9,-60.39]}],"lines":[{"name":"Camino","pts":[[0,0],[10,10]]}]}}'
chk op-no-kml "$(curl -s -b $O "${J[@]}" -d "$KML" $B/api.php?action=importKml)" 'Solo el administrador'
chk kml-dup "$(curl -s -b $A "${J[@]}" -d '{"change":{"lots":[{"num":3,"poly":[[0,0],[1,0],[1,1]]},{"num":3,"poly":[[0,0],[1,0],[1,1]]}],"outline":[[0,0],[1,0],[1,1]],"georef":{"lat0":-35,"lng0":-60,"s":1,"ox":0,"oy":0}}}' $B/api.php?action=importKml)" 'repetido'
chk kml-georef-mala "$(curl -s -b $A "${J[@]}" -d '{"change":{"lots":[{"num":3,"poly":[[0,0],[1,0],[1,1]]}],"outline":[[0,0],[1,0],[1,1]],"georef":{"lat0":-135,"lng0":-60,"s":1,"ox":0,"oy":0}}}' $B/api.php?action=importKml)" 'inválida'
R=$(curl -s -b $A "${J[@]}" -d "$KML" $B/api.php?action=importKml)
chk kml-modo "$R" '"mode":"kml"'
chk kml-archivo "$R" '"archivo":"campo.kml"'
chk kml-silo "$R" '"id":"RB16001","lote":16,[^}]*"map":\[150,50\]'
chk kml-lineas "$R" '"lines":\[{"name":"Camino"'
chk kml-sin-poly0 "$(echo "$R" | grep -c poly0)" '^0$'
chk kml-silo-huerfano "$R" "\"id\":\"RB05001\",\"lote\":3"
# Dos estancias con el mismo número de lote y sigla propia
EST='{"change":{"lots":[{"num":31,"ha":10,"kml":"kaa","poly":[[10,10],[100,10],[100,100],[10,100]]},{"num":31,"ha":12,"kml":"kbb","poly":[[110,10],[200,10],[200,100],[110,100]]},{"num":"Casco","ha":2,"kml":"kbb","poly":[[210,10],[220,10],[220,20]]}],"outline":[[10,10],[220,10],[220,100],[10,100]],"georef":{"lat0":-35.9,"lng0":-60.4,"s":0.2,"ox":100,"oy":50,"kmls":[{"id":"kaa","archivo":"Baguales.kmz","nombre":"Rincón de Baguales","sigla":"RB","lotes":[31]},{"id":"kbb","archivo":"Los Gatos.kml","nombre":"Los Gatos","sigla":"LG","lotes":[31,"Casco"]}]}}}'
R=$(curl -s -b $A "${J[@]}" -d "$EST" $B/api.php?action=importKml)
chk est-ids "$R" '"id":"kbb:31","num":31'
chk est-sigla "$R" '"sigla":"LG"'
chk est-casco "$R" '"id":"kbb:Casco","num":"Casco"'
chk est-silo-LG "$(curl -s -b $A "${J[@]}" -d '{"silo":{"lot":"kbb:31","lote":31,"kg":1000,"map":[150,50]}}' $B/api.php?action=saveSilo)" '"id":"LG31001","lote":31,"lot":"kbb:31"'
chk est-silo-RB "$(curl -s -b $A "${J[@]}" -d '{"silo":{"lot":"kaa:31","lote":31,"kg":1000,"map":[50,50]}}' $B/api.php?action=saveSilo)" '"id":"RB31001","lote":31,"lot":"kaa:31"'
chk est-casco-sin-silos "$(curl -s -b $A "${J[@]}" -d '{"silo":{"lot":"kbb:Casco","lote":0,"kg":1,"map":[215,15]}}' $B/api.php?action=saveSilo)" 'sin silobolsas'
chk est-lote-dup "$(curl -s -b $A "${J[@]}" -d '{"lot":{"_origId":"kaa:31","num":31,"ha":10}}' $B/api.php?action=saveLot)" '"ok":true'
# humedad y prioridad de salida
chk humedad-prio "$(curl -s -b $A "${J[@]}" -d '{"silo":{"id":"","lote":31,"kg":1000,"grano":"Soja","hum":13.46,"prio":"alta","map":[10,10]}}' $B/api.php?action=saveSilo)" '"hum":13.5,"prio":"alta"'
chk humedad-invalida "$(curl -s -b $A "${J[@]}" -d '{"silo":{"id":"","lote":31,"grano":"Soja","hum":55,"map":[10,10]}}' $B/api.php?action=saveSilo)" 'Humedad inválida'
chk prio-marcar "$(curl -s -b $O "${J[@]}" -d '{"id":"RB16001","prio":"baja"}' $B/api.php?action=setPrio)" '"prio":"baja".*"prioPor":"peon"'
chk prio-quitar "$(curl -s -b $A "${J[@]}" -d '{"id":"RB16001","prio":"urgente"}' $B/api.php?action=setPrio)" '"id":"RB16001","lote":31,"lot":"kaa:31","kg":180000,"hum":null,"prio":null'
chk prio-sin-sesion "$(curl -s "${J[@]}" -d '{"id":"RB16001","prio":"alta"}' $B/api.php?action=setPrio)" 'Sesión expirada'
# formulario de contacto y demo de 10 días (público)
chk contacto-faltan "$(curl -s "${J[@]}" -d '{"nombre":"Ana"}' $B/api.php?action=contact)" 'Completá el apellido'
chk contacto-email "$(curl -s "${J[@]}" -d '{"nombre":"Ana","apellido":"G","email":"x","tel":"2346555000","empresa":"Agro"}' $B/api.php?action=contact)" 'email no es válido'
chk contacto-robot "$(curl -s "${J[@]}" -d '{"web":"spam","nombre":"x"}' $B/api.php?action=contact)" '"ok":true'
chk contacto-demo "$(curl -s "${J[@]}" -d '{"tipo":"demo","nombre":"Ana","apellido":"Gómez","email":"ana@agro.com","tel":"2346 555000","empresa":"Agro Gómez","fuente":"LinkedIn"}' $B/api.php?action=contact)" '"ok":true'
chk contactos-admin "$(curl -s -b $A $B/api.php?action=contacts)" '"tipo":"demo"'
chk contactos-sin-robot "$(curl -s -b $A $B/api.php?action=contacts | grep -c spam)" '^0$'
chk contactos-supervisor "$(curl -s -b $O $B/api.php?action=contacts)" 'Solo el administrador'
for i in 1 2 3 4; do curl -s -o /dev/null "${J[@]}" -d '{"nombre":"A","apellido":"B","email":"a@b.co","tel":"2346555000","empresa":"C"}' $B/api.php?action=contact; done
chk contacto-limite "$(curl -s "${J[@]}" -d '{"nombre":"A","apellido":"B","email":"a@b.co","tel":"2346555000","empresa":"C"}' $B/api.php?action=contact)" 'varias consultas'
# nombre y apellido por separado
chk apellido "$(curl -s -b $A "${J[@]}" -d '{"u":{"user":"peon","nombre":"Juan","apellido":"Pérez","rol":"operador"}}' $B/api.php?action=saveUser)" '"nombre":"Juan","apellido":"Pérez"'
chk borrar "$(curl -s -b $A "${J[@]}" -d '{"id":"RB05001"}' $B/api.php?action=deleteSilo)" '"ok":true'
chk mapa-borrar "$(curl -s -b $A "${J[@]}" -d "{\"id\":\"$MID\"}" $B/api.php?action=deleteMap)" '"maps":\[\]'
code=$(curl -s -o /dev/null -w '%{http_code}' $B/api.php?action=nada); chk accion-desconocida "$code" 404
echo "api: $pass OK, $fail fallas"; [ $fail -eq 0 ]
