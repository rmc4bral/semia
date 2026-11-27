# Capturas reales de la app para la landing (se corre en GitHub Actions, que tiene acceso a las imágenes satelitales).
# Uso: python3 tests/capturas.py http://127.0.0.1:PUERTO DIR_DATOS SALIDA
# Arma una sección de ejemplo con 6 lotes, registra silobolsas sobre el borde de los lotes (como en el campo)
# y guarda cada pantalla del recorrido con la posición de los botones que toca el dedo en la animación.
import json, shutil, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL, DAT, OUT = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
ROOT = Path(__file__).resolve().parent.parent
OUT.mkdir(parents=True, exist_ok=True)
DAT.mkdir(parents=True, exist_ok=True)
shutil.copy(ROOT / 'public_html/data.seed.json', DAT / 'data.json')

# 6 lotes de ~100 ha (3 × 2) con un camino interno entre las dos filas
LA0, LO0, W, H, GAP = -35.9400, -60.4000, 0.0110, 0.0090, 0.0004
def lot(col, row):
    a = LO0 + col * (W + GAP); top = LA0 - row * (H + GAP)
    return dict(w=a, e=a + W, n=top, s=top - H)
LOTS = {31 + r * 3 + c: lot(c, r) for r in range(2) for c in range(3)}
def ring(b):
    pts = [(b['w'], b['n']), (b['e'], b['n']), (b['e'], b['s']), (b['w'], b['s']), (b['w'], b['n'])]
    return ' '.join(f'{x:.6f},{y:.6f},0' for x, y in pts)
kml = OUT / 'la-aurora.kml'
kml.write_text('<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>La Aurora</name>' + ''.join(
    f'<Placemark><name>Lote {n}</name><ExtendedData><Data name="ha"><value>{98 + n % 7}</value></Data></ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>{ring(b)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>'
    for n, b in LOTS.items()) + '</Folder></Document></kml>', encoding='utf-8')

# silobolsas: sobre el borde que da al camino, a ~15 m del alambrado, de 60 m de largo
M_LAT, M_LNG = 1 / 111320, 1 / 90200   # grados por metro a esta latitud
def bolsa(n, desde_m, fila=0):
    b = LOTS[n]; arriba = n <= 33
    la = (b['s'] + (15 + fila * 9) * M_LAT) if arriba else (b['n'] - (15 + fila * 9) * M_LAT)
    lo = b['w'] + desde_m * M_LNG
    return (la, lo), (la, lo + 60 * M_LNG)
SILOS = [  # lote, metros desde la esquina, fila, kg, grano, humedad, prioridad
    (31, 140, 0, '214300', 'Soja', '128', 'alta'), (31, 140, 1, '198700', 'Soja', '139', 'media'),
    (32, 380, 0, '232900', 'Maíz', '152', 'media'), (33, 600, 0, '176400', 'Trigo', '121', 'alta'),
    (34, 220, 0, '205800', 'Maíz', '171', 'baja'), (35, 480, 0, '189200', 'Girasol', '94', 'alta'),
]
ULTIMO = (36, 300, 0, '212300', 'Soja', '132', 'alta')   # la bolsa que se registra en la animación

boxes = {}
def shot(pg, name, *sels):
    pg.wait_for_timeout(350)
    pg.screenshot(path=str(OUT / f'{name}.png'))
    for s in sels:
        bb = pg.locator(s).first.bounding_box()
        boxes.setdefault(name, []).append({'sel': s, 'x': round((bb['x'] + bb['width'] / 2) / 390 * 100, 2), 'y': round((bb['y'] + bb['height'] / 2) / 797 * 100, 2)})

def kg_keys(pg, field_idx, digits, close=True):
    pg.locator('.modal .num-input').nth(field_idx).click(); pg.wait_for_selector('.kb-num')
    for k in digits: pg.click(f'.kb-num .kb-key[data-k="{k}"]')
    if close: pg.click('.kb-done'); pg.wait_for_selector('.kb-num', state='detached')

