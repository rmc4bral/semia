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
        page.wait_for_selector('.satmap'); page.wait_for_timeout(400)
        check(page.locator('.seg button:has-text("Plano 3D")').count() == 0, f'{tag}: sin opción de plano 3D')
        check('KML' in page.inner_text('.sat-note'), f'{tag}: sin coordenadas pide cargar el KML')
        layout_checks(page, tag)
        # georreferenciar vía API (plano con puntos de control) y ubicar GPS dentro del lote 16
        r = page.request.post(URL + '/api.php?action=saveGeoref', data=json.dumps({'georef': {'points': [{'lote': p['lote'], 'vi': p['vi'], 'label': p['label'], 'lat': CORN[k][0], 'lng': CORN[k][1]} for p, k in zip(data['georef']['points'], CK)]}}), headers={'Content-Type': 'application/json'})
        check(r.ok, f'{tag}: georreferencia guardada')
        la, lo = latlng(lot16['label']); ctx.set_geolocation({'latitude': la, 'longitude': lo})
        page.reload(); page.wait_for_selector('path.sat-lot'); page.wait_for_timeout(1200)
        check(page.locator('path.sat-lot').count() == 25, f'{tag}: 25 lotes sobre el satélite')
        labels = page.locator('.sat-label').all_inner_texts()
        check(len(labels) == 25 and all(t.strip().isdigit() for t in labels), f'{tag}: etiquetas solo con el número de lote')
        check(page.locator('path.sat-gps').count() == 1, f'{tag}: posición en vivo sobre el satélite')
        page.locator('.sat-label:has(b:text-is("16"))').click(force=True); page.wait_for_timeout(300)
        check('ha' in page.inner_text('.sat-label.is-sel'), f'{tag}: al tocar el lote muestra sus hectáreas')
        bar = '.side-panel' if vp[0] > 500 else '.lot-bar'
        check('Lote 16' in page.inner_text(bar), f'{tag}: panel del lote seleccionado')
        mb = page.locator('.satmap-el').bounding_box(); page.mouse.click(mb['x'] + mb['width'] / 2, mb['y'] + 30); page.wait_for_timeout(200)
        # alta por GPS: silo 1 con cabecera y cola (A-B), silo 2 con un solo punto
        for i, kg in enumerate(['180000', '150.000']):
            ctx.set_geolocation({'latitude': la + 0.001, 'longitude': lo + 0.002 * i, 'accuracy': 4}); page.wait_for_timeout(700)
            page.click('.nav-add'); page.wait_for_selector('.cap-lots')
            check('lote' in page.inner_text('.cap-title') and page.locator('.cap-btn').count() == 0, f'{tag}: antes de medir pide elegir el lote')
            check(page.inner_text('.cap-lot.is-sug b') == '16', f'{tag}: sugiere el lote donde está el GPS')
            page.click('.cap-lot:has(b:text-is("16"))'); page.wait_for_selector('.cap-btn')
            check('cabecera' in page.inner_text('.cap-title') and page.get_attribute('.cap-lot-chip', 'aria-label').startswith('Lote 16'), f'{tag}: pide pararse en la cabecera del lote elegido')
            check('contorno del lote 16' in page.inner_text('.cap-border') or 'afuera' in page.inner_text('.cap-border'), f'{tag}: distancia al contorno del lote')
            page.click('.cap-btn'); page.wait_for_selector('.cap-dist, .modal', timeout=15000)
            if i == 0:
                ctx.set_geolocation({'latitude': la + 0.001, 'longitude': lo + 0.0007, 'accuracy': 4}); page.wait_for_timeout(1500)
                d = page.inner_text('.cap-dist b')
                check(d.replace('m', '').strip().isdigit() and 55 <= int(d.replace('m', '').strip()) <= 72, f'{tag}: distancia en vivo desde la cabecera ({d})')
                check(page.locator('.cap-pt').count() >= 1 or page.locator('.sat-cap-pt').count() >= 1, f'{tag}: punto A en el mapa')
                page.click('.cap-btn')
            else:
                page.click('.cap-foot button:has-text("Solo un punto")')
            page.wait_for_function("() => (document.querySelector('.modal .silo-id-num')?.textContent || '').length > 3", timeout=15000)
            sid = page.inner_text('.modal .silo-id-num')
            check(sid == f'RB16{i+1:03d}', f'{tag}: ID automático {sid}')
            if i == 0: check('m de largo' in page.inner_text('.modal .loc-gps'), f'{tag}: ficha con largo de la bolsa')
            page.fill('.modal input[inputmode=decimal]', kg)
            check(page.locator('.silo-id-num').inner_text() == sid and 'Lote' in page.inner_text('.silo-id-parts'), f'{tag}: número de silobolsa detallado')
            page.click('.modal-foot .btn-primary'); page.wait_for_timeout(300)
            check(page.locator('.modal').count() == 1, f'{tag}: sin grano no deja guardar')
            page.click('.modal .pick:has-text("Soja")')
            page.fill('.modal textarea', 'Bolsa de prueba')
            page.set_input_files('.modal input[type=file]:not([capture])', files=[{'name': 'f.png', 'mimeType': 'image/png', 'buffer': bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5fa5ec50000000049454e44ae426082')}])
            page.wait_for_selector('.photo-prev img')
            page.click('.modal-foot .btn-primary'); page.wait_for_selector('.modal', state='detached')
            page.wait_for_timeout(400)
        st = page.request.get(URL + '/api.php?action=state').json()['state']
        check(len(st['silos']) == 2 and all(s['lote'] == 16 and s['foto'] for s in st['silos']), f'{tag}: 2 silos con foto en lote 16')
        check(st['silos'][1]['kg'] == 150000, f'{tag}: kg con separador de miles')
        s1 = st['silos'][0]
        check(s1.get('map2') and 55 <= (s1.get('largo') or 0) <= 72 and s1['gps2']['acc'] == 4, f'{tag}: bolsa A-B guardada ({s1.get("largo")} m)')
        check(abs(s1['latlng'][0] - (la + 0.001)) < 1e-6 and abs(s1['latlng'][1] - lo) < 1e-6, f'{tag}: cabecera en la coordenada medida')
        check(st['silos'][1].get('map2') is None and st['silos'][1]['t'] is None, f'{tag}: punto único libre (sin pegar al borde)')
        check(page.locator('.sat-silo').count() == 1 and page.locator('path.sat-bag').count() == 1, f'{tag}: silos en satélite (bolsa A-B como línea)')
        check('RB16002' in page.inner_text('.silo-bar') and '150.000' in page.inner_text('.silo-bar'), f'{tag}: la ficha rápida muestra ID y KG')
        # mover silo (punto libre): se desplaza donde se suelta
        page.click('.silo-bar button:has-text("Mover")'); page.wait_for_selector('.move-handle')
        before = st['silos'][1]['map']
        hb = page.locator('.move-handle').bounding_box(); cx, cy = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
        page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 40, cy + 25, steps=8); page.mouse.up(); page.wait_for_timeout(300)
        page.click('.map-banner .btn-primary'); page.wait_for_timeout(500)
        after = next(s for s in page.request.get(URL + '/api.php?action=state').json()['state']['silos'] if s['id'] == 'RB16002')
        check(np.hypot(after['map'][0] - before[0], after['map'][1] - before[1]) > 1 and after['t'] is None, f'{tag}: silo movido libremente')
        # ajuste manual de la forma del lote 16 sobre el satélite
        btn = '.side-panel button:has-text("Ajustar forma")' if vp[0] > 500 else '.lot-bar button:has-text("Ajustar")'
        mb = page.locator('.satmap-el').bounding_box(); page.mouse.click(mb['x'] + 12, mb['y'] + mb['height'] - 12); page.wait_for_timeout(300)
        if 'ha' not in (page.locator('.sat-label.is-sel').all_inner_texts() or [''])[0]:
            page.locator('.sat-label:has(b:text-is("16"))').click(force=True); page.wait_for_timeout(300)
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
        # pantallas
        page.click('.nav button:has-text("Silos")'); page.wait_for_selector('.silo-row')
        check(page.locator('.list-card .silo-row').count() == 2, f'{tag}: listado de silos'); layout_checks(page, tag + ' silos')
        with page.expect_download() as dl: page.click('.screen button:has-text("KML")')
        kx = open(dl.value.path(), encoding='utf-8').read()
        check(kx.count('<Placemark>') == 27 and '<LineString>' in kx, f'{tag}: exporta KML con lotes y silobolsas')
        page.click('.nav button:has-text("Lotes")'); check(page.locator('.lot-card').count() == 25, f'{tag}: listado de lotes'); layout_checks(page, tag + ' lotes')
        page.click('.avatar-btn'); page.wait_for_selector('.set-page'); check(page.locator('.geo-pt').count() == 4, f'{tag}: 4 puntos de georreferencia')
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
            cols = page.evaluate("""() => { const g=s=>getComputedStyle(document.querySelector(s)).backgroundColor; return [g('body'), g('.topbar'), g('.nav')]; }""")
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
        page.click('.nav button:has-text("Mapa")'); page.wait_for_selector('.satmap'); layout_checks(page, tag + ' mapa final')
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
    page.wait_for_selector('.satmap')
    page.click('.nav button:has-text("Mapas")'); page.wait_for_selector('.kml-sec')
    page.set_input_files('.kml-sec input[type=file]', str(KML)); page.wait_for_selector('.kml-row')
    check(page.locator('.kml-row').count() == 3 and page.locator('.kml-prev polygon').count() == 3, 'kml: 3 polígonos con vista previa')
    btn = page.locator('.kml-sec .btn-primary')
    check(page.locator('.kml-row').nth(2).locator('input').input_value() == 'Potrero' and 'Sin silobolsas' in page.locator('.kml-row').nth(2).inner_text(), 'kml: sin número propone el nombre como lote sin silos')
    page.locator('.kml-row').nth(2).locator('input').fill('3'); page.wait_for_timeout(100)
    check(page.input_value('.kml-est input >> nth=0') == 'lotes', 'kml: estancia propuesta desde el archivo')
    page.fill('.kml-est input >> nth=0', 'Rincón de Baguales'); page.wait_for_timeout(100)
    check(page.input_value('.kml-sigla input') == 'RB', 'kml: sigla sugerida RB')
    check('Usar 3 lotes' in btn.inner_text(), 'kml: listo para usar 3 lotes')
    btn.click(); page.wait_for_selector('.kml-confirm'); layout_checks(page, 'kml vista previa')
    btn.click(); page.wait_for_selector('.leaflet-container', timeout=10000); page.wait_for_timeout(600)
    st = page.request.get(URL + '/api.php?action=state').json()['state']
    check(st['georef'].get('mode') == 'kml' and [l['num'] for l in st['lots']] == [1, 2, 3], f"kml: lotes reemplazados {[l['num'] for l in st['lots']]}")
    check(next(l for l in st['lots'] if l['num'] == 2)['ha'] == 95.5 and next(l for l in st['lots'] if l['num'] == 1)['nombre'] == 'Casco', 'kml: hectáreas y nombre del archivo')
    check(st['decor'].get('lines') and len(st['decor']['lines']) == 1, 'kml: camino interno guardado')
    check(page.locator('path.sat-lot').count() == 3, 'kml: lotes sobre el satélite sin puntos de control')
    check([t.strip() for t in page.locator('.sat-label').all_inner_texts()] == ['1', '2', '3'], 'kml: etiquetas 1, 2, 3')
    page.wait_for_timeout(900)
    page.click('.nav-add'); page.wait_for_selector('.cap-lots'); check(page.inner_text('.cap-lot.is-sug b') == '2', 'kml: sugiere el lote 2 por coordenadas')
    page.click('.cap-lot.is-sug'); page.click('.cap-btn'); page.wait_for_selector('.cap-dist', timeout=15000)
    ctx.set_geolocation({'latitude': -35.9455, 'longitude': -60.3852, 'accuracy': 3}); page.wait_for_timeout(1200); page.click('.cap-btn')
    page.wait_for_function("() => (document.querySelector('.modal .silo-id-num')?.textContent || '').length > 3", timeout=15000)
    check(page.inner_text('.modal .silo-id-num') == 'RB02001', 'kml: la bolsa cae en el lote 2 por coordenadas')
    page.fill('.modal input[inputmode=decimal]', '210000'); page.click('.modal .pick:has-text("Maíz")'); page.click('.modal-foot .btn-primary'); page.wait_for_selector('.modal', state='detached')
    s_ = page.request.get(URL + '/api.php?action=state').json()['state']['silos'][0]
    check(mdist(s_['latlng2'], (-35.9455, -60.3852)) < 0.5 and 50 < s_['largo'] < 62, f"kml: cola y largo exactos ({s_['largo']} m)")
    # agregar un segundo KML sin perder lo cargado
    KML2 = TMP / 'campo2.kml'
    KML2.write_text(f"""<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Lote 2</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.97, -60.40)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Lote 5</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.97, -60.39)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Casco</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.98, -60.40, 0.004)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>""", encoding='utf-8')
    page.click('.nav button:has-text("Mapas")'); page.wait_for_selector('.kml-file')
    check(page.locator('.kml-file').count() == 1 and 'Agregar KML' in page.inner_text('.kml-sec .dropzone'), 'kml: listado con 1 KML y botón Agregar')
    page.set_input_files('.kml-sec input[type=file]', str(KML2)); page.wait_for_selector('.kml-row')
    check(page.locator('.kml-sec .seg button.is-on').inner_text() == 'Agregar', 'kml: por defecto agrega')
    page.fill('.kml-est input >> nth=0', 'Los Gatos'); page.wait_for_timeout(100)
    check(page.input_value('.kml-sigla input') == 'LG' and 'LG31001' in page.inner_text('.kml-est'), 'estancia: Los Gatos → sigla LG')
    check('Ya existe' not in page.inner_text('.kml-list'), 'estancia: el lote 2 puede repetirse en otra estancia')
    b2 = page.locator('.kml-sec .btn-primary'); check('Agregar 3 lotes' in b2.inner_text(), 'kml: listo para agregar 3 lotes (uno con nombre)')
    b2.click(); page.wait_for_selector('.kml-confirm'); b2.click(); page.wait_for_selector('.leaflet-container', timeout=10000); page.wait_for_timeout(400)
    st = page.request.get(URL + '/api.php?action=state').json()['state']
    check([l['num'] for l in st['lots']] == [1, 2, 3, 2, 5, 'Casco'] and len(st['georef']['kmls']) == 2, f"kml: agregados ({[l['num'] for l in st['lots']]})")
    check(st['georef']['kmls'][1]['nombre'] == 'Los Gatos' and st['georef']['kmls'][1]['sigla'] == 'LG', 'estancia: Los Gatos registrada con sigla LG')
    # bolsa en el lote 2 de Los Gatos → ID LG02001
    page.click('.nav button:has-text("Mapa")'); page.wait_for_selector('path.sat-lot')
    ctx.set_geolocation({'latitude': -35.975, 'longitude': -60.395, 'accuracy': 3}); page.wait_for_timeout(1200)
    page.click('.nav-add'); page.wait_for_selector('.cap-lots'); page.click('.cap-lot.is-sug'); page.click('.cap-btn'); page.wait_for_selector('.cap-dist', timeout=15000)
    page.click('.cap-foot button:has-text("Solo un punto")')
    page.wait_for_function("() => (document.querySelector('.modal .silo-id-num')?.textContent || '').length > 3", timeout=15000)
    check(page.inner_text('.modal .silo-id-num') == 'LG02001' and 'Los Gatos' in page.inner_text('.modal .silo-id'), f"estancia: ID con la sigla de su estancia ({page.inner_text('.modal .silo-id-num')})")
    page.click('.modal .pick:has-text("Otro")'); page.fill('.modal .field:has-text("¿Qué grano?") input', 'Colza')
    page.click('.modal-foot .btn-primary'); page.wait_for_selector('.modal', state='detached')
    st = page.request.get(URL + '/api.php?action=state').json()['state']
    lg = next(x for x in st['silos'] if x['id'] == 'LG02001')
    check(lg['kg'] is None and lg['grano'] == 'Colza', f"silo: kg opcional y grano «Otro» escrito ({lg['kg']}, {lg['grano']})")
    check(lg['lot'] == st['georef']['kmls'][1]['id'] + ':2' and next(x for x in st['silos'] if x['id'] == 'RB02001')['lot'].endswith(':2') and next(x for x in st['silos'] if x['id'] == 'RB02001')['lot'] != lg['lot'], 'estancia: cada silo queda en el lote 2 de su estancia')
    page.request.post(URL + '/api.php?action=deleteSilo', data=json.dumps({'id': 'LG02001'}), headers={'Content-Type': 'application/json'})
    page.reload(); page.wait_for_selector('path.sat-lot')
    check('Casco' in [t.strip() for t in page.locator('.sat-label').all_inner_texts()], 'kml: lote «Casco» con nombre en el mapa')
    # filtro Estancia (cada KML)
    est = page.locator('.map-layers .field:has-text("Estancia") .select')
    check(est.count() == 1, 'estancia: filtro en el mapa con 2 KML')
    est.click(); page.click('.select-opt:has-text("Los Gatos")'); page.wait_for_timeout(600)
    check(page.locator('path.sat-lot').count() == 3 and 'Casco' in page.inner_text('.leaflet-container'), 'estancia: el mapa muestra solo los lotes de esa estancia')
    check('0' in page.inner_text('.kpi.is-hero') or 't' in page.inner_text('.kpi.is-hero'), 'estancia: indicadores de la estancia')
    page.click('.nav button:has-text("Lotes")'); page.wait_for_selector('.lot-card')
    check(page.locator('.lot-card').count() == 3, 'estancia: la pestaña Lotes respeta el filtro')
    page.fill('.lots-filters input', 'cas'); page.wait_for_timeout(150)
    check(page.locator('.lot-card').count() == 1, 'estancia: buscar lote por nombre')
    page.fill('.lots-filters input', '')
    page.locator('.lots-filters .select').click(); page.click('.select-opt:has-text("Todas las estancias")'); page.wait_for_timeout(200)
    check(page.locator('.lot-card').count() == 6, 'estancia: todas = 6 lotes')
    page.click('.nav button:has-text("Silos")'); page.wait_for_selector('.filters')
    check(page.locator('.filters .field:has-text("Estancia")').count() == 1, 'estancia: filtro también en Silos')
    page.click('.nav button:has-text("Mapa")'); page.wait_for_selector('path.sat-lot')
    check(next(x for x in st['silos'] if x['id'] == 'RB02001')['largo'] == s_['largo'], 'kml: la bolsa cargada no cambió')
    # supervisor: login → estancia → ubicación → solo Mapa, Silos, + y Lotes
    r = page.request.post(URL + '/api.php?action=saveUser', data=json.dumps({'u': {'user': 'juan', 'nombre': 'Juan Pérez', 'pass': 'juan123', 'rol': 'operador'}}), headers={'Content-Type': 'application/json'})
    check(r.ok, 'supervisor: usuario creado')
    sctx = br.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, geolocation={'latitude': -35.9455, 'longitude': -60.3852, 'accuracy': 3})
    sp = sctx.new_page(); sbucket = []; watch(sp, sbucket)
    sp.goto(URL); sp.wait_for_selector('.login-card')
    sp.fill('input[autocomplete=username]', 'juan'); sp.fill('input[type=password]', 'juan123'); sp.click('button[type=submit]')
    sp.wait_for_selector('.est-gate')
    check(sp.locator('.est-opt').count() == 2 and 'Los Gatos' in sp.inner_text('.est-gate') and 'Paso 1 de 2' in sp.inner_text('.est-gate'), 'supervisor: primero elige la estancia')
    layout_checks(sp, 'supervisor estancia')
    sp.click('.est-opt:has-text("Rincón de Baguales")'); sp.wait_for_selector('.geo-gate:not(.est-gate)')
    check('Paso 2 de 2' in sp.inner_text('.geo-gate') and sp.locator('.geo-gate button:has-text("Ahora no")').count() == 0, 'supervisor: la ubicación es obligatoria (sin «Ahora no»)')
    sctx.grant_permissions(['geolocation']); sp.click('.geo-gate button:has-text("Permitir ubicación")'); sp.wait_for_selector('.satmap'); sp.wait_for_timeout(800)
    navs = [t.strip() for t in sp.locator('.nav .nav-item:visible').all_inner_texts()]
    check(navs == ['Mapa', 'Silos', 'Lotes', 'Cuenta'] and sp.locator('.avatar-btn').count() == 0, f'supervisor: menú reducido {navs}')
    check(sp.locator('.map-layers .field:has-text("Estancia")').count() == 0 and sp.locator('path.sat-lot').count() == 3, 'supervisor: solo ve los lotes de su estancia, sin filtro')
    ab = sp.locator('.nav-add').bounding_box(); check(ab['width'] >= 68, f'supervisor: botón + más grande ({ab["width"]:.0f}px)')
    sp.click('.nav-add'); sp.wait_for_selector('.cap-lots')
    lots_ = [t.strip() for t in sp.locator('.cap-lot b').all_inner_texts()]
    check(sorted(lots_) == ['1', '2', '3'] and lots_[0] == '2', f'supervisor: elige entre los lotes con número de su estancia {lots_}')
    sp.click('.cap-lot:has(b:text-is("3"))'); sp.wait_for_selector('.cap-btn')
    check('afuera del lote 3' in sp.inner_text('.cap-border'), 'supervisor: avisa si está lejos del lote elegido')
    sp.click('.cap-btn'); sp.wait_for_selector('.cap-dist', timeout=15000); sp.click('.cap-foot button:has-text("Solo un punto")')
    sp.wait_for_function("() => (document.querySelector('.modal .silo-id-num')?.textContent || '').length > 3", timeout=15000)
    check(sp.inner_text('.modal .silo-id-num') == 'RB03001', f"supervisor: respeta el lote elegido aunque el GPS caiga en otro ({sp.inner_text('.modal .silo-id-num')})")
    check('afuera del lote 3' in sp.inner_text('.modal'), 'supervisor: la ficha advierte la distancia al lote')
    sp.click('.modal .pick:has-text("Soja")'); sp.fill('.modal input[inputmode=decimal]', '200000'); sp.click('.modal-foot .btn-primary'); sp.wait_for_selector('.modal', state='detached')
    sp.click('.nav button:has-text("Silos")'); sp.wait_for_selector('.list-card .silo-row')
    check(sp.locator('.list-card .silo-row').count() == 2 and sp.locator('.screen-head button:has-text("CSV")').count() == 0, 'supervisor: ve las cargas activas de su estancia')
    sp.locator('.list-card .silo-row:has-text("RB03001")').click(); sp.wait_for_selector('.card-facts')
    facts = sp.inner_text('.modal')
    check(all(x in facts for x in ['RB03001', 'Rincón de Baguales', 'Lote 3', 'Soja', '200.000 kg', 'Juan Pérez', 'Registrado', 'Lugar']), 'supervisor: tarjeta con id, estancia, lote, grano, kg, lugar, fecha y usuario')
    layout_checks(sp, 'supervisor ficha'); sp.click('.modal-head button[aria-label="Cerrar"]')
    sp.click('.nav button:has-text("Lotes")'); sp.wait_for_selector('.lot-card')
    check(sp.locator('.lot-card button[aria-label^="Configurar"]').count() == 0, 'supervisor: no configura lotes')
    sp.locator('.lot-card:has(.lot-card-num:text-is("2")) .lot-card-main').click(); sp.wait_for_selector('.lot-sum')
    check('Maíz' in sp.inner_text('.grano-break') and '210 t' in sp.inner_text('.lot-sum') and '1' in sp.inner_text('.lot-sum'), f"supervisor: lote con silos, grano y toneladas ({sp.inner_text('.lot-sum')})")
    layout_checks(sp, 'supervisor lote'); sp.click('.modal-head button[aria-label="Cerrar"]')
    sp.click('.nav button:has-text("Cuenta")'); sp.wait_for_selector('.set-page')
    heads = sp.locator('.set-group-head h3').all_inner_texts()
    check(heads == ['Mi cuenta', 'Estancia de trabajo', 'Apariencia'], f'supervisor: cuenta simple {heads}')
    sp.click('button:has-text("Cambiar estancia")'); sp.wait_for_selector('.est-gate'); sp.click('.est-opt:has-text("Los Gatos")'); sp.wait_for_selector('.satmap'); sp.wait_for_timeout(600)
    check(sp.locator('path.sat-lot').count() == 3 and 'Los Gatos' in sp.inner_text('.topbar'), 'supervisor: cambia de estancia (ubicación ya activa)')
    check(not sbucket, f'supervisor: sin errores de consola {sbucket[:3]}')
    sctx.close()
    page.request.post(URL + '/api.php?action=deleteSilo', data=json.dumps({'id': 'RB03001'}), headers={'Content-Type': 'application/json'})
    page.click('.nav button:has-text("Mapas")'); page.wait_for_selector('.kml-file')
    check(page.locator('.kml-file').count() == 2 and 'campo2.kml' in page.inner_text('.kml-files') and 'Los Gatos' in page.inner_text('.kml-files'), 'kml: listado de 2 estancias con su archivo')
    page.locator('.kml-file').nth(1).locator('button[aria-label^="Renombrar"]').click(); page.locator('.kml-file').nth(1).locator('input').nth(0).fill('Campo norte')
    page.locator('.kml-file').nth(1).locator('button:has-text("Guardar")').click(); page.wait_for_timeout(400)
    check('Campo norte' in page.inner_text('.kml-files'), 'kml: renombrar una estancia')
    page.click('.avatar-btn'); page.wait_for_selector('.set-page')
    check('Campo norte' in page.inner_text('#sg-estancia >> xpath=../..') and 'LG' in page.inner_text('.set-page'), 'ajustes: estancias con su sigla')
    page.click('.nav button:has-text("Lotes")'); page.wait_for_selector('.lot-card')
    check('Sin silobolsas' in page.locator('.lot-card.is-casco').inner_text(), 'kml: el Casco figura sin silobolsas')
    page.click('.nav button:has-text("Mapas")'); page.wait_for_selector('.kml-file')
    page.locator('.kml-file').nth(1).locator('button[aria-label^="Quitar"]').click(); page.locator('.kml-file').nth(1).locator('button:has-text("Quitar")').click(); page.wait_for_timeout(500)
    st = page.request.get(URL + '/api.php?action=state').json()['state']
    check([l['num'] for l in st['lots']] == [1, 2, 3] and page.locator('.kml-file').count() == 1, 'kml: quitar un KML borra solo sus lotes')
    page.click('.avatar-btn'); page.wait_for_selector('.set-page')
    check('KML' in page.inner_text('.set-page') and page.locator('.geo-pt').count() == 0, 'kml: ajustes sin puntos de control')
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
    page.wait_for_selector('.geo-gate')
    check('Activá tu ubicación' in page.inner_text('.geo-gate') and page.locator('.geo-gate button:has-text("Permitir ubicación")').count() == 1, 'local: primero pide activar la ubicación')
    layout_checks(page, 'local ubicación')
    page.click('.geo-gate button:has-text("Ahora no")')
    page.wait_for_selector('.satmap'); page.wait_for_timeout(300)
    page.click('.nav-add'); page.wait_for_selector('.kml-sec')
    check(page.locator('.kml-sec').count() == 1, 'local: sin lotes con coordenadas, «+» lleva a cargar el KML')
    page.set_input_files('.kml-sec input[type=file]', str(KML)); page.wait_for_selector('.kml-row')
    page.locator('.kml-row').nth(2).locator('input').fill('3'); b3 = page.locator('.kml-sec .btn-primary'); b3.click(); page.wait_for_selector('.kml-confirm'); b3.click(); page.wait_for_selector('path.sat-lot', timeout=10000)
    page.reload(); page.wait_for_selector('path.sat-lot')
    check(page.locator('path.sat-lot').count() == 3, 'local: lotes del KML persisten tras recargar')
    page.click('.avatar-btn'); page.wait_for_selector('.set-page')
    heads = page.locator('.set-group-head h3').all_inner_texts()
    check(heads == ['Mi cuenta', 'Apariencia', 'Estancias', 'Usuarios', 'Lotes y ubicación', 'Datos'], f'local: ajustes ordenados {heads}')
    layout_checks(page, 'local ajustes')
    check(not bucket, f'local: sin errores de consola {bucket[:3]}')
    br.close()
print(f'e2e: {ok} OK, {len(errs)} fallas'); sys.exit(1 if errs else 0)
