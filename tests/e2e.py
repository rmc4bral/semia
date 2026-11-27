"""Prueba de punta a punta sin capturas: python3 tests/e2e.py <url_servidor> <carpeta_servidor>"""
import json, time, sys, shutil, pathlib, numpy as np
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


def set_kg(page, kg, tag=''):
    # celular: teclado numérico propio; computadora: se escribe en el campo
    inp = page.locator('.modal .num-input').first
    if inp.get_attribute('readonly') is not None:
        inp.click(); page.wait_for_selector('.kb-num')
        for k in [c for c in kg if c.isdigit()]: page.click(f'.kb-num .kb-key[data-k="{k}"]')
        conv = page.inner_text('.kb-conv')
        check(conv.startswith('= ') and conv.endswith(' t'), f'{tag} teclado numérico: conversión a toneladas en vivo ({conv})')
        page.click('.kb-done'); page.wait_for_selector('.kb-num', state='detached')
    else:
        inp.fill(kg)

def set_text(page, sel, text):
    ta = page.locator(sel).first
    if ta.get_attribute('readonly') is not None:
        ta.click(); page.wait_for_selector('.kb-text')
        for ch in text:
            if ch == ' ': page.click('.kb-text .kb-key[data-k="space"]')
            elif ch.isdigit():
                page.click('.kb-text .kb-key[data-k="num"]'); page.click(f'.kb-text .kb-key[data-k="{ch}"]'); page.click('.kb-text .kb-key[data-k="abc"]')
            else: page.click(f'.kb-text .kb-key[data-k="{ch.lower()}"]')
        page.click('.kb-bar-btn.is-done'); page.wait_for_selector('.kb-text', state='detached')
    else:
        ta.fill(text)

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

def mapas(pg):
    """Mapas del administrador: pestaña en escritorio; en el celular se entra desde Perfil."""
    nb = pg.locator('.nav button:has-text("Mapas")')
    if nb.count() and nb.first.is_visible(): nb.first.click()
    else:
        pg.click('.avatar-btn'); pg.wait_for_selector('.set-link'); pg.click('.set-link:has-text("Mapas")')
    pg.wait_for_timeout(300)

def ajustes(pg):
    """Ajustes del administrador: pestaña en escritorio; en el celular se entra desde Perfil."""
    nb = pg.locator('.nav button:has-text("Ajustes")')
    if nb.count() and nb.first.is_visible(): nb.first.click()
    else:
        pg.click('.avatar-btn'); pg.wait_for_selector('.set-link'); pg.click('.set-link:has-text("Ajustes")')
    pg.wait_for_selector('#sg-empresa')

