# SemIA · Registro de silobolsas

App web móvil (React + HTML5 + CSS + PHP) para registrar silobolsas por lote en la **Est. Rincón de Baguales**.

## Estructura

```
SemIA/
├─ public_html/          ← ESTO es lo que se sube a Hostinger
│  ├─ index.html         página única
│  ├─ script.js          app React compilada (no editar a mano: se genera desde src/)
│  ├─ style.css          estilos (paleta #183630 · #E3DAC9 · #E5C690, radio 6px)
│  ├─ api.php            API: login, silos, lotes, georreferencia, fotos, usuarios
│  ├─ data.seed.json     plantilla inicial; api.php crea data.json la primera vez
│  ├─ .htaccess          protege data.json, fuerza HTTPS
│  ├─ manifest.json, sw.js, icon*.{svg,png}   instalable como app en el celular
│  ├─ uploads/           fotos de los silos
│  └─ backups/           copia diaria automática de data.json
├─ src/                  código fuente React (main, Map3D, SatMap, modals, screens, geo, store)
├─ tests/                pruebas automáticas (geometría, API, navegador)
├─ tools/                digitalización del plano PDF → polígonos de lotes
├─ build.mjs, package.json
```

## Usarla localmente

**Opción A · doble clic en `public_html/index.html`** → abre en *modo local*: los datos quedan guardados en ese navegador (fotos incluidas). Sirve para probar el plano 3D y la carga marcando el silo en el mapa.

**Opción B · con servidor PHP (recomendado, igual que en Hostinger)**
```
cd public_html
php -S localhost:8000
```
Abrir `http://localhost:8000`. Así funciona la API, el GPS y la cámara (el navegador solo da ubicación en `https` o `localhost`).

**Usuario:** `rodma` · **Contraseña:** `rmaldonado` (administrador).

## Subir a Hostinger

1. En el Administrador de archivos, subir **el contenido** de `public_html/` a `public_html/` del dominio (incluidos `.htaccess` y las carpetas `uploads/` y `backups/`).
2. Verificar que `data.json`, `uploads/` y `backups/` tengan permiso de escritura (644 / 755).
3. Activar el SSL del dominio (el GPS y la cámara del celular lo requieren).
4. Entrar y **cambiar la contraseña** en Ajustes → Usuarios.
5. En el celular: menú del navegador → *Agregar a pantalla de inicio*.

`data.json` no es accesible desde la web (lo bloquea `.htaccess`); las contraseñas se guardan con bcrypt.

## Cómo se usa

- **Plano 3D:** pasar el cursor (o tocar) un lote lo eleva. Arrastrar = mover; rueda / pellizco = zoom; botón derecho o dos dedos = girar; botón 2D/3D.
- **Tuerca sobre el lote:** edita número, hectáreas, subdivisiones, nombre y observaciones (también desde la pestaña Lotes).
- **Puntos de control (Ajustes):** elegir cualquier lote y su esquina por orientación (N, NE, E, SE, S, SO, O, NO), pararse ahí y tocar el ícono de ubicación. Con 4 puntos el plano se ubica sobre el **mapa satelital**; se pueden cargar hasta 12 y el ajuste por mínimos cuadrados informa el desvío en metros de cada punto (en rojo si supera 15 m).
- **Ajustar forma (admin):** con el lote seleccionado en *Satélite* → *Ajustar forma*. Se arrastran los vértices, *+* agrega uno, *Quitar vértice*, *Deshacer* y *Original*. Los vértices compartidos mueven también al lote vecino; los puntos de control GPS quedan fijos; los silos del lote se reubican sobre el nuevo borde.
- **Botón +:** toma tu ubicación en tiempo real, detecta el lote y ubica el silo sobre su **borde**. Se abre la ficha con ID automático, Kg, grano, observación y foto. Sin GPS o sin georreferencia, se marca tocando el borde del lote.
- **ID:** `RB16001` = RB (estancia) + 16 (lote) + 001 (bolsa). La sigla se cambia en Ajustes.
- **Recorrido:** los silos de cada lote se unen en el orden de carga siguiendo el borde (línea punteada).
- **Corregir ubicación (admin):** tocar el silo → *Mover* → arrastrarlo; se desliza solo por el contorno del lote → *Guardar*.
- **Roles:** el operador registra silos; el administrador además mueve, elimina, edita lotes, georreferencia y gestiona usuarios.
- **Exportar:** CSV de silos (pestaña Silos) y respaldo JSON (Ajustes).

## Repositorio y despliegue automático

Cada `push` a `main` corre las pruebas y, si pasan, publica `public_html/` en Hostinger por FTP
(`.github/workflows/deploy.yml`). **`data.json`, `uploads/` y `backups/` nunca se suben ni se pisan**:
los datos cargados en el campo viven solo en el servidor.

Secretos a cargar en GitHub → Settings → Secrets and variables → Actions:
`FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` (cuenta FTP de Hostinger) y `FTP_DIR` (ej. `/public_html/`).

## Desarrollo

```
npm install
npm run build                 # src/ → public_html/script.js + style.css
node tests/geo.test.mjs       # geometría, homografía, IDs
bash tests/api.test.sh http://localhost:8000      # API (con php -S corriendo)
python3 tests/e2e.py http://localhost:8000 public_html   # flujo completo en navegador
```
`tools/build_data.py` regenera `data.json` desde la geometría **y lo deja vacío de silos**: no usarlo sobre la base de producción.

## Notas

- Los lotes se digitalizaron del PDF (imagen) con detección de líneas; las hectáreas mostradas son las del plano y se pueden ajustar.
- La imagen satelital (Esri World Imagery) necesita conexión a internet.