def registrar(pg, ctx, s, frames=False):
    n, m, fila, kg, grano, hum, prio = s
    (a, b) = bolsa(n, m, fila)
    ctx.set_geolocation({'latitude': a[0] - 40 * M_LAT * (1 if n <= 33 else -1), 'longitude': a[1], 'accuracy': 3}); pg.wait_for_timeout(1500)
    if frames: pg.wait_for_timeout(2500); shot(pg, '01-inicio', '.nav-add')
    pg.click('.nav-add'); pg.wait_for_selector('.cap-lots'); pg.wait_for_timeout(900)
    if frames: shot(pg, '02-lote', f'.cap-lot[aria-label="Lote {n}"]')
    pg.click(f'.cap-lot[aria-label="Lote {n}"]'); pg.wait_for_selector('.cap-btn')
    ctx.set_geolocation({'latitude': a[0], 'longitude': a[1], 'accuracy': 3}); pg.wait_for_timeout(2200)
    if frames: shot(pg, '03-cabecera', '.cap-btn')
    pg.click('.cap-btn'); pg.wait_for_selector('.cap-dist', timeout=20000)
    ctx.set_geolocation({'latitude': b[0], 'longitude': b[1], 'accuracy': 3}); pg.wait_for_timeout(2200)
    if frames: shot(pg, '04-cola', '.cap-btn')
    pg.click('.cap-btn')
    pg.wait_for_function("() => (document.querySelector('.modal .silo-id-num')?.textContent || '').length > 3", timeout=20000)
    pg.click(f'.modal .pick:has-text("{grano}")')
    kg_keys(pg, 0, kg, close=not frames)
    if frames: shot(pg, '05-kilos', '.kb-done'); pg.click('.kb-done'); pg.wait_for_selector('.kb-num', state='detached')
    kg_keys(pg, 1, hum[:-1] + ',' + hum[-1])
    if prio: pg.click(f'.modal .prio-pick .pick.is-{prio}')
    if frames:
        pg.locator('.modal .prio-pick').scroll_into_view_if_needed(); shot(pg, '06-ficha', '.modal-foot .btn-primary')
    pg.click('.modal-foot .btn-primary'); pg.wait_for_selector('.modal', state='detached'); pg.wait_for_timeout(600)

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={'width': 390, 'height': 797}, device_scale_factor=3, has_touch=True, is_mobile=True,
                         permissions=['geolocation'], geolocation={'latitude': -35.9445, 'longitude': -60.3950, 'accuracy': 3},
                         timezone_id='America/Argentina/Buenos_Aires', locale='es-AR')
    pg = ctx.new_page()
    pg.goto(URL + '/login'); pg.wait_for_selector('.login-card')
    pg.fill('input[autocomplete=username]', 'rodma'); pg.fill('input[type=password]', 'rmaldonado'); pg.click('button[type=submit]')
    pg.wait_for_timeout(1200)
    for t in ['Permitir ubicación', 'Ahora no']:
        if pg.locator(f'button:has-text("{t}")').count(): pg.click(f'button:has-text("{t}")'); break
    pg.wait_for_selector('.satmap')
    pg.request.post(URL + '/api.php?action=saveUser', data=json.dumps({'u': {'user': 'rodma', 'nombre': 'Rodrigo', 'apellido': 'Maldonado', 'rol': 'admin'}}), headers={'Content-Type': 'application/json'})
    pg.request.post(URL + '/api.php?action=saveEstancia', data=json.dumps({'estancia': {'nombre': 'Agropecuaria La Aurora', 'sigla': 'LA'}}), headers={'Content-Type': 'application/json'})
    # lotes desde el KML
    pg.click('.avatar-btn'); pg.wait_for_selector('.set-link')
    pg.goto(URL + '/dashboard/mapas'); pg.wait_for_selector('.kml-sec')
    pg.set_input_files('.kml-sec input[type=file]', str(kml)); pg.wait_for_selector('.kml-row')
    pg.fill('.kml-est input >> nth=0', 'La Aurora'); pg.wait_for_timeout(150)
    btn = pg.locator('.kml-sec .btn-primary'); btn.click(); pg.wait_for_selector('.kml-confirm'); btn.click()
    pg.wait_for_selector('.leaflet-container', timeout=15000)
    pg.goto(URL + '/dashboard/inicio'); pg.wait_for_selector('.satmap'); pg.wait_for_timeout(1500)
    for s in SILOS: registrar(pg, ctx, s)
    pg.reload(); pg.wait_for_selector('.satmap')
    registrar(pg, ctx, ULTIMO, frames=True)
    pg.wait_for_timeout(2500); shot(pg, '07-guardada')
    # navegación a pie hasta la bolsa con prioridad de salida del lote 34
    (dest, _) = bolsa(34, 220, 0)
    start = (dest[0] + 260 * M_LAT, dest[1] + 330 * M_LNG)
    ctx.set_geolocation({'latitude': start[0], 'longitude': start[1], 'accuracy': 4}); pg.wait_for_timeout(2000)
    pg.click('.nav-start'); pg.wait_for_selector('.nav-near-row'); pg.wait_for_timeout(2500)
    row = '.nav-near-row:has-text("LA34001")'
    shot(pg, '08-cercanas', row)
    pg.click(row); pg.wait_for_timeout(2500)
    camino = [(start[0] - 30 * M_LAT, start[1] - 20 * M_LNG)]
    # por el camino interno y después hacia la bolsa
    via = (LOTS[34]['n'] + 20 * M_LAT, start[1] - 60 * M_LNG)
    for k in range(1, 6): camino.append((start[0] + (via[0] - start[0]) * k / 5, start[1] + (via[1] - start[1]) * k / 5))
    for k in range(1, 7): camino.append((via[0] + (dest[0] - via[0]) * k / 6, via[1] + (dest[1] + 30 * M_LNG - via[1]) * k / 6))
    for i, (la, lo) in enumerate(camino):
        ctx.set_geolocation({'latitude': la, 'longitude': lo, 'accuracy': 4}); pg.wait_for_timeout(1300)
        pg.screenshot(path=str(OUT / f'09-nav-{i:02d}.png'))
    ctx.set_geolocation({'latitude': dest[0], 'longitude': dest[1] + 30 * M_LNG, 'accuracy': 3}); pg.wait_for_timeout(2500)
    shot(pg, '10-llegaste')
    pg.click('.navi-foot button:has-text("Terminar")'); pg.wait_for_timeout(600)
    # panel: silobolsas ordenadas por prioridad de salida
    pg.goto(URL + '/dashboard/silos'); pg.wait_for_selector('.silo-row'); pg.wait_for_timeout(800); shot(pg, '11-silos')
    pg.goto(URL + '/dashboard/lotes'); pg.wait_for_selector('.lot-card'); pg.wait_for_timeout(800); shot(pg, '12-lotes')
    # escritorio
    d = br.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=2, permissions=['geolocation'],
                       geolocation={'latitude': start[0], 'longitude': start[1], 'accuracy': 4}, timezone_id='America/Argentina/Buenos_Aires', locale='es-AR')
    dp = d.new_page(); dp.goto(URL + '/login'); dp.wait_for_selector('.login-card')
    dp.fill('input[autocomplete=username]', 'rodma'); dp.fill('input[type=password]', 'rmaldonado'); dp.click('button[type=submit]'); dp.wait_for_timeout(1200)
    for t in ['Permitir ubicación', 'Ahora no']:
        if dp.locator(f'button:has-text("{t}")').count(): dp.click(f'button:has-text("{t}")'); break
    dp.wait_for_selector('.satmap'); dp.wait_for_timeout(4000); dp.screenshot(path=str(OUT / '20-escritorio-inicio.png'))
    dp.goto(URL + '/dashboard/silos'); dp.wait_for_selector('.silo-row'); dp.wait_for_timeout(1200); dp.screenshot(path=str(OUT / '21-escritorio-silos.png'))
    br.close()
(OUT / 'boxes.json').write_text(json.dumps(boxes, indent=1))
print('capturas:', sorted(x.name for x in OUT.glob('*.png')))
