"""Prueba de punta a punta sin capturas: python3 tests/e2e.py <url_servidor> <carpeta_servidor>"""
import json, sys, shutil, pathlib, numpy as np
from playwright.sync_api import sync_playwright

URL = sys.argv[1]; SRV = pathlib.Path(sys.argv[2]); ROOT = pathlib.Path(__file__).resolve().parents[1]
shutil.copy(ROOT / 'public_html/data.seed.json', SRV / 'data.json')
for f in (SRV / 'uploads').glob('*.jpg'): f.unlink()
data = json.loads((ROOT / 'public_html/data.seed.json').read_text())
CORN = {'NO': (-35.9, -60.42), 'NE': (-35.9025, -60.33), 'SE': (-35.995, -60.333), 'SO': (-35.992, -60.425)}
CK = ['NO', 'NE', 'SE', 'SO']
src = [p['map'] for p in data['georef']['points']]; dst = [(CORN[k][1], CORN[k][0]) for k in CK]
A = []; b = []
for (x, y), (u, v) in zip(src, dst):
    A += [[x, y, 1, 0, 0, 0, -u*x, -u*y], [0, 0, 0, x, y, 1, -v*x, -v*y]]; b += [u, v]
h = np.linalg.solve(np.array(A), np.array(b)); H = np.append(h, 1).reshape(3, 3)
def latlng(p):
    w = H[2] @ [p[0], p[1], 1]; return ((H[1] @ [p[0], p[1], 1]) / w, (H[0] @ [p[0], p[1], 1]) / w)
lot16 = next(l for l in data['lots'] if l['num'] == 16)

# GeoTIFF de prueba en UTM 21S (EPSG:32721) que cubre el campo, y una imagen común
import pyproj, tifffile
TMP = pathlib.Path(SRV).parent
to_utm = pyproj.Transformer.from_crs(4326, 32721, always_xy=True); to_ll = pyproj.Transformer.from_crs(32721, 4326, always_xy=True)
X0, Y0 = to_utm.transform(-60.43, -35.89); PX = 5.0; TW, TH = 2400, 2200
arr = np.zeros((TH, TW, 4), np.uint8); yy, xx = np.mgrid[0:TH, 0:TW]
arr[..., 0] = (xx * 255 // TW); arr[..., 1] = 140; arr[..., 2] = (yy * 255 // TH); arr[..., 3] = 255; arr[:20, :, 3] = 0
gk = [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 32721]
TIF = TMP / 'vuelo_utm21s.tif'
tifffile.imwrite(TIF, arr, photometric='rgb', extrasamples=['unassalpha'], tile=(256, 256), compression='zlib',
  extratags=[(33550, 'd', 3, (PX, PX, 0.0), False), (33922, 'd', 6, (0, 0, 0, X0, Y0, 0), False), (34735, 'H', len(gk), gk, False)], datetime='2026:10:20 11:30:00')
EXP = [to_ll.transform(X0 + i * PX, Y0 - j * PX)[::-1] for i, j in [(0, 0), (TW, 0), (TW, TH), (0, TH)]]
from PIL import Image as _I
PNG = TMP / 'croquis.png'; _I.new('RGB', (600, 400), (120, 160, 90)).save(PNG)
PDF = TMP / 'plano.pdf'; _I.new('RGB', (900, 600), (200, 190, 150)).save(PDF, 'PDF', resolution=100)
def mdist(a, b): return np.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * np.cos(np.radians(a[0])))

