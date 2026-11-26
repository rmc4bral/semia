# Acopia · Registro de silobolsas

> Antes se llamaba SemIA. Por ahora sigue en este repositorio (`rmc4bral/semia`); la migración a uno propio queda para más adelante.

App web móvil (React + HTML5 + CSS + PHP) para registrar silobolsas en la **Est. Rincón de Baguales**: los lotes se cargan desde un **KML** con sus límites reales y cada bolsa se ubica con el **GPS del celular** marcando su cabecera y su cola.

Tema: negro `#000000`, lima `#CCFF00`, gris `#999999` y claro `#F2F2F2`; modo oscuro y claro con la misma paleta. Pensada para el celular (barra inferior con botón central **+**, hojas inferiores, instalable como app); la misma base sirve para empaquetar el APK de Android.

## Estructura

```
acopia/
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
- **Supervisor:** ingresa → elige la **Estancia** (paso 1) → activa la **ubicación** (paso 2, obligatoria) → registra. Su menú es solo **Mapa, Silos, + y Lotes** (y *Cuenta* para cambiar de estancia o salir). Ve únicamente los lotes y silos de la estancia elegida. En **Lotes**, al tocar uno ve cuántos silos tiene, los granos y las toneladas.
- **Administrador:** primer paso, activar la ubicación (con «Ahora no» vuelve a preguntar al abrirla de nuevo). Tiene además Mapas, Ajustes, KML, usuarios y exportación.
- **Nueva silobolsa (botón + de la barra):**
  0. **Elegí el lote** primero: el GPS puede moverse o caer entre dos lotes, así que el supervisor lo confirma (se marca como *Estás acá* el que indica el GPS). Durante la medición se ve la distancia al contorno del lote (las bolsas suelen ir sobre el contorno) y avisa si está a más de 40 m afuera.
  1. Parate en la **cabecera** de la bolsa y tocá *Marcar cabecera (A)*: se toman lecturas durante 5 segundos y se promedian.
  2. Caminá hasta la **cola** (se ve la distancia en vivo) y tocá *Marcar cola (B)*, o *Solo un punto*.
  3. Se abre la ficha con el **número detallado** (estancia · lote · bolsa), la ubicación y el largo, el **grano** (obligatorio, con botones), los **kg (opcional)**, la **foto** y las **observaciones** del supervisor.
  Sin GPS o sin lotes georreferenciados, se marca tocando el plano.
- **Inicio (mapa general):** lotes con su número (al tocar uno se ven sus hectáreas), bolsas (línea A‑B) y tu posición sobre la imagen Esri; filtro **Mapa a mostrar** para tus ortomosaicos.
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
- **Navegar (estilo Google Maps):** botón *Navegar* en el mapa o *Ir* en la barra de un silo. Flecha con el rumbo, el mapa sigue al usuario (*Centrar* si se lo movió), cartel con distancia, dirección y tiempo a pie hasta la silobolsa, aviso de llegada, recorrido dibujado y líneas con la distancia a las silobolsas más cercanas. Al marcar una bolsa nueva se muestra a cuántos metros están las vecinas.
- **Saludo:** «Buenos días / Buenas tardes / Buenas noches, Nombre» según la hora.
- **Teclados propios:** numérico para kg (con toneladas debajo) y hectáreas; de texto en español para observaciones, con tecla *Sistema* para usar el teclado del celular (dictado por voz). Solo en pantallas táctiles.
- **Enter = Guardar:** en cualquier formulario (lotes, silos, estancias, usuarios, contraseña) Enter guarda sin tocar el botón, que sigue disponible.
- **Tarjeta de cada silo** (tocándolo en Silos, Lotes o el mapa): ID, lugar (cabecera, cola y largo), estancia, lote, grano, kg, fecha de registro y usuario que lo registró, más foto y observaciones.
- **Roles:** el supervisor registra silos y edita los suyos; el administrador además mueve, elimina, edita lotes, carga KML y gestiona usuarios.

## Producción: acopia.app (Hostinger)

> **Dónde están los datos:** el Git de Hostinger reemplaza la carpeta del sitio en cada publicación (y puede publicar cada versión en una carpeta nueva enlazada como `public_html`). Por eso la base (`data.json`), las fotos, los mapas y los respaldos diarios (60 días) viven en **`~/acopia-datos/`**, la carpeta personal de la cuenta: fuera de la web, fuera de git y fuera de cualquier despliegue. Si encuentra datos en ubicaciones anteriores, la app los recupera sola. Diagnóstico (administrador): `api.php?action=health`.

En cada push a `main`, GitHub Actions prueba todo y deja la web lista en la rama **`hostinger`** (solo el contenido de `public_html/`, sin `data.json`, `uploads/` ni `backups/`).

1. hPanel → acopia.app → **Archivos**: vaciar la carpeta `public_html` del dominio (borrar `default.php`).
2. hPanel → **Avanzado → GIT**: repositorio `https://github.com/rmc4bral/semia.git`, rama `hostinger`, directorio vacío → *Crear*, y después *Implementar*.
3. En la misma pantalla, **Implementación automática** → copiar la URL del webhook → GitHub → *Settings → Webhooks → Add webhook* (Payload URL = esa URL, evento *Just the push event*).
4. hPanel → **Seguridad → SSL**: certificado activo para acopia.app (el GPS y la cámara exigen HTTPS). PHP 8.1 o superior.
5. Primer ingreso con el usuario administrador de `data.seed.json` y **cambiar la contraseña** en Ajustes → Mi cuenta (el repositorio es público).

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
