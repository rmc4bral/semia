# Control de textos cortados (ancho, alto o colas de letras) en todas las pantallas: python3 tests/textos.test.py http://127.0.0.1:PUERTO  (requiere datos cargados)
import json, sys
from playwright.sync_api import sync_playwright
URL=sys.argv[1]
JS = r"""() => {
  const out = [];
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e) || e.closest('.leaflet-container')) continue;
    const t = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    if (!t) continue;
    const s = getComputedStyle(e), fs = parseFloat(s.fontSize), lh = s.lineHeight === 'normal' ? fs * 1.3 : parseFloat(s.lineHeight);
    const clipX = (s.overflowX !== 'visible' || s.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1;
    const clipY = s.overflowY !== 'visible' && e.scrollHeight > e.clientHeight + 1 && s.overflowY !== 'auto' && s.overflowY !== 'scroll';
    let anc = e, hid = false; while (anc && anc !== document.body) { const a = getComputedStyle(anc); if (a.overflow === 'hidden' || a.overflowY === 'hidden') { hid = true; break; } anc = anc.parentElement; }
    const desc = /[gjpqy,(]/.test(t) && lh / fs < 1.18 && (s.overflow === 'hidden' || s.overflowY === 'hidden');
    if (clipX || clipY || desc) out.push({ t: t.slice(0, 40), cls: (e.className && e.className.baseVal === undefined ? e.className : e.tagName), why: [clipX && 'ancho', clipY && 'alto', desc && 'colas'].filter(Boolean).join('+'), w: e.clientWidth, sw: e.scrollWidth });
  }
  return out;
}"""
def run(w, h, who='rodma', pw='rmaldonado'):
    res = {}
    with sync_playwright() as p:
        b = p.chromium.launch(); c = b.new_context(viewport={'width': w, 'height': h}, geolocation={'latitude': -35.9455, 'longitude': -60.3815, 'accuracy': 5}, permissions=['geolocation'])
        pg = c.new_page(); pg.goto(URL); pg.wait_for_selector('.login-card')
        res['login'] = pg.evaluate(JS)
        pg.fill('input[autocomplete=username]', who); pg.fill('input[type=password]', pw); pg.click('button[type=submit]'); pg.wait_for_timeout(1200)
        for t in ['Permitir ubicación', 'Ahora no']:
            if pg.locator(f'button:has-text("{t}")').count(): pg.click(f'button:has-text("{t}")'); break
        pg.wait_for_selector('.satmap'); pg.wait_for_timeout(800)
        res['mapa'] = pg.evaluate(JS)
        if pg.locator('.lot-bar, .silo-bar').count() == 0:
            pass
        pg.click('.nav-add'); pg.wait_for_timeout(900); res['elegir-lote'] = pg.evaluate(JS)
        if pg.locator('.cap-foot button:has-text("Cancelar")').count(): pg.click('.cap-foot button:has-text("Cancelar")')
        for tab in ['Silos', 'Lotes', 'Mapas', 'Ajustes', 'Cuenta']:
            loc = pg.locator(f'.nav button:has-text("{tab}")')
            if loc.count() and loc.first.is_visible(): loc.first.click(); pg.wait_for_timeout(900); res[tab] = pg.evaluate(JS)
            if tab == 'Silos' and pg.locator('.list-card .silo-row').count():
                pg.locator('.list-card .silo-row').first.click(); pg.wait_for_timeout(700); res['ficha'] = pg.evaluate(JS); pg.click('.modal-head button[aria-label="Cerrar"]')
            if tab == 'Lotes' and pg.locator('.lot-card .lot-card-main').count():
                pg.locator('.lot-card .lot-card-main').first.click(); pg.wait_for_timeout(700); res['detalle-lote'] = pg.evaluate(JS); pg.click('.modal-head button[aria-label="Cerrar"]')
        b.close()
    return res
tot = 0
for w, h in [(360, 740), (390, 844), (1440, 900)]:
    for k, v in run(w, h).items():
        for i in v: tot += 1; print(f'{w}px {k}: [{i["why"]}] {i["cls"]} → "{i["t"]}" ({i["w"]}/{i["sw"]})')
print('textos cortados:', tot)
