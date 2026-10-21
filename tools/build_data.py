import json,subprocess,hashlib
# Regenera public_html/data.seed.json y src/seed.json desde la geometría. ¡Pisa los silos cargados!
USER,PASS="rodma","rmaldonado"
g=json.load(open("tools/geometry.json"))
h=subprocess.check_output(["php","-r",f"echo password_hash('{PASS}', PASSWORD_DEFAULT);"]).decode()
# puntos de control iniciales: las 4 esquinas exteriores, como lote + vértice
import math
SECT=['E','NE','N','NO','O','SO','S','SE']
def corner(lot,vi):
    cx=sum(p[0] for p in lot["poly"])/len(lot["poly"]); cy=sum(p[1] for p in lot["poly"])/len(lot["poly"])
    x,y=lot["poly"][vi]; return SECT[round(math.atan2(-(y-cy),x-cx)/(math.pi/4))%8]
georef={"points":[]}
for a in [g["outline"][0],g["outline"][2],g["outline"][3],g["outline"][4]]:
    for l in g["lots"]:
        vi=next((i for i,q in enumerate(l["poly"]) if abs(q[0]-a[0])<.6 and abs(q[1]-a[1])<.6),None)
        if vi is not None:
            georef["points"].append({"key":f"L{l['num']}-{vi}","lote":l["num"],"vi":vi,"label":f"Lote {l['num']} · {corner(l,vi)}","map":l["poly"][vi],"lat":None,"lng":None,"acc":None,"at":None}); break
assert len(georef["points"])==4
base={"version":1,"updatedAt":None,
 "estancia":{"nombre":"Rincón de Baguales","sigla":"RB"},
 "lots":g["lots"],"outline":g["outline"],"decor":g["decor"],"georef":georef,
 "silos":[]}
srv=dict(base); srv["users"]=[{"user":USER,"nombre":"R. Maldonado","rol":"admin","hash":h}]
json.dump(srv,open("public_html/data.seed.json","w"),ensure_ascii=False,indent=1)
seed=dict(base); seed["users"]=[{"user":USER,"nombre":"R. Maldonado","rol":"admin","sha":hashlib.sha256(f"semia|{USER}|{PASS}".encode()).hexdigest()}]
json.dump(seed,open("src/seed.json","w"),ensure_ascii=False)
print("data ok")