ok = 0; errs = []
def check(c, m):
    global ok
    if c:
        ok += 1
        if __import__('os').environ.get('E2E_V'): print('ok:', m)
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
        r = page.request.post(URL + '/api.php?action=saveGeoref', data=json.dumps({'georef': {'points': [{'lote': p['lote'], 'vi': p['vi'], 'label': p['label'], 'lat': CORN[k][0], 'lng': CORN[k][1]} for p, k in zip(data['georef']['points'], CK)]}}), headers={'Content-Type': 'application/json'})
        check(r.ok, f'{tag}: georreferencia guardada')
        la, lo = latlng(lot16['label']); ctx.set_geolocation({'latitude': la, 'longitude': lo})
        page.reload(); page.wait_for_selector('.map3d-svg'); page.wait_for_timeout(1200)
        check(page.locator('.gps-dot').count() == 1, f'{tag}: posición en vivo sobre el plano')
        # alta por GPS: silo 1 con cabecera y cola (A-B), silo 2 con un solo punto
        for i, kg in enumerate(['180000', '150.000']):
            ctx.set_geolocation({'latitude': la + 0.001, 'longitude': lo + 0.002 * i, 'accuracy': 4}); page.wait_for_timeout(700)
            page.click('.nav-add'); page.wait_for_selector('.cap-sheet')
            check('cabecera' in page.inner_text('.cap-title'), f'{tag}: pide pararse en la cabecera')
            page.click('.cap-btn'); page.wait_for_selector('.cap-dist, .modal', timeout=15000)
            if i == 0:
                ctx.set_geolocation({'latitude': la + 0.001, 'longitude': lo + 0.0007, 'accuracy': 4}); page.wait_for_timeout(1500)
                d = page.inner_text('.cap-dist b')
                check(d.replace('m', '').strip().isdigit() and 55 <= int(d.replace('m', '').strip()) <= 72, f'{tag}: distancia en vivo desde la cabecera ({d})')
                check(page.locator('.cap-pt').count() >= 1 or page.locator('.sat-cap-pt').count() >= 1, f'{tag}: punto A en el mapa')
                page.click('.cap-btn')
            else:
                page.click('.cap-foot button:has-text("Solo un punto")')
            page.wait_for_function("() => (document.querySelector('.modal .input-static')?.textContent || '').length > 3", timeout=15000)
            sid = page.inner_text('.modal .input-static')
            check(sid == f'RB16{i+1:03d}', f'{tag}: ID automático {sid}')
            if i == 0: check('m de largo' in page.inner_text('.modal .loc-gps'), f'{tag}: ficha con largo de la bolsa')
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
        s1 = st['silos'][0]
        check(s1.get('map2') and 55 <= (s1.get('largo') or 0) <= 72 and s1['gps2']['acc'] == 4, f'{tag}: bolsa A-B guardada ({s1.get("largo")} m)')
        check(abs(s1['latlng'][0] - (la + 0.001)) < 1e-6 and abs(s1['latlng'][1] - lo) < 1e-6, f'{tag}: cabecera en la coordenada medida')
        check(st['silos'][1].get('map2') is None and st['silos'][1]['t'] is None, f'{tag}: punto único libre (sin pegar al borde)')
        check(page.locator('.track').count() == 0 and page.locator('.silo-bag').count() == 2, f'{tag}: bolsas dibujadas sin recorrido de borde')
        check('RB16002' in page.inner_text('.silo-pop') and '150.000' in page.inner_text('.silo-pop'), f'{tag}: el punto muestra ID y KG')
        # mover silo (punto libre): se desplaza donde se suelta
        page.click('.silo-pop button:has-text("Mover")'); page.wait_for_selector('.map-banner')
        before = st['silos'][1]['map']
        box = page.evaluate("""() => { const r=document.querySelector('[data-silo="RB16002"] .silo-hit').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]; }""")
        page.mouse.move(*box); page.mouse.down(); page.mouse.move(box[0] + 30, box[1] + 20, steps=8); page.mouse.up()
        page.click('.map-banner .btn-primary'); page.wait_for_timeout(500)
        after = next(s for s in page.request.get(URL + '/api.php?action=state').json()['state']['silos'] if s['id'] == 'RB16002')
        check(np.hypot(after['map'][0] - before[0], after['map'][1] - before[1]) > 1 and after['t'] is None, f'{tag}: silo movido libremente')
        # satélite
        page.click('.seg button:has-text("Satélite")'); page.wait_for_selector('.leaflet-container'); page.wait_for_timeout(500)
        check(page.locator('path.sat-lot').count() == 25, f'{tag}: lotes superpuestos en satélite')
        check(page.locator('.sat-silo').count() == 1 and page.locator('path.sat-bag').count() == 1, f'{tag}: silos en satélite (bolsa A-B como línea)')
        # ajuste manual de la forma del lote 16 sobre el satélite
        btn = '.side-panel button:has-text("Ajustar forma")' if vp[0] > 500 else '.lot-bar button:has-text("Ajustar")'
        if vp[0] < 500:  # quitar la selección del silo tocando fuera del campo
            mb = page.locator('.satmap-el').bounding_box(); page.mouse.click(mb['x'] + mb['width'] / 2, mb['y'] + 58); page.wait_for_timeout(300)
        page.click(btn); page.wait_for_selector('.edit-bar'); page.wait_for_timeout(600)
        n0 = len(lot16['poly'])
        check(page.locator('.v-handle').count() == n0 and page.locator('.v-mid').count() == n0, f'{tag}: manijas de vértices y de agregar')
        page.locator('.v-mid').nth(1).click(); page.wait_for_timeout(200)
        check(page.locator('.v-handle').count() == n0 + 1, f'{tag}: agrega vértice')
        page.click('.edit-bar button:has-text("Deshacer")'); page.wait_for_timeout(200)
        check(page.locator('.v-handle').count() == n0, f'{tag}: deshacer')
        hb = page.locator('.v-handle').nth(0).bounding_box(); cx, cy = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
        page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 25, cy + 18, steps=10); page.mouse.up(); page.wait_for_timeout(300)
        page.click('.edit-bar button:has-text("Guardar")'); page.wait_for_selector('.edit-bar', state='detached')
        st2 = page.request.get(URL + '/api.php?action=state').json()['state']
        L16 = next(l for l in st2['lots'] if l['num'] == 16)
        moved_from = lot16['poly'][0]; moved_to = L16['poly'][0]
        check(L16.get('poly0') == lot16['poly'] and moved_to != moved_from, f'{tag}: forma ajustada guardada con original de respaldo')
        neigh = [l for l in data['lots'] if l['num'] != 16 and any(abs(q[0]-moved_from[0]) < .6 and abs(q[1]-moved_from[1]) < .6 for q in l['poly'])]
        check(neigh and all(next(x for x in st2['lots'] if x['num'] == n['num'])['poly'] == n['poly'] for n in neigh), f'{tag}: lotes vecinos NO se mueven ({[n["num"] for n in neigh]})')
        check([l['num'] for l in st2['lots'] if l.get('poly0')] == [16], f'{tag}: solo el lote 16 quedó ajustado')
        def onb(q, poly):
            best = 9e9
            for a, c in zip(poly, poly[1:] + poly[:1]):
                d = np.array(c) - a; k = max(0, min(1, np.dot(np.array(q) - a, d) / np.dot(d, d))); best = min(best, np.linalg.norm(np.array(q) - (np.array(a) + d * k)))
            return best
        check([s_['map'] for s_ in st2['silos']] == [s_['map'] for s_ in page.request.get(URL + '/api.php?action=state').json()['state']['silos']] and st2['silos'][0]['map'] == next(x for x in st2['silos'] if x['id'] == 'RB16001')['map'], f'{tag}: silos GPS no se mueven al ajustar la forma')
        page.click('.seg button:has-text("Plano 3D")')
        # pantallas
        page.click('.nav button:has-text("Silos")'); page.wait_for_selector('.silo-row')
        check(page.locator('.list-card .silo-row').count() == 2, f'{tag}: listado de silos'); layout_checks(page, tag + ' silos')
        with page.expect_download() as dl: page.click('.screen button:has-text("KML")')
        kx = open(dl.value.path(), encoding='utf-8').read()
        check(kx.count('<Placemark>') == 27 and '<LineString>' in kx, f'{tag}: exporta KML con lotes y silobolsas')
        page.click('.nav button:has-text("Lotes")'); check(page.locator('.lot-card').count() == 25, f'{tag}: listado de lotes'); layout_checks(page, tag + ' lotes')
        page.click('.avatar-btn'); page.wait_for_selector('.settings'); check(page.locator('.geo-pt').count() == 4, f'{tag}: 4 puntos de georreferencia')
        check('Activa' in page.inner_text('.badge'), f'{tag}: georreferencia activa'); layout_checks(page, tag + ' ajustes')
        check('Lote 21' in page.locator('.geo-pt').nth(0).inner_text() and 'NO' in page.locator('.geo-pt').nth(0).inner_text(), f'{tag}: punto 1 = lote 21 esquina NO')
        # quinto punto en cualquier lote, por orientación
        page.click('button:has-text("Agregar punto de control")'); check(page.locator('.geo-pt').count() == 5, f'{tag}: agrega quinto punto')
        last = page.locator('.geo-pt').nth(4)
        last.locator('.select').nth(0).click(); page.click('.select-opt:has-text("Lote 16")')
        last.locator('.select').nth(1).click(); opts = page.locator('.select-opt').all_inner_texts()
        check(all(o.split()[0] in ('N','NE','E','SE','S','SO','O','NO') for o in opts), f'{tag}: esquinas por orientación {opts}')
        page.locator('.select-opt').first.click()
        vi = next(c for c in range(len(L16['poly'])) if True)
        ctx.set_geolocation({'latitude': la, 'longitude': lo, 'accuracy': 3})
        last.locator('.geo-act .btn-primary').click(); page.wait_for_function("() => document.querySelectorAll('.geo-pt')[4].querySelector('input').value !== ''", timeout=12000)
        page.click('button:has-text("Guardar georreferencia")'); page.wait_for_timeout(500)
        check('5 puntos' in page.inner_text('.badge'), f'{tag}: ajuste con 5 puntos')
        check(page.locator('.geo-meta:has-text("Desvío")').count() == 5, f'{tag}: desvío informado por punto')
        # temas: mismas superficies de la paleta
        for th in ('dark', 'light'):
            page.evaluate(f"document.documentElement.dataset.theme='{th}'")
            cols = page.evaluate("""() => { const g=s=>getComputedStyle(document.querySelector(s)).backgroundColor; return [g('body'), g('.topbar'), g('.nav'), g('.card')]; }""")
            check(cols[0] == cols[1] == cols[2], f'{tag} {th}: barra, menú y fondo con el mismo tono {cols}')
        # mapas propios: GeoTIFF georreferenciado
        page.click('.nav button:has-text("Mapas")'); page.wait_for_selector('.dropzone')
        page.set_input_files('.maps-screen input[accept*=".tif"]', str(TIF)); page.wait_for_selector('.pbar'); page.wait_for_selector('.map-prev img', timeout=60000)
        check(page.get_attribute('.pbar', 'aria-valuenow') == '100', f'{tag}: barra de proceso completa al convertir')
        check('UTM 21S' in page.inner_text('.maps-screen .loc-box'), f'{tag}: detecta UTM 21S')
        check(page.input_value('.maps-screen input[inputmode=numeric]') == '20/10/2026', f'{tag}: toma la fecha del GeoTIFF')
        page.fill('.maps-screen .field:has-text("Nombre") input', 'Vuelo octubre'); page.click('.maps-screen button:has-text("Subir mapa") >> nth=-1'); page.wait_for_selector('.job', state='detached', timeout=30000)
        st3 = page.request.get(URL + '/api.php?action=state').json()['state']
        err_m = max(mdist(a, b) for a, b in zip(st3['maps'][0]['corners'], EXP))
        check(len(st3['maps']) == 1 and err_m < 1, f'{tag}: esquinas del GeoTIFF exactas (error {err_m:.3f} m)')
        check(page.locator('.maps-item').count() == 1 and 'GeoTIFF UTM 21S' in page.inner_text('.maps-item'), f'{tag}: el mapa figura en «Mapas cargados» con su tipo')
        page.wait_for_timeout(400)
        check(page.locator('path.glob-foot').count() == 1 and page.locator('.glob-map .warp-img').count() == 1, f'{tag}: mapa global con el GeoTIFF')
        page.click('.maps-item-main'); page.wait_for_timeout(300)
        check(page.locator('.maps-item.is-sel').count() == 1 and page.locator('path.glob-foot.is-sel').count() == 1, f'{tag}: seleccionar en la lista resalta en el mapa global')
        page.click('.maps-item button[aria-label^="Ver"]'); page.wait_for_selector('.warp-img', state='attached'); page.wait_for_timeout(500)
        check('matrix3d' in page.get_attribute('.warp-img', 'style'), f'{tag}: mapa proyectado sobre el satélite')
        layout_checks(page, tag + ' satélite con capas')
        def pick(label):
            page.click('.map-filter .select'); page.click(f'.select-opt:has-text("{label}")'); page.wait_for_timeout(300)
        pick('Solo satélite'); check(page.locator('.warp-img').count() == 0, f'{tag}: filtro solo satélite')
        pick('Todos los mapas'); check(page.locator('.warp-img').count() == 1, f'{tag}: filtro todos')
        # imagen común: se ubica arrastrando esquinas
        page.click('.nav button:has-text("Mapas")'); page.set_input_files('.maps-screen input[accept*=".tif"]', str(PNG)); page.wait_for_selector('.map-prev img')
        check('sin coordenadas' in page.inner_text('.maps-screen .loc-box').lower(), f'{tag}: imagen sin coordenadas')
        page.click('.maps-screen button:has-text("Subir mapa") >> nth=-1'); page.wait_for_selector('.edit-bar'); page.wait_for_timeout(500)
        check(page.locator('.map-corner').count() == 4 and page.locator('.map-center').count() == 1, f'{tag}: manijas de esquinas y centro')
        before_c = next(m for m in page.request.get(URL + '/api.php?action=state').json()['state']['maps'] if m['nombre'] == 'croquis')['corners']
        hb = page.locator('.map-corner').nth(1).bounding_box(); cx, cy = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
        page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 30, cy + 20, steps=8); page.mouse.up(); page.wait_for_timeout(200)
        page.click('.edit-bar button:has-text("Guardar")'); page.wait_for_selector('.edit-bar', state='detached')
        after_c = next(m for m in page.request.get(URL + '/api.php?action=state').json()['state']['maps'] if m['nombre'] == 'croquis')['corners']
        check(after_c[1] != before_c[1] and after_c[0] == before_c[0], f'{tag}: esquina NE reubicada a mano')
        # PDF: se convierte a imagen y se sube
        page.click('.nav button:has-text("Mapas")'); page.set_input_files('.maps-screen input[accept*=".tif"]', str(PDF)); page.wait_for_selector('.map-prev img', timeout=60000)
        check('sin coordenadas' in page.inner_text('.maps-screen .loc-box').lower() and '1 de 1' not in page.inner_text('.maps-screen .loc-box'), f'{tag}: PDF convertido a imagen')
        page.click('.maps-screen button:has-text("Subir mapa") >> nth=-1'); page.wait_for_selector('.edit-bar'); page.wait_for_timeout(400)
        page.click('.edit-bar button:has-text("Guardar")'); page.wait_for_selector('.edit-bar', state='detached')
        check(len(page.request.get(URL + '/api.php?action=state').json()['state']['maps']) == 3, f'{tag}: 3 mapas con el PDF')
        pick('Todos los mapas (3)'); check(page.locator('.warp-img').count() == 3, f'{tag}: todos = 3 mapas')
        pick('Vuelo octubre'); check(page.locator('.warp-img').count() == 1, f'{tag}: un solo mapa')
        page.click('.nav button:has-text("Mapas")'); page.wait_for_selector('.maps-item'); page.wait_for_timeout(400)
        check(page.locator('.maps-item').count() == 3 and page.locator('path.glob-foot').count() == 3, f'{tag}: listado general y mapa global con 3 mapas')
        check('PDF' in page.inner_text('.maps-list') and 'Imagen' in page.inner_text('.maps-list'), f'{tag}: tipo de cada mapa en el listado')
        page.fill('.maps-filters input', 'plano'); page.wait_for_timeout(150)
        check(page.locator('.maps-item').count() == 1, f'{tag}: buscar en el listado')
        page.fill('.maps-filters input', ''); layout_checks(page, tag + ' mapas')
        page.click('.glob-head button:has-text("Contornos")'); page.wait_for_timeout(200)
        check(page.locator('.glob-map .warp-img').count() == 0, f'{tag}: mapa global solo contornos')
        page.click('.nav button:has-text("Mapa")')
        page.click('.seg button:has-text("Plano 3D")')
        page.click('.nav button:has-text("Mapa")'); page.wait_for_selector('.map3d-svg'); layout_checks(page, tag + ' mapa final')
        check(not bucket, f'{tag}: sin errores de consola {bucket[:3]}')
        ctx.close()

    # Lotes desde KML (móvil): importar, numerar, reemplazar y cargar una bolsa por GPS
    def rect(la, lo, d=0.01):
        return f"{lo},{la},0 {lo+d},{la},0 {lo+d},{la-d},0 {lo},{la-d},0 {lo},{la},0"
    KML = TMP / 'lotes.kml'
    KML.write_text(f"""<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Rincón</name>
<Placemark><name>Lote 1 - Casco</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.94, -60.40)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Lote 2</name><ExtendedData><Data name="ha"><value>95,5</value></Data></ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.94, -60.39)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Potrero sin número</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.95, -60.40)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Camino interno</name><LineString><coordinates>-60.40,-35.95 -60.38,-35.95</coordinates></LineString></Placemark>
</Folder></Document></kml>""", encoding='utf-8')
    shutil.copy(ROOT / 'public_html/data.seed.json', SRV / 'data.json')
    bucket = []
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, permissions=['geolocation'], geolocation={'latitude': -35.945, 'longitude': -60.385, 'accuracy': 3}, has_touch=True)
    page = ctx.new_page(); watch(page, bucket)
    page.goto(URL); page.wait_for_selector('.login-card')
    page.fill('input[autocomplete=username]', 'rodma'); page.fill('input[type=password]', 'rmaldonado'); page.click('button[type=submit]')
    page.wait_for_selector('.map3d-svg')
    page.click('.nav button:has-text("Mapas")'); page.wait_for_selector('.kml-sec')
    page.set_input_files('.kml-sec input[type=file]', str(KML)); page.wait_for_selector('.kml-row')
    check(page.locator('.kml-row').count() == 3 and page.locator('.kml-prev polygon').count() == 3, 'kml: 3 polígonos con vista previa')
    btn = page.locator('.kml-sec .btn-primary')
    check(btn.is_disabled() and 'Número 1 a 99' in page.inner_text('.kml-list'), 'kml: exige número al polígono sin número')
    page.locator('.kml-row').nth(2).locator('input').fill('3'); page.wait_for_timeout(100)
    check('Usar 3 lotes' in btn.inner_text(), 'kml: listo para usar 3 lotes')
    btn.click(); page.wait_for_selector('.kml-confirm'); layout_checks(page, 'kml vista previa')
    btn.click(); page.wait_for_selector('.leaflet-container', timeout=10000); page.wait_for_timeout(600)
    st = page.request.get(URL + '/api.php?action=state').json()['state']
    check(st['georef'].get('mode') == 'kml' and [l['num'] for l in st['lots']] == [1, 2, 3], f"kml: lotes reemplazados {[l['num'] for l in st['lots']]}")
    check(next(l for l in st['lots'] if l['num'] == 2)['ha'] == 95.5 and next(l for l in st['lots'] if l['num'] == 1)['nombre'] == 'Casco', 'kml: hectáreas y nombre del archivo')
    check(st['decor'].get('lines') and len(st['decor']['lines']) == 1, 'kml: camino interno guardado')
    check(page.locator('path.sat-lot').count() == 3, 'kml: lotes sobre el satélite sin puntos de control')
    page.click('.seg button:has-text("Plano 3D")'); page.wait_for_selector('.map3d-svg')
    check(page.locator('g.lot').count() == 3 and page.locator('.kml-line').count() == 1, 'kml: plano 3D con lotes y camino')
    page.wait_for_timeout(900)
    page.click('.nav-add'); page.wait_for_selector('.cap-sheet'); page.click('.cap-btn'); page.wait_for_selector('.cap-dist', timeout=15000)
    ctx.set_geolocation({'latitude': -35.9455, 'longitude': -60.3852, 'accuracy': 3}); page.wait_for_timeout(1200); page.click('.cap-btn')
    page.wait_for_function("() => (document.querySelector('.modal .input-static')?.textContent || '').length > 3", timeout=15000)
    check(page.inner_text('.modal .input-static') == 'RB02001', 'kml: la bolsa cae en el lote 2 por coordenadas')
    page.fill('.modal input[inputmode=decimal]', '210000'); page.click('.modal-foot .btn-primary'); page.wait_for_selector('.modal', state='detached')
    s_ = page.request.get(URL + '/api.php?action=state').json()['state']['silos'][0]
    check(mdist(s_['latlng2'], (-35.9455, -60.3852)) < 0.5 and 50 < s_['largo'] < 62, f"kml: cola y largo exactos ({s_['largo']} m)")
    # agregar un segundo KML sin perder lo cargado
    KML2 = TMP / 'campo2.kml'
    KML2.write_text(f"""<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Lote 2</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.97, -60.40)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Lote 5</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.97, -60.39)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>""", encoding='utf-8')
    page.click('.nav button:has-text("Mapas")'); page.wait_for_selector('.kml-file')
    check(page.locator('.kml-file').count() == 1 and 'Agregar KML' in page.inner_text('.kml-sec .dropzone'), 'kml: listado con 1 KML y botón Agregar')
    page.set_input_files('.kml-sec input[type=file]', str(KML2)); page.wait_for_selector('.kml-row')
    check(page.locator('.kml-sec .seg button.is-on').inner_text() == 'Agregar', 'kml: por defecto agrega')
    check('Ya existe' in page.inner_text('.kml-list') and page.locator('.kml-sec .btn-primary').is_disabled(), 'kml: avisa lote ya existente')
    page.locator('.kml-row').nth(0).locator('input').fill('4'); page.wait_for_timeout(100)
    b2 = page.locator('.kml-sec .btn-primary'); check('Agregar 2 lotes' in b2.inner_text(), 'kml: listo para agregar 2 lotes')
    b2.click(); page.wait_for_selector('.kml-confirm'); b2.click(); page.wait_for_selector('.leaflet-container', timeout=10000); page.wait_for_timeout(400)
    st = page.request.get(URL + '/api.php?action=state').json()['state']
    check([l['num'] for l in st['lots']] == [1, 2, 3, 4, 5] and len(st['georef']['kmls']) == 2, f"kml: agregados ({[l['num'] for l in st['lots']]})")
    check(len(st['silos']) == 1 and st['silos'][0]['largo'] == s_['largo'], 'kml: la bolsa cargada no cambió')
    page.click('.nav button:has-text("Mapas")'); page.wait_for_selector('.kml-file')
    check(page.locator('.kml-file').count() == 2 and 'campo2.kml' in page.inner_text('.kml-files'), 'kml: listado de 2 KML cargados')
    page.locator('.kml-file').nth(1).locator('button').click(); page.locator('.kml-file').nth(1).locator('button:has-text("Quitar")').click(); page.wait_for_timeout(500)
    st = page.request.get(URL + '/api.php?action=state').json()['state']
    check([l['num'] for l in st['lots']] == [1, 2, 3] and page.locator('.kml-file').count() == 1, 'kml: quitar un KML borra solo sus lotes')
    page.click('.avatar-btn'); page.wait_for_selector('.settings')
    check('KML' in page.inner_text('.settings') and page.locator('.geo-pt').count() == 0, 'kml: ajustes sin puntos de control')
    # versión nueva publicada: aparece el botón flotante y recarga
    check(page.locator('.upd').count() == 0, 'versión: sin aviso cuando está al día')
    vj = SRV / 'version.json'; orig = vj.read_text()
    vj.write_text('{"v":"zz-nueva"}'); page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); page.wait_for_selector('.upd', timeout=8000); page.wait_for_timeout(500)
    r_ = page.evaluate("()=>{const a=document.querySelector('.upd').getBoundingClientRect(),n=document.querySelector('.nav').getBoundingClientRect();return [a.bottom,n.top,a.left>=0&&a.right<=innerWidth]}")
    check(r_[0] <= r_[1] and r_[2], f'versión: botón flotante sobre la barra, sin taparla {r_}')
    check('Nueva versión' in page.inner_text('.upd'), 'versión: muestra «Nueva versión»')
    vj.write_text(orig)
    with page.expect_navigation(): page.click('.upd-btn')
    page.wait_for_selector('.app'); page.wait_for_timeout(500)
    check(page.locator('.upd').count() == 0, 'versión: tras actualizar desaparece el aviso')
    check(not bucket, f'kml: sin errores de consola {bucket[:3]}')
    ctx.close()

    # Modo local (file://): sin servidor, colocar silo tocando el mapa
    bucket = []
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, has_touch=True)
    page = ctx.new_page(); watch(page, bucket)
    page.goto((ROOT / 'public_html/index.html').as_uri()); page.wait_for_selector('.login-card')
    check('modo local' in page.inner_text('.login-card'), 'local: detecta modo local')
    page.fill('input[autocomplete=username]', 'rodma'); page.fill('input[type=password]', 'rmaldonado'); page.click('button[type=submit]')
    page.wait_for_selector('.map3d-svg'); page.wait_for_timeout(300)
    page.click('.nav-add'); page.wait_for_selector('.map-banner')
    x, y = label_xy(page, 7); page.touchscreen.tap(x, y)
    page.wait_for_selector('.modal .input-static')
    check(page.inner_text('.modal .input-static') == 'RB07001', 'local: ID por toque en lote 7')
    page.fill('.modal input[inputmode=decimal]', '200000'); page.click('.modal-foot .btn-primary'); page.wait_for_selector('[data-silo="RB07001"]')
    page.reload(); page.wait_for_selector('[data-silo="RB07001"]')
    check(True, 'local: persiste tras recargar')
    check(not bucket, f'local: sin errores de consola {bucket[:3]}')
    br.close()
print(f'e2e: {ok} OK, {len(errs)} fallas'); sys.exit(1 if errs else 0)