with sync_playwright() as p:
    br = p.chromium.launch()
    for vp, tag in [((390, 844), 'móvil'), ((1440, 900), 'escritorio')]:
        shutil.copy(ROOT / 'public_html/data.seed.json', SRV / 'data.json')
        bucket = []
        ctx = br.new_context(viewport={'width': vp[0], 'height': vp[1]}, permissions=['geolocation'], geolocation={'latitude': -35.95, 'longitude': -60.38}, has_touch=vp[0] < 500)
        page = ctx.new_page(); watch(page, bucket)
        # landing pública en «/», con el lema y acceso a /login
        page.goto(URL + '/'); page.wait_for_selector('.hero h1')
        check('Control preciso de tu Producción' in page.inner_text('.hero h1') and page.locator('a[href="/login"]').count() >= 2, f'{tag}: landing con lema e «Ingresar»')
        check(page.evaluate("getComputedStyle(document.querySelector('.bg')).position") == 'fixed', f'{tag}: landing con fondo fijo')
        check(page.locator('.top .btn-demo').is_visible() and page.locator('.top .login-link').is_visible() and page.locator('#plataforma .feat article').count() == 6, f'{tag}: barra con Ingresar y Solicitar demo; Plataforma con 6 pilares')
        check(page.evaluate("getComputedStyle(document.querySelector('.top .btn-demo')).animationName") == 'orbit', f'{tag}: Solicitar demo con borde dinámico')
        page.evaluate("scrollTo(0, document.body.scrollHeight)"); page.wait_for_timeout(900)
        check(page.locator('.rv:not(.in)').count() == 0, f'{tag}: landing revela todas las secciones al desplazarse')
        check(page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f'{tag}: landing sin desborde horizontal')
        check(page.locator('.cookies.show').count() == 1, f'{tag}: aviso de cookies'); page.click('.cookies button'); page.wait_for_timeout(800)
        check(page.locator('.cookies').is_hidden(), f'{tag}: aviso de cookies se cierra')
        check(page.locator('.stage .iphone').count() == 1 and page.locator('.frames img').first.get_attribute('src').endswith('01-inicio.webp'), f'{tag}: iPhone con captura real')
        if tag == 'escritorio':
            page.evaluate("document.querySelector('#demo').scrollIntoView({block:'center'})"); page.wait_for_timeout(5200)
            check(page.locator('.touch.show, .touch.press').count() + int(page.inner_text('.cap .n')) > 1, f'{tag}: la demostración avanza y el dedo toca')
            page.goto(URL + '/#solicitar-demo'); page.wait_for_selector('#form')
            check(page.get_attribute('.seg button[data-m="demo"]', 'aria-checked') == 'true' and 'Solicitar Demo' in page.inner_text('#form button[type=submit]'), f'{tag}: formulario arranca en demo de 10 días')
            page.click('#form button[type=submit]'); page.wait_for_timeout(200)
            check(page.locator('#form .f.bad').count() == 5, f'{tag}: contacto valida los 5 obligatorios ({page.locator("#form .f.bad").count()})')
            for n, v in [('nombre', 'Ana'), ('apellido', 'Gómez'), ('email', 'ana@agro.com'), ('tel', '2346 555000'), ('empresa', 'Agro Gómez')]: page.fill(f'#form [name={n}]', v)
            page.click('.dd-btn'); page.wait_for_timeout(250); check(page.locator('.dd li').count() == 8, f'{tag}: ¿Cómo nos conociste? con 8 opciones')
            page.click('.dd li:has-text("LinkedIn")'); check(page.inner_text('.dd-btn') == 'LinkedIn', f'{tag}: lista desplegable propia')
            page.click('#form button[type=submit]'); page.wait_for_selector('.sent')
            check('demo de 10 días' in page.inner_text('.sent'), f'{tag}: solicitud de demo enviada')
            for path, h in [('/privacidad', 'Política de privacidad'), ('/terminos', 'Términos y condiciones'), ('/cookies', 'Política de cookies')]:
                r = page.goto(URL + path); check(r.status == 200 and h in page.inner_text('h1') and 'R. Maldonado' in page.inner_text('.doc') and 'Rodrigo' not in page.inner_text('body') and 'Copyright © ' in page.inner_text('footer'), f'{tag}: {path} con titular')
            page.goto(URL + '/privacidad'); check('25.326' in page.inner_text('.note') and 'AGENCIA DE ACCESO' in page.inner_text('.note'), f'{tag}: privacidad con leyenda de la AAIP')
            r = page.goto(URL + '/no-existe'); check(r.status == 404 and page.locator('.nf .code').count() == 1, f'{tag}: página 404')
        # sin sesión, el panel lleva al login
        page.goto(URL + '/dashboard/silos'); page.wait_for_selector('.login-card'); page.wait_for_timeout(200)
        check(page.url.endswith('/login'), f'{tag}: /dashboard sin sesión redirige a /login ({page.url})')
        check(page.get_attribute('.login-card button.check', 'aria-checked') == 'true' and 'Mantener sesión iniciada' in page.inner_text('.login-card'), f'{tag}: «Mantener sesión iniciada» marcado por defecto')
        page.fill('input[autocomplete=username]', 'rodma'); page.fill('input[type=password]', 'mal')
        page.click('button[type=submit]'); page.wait_for_selector('.form-err')
        check('incorrectos' in page.inner_text('.form-err'), f'{tag}: login rechaza clave errónea')
        page.fill('input[type=password]', 'rmaldonado'); page.click('button[type=submit]')
        page.wait_for_selector('.satmap'); page.wait_for_timeout(400)
        check(page.url.endswith('/dashboard/inicio') and page.get_attribute('html', 'data-theme') == 'light', f'{tag}: entra a /dashboard/inicio en tema claro ({page.url})')
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
            check('Estás adentro' in page.inner_text('.cap-near-row.is-first') and page.inner_text('.cap-near-row.is-first .cap-near-num') == '16', f'{tag}: lotes cercanos con distancia, el primero donde estás')
            check(page.locator('.cap-lot').count() >= 10, f'{tag}: también se puede elegir cualquier otro lote')
            ov = page.evaluate("() => [...document.querySelectorAll('.kpis, .screen, .dash')].some(e => e.scrollWidth > e.clientWidth + 1)")
            check(not ov, f'{tag}: sin desplazamiento horizontal')
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
            set_kg(page, kg, tag)
            check(page.locator('.silo-id-num').inner_text() == sid and 'Lote' in page.inner_text('.silo-id-parts'), f'{tag}: número de silobolsa detallado')
            page.click('.modal-foot .btn-primary'); page.wait_for_timeout(300)
            check(page.locator('.modal').count() == 1, f'{tag}: sin grano no deja guardar')
            page.click('.modal .pick:has-text("Soja")')
            set_text(page, '.modal textarea', 'Bolsa de prueba')
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
        ajustes(page); check(page.locator('.geo-pt').count() == 4, f'{tag}: 4 puntos de georreferencia')
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
        mapas(page); page.wait_for_selector('.dropzone')
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
        mapas(page); page.set_input_files('.maps-screen input[accept*=".tif"]', str(PNG)); page.wait_for_selector('.map-prev img')
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
        mapas(page); page.set_input_files('.maps-screen input[accept*=".tif"]', str(PDF)); page.wait_for_selector('.map-prev img', timeout=60000)
        check('sin coordenadas' in page.inner_text('.maps-screen .loc-box').lower() and '1 de 1' not in page.inner_text('.maps-screen .loc-box'), f'{tag}: PDF convertido a imagen')
        page.click('.maps-screen button:has-text("Subir mapa") >> nth=-1'); page.wait_for_selector('.edit-bar'); page.wait_for_timeout(400)
        page.click('.edit-bar button:has-text("Guardar")'); page.wait_for_selector('.edit-bar', state='detached')
        check(len(page.request.get(URL + '/api.php?action=state').json()['state']['maps']) == 3, f'{tag}: 3 mapas con el PDF')
        pick('Todos los mapas (3)'); check(page.locator('.warp-img').count() == 3, f'{tag}: todos = 3 mapas')
        pick('Vuelo octubre'); check(page.locator('.warp-img').count() == 1, f'{tag}: un solo mapa')
        mapas(page); page.wait_for_selector('.maps-item'); page.wait_for_timeout(400)
        check(page.locator('.maps-item').count() == 3 and page.locator('path.glob-foot').count() == 3, f'{tag}: listado general y mapa global con 3 mapas')
        check('PDF' in page.inner_text('.maps-list') and 'Imagen' in page.inner_text('.maps-list'), f'{tag}: tipo de cada mapa en el listado')
        page.fill('.maps-filters input', 'plano'); page.wait_for_timeout(150)
        check(page.locator('.maps-item').count() == 1, f'{tag}: buscar en el listado')
        page.fill('.maps-filters input', ''); layout_checks(page, tag + ' mapas')
        page.click('.glob-head button:has-text("Contornos")'); page.wait_for_timeout(200)
        check(page.locator('.glob-map .warp-img').count() == 0, f'{tag}: mapa global solo contornos')
        page.click('.nav button:has-text("Inicio")')
        page.click('.nav button:has-text("Inicio")'); page.wait_for_selector('.satmap'); layout_checks(page, tag + ' mapa final')
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
    page.goto(URL + '/login'); page.wait_for_selector('.login-card')
    page.fill('input[autocomplete=username]', 'rodma'); page.fill('input[type=password]', 'rmaldonado'); page.click('button[type=submit]')
    page.wait_for_selector('.satmap')
    mapas(page); page.wait_for_selector('.kml-sec')
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
    set_kg(page, '210000', 'kml'); page.click('.modal .pick:has-text("Maíz")')
    page.locator('.modal .num-input').nth(1).click(); page.wait_for_selector('.kb-num')
    for k in '14,5': page.click(f'.kb-num .kb-key[data-k="{k}"]')
    page.click('.kb-done'); page.wait_for_selector('.kb-num', state='detached'); page.click('.modal .prio-pick .pick.is-media'); page.click('.modal-foot .btn-primary'); page.wait_for_selector('.modal', state='detached')
    s_ = page.request.get(URL + '/api.php?action=state').json()['state']['silos'][0]
    check(s_.get('hum') == 14.5 and s_.get('prio') == 'media', f"silo: humedad al embolsar y prioridad media ({s_.get('hum')}, {s_.get('prio')})")
    check(mdist(s_['latlng2'], (-35.9455, -60.3852)) < 0.5 and 50 < s_['largo'] < 62, f"kml: cola y largo exactos ({s_['largo']} m)")
    # saludo según la hora y navegación a pie
    g = page.inner_text('.greet')
    check(any(g.startswith(x) for x in ('Buenos días', 'Buenas tardes', 'Buenas noches')) and ', ' in g, f'inicio: saludo según la hora ({g})')
    ctx.set_geolocation({'latitude': -35.9470, 'longitude': -60.3860, 'accuracy': 4}); page.wait_for_timeout(1200)
    page.click('.nav-start'); page.wait_for_selector('.nav-top')
    check(page.locator('.nav-near-row').count() >= 1 and 'm' in page.inner_text('.nav-near-row em'), f"navegar: silobolsas cercanas con distancia ({page.inner_text('.nav-near-row em')})")
    check(page.locator('path.sat-gap').count() >= 1 and page.locator('.sat-gap-lbl').count() >= 1, 'navegar: líneas con la separación a los silos')
    page.locator('.nav-near-row').first.click(); page.wait_for_timeout(500)
    tt = page.inner_text('.nav-top')
    check(page.locator('path.sat-route').count() == 1 and ' m' in tt and 'a pie' in tt and s_['id'] in tt, f'navegar: ruta, distancia y tiempo hasta el silo ({tt[:60]})')
    ctx.set_geolocation({'latitude': -35.9462, 'longitude': -60.3856, 'accuracy': 4}); page.wait_for_timeout(1500)
    check(page.locator('.nav-me svg').count() == 1, 'navegar: flecha con el rumbo al caminar')
    check(page.locator('path.sat-trail').count() == 1, 'navegar: dibuja el recorrido')
    ctx.set_geolocation({'latitude': s_['latlng'][0], 'longitude': s_['latlng'][1], 'accuracy': 4}); page.wait_for_timeout(1500)
    check('Llegaste' in page.inner_text('.nav-top'), 'navegar: aviso de llegada')
    layout_checks(page, 'navegación')
    page.click('.navi-foot button:has-text("Terminar")'); check(page.locator('.nav-top').count() == 0, 'navegar: terminar')
    # Estadísticas: totales, anillos de prioridad, gráficos y período con calendario propio
    page.click('.nav button:has-text("Estadísticas")'); page.wait_for_selector('.st-kpis'); page.wait_for_timeout(1300)
    check(page.url.endswith('/dashboard/estadisticas') and page.title() == 'Acopia · Estadísticas', f'estadísticas: ruta y título ({page.url})')
    st = page.request.get(URL + '/api.php?action=state').json()['state']['silos']
    vivos = [x for x in st if not x.get('fin')]
    k0 = page.locator('.st-kpi b').first.inner_text()
    check(k0 == str(len(vivos)), f'estadísticas: total de silobolsas en stock ({k0} = {len(vivos)})')
    check(page.locator('.st-prio .ring').count() == 3 and page.locator('.st-var .donut').count() == 1 and page.locator('.st-mes .col').count() >= 1, 'estadísticas: anillos de prioridad, variedades y gráfico mensual')
    off = page.evaluate("[...document.querySelectorAll('.st-prio .ring-arc')].map(c => +c.getAttribute('stroke-dashoffset'))")
    check(any(o > 0 for o in off) and page.locator('.st-prio .ring-in b').first.inner_text().endswith('%'), f'estadísticas: anillos con porcentaje ({off})')
    page.click('.stats-filters .date-btn'); page.wait_for_selector('.cal-range')
    check(page.locator('.cal-range .cal-day').count() >= 28 and page.locator('input[type=date]').count() == 0, 'estadísticas: calendario propio (sin control nativo)')
    page.click('.cal-range .cal-day.is-today'); page.click('.cal-range .cal-day.is-today'); page.wait_for_timeout(500)
    hoy = time.strftime('%d/%m/%y')
    check(hoy in page.inner_text('.stats-filters .date-btn') and hoy in page.inner_text('.screen-head'), f"estadísticas: filtra por fecha ({page.inner_text('.stats-filters .date-btn')})")
    page.click('.stats-filters .date-btn'); page.click('.cal-presets .select-opt:has-text("Todo el período")'); page.wait_for_timeout(300)
    layout_checks(page, 'estadísticas')
    # Despacho: inicio de extracción y finalización desde cada línea del listado de silos
    page.click('.nav button:has-text("Silos")'); page.wait_for_selector('.silo-line')
    n0 = page.locator('.list-card .silo-line').count()
    page.locator(f'.silo-line:has-text("{s_["id"]}") .row-act').click(); page.wait_for_selector('.modal:has-text("Despacho de la bolsa")')
    page.locator('.modal .field:has(.field-label:text-is("Inicio de extracción")) .date-btn').click(); page.click('.cal-pop .cal-link:has-text("Hoy")')
    page.click('.modal-foot button:has-text("Guardar inicio")'); page.wait_for_selector('.modal', state='detached'); page.wait_for_timeout(300)
    check('En extracción' in page.inner_text(f'.silo-line:has-text("{s_["id"]}")'), 'despacho: la bolsa queda en extracción')
    page.locator(f'.silo-line:has-text("{s_["id"]}") .row-act').click(); page.wait_for_selector('.modal:has-text("Despacho de la bolsa")')
    page.locator('.modal .field:has(.field-label:text-is("Finalización")) .date-btn').click(); page.click('.cal-pop .cal-link:has-text("Hoy")')
    page.click('.modal-foot button:has-text("Marcar finalizada")'); page.wait_for_selector('.modal', state='detached'); page.wait_for_timeout(400)
    sf = next(x for x in page.request.get(URL + '/api.php?action=state').json()['state']['silos'] if x['id'] == s_['id'])
    check(sf.get('inicio') == time.strftime('%Y-%m-%d') and sf.get('fin') == time.strftime('%Y-%m-%d'), f"despacho: fechas de inicio y finalización ({sf.get('inicio')}, {sf.get('fin')})")
    check(page.locator('.list-card .silo-line').count() == n0 - 1, 'despacho: la finalizada sale de las activas')
    page.locator('.filters .field:has(.field-label:text-is("Estado")) .select').click(); page.click('.select-opt:has-text("Finalizadas")'); page.wait_for_timeout(200)
    check(page.locator('.list-card .silo-line').count() == 1 and 'Finalizada' in page.inner_text('.list-card .silo-line'), 'despacho: filtro Estado = Finalizadas')
    page.locator('.filters .field:has(.field-label:text-is("Estado")) .select').click(); page.click('.select-opt:has-text("Activas")')
    page.click('.nav button:has-text("Estadísticas")'); page.wait_for_selector('.st-kpis'); page.wait_for_timeout(1200)
    check(page.locator('.st-kpi b').first.inner_text() == str(len(vivos) - 1) and '1 bolsa finalizada' in page.inner_text('.st-kpis'), f"estadísticas: el despacho se refleja ({page.locator('.st-kpi b').first.inner_text()})")
    page.click('.nav button:has-text("Silos")'); page.wait_for_selector('.list-card')
    page.locator('.filters .field:has(.field-label:text-is("Estado")) .select').click(); page.click('.select-opt:has-text("Finalizadas")'); page.wait_for_selector('.silo-line')
    page.locator('.silo-line .row-act').first.click(); page.click('.modal-foot button:has-text("Reabrir bolsa")'); page.wait_for_selector('.modal', state='detached'); page.wait_for_timeout(300)
    sf = next(x for x in page.request.get(URL + '/api.php?action=state').json()['state']['silos'] if x['id'] == s_['id'])
    check(not sf.get('fin') and not sf.get('inicio'), 'despacho: reabrir la bolsa')
    page.locator('.filters .field:has(.field-label:text-is("Estado")) .select').click(); page.click('.select-opt:has-text("Activas")')
    page.click('.nav button:has-text("Inicio")'); page.wait_for_selector('.satmap'); page.wait_for_timeout(300)
    # agregar un segundo KML sin perder lo cargado
    KML2 = TMP / 'campo2.kml'
    KML2.write_text(f"""<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Lote 2</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.97, -60.40)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Lote 5</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.97, -60.39)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Casco</name><Polygon><outerBoundaryIs><LinearRing><coordinates>{rect(-35.98, -60.40, 0.004)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>""", encoding='utf-8')
    mapas(page); page.wait_for_selector('.kml-file')
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
    page.click('.nav button:has-text("Inicio")'); page.wait_for_selector('path.sat-lot')
    ctx.set_geolocation({'latitude': -35.975, 'longitude': -60.395, 'accuracy': 3}); page.wait_for_timeout(1200)
    page.click('.nav-add'); page.wait_for_selector('.cap-lots'); page.click('.cap-lot.is-sug'); page.click('.cap-btn'); page.wait_for_selector('.cap-dist', timeout=15000)
    page.click('.cap-foot button:has-text("Solo un punto")')
    page.wait_for_function("() => (document.querySelector('.modal .silo-id-num')?.textContent || '').length > 3", timeout=15000)
    check(page.inner_text('.modal .silo-id-num') == 'LG02001' and 'Los Gatos' in page.inner_text('.modal .silo-id'), f"estancia: ID con la sigla de su estancia ({page.inner_text('.modal .silo-id-num')})")
    page.click('.modal .pick:has-text("Otro")'); page.fill('.modal .field:has-text("¿Qué variedad?") input', 'Colza')
    page.click('.modal-foot .btn-primary'); page.wait_for_selector('.modal', state='detached')
    st = page.request.get(URL + '/api.php?action=state').json()['state']
    lg = next(x for x in st['silos'] if x['id'] == 'LG02001')
    check(lg['kg'] is None and lg['grano'] == 'Colza', f"silo: kg opcional y grano «Otro» escrito ({lg['kg']}, {lg['grano']})")
    check(lg['lot'] == st['georef']['kmls'][1]['id'] + ':2' and next(x for x in st['silos'] if x['id'] == 'RB02001')['lot'].endswith(':2') and next(x for x in st['silos'] if x['id'] == 'RB02001')['lot'] != lg['lot'], 'estancia: cada silo queda en el lote 2 de su estancia')
    page.request.post(URL + '/api.php?action=deleteSilo', data=json.dumps({'id': 'LG02001'}), headers={'Content-Type': 'application/json'})
    page.reload(); page.wait_for_selector('path.sat-lot')
    check('Casco' in [t.strip() for t in page.locator('.sat-label').all_inner_texts()], 'kml: lote «Casco» con nombre en el mapa')
    # filtro Estancia (cada KML)
    est = page.locator('.map-layers .field:has-text("Sección") .select')
    check(est.count() == 1, 'estancia: filtro en el mapa con 2 KML')
    est.click(); page.click('.select-opt:has-text("Los Gatos")'); page.wait_for_timeout(600)
    check(page.locator('path.sat-lot').count() == 3 and 'Casco' in page.inner_text('.leaflet-container'), 'estancia: el mapa muestra solo los lotes de esa estancia')
    check('0' in page.inner_text('.kpi.is-hero') or 't' in page.inner_text('.kpi.is-hero'), 'estancia: indicadores de la estancia')
    dm = page.evaluate("() => { const c = document.querySelector('.leaflet-container'), p = document.querySelector('.leaflet-semiaColor-pane'); return [c.classList.contains('has-lots'), (p.style.clipPath || '').startsWith('path('), getComputedStyle(document.querySelector('.sat-base')).filter] }")
    check(dm[0] and dm[1] and 'grayscale' in dm[2], f'mapa: lotes a color y el resto en blanco y negro {dm}')
    page.click('.nav button:has-text("Lotes")'); page.wait_for_selector('.lot-card')
    check(page.locator('.lot-card').count() == 3, 'estancia: la pestaña Lotes respeta el filtro')
    page.fill('.lots-filters input', 'cas'); page.wait_for_timeout(150)
    check(page.locator('.lot-card').count() == 1, 'estancia: buscar lote por nombre')
    page.locator('.lots-filters input').press('Enter'); page.wait_for_timeout(300)
    check(page.locator('.modal').count() == 0, 'enter: en un buscador no dispara nada')
    page.fill('.lots-filters input', '')
    # Enter guarda: hectáreas de un lote
    page.locator('.lot-card').first.locator('button[aria-label^="Configurar"]').click(); page.wait_for_selector('.modal')
    ha = page.locator('.modal .field:has-text("Hectáreas") input').first
    check(',' in ha.input_value() or ha.input_value().isdigit(), f'lote: hectáreas con coma decimal ({ha.input_value()})')
    ha.click(); page.wait_for_selector('.kb-num')
    for _ in range(8): page.click('.kb-num .kb-key[data-k="del"]')
    for k in '123,5': page.click(f'.kb-num .kb-key[data-k="{k}"]')
    check(page.inner_text('.kb-val').startswith('123,5'), f"lote: teclado numérico con decimales ({page.inner_text('.kb-val')})")
    page.click('.kb-done'); page.click('.modal-foot .btn-primary')
    page.wait_for_selector('.modal', state='detached', timeout=5000)
    st2 = page.request.get(URL + '/api.php?action=state').json()['state']
    check(any(abs(float(l.get('ha') or 0) - 123.5) < 0.01 for l in st2['lots']), 'lote: guarda 123,5 ha (no 1235)')
    page.locator('.lots-filters .select').click(); page.click('.select-opt:has-text("Todas las secciones")'); page.wait_for_timeout(200)
    check(page.locator('.lot-card').count() == 6, 'estancia: todas = 6 lotes')
    page.click('.nav button:has-text("Silos")'); page.wait_for_selector('.filters')
    check(page.locator('.filters .field:has-text("Sección")').count() == 1, 'estancia: filtro también en Silos')
    page.click('.nav button:has-text("Inicio")'); page.wait_for_selector('path.sat-lot')
    check(next(x for x in st['silos'] if x['id'] == 'RB02001')['largo'] == s_['largo'], 'kml: la bolsa cargada no cambió')
    # supervisor: login → estancia → ubicación → solo Mapa, Silos, + y Lotes
    # Usuarios: el administrador da de alta al supervisor desde su propio menú
    page.click('.avatar-btn'); page.wait_for_selector('.set-link'); page.click('.set-link:has-text("Usuarios")'); page.wait_for_selector('.user-row')
    check(page.url.endswith('/dashboard/usuarios') and page.title() == 'Acopia · Usuarios', f'usuarios: ruta y título ({page.url})')
    page.click('button:has-text("Nuevo usuario")'); page.wait_for_selector('.user-form')
    fv = lambda lab, v: page.locator(f'.user-form .field:has(.field-label:text-is("{lab}")) input').fill(v)
    fv('Usuario', 'juan'); fv('Nombre', 'Juan'); fv('Apellido', 'Pérez'); fv('Email', 'juan@campo.com'); fv('Celular', '+54 9 2346 555123'); fv('Contraseña', 'juan123')
    layout_checks(page, 'usuarios alta')
    page.click('.user-form button:has-text("Crear usuario")'); page.wait_for_selector('.user-row:has-text("Juan Pérez")')
    jr = page.inner_text('.user-row:has-text("Juan Pérez")')
    check('Supervisor' in jr and 'juan@campo.com' in jr and '555123' in jr, f'usuarios: alta con rol, email y celular ({jr})')
    # Perfil: el administrador completa sus datos
    page.click('.avatar-btn'); page.wait_for_selector('#sg-perfil')
    pf = lambda lab: page.locator(f'#sg-perfil >> xpath=../.. >> .field:has(.field-label:text-is("{lab}")) input')
    check(pf('Nombre').input_value() == 'R.' and pf('Apellido').input_value() == 'Maldonado', f"perfil: nombre y apellido por separado ({pf('Nombre').input_value()} / {pf('Apellido').input_value()})")
    pf('Nombre').fill('Rodrigo')
    page.locator('#sg-perfil >> xpath=../.. >> .field:has(.field-label:text-is("Email")) input').fill('rodma@acopia.app')
    page.locator('#sg-perfil >> xpath=../.. >> .field:has(.field-label:text-is("Celular")) input').fill('2346 400500')
    page.click('.set-page button:has-text("Guardar")'); page.wait_for_timeout(600)
    me_ = next(u for u in page.request.get(URL + '/api.php?action=state').json()['state']['users'] if u['user'] == 'rodma')
    check(me_.get('email') == 'rodma@acopia.app' and '400500' in me_.get('tel', '') and me_.get('nombre') == 'Rodrigo' and me_.get('apellido') == 'Maldonado', f'perfil: guarda nombre, apellido, email y celular {me_}')
    check(', Rodrigo' in page.locator('.greet').inner_text() if page.locator('.greet').count() else True, 'perfil: el saludo usa el nombre')
    sctx = br.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, geolocation={'latitude': -35.9455, 'longitude': -60.3852, 'accuracy': 3})
    sp = sctx.new_page(); sbucket = []; watch(sp, sbucket)
    sp.goto(URL + '/login'); sp.wait_for_selector('.login-card')
    sp.fill('input[autocomplete=username]', 'juan'); sp.fill('input[type=password]', 'juan123'); sp.click('button[type=submit]')
    sp.wait_for_selector('.est-gate')
    check(sp.locator('.est-opt').count() == 2 and 'Los Gatos' in sp.inner_text('.est-gate') and 'Paso 1 de 2' in sp.inner_text('.est-gate'), 'supervisor: primero elige la estancia')
    layout_checks(sp, 'supervisor estancia')
    sp.click('.est-opt:has-text("Rincón de Baguales")'); sp.wait_for_selector('.geo-gate:not(.est-gate)')
    check('Paso 2 de 2' in sp.inner_text('.geo-gate') and sp.locator('.geo-gate button:has-text("Ahora no")').count() == 0, 'supervisor: la ubicación es obligatoria (sin «Ahora no»)')
    sctx.grant_permissions(['geolocation']); sp.click('.geo-gate button:has-text("Permitir ubicación")'); sp.wait_for_selector('.satmap'); sp.wait_for_timeout(800)
    navs = [t.strip() for t in sp.locator('.nav .nav-item:visible').all_inner_texts()]
    check(navs == ["Inicio", "Silos", "Lotes", "Perfil"] and sp.title() == "Acopia · Inicio" and sp.locator('.avatar-btn').count() == 0, f'supervisor: menú reducido {navs}')
    check(sp.locator('.map-layers .field:has-text("Sección")').count() == 0 and sp.locator('path.sat-lot').count() == 3, 'supervisor: solo ve los lotes de su estancia, sin filtro')
    ab = sp.locator('.nav-add').bounding_box(); check(ab['width'] >= 68, f'supervisor: botón + más grande ({ab["width"]:.0f}px)')
    sp.click('.nav-add'); sp.wait_for_selector('.cap-lots')
    lots_ = [t.strip() for t in sp.locator('.cap-lot b').all_inner_texts()]
    check(lots_ == ['1', '2', '3'] and sp.inner_text('.cap-lot.is-sug b') == '2' and sp.locator('.cap-near-row').count() >= 1, f'supervisor: elige entre los lotes con número de su estancia {lots_}')
    sp.click('.cap-lot:has(b:text-is("3"))'); sp.wait_for_selector('.cap-btn')
    check('afuera del lote 3' in sp.inner_text('.cap-border'), 'supervisor: avisa si está lejos del lote elegido')
    sp.click('.cap-btn'); sp.wait_for_selector('.cap-dist', timeout=15000); sp.click('.cap-foot button:has-text("Solo un punto")')
    sp.wait_for_function("() => (document.querySelector('.modal .silo-id-num')?.textContent || '').length > 3", timeout=15000)
    check(sp.inner_text('.modal .silo-id-num') == 'RB03001', f"supervisor: respeta el lote elegido aunque el GPS caiga en otro ({sp.inner_text('.modal .silo-id-num')})")
    check('afuera del lote 3' in sp.inner_text('.modal'), 'supervisor: la ficha advierte la distancia al lote')
    sp.click('.modal .pick:has-text("Soja")')
    sp.locator('.modal .num-input').first.click(); sp.wait_for_selector('.kb-num')
    for k in '200000': sp.click(f'.kb-num .kb-key[data-k="{k}"]')
    check(sp.inner_text('.kb-val').startswith('200.000') and sp.inner_text('.kb-conv') == '= 200 t', f"supervisor: teclado numérico propio con toneladas ({sp.inner_text('.kb-conv')})")
    layout_checks(sp, 'supervisor teclado numérico')
    sp.click('.kb-done'); check(sp.inner_text('.modal .num-conv') == '= 200 t', 'supervisor: conversión debajo del campo')
    sp.locator('.modal textarea').click(); sp.wait_for_selector('.kb-text')
    for k in ['b', 'o', 'l', 's', 'a', 'space', 'r', 'o', 't', '´', 'a']: sp.click(f'.kb-text .kb-key[data-k="{k}"]')
    check(sp.input_value('.modal textarea') == 'Bolsa rotá', f"supervisor: teclado de texto propio con mayúscula y tilde ({sp.input_value('.modal textarea')})")
    check(sp.locator('.kb-bar-btn:has-text("Sistema")').count() == 1, 'supervisor: opción de volver al teclado del celular (dictado)')
    kb_top = sp.locator('.kb-text').bounding_box()['y']; ta_box = sp.locator('.modal textarea').bounding_box()
    check(ta_box['y'] + ta_box['height'] <= kb_top + 1, 'supervisor: el teclado no tapa el campo')
    sp.click('.kb-bar-btn.is-done')
    sp.click('.modal-foot .btn-primary'); sp.wait_for_selector('.modal', state='detached')
    sp.click('.nav button:has-text("Silos")'); sp.wait_for_selector('.list-card .silo-row')
    check(sp.locator('.list-card .silo-row').count() == 2 and sp.locator('.screen-head button:has-text("CSV")').count() == 0, 'supervisor: ve las cargas activas de su estancia')
    sp.locator('.list-card .silo-row:has-text("RB03001")').click(); sp.wait_for_selector('.card-facts')
    facts = sp.inner_text('.modal')
    check(all(x in facts for x in ['RB03001', 'Rincón de Baguales', 'Lote 3', 'Soja', '200.000 kg', 'Juan Pérez', 'Embolsado', 'Lugar']), 'supervisor: tarjeta con id, estancia, lote, grano, kg, lugar, fecha y usuario')
    layout_checks(sp, 'supervisor ficha')
    # prioridad de salida: el supervisor la marca desde la ficha
    sp.click('.modal .prio-pick .pick.is-alta'); sp.wait_for_timeout(500)
    s3 = next(x for x in sp.request.get(URL + '/api.php?action=state').json()['state']['silos'] if x['id'] == 'RB03001')
    check(s3.get('prio') == 'alta' and s3.get('prioPor') == 'juan', f"prioridad: el supervisor marca Alta ({s3.get('prio')}, {s3.get('prioPor')})")
    sp.click('.modal-head button[aria-label="Cerrar"]'); sp.wait_for_timeout(300)
    check(sp.locator('.list-card .silo-row').first.locator('.prio-tag').inner_text() == 'Alta', 'prioridad: la bolsa Alta encabeza la lista (orden por prioridad)')
    sp.locator('.filters .field:has(.field-label:text-is("Prioridad")) .select').click(); sp.click('.select-opt:has-text("Alta")'); sp.wait_for_timeout(200)
    check(sp.locator('.list-card .silo-row').count() == 1, 'prioridad: filtro Prioridad = Alta')
    sp.locator('.filters .field:has(.field-label:text-is("Prioridad")) .select').click(); sp.click('.select-opt:has-text("Todas")')
    sp.click('.nav button:has-text("Lotes")'); sp.wait_for_selector('.lot-card')
    check(sp.locator('.lot-card button[aria-label^="Configurar"]').count() == 0, 'supervisor: no configura lotes')
    sp.locator('.lot-card:has(.lot-card-num:text-is("2")) .lot-card-main').click(); sp.wait_for_selector('.lot-sum')
    check('Maíz' in sp.inner_text('.grano-break') and '210 t' in sp.inner_text('.lot-sum') and '1' in sp.inner_text('.lot-sum'), f"supervisor: lote con silos, grano y toneladas ({sp.inner_text('.lot-sum')})")
    layout_checks(sp, 'supervisor lote'); sp.click('.modal-head button[aria-label="Cerrar"]')
    sp.click('.nav button:has-text("Perfil")'); sp.wait_for_selector('.set-page')
    heads = sp.locator('.set-group-head h3').all_inner_texts()
    check(heads == ['Mis datos', 'Apariencia', 'Sección de trabajo'] and sp.url.endswith('/dashboard/perfil'), f'supervisor: perfil {heads}')
    sp.click('button:has-text("Cambiar sección")'); sp.wait_for_selector('.est-gate'); sp.click('.est-opt:has-text("Los Gatos")'); sp.wait_for_selector('.satmap'); sp.wait_for_timeout(600)
    check(sp.locator('path.sat-lot').count() == 3 and 'Los Gatos' in sp.inner_text('.topbar'), 'supervisor: cambia de estancia (ubicación ya activa)')
    check(not sbucket, f'supervisor: sin errores de consola {sbucket[:3]}')
    sctx.close()
    page.request.post(URL + '/api.php?action=deleteSilo', data=json.dumps({'id': 'RB03001'}), headers={'Content-Type': 'application/json'})
    mapas(page); page.wait_for_selector('.kml-file')
    check(page.locator('.kml-file').count() == 2 and 'campo2.kml' in page.inner_text('.kml-files') and 'Los Gatos' in page.inner_text('.kml-files'), 'kml: listado de 2 estancias con su archivo')
    page.locator('.kml-file').nth(1).locator('button[aria-label^="Renombrar"]').click(); page.locator('.kml-file').nth(1).locator('input').nth(0).fill('Campo norte')
    page.locator('.kml-file').nth(1).locator('button:has-text("Guardar")').click(); page.wait_for_timeout(400)
    check('Campo norte' in page.inner_text('.kml-files'), 'kml: renombrar una estancia')
    ajustes(page)
    check('Campo norte' in page.inner_text('#sg-estancia >> xpath=../..') and 'LG' in page.inner_text('.set-page'), 'ajustes: estancias con su sigla')
    page.click('.nav button:has-text("Lotes")'); page.wait_for_selector('.lot-card')
    check('Sin silobolsas' in page.locator('.lot-card.is-casco').inner_text(), 'kml: el Casco figura sin silobolsas')
    mapas(page); page.wait_for_selector('.kml-file')
    page.locator('.kml-file').nth(1).locator('button[aria-label^="Quitar"]').click(); page.locator('.kml-file').nth(1).locator('button:has-text("Quitar")').click(); page.wait_for_timeout(500)
    st = page.request.get(URL + '/api.php?action=state').json()['state']
    check([l['num'] for l in st['lots']] == [1, 2, 3] and page.locator('.kml-file').count() == 1, 'kml: quitar un KML borra solo sus lotes')
    ajustes(page)
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
    page.goto((ROOT / 'public_html/app.html').as_uri()); page.wait_for_selector('.login-card')
    check('Modo local' in page.inner_text('.login-card'), 'local: detecta modo local')
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
    check(heads == ['Mis datos', 'Apariencia'] and page.locator('.set-link').count() == 3, f'local: perfil del administrador {heads}')
    page.click('.set-link:has-text("Ajustes")'); page.wait_for_selector('#sg-empresa')
    heads = page.locator('.set-group-head h3').all_inner_texts()
    check(heads == ['Empresa', 'Variedades', 'Secciones', 'Lotes y ubicación', 'Datos'], f'local: ajustes ordenados {heads}')
    # variedades propias de la empresa: agregar, renombrar y quitar
    page.locator('.var-add input').fill('Soja DM 46i20'); page.keyboard.press('Enter'); page.wait_for_selector('.var-row:has-text("Soja DM 46i20")')
    check(page.locator('.var-row').count() == 7, f"variedades: agregar ({page.locator('.var-row').count()})")
    page.click('.var-row:has-text("Cebada") button[aria-label="Renombrar Cebada"]'); page.locator('.var-edit input').fill('Cebada cervecera'); page.keyboard.press('Enter')
    page.wait_for_selector('.var-row:has-text("Cebada cervecera")')
    page.click('.var-row:has-text("Sorgo") button[aria-label="Quitar Sorgo"]'); page.click('.var-row button:has-text("Quitar")'); page.wait_for_timeout(300)
    vs = page.locator('.var-name b').all_inner_texts()
    check('Sorgo' not in vs and 'Cebada cervecera' in vs and vs[-1] == 'Soja DM 46i20', f'variedades: renombrar y quitar {vs}')
    d_ = page.evaluate("JSON.parse(localStorage.getItem('semia.data.v1') || 'null')") or {}
    check((d_.get('variedades') or [])[-1:] == ['Soja DM 46i20'], f"variedades: se guardan en el modo local ({(d_.get('variedades') or [])[-2:]})")
    layout_checks(page, 'local ajustes')
    check(not bucket, f'local: sin errores de consola {bucket[:3]}')
    br.close()
print(f'e2e: {ok} OK, {len(errs)} fallas'); sys.exit(1 if errs else 0)
