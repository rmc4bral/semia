"""Prueba de punta a punta sin capturas: python3 tests/e2e.py <url_servidor> <carpeta_servidor>"""
import json, sys, shutil, pathlib, numpy as np
from playwright.sync_api import sync_playwright

URL = sys.argv[1]; SRV = pathlib.Path(sys.argv[2]); ROOT = pathlib.Path(__file__).resolve().parents[1]
shutil.copy(ROOT / 'public_html/data.seed.json', SRV / 'data.json')
for f in (SRV / 'uploads').glob('*.jpg'): f.unlink()
data = json.loads((ROOT / 'public_html/data.seed.json').read_text())
CORN = {'NO': (-35.9, -60.42), 'NE': (-35.9025, -60.33), 'SE': (-35.995, -60.333), 'SO': (-35.992, -60.425)}
src = [p['map'] for p in data['georef']['points']]; dst = [(CORN[p['key']][1], CORN[p['key']][0]) for p in data['georef']['points']]
A = []; b = []
for (x, y), (u, v) in zip(src, dst):
    A += [[x, y, 1, 0, 0, 0, -u*x, -u*y], [0, 0, 0, x, y, 1, -v*x, -v*y]]; b += [u, v]
h = np.linalg.solve(np.array(A), np.array(b)); H = np.append(h, 1).reshape(3, 3)
def latlng(p):
    w = H[2] @ [p[0], p[1], 1]; return ((H[1] @ [p[0], p[1], 1]) / w, (H[0] @ [p[0], p[1], 1]) / w)
lot16 = next(l for l in data['lots'] if l['num'] == 16)

ok = 0; errs = []
def check(c, m):
    global ok
    if c: ok += 1
    else: errs.append(m); print('FALLA:', m)

IGNORE = ('arcgisonline', 'fonts.g', 'ERR_INTERNET_DISCONNECTED', 'ERR_NAME_NOT_RESOLVED', 'Failed to load resource', 'ERR_TUNNEL', 'ERR_CONNECTION')
def watch(page, bucket):
    page.on('console', lambda m: m.type == 'error' and not any(s in m.text for s in IGNORE) and bucket.append(m.text))
    page.on('pageerror', lambda e: bucket.append(str(e)))

def label_xy(page, num):
    return page.evaluate("""n => { const t=[...document.querySelectorAll('.lot-num')].find(e=>e.textContent==String(n)); const r=t.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]; }""", num)

def layout_checks(page, tag):
    r = page.evaluate("""() => { const q=s=>document.querySelector(s)?.getBoundingClientRect();
      return {sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, card: q('.map-card'), nav: q('.nav'), main: q('.main'), dash: q('.dash'),
        selects: document.querySelectorAll('select, input[type=date], input[type=number]').length,
        loose: [...document.querySelectorAll('.input')].filter(e=>!e.closest('.field')).length }; }""")
    check(r['sw'] <= r['iw'], f'{tag}: sin desborde horizontal')
    check(r['selects'] == 0, f'{tag}: sin controles nativos')
    check(r['loose'] == 0, f'{tag}: todo campo con etiqueta')
    if r['card']:
        check(r['card']['bottom'] <= r['main']['bottom'] + 0.5, f'{tag}: el mapa no pisa la barra')
        check(r['main']['bottom'] - r['card']['bottom'] < 20, f'{tag}: el mapa ocupa todo el alto ({r["main"]["bottom"] - r["card"]["bottom"]:.0f}px libres)')

