# Convierte las capturas a WebP livianas para la landing y anota el color de la barra de estado de cada pantalla.
# Uso: python tests/capturas_webp.py CARPETA_PNG
import json, sys
from pathlib import Path
from PIL import Image
SRC = Path(sys.argv[1]); ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public_html/img/app'; OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob('*.webp'): old.unlink()
boxes = json.loads((SRC / 'boxes.json').read_text())
meta = {}
for png in sorted(SRC.glob('*.png')):
    im = Image.open(png).convert('RGB')
    if png.stem.startswith('2'):  # escritorio
        name = {'20-escritorio-inicio': 'escritorio-inicio', '21-escritorio-silos': 'escritorio-silos'}.get(png.stem, png.stem)
        im.resize((1440, round(im.height * 1440 / im.width)), Image.LANCZOS).save(OUT / f'{name}.webp', 'WEBP', quality=74, method=6)
        continue
    # color de la franja superior: la barra de estado del iPhone lo continúa
    top = im.crop((0, 0, im.width, 6)).resize((1, 1), Image.BOX).getpixel((0, 0))
    lum = (0.2126 * top[0] + 0.7152 * top[1] + 0.0722 * top[2]) / 255
    meta[png.stem] = {'sb': '#%02x%02x%02x' % top, 'ink': '#0A0A0A' if lum > 0.55 else '#F2F2F2',
                      'taps': [[b['x'], b['y']] for b in boxes.get(png.stem, [])]}
    im.resize((600, round(im.height * 600 / im.width)), Image.LANCZOS).save(OUT / f'{png.stem}.webp', 'WEBP', quality=72, method=6)
(ROOT / 'src/capturas.json').write_text(json.dumps(meta, indent=1))
print('webp:', len(list(OUT.glob('*.webp'))), 'KB:', sum(f.stat().st_size for f in OUT.glob('*.webp')) // 1024)
