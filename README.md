# SemIA · Registro de silobolsas

App web móvil (React + HTML5 + CSS + PHP) para registrar silobolsas en la **Est. Rincón de Baguales**: los lotes se cargan desde un **KML** con sus límites reales y cada bolsa se ubica con el **GPS del celular** marcando su cabecera y su cola.

Tema: negro `#000000`, lima `#CCFF00`, gris `#999999` y claro `#F2F2F2`; modo oscuro y claro con la misma paleta. Pensada para el celular (barra inferior con botón central **+**, hojas inferiores, instalable como app); la misma base sirve para empaquetar el APK de Android.

## Estructura

```
SemIA/
├─ public_html/          ← ESTO es lo que se sube a Hostinger
│  ├─ index.html         página única
│  ├─ script.js          app React compilada (no editar a mano: se genera desde src/)
│  ├─ tiff.js, pdf.js, pdf.worker.js   lectores de GeoTIFF y PDF (se cargan solo al subir un mapa)
│  │                     (el lector de KML/KMZ va dentro de script.js)
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

**Usuario administrador:** `rodma` (la contraseña inicial se cambia en Ajustes → Usuarios al primer ingreso).

## Subir a Hostinger

1. En el Administrador de archivos, subir **el contenido** de `public_html/` a `public_html/` del dominio (incluidos `.htaccess` y las carpetas `uploads/` y `backups/`).
2. Verificar que `data.json`, `uploads/` y `backups/` tengan permiso de escritura (644 / 755).
3. Activar el SSL del dominio (el GPS y la cámara del celular lo requieren).
4. Entrar y **cambiar la contraseña** en Ajustes → Usuarios.
5. En el celular: menú del navegador → *Agregar a pantalla de inicio*.

`data.json` no es accesible desde la web (lo bloquea `.htaccess`); las contraseñas se guardan con bcrypt.

## Cómo se usa

- **Lotes desde KML (Mapas → Lotes desde KML, administrador):** elegí un `.kml` o `.kmz` (Google Earth, QGIS, Pix4Dfields). Cada polígono es un lote: el número se toma del nombre (`Lote 16`, `16 - La Loma`) o de un campo `lote`; las hectáreas, de un campo `ha` o se calculan. Un polígono llamado *Perímetro / Campo / Estancia* se usa como contorno, y las líneas (caminos, cortinas) se dibujan en el plano. Antes de confirmar se ven todos los polígonos, se puede corregir el número o excluir alguno. El primer KML reemplaza el plano digitalizado; los siguientes se **agregan** (otros campos o sectores) sin tocar lo cargado, y la lista *KML cargados* permite quitar uno con sus lotes. *Reemplazar todo* reubica los silos por sus coordenadas. Con KML no hacen falta puntos de control.
- **Versión nueva:** cuando se publica una actualización aparece un botón flotante *Nueva versión · Actualizar*.
- **Nueva silobolsa (botón + de la barra):**
  1. Parate en la **cabecera** de la bolsa y tocá *Marcar cabecera (A)*: se toman lecturas durante 5 segundos y se promedian.
  2. Caminá hasta la **cola** (se ve la distancia en vivo) y tocá *Marcar cola (B)*, o *Solo un punto*.
  3. Se abre la ficha con el lote detectado por coordenadas, el ID automático, el **largo en metros**, kg, grano, observación y foto.
  Sin GPS o sin lotes georreferenciados, se marca tocando el plano.
- **Mapa (satélite):** lotes con su número (al tocar uno se ven sus hectáreas), bolsas (línea A‑B) y tu posición sobre la imagen Esri; filtro **Mapa a mostrar** para tus ortomosaicos.
- **Filtro Estancia:** cada KML cargado es una estancia; en Mapa, Lotes y Silos se elige cuál mostrar (los indicadores también se filtran). En Lotes se busca por número o nombre.
- **Lotes con nombre:** un lote puede llamarse con letras (ej. *Casco*, donde está el personal); esos lotes no reciben silobolsas.
- **Ajustar forma (admin):** cada lote se ajusta por separado (los vecinos no se mueven). Las bolsas ubicadas por GPS quedan donde se midieron.
- **Mover (admin):** tocar el silo → *Mover* → arrastrar el punto central; la bolsa A‑B se traslada completa.
- **Mapas propios:** GeoTIFF (se ubica solo), PDF, JPG/PNG/WebP con barra de proceso.
- **Estancias:** cada KML es una estancia con nombre y sigla propia (al cargarlo se propone desde el nombre: *Los Gatos* → `LG`). Un mismo número de lote puede existir en estancias distintas.
- **ID:** `LG31010` = LG (sigla de la estancia) + 31 (lote) + 010 (bolsa). Nombre y sigla se editan en Ajustes → Estancias o en Mapas; los IDs ya cargados no cambian.
- **Exportar (Silos):** **KML** con lotes y bolsas (para Google Earth / QGIS) y **CSV** con cabecera, cola y largo.
- **Ajustes** (tu inicial arriba a la derecha): Mi cuenta, Apariencia, Estancia, Usuarios, Lotes y ubicación, Datos.
- **Mapas y KML cargados:** cada uno se puede renombrar o eliminar desde la pestaña Mapas.
- **Roles:** el operador registra silos; el administrador además mueve, elimina, edita lotes, carga KML y gestiona usuarios.

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
node tests/geo.test.mjs       # geometría, homografía, IDs, lectura y exportación KML
bash tests/api.test.sh http://localhost:8000      # API (con php -S corriendo)
python3 tests/e2e.py http://localhost:8000 public_html   # flujo completo en navegador
```
`tools/build_data.py` regenera `data.json` desde la geometría **y lo deja vacío de silos**: no usarlo sobre la base de producción.

## Notas

- Si al subir un mapa grande aparece un error del servidor, subir en hPanel → Avanzado → Configuración de PHP los valores `post_max_size` y `upload_max_filesize` (ej. 64M).

- Los lotes se digitalizaron del PDF (imagen) con detección de líneas; las hectáreas mostradas son las del plano y se pueden ajustar.
- La imagen satelital (Esri World Imagery) necesita conexión a internet.