with sync_playwright() as p:
    br = p.chromium.launch()
    for vp, tag in [((390, 844), 'móvil'), ((1440, 900), 'escritorio')]:
        shutil.copy(ROOT / 'public_html/data.seed.json', SRV / 'data.json')
        bucket = []
        ctx = br.new_context(viewport={'width': vp[0], 'height': vp[1]}, permissions=['geolocation'], geolocation={'latitude': -35.95, 'longitude': -60.38}, has_touch=vp[0] < 500)
        page = ctx.new_page(); watch(page, bucket)
        page.goto(URL); page.wait_for_selector('.login-card')
        page.fill('input[autocomplete=username]', 'rodma'); page.fill('input[type=password]', 'mal')
        page.click('button[type=submit]'); page.wait_for_selector('.form-err')
        check('incorrectos' in page.inner_text('.form-err'), f'{tag}: login rechaza clave errónea')
        page.fill('input[type=password]', 'rmaldonado'); page.click('button[type=submit]')
        page.wait_for_selector('.map3d-svg'); page.wait_for_timeout(400)
        check(page.locator('g.lot').count() == 25, f'{tag}: 25 lotes dibujados')
        check(page.locator('.river').count() >= 4, f'{tag}: hidrografía dibujada')
        layout_checks(page, tag)
        # elevar lote con el cursor (escritorio) o toque (móvil)
        x, y = label_xy(page, 16)
        if vp[0] > 500:
            page.mouse.move(x, y + 8); page.wait_for_timeout(500)
            check(page.locator('.lot-wall').count() > 0, f'{tag}: el lote se eleva al pasar el cursor')
            page.mouse.click(x, y + 8)
        else:
            page.touchscreen.tap(x, y + 8)
        page.wait_for_selector('.lot-gear'); page.wait_for_timeout(300)
        check(page.locator('.lot-wall').count() > 0, f'{tag}: lote seleccionado elevado')
        page.click('.lot-gear'); page.wait_for_selector('.modal h2')
        check(page.inner_text('.modal h2') == 'Lote 16', f'{tag}: tuerca abre configuración del lote')
        page.click('.modal-head button')
        # georreferenciar vía API y ubicar GPS dentro del lote 16
        r = page.request.post(URL + '/api.php?action=saveGeoref', data=json.dumps({'georef': {'points': [{'key': k, 'lat': v[0], 'lng': v[1]} for k, v in CORN.items() if k in ('NO','NE','SE','SO')]}}), headers={'Content-Type': 'application/json'})
        check(r.ok, f'{tag}: georreferencia guardada')
        la, lo = latlng(lot16['label']); ctx.set_geolocation({'latitude': la, 'longitude': lo})
        page.reload(); page.wait_for_selector('.map3d-svg'); page.wait_for_timeout(1200)
        check(page.locator('.gps-dot').count() == 1, f'{tag}: posición en vivo sobre el plano')
        for i, (dx, kg) in enumerate([(0, '180000'), (0.002, '150.000')]):
            ctx.set_geolocation({'latitude': la + 0.001, 'longitude': lo + dx}); page.wait_for_timeout(900)
            page.click('.fab'); page.wait_for_selector('.modal .input-static')
            sid = page.inner_text('.modal .input-static')
            check(sid == f'RB16{i+1:03d}', f'{tag}: ID automático {sid}')
            page.fill('.modal input[inputmode=decimal]', kg)
            page.locator('.modal .select').nth(1).click(); page.click('.select-opt:has-text("Soja")')
            page.fill('.modal textarea', 'Bolsa de prueba')
            page.set_input_files('.modal input[type=file]:not([capture])', files=[{'name': 'f.png', 'mimeType': 'image/png', 'buffer': bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5fa5ec50000000049454e44ae426082')}])
            page.wait_for_selector('.photo-prev img')
            page.click('.modal-foot .btn-primary'); page.wait_for_selector('.modal', state='detached')
            page.wait_for_selector(f'[data-silo="{sid}"]')
        st = page.request.get(URL + '/api.php?action=state').json()['state']
        check(len(st['silos']) == 2 and all(s['lote'] == 16 and s['foto'] for s in st['silos']), f'{tag}: 2 silos con foto en lote 16')
        check(st['silos'][1]['kg'] == 150000, f'{tag}: kg con separador de miles')
        check(page.locator('.track').count() == 1, f'{tag}: recorrido por el borde dibujado')
        check('RB16002' in page.inner_text('.silo-pop') and '150.000' in page.inner_text('.silo-pop'), f'{tag}: el punto muestra ID y KG')
        # mover silo por el contorno
        page.click('.silo-pop button:has-text("Mover")'); page.wait_for_selector('.map-banner')
        before = st['silos'][1]['map']
        box = page.evaluate("""() => { const r=document.querySelector('[data-silo="RB16002"] .silo-hit').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]; }""")
        page.mouse.move(*box); page.mouse.down(); page.mouse.move(box[0] + 40, box[1] + 30, steps=8); page.mouse.up()
        page.click('.map-banner .btn-primary'); page.wait_for_timeout(500)
        after = next(s for s in page.request.get(URL + '/api.php?action=state').json()['state']['silos'] if s['id'] == 'RB16002')['map']
        poly = lot16['poly']
        def onborder(q):
            best = 9e9
            for a, c in zip(poly, poly[1:] + poly[:1]):
                d = np.array(c) - a; k = max(0, min(1, np.dot(np.array(q) - a, d) / np.dot(d, d))); best = min(best, np.linalg.norm(np.array(q) - (np.array(a) + d * k)))
            return best
        check(after != before and onborder(after) < 0.05, f'{tag}: silo desplazado sobre el borde del lote ({onborder(after):.3f})')
        # satélite
        page.click('.seg button:has-text("Satélite")'); page.wait_for_selector('.leaflet-container'); page.wait_for_timeout(500)
        check(page.locator('path.sat-lot').count() == 25, f'{tag}: lotes superpuestos en satélite')
        check(page.locator('.sat-silo').count() == 2, f'{tag}: silos en satélite')
        page.click('.seg button:has-text("Plano 3D")')
        # pantallas
        page.click('.nav button:has-text("Silos")'); page.wait_for_selector('.silo-row')
        check(page.locator('.list-card .silo-row').count() == 2, f'{tag}: listado de silos'); layout_checks(page, tag + ' silos')
        page.click('.nav button:has-text("Lotes")'); check(page.locator('.lot-card').count() == 25, f'{tag}: listado de lotes'); layout_checks(page, tag + ' lotes')
        page.click('.nav button:has-text("Ajustes")'); check(page.locator('.geo-pt').count() == 4, f'{tag}: 4 puntos de georreferencia')
        check('Activa' in page.inner_text('.badge'), f'{tag}: georreferencia activa'); layout_checks(page, tag + ' ajustes')
        # temas: mismas superficies de la paleta
        for th in ('dark', 'light'):
            page.evaluate(f"document.documentElement.dataset.theme='{th}'")
            cols = page.evaluate("""() => { const g=s=>getComputedStyle(document.querySelector(s)).backgroundColor; return [g('body'), g('.topbar'), g('.nav'), g('.card')]; }""")
            check(cols[0] == cols[1] == cols[2], f'{tag} {th}: barra, menú y fondo con el mismo tono {cols}')
        page.click('.nav button:has-text("Mapa")'); page.wait_for_selector('.map3d-svg'); layout_checks(page, tag + ' mapa final')
        check(not bucket, f'{tag}: sin errores de consola {bucket[:3]}')
        ctx.close()

    # Modo local (file://): sin servidor, colocar silo tocando el mapa
    bucket = []
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, has_touch=True)
    page = ctx.new_page(); watch(page, bucket)
    page.goto((ROOT / 'public_html/index.html').as_uri()); page.wait_for_selector('.login-card')
    check('modo local' in page.inner_text('.login-card'), 'local: detecta modo local')
    page.fill('input[autocomplete=username]', 'rodma'); page.fill('input[type=password]', 'rmaldonado'); page.click('button[type=submit]')
    page.wait_for_selector('.map3d-svg'); page.wait_for_timeout(300)
    page.click('.fab'); page.wait_for_selector('.map-banner')
    x, y = label_xy(page, 7); page.touchscreen.tap(x, y)
    page.wait_for_selector('.modal .input-static')
    check(page.inner_text('.modal .input-static') == 'RB07001', 'local: ID por toque en lote 7')
    page.fill('.modal input[inputmode=decimal]', '200000'); page.click('.modal-foot .btn-primary'); page.wait_for_selector('[data-silo="RB07001"]')
    page.reload(); page.wait_for_selector('[data-silo="RB07001"]')
    check(True, 'local: persiste tras recargar')
    check(not bucket, f'local: sin errores de consola {bucket[:3]}')
    br.close()
print(f'e2e: {ok} OK, {len(errs)} fallas'); sys.exit(1 if errs else 0)
