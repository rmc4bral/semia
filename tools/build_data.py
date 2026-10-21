import json,subprocess,hashlib
# Regenera public_html/data.seed.json y src/seed.json desde la geometría. ¡Pisa los silos cargados!
USER,PASS="rodma","rmaldonado"
g=json.load(open("tools/geometry.json"))
h=subprocess.check_output(["php","-r",f"echo password_hash('{PASS}', PASSWORD_DEFAULT);"]).decode()
base={"version":1,"updatedAt":None,
 "estancia":{"nombre":"Rincón de Baguales","sigla":"RB"},
 "lots":g["lots"],"outline":g["outline"],"decor":g["decor"],"anchors":g["anchors"],"georef":g["georef"],
 "silos":[]}
srv=dict(base); srv["users"]=[{"user":USER,"nombre":"R. Maldonado","rol":"admin","hash":h}]
json.dump(srv,open("public_html/data.seed.json","w"),ensure_ascii=False,indent=1)
seed=dict(base); seed["users"]=[{"user":USER,"nombre":"R. Maldonado","rol":"admin","sha":hashlib.sha256(f"semia|{USER}|{PASS}".encode()).hexdigest()}]
json.dump(seed,open("src/seed.json","w"),ensure_ascii=False)
print("data ok")
